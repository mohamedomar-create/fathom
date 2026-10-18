-- 0025: layered protection for the live Odoo connection. Needs 0016. Nothing is removed from the data.
--  1. The encrypted API key cannot be read through the database API: signed-in users see every column but the key; the
--     server reads it through odoo_secret(), which checks the caller edits that company.
--  2. Only an admin can save a connection, change its key, address, database, login, Odoo company or history, or remove it.
--     Editors can test and sync (status columns only).
--  3. Every change to a connection is recorded by a trigger in odoo_audit, an append-only log nobody can edit or delete;
--     the app adds tests, syncs and refusals through odoo_audit_log().
--  4. One sync at a time per company: odoo_claim_sync() takes the connection atomically; a claim older than 15 minutes
--     is treated as abandoned.
--  5. Limits per company on testing (10 an hour) and syncing (6 an hour), on top of the 20-an-hour limit per user.

-- ---------------------------------------------------------------- new columns
alter table public.odoo_connections add column if not exists has_key boolean generated always as (coalesce(api_key_enc, '') <> '') stored;
alter table public.odoo_connections add column if not exists key_expires_on date;
alter table public.odoo_connections add column if not exists sync_started_at timestamptz;
alter table public.odoo_connections add column if not exists created_at timestamptz not null default now();

-- ---------------------------------------------------------------- 1. the key is never readable through the API
revoke select on public.odoo_connections from anon, authenticated;
grant select (company_id, url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, version, status,
  last_error, last_sync_at, updated_at, has_key, key_expires_on, sync_started_at, created_at) on public.odoo_connections to authenticated;
revoke all on public.odoo_connections from anon;

create or replace function public.odoo_secret(p_company uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare k text;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  select api_key_enc into k from public.odoo_connections where company_id = p_company;
  return nullif(k, '');
end $$;
revoke execute on function public.odoo_secret(uuid) from public, anon;
grant execute on function public.odoo_secret(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. admins change the connection, editors sync
drop policy if exists odoo_insert on public.odoo_connections;
drop policy if exists odoo_delete on public.odoo_connections;
create policy odoo_insert on public.odoo_connections for insert to authenticated with check (private.is_member(private.company_org(company_id), 'admin'));
create policy odoo_delete on public.odoo_connections for delete to authenticated using (private.is_member(private.company_org(company_id), 'admin'));

create or replace function private.odoo_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Signed-in callers only (the database owner and server jobs are not limited here).
  if (select auth.uid()) is not null
     and (new.url, new.db, new.login, new.api_key_enc, new.odoo_company_id, new.include_branches, new.months_history, new.key_expires_on, new.company_id)
         is distinct from (old.url, old.db, old.login, old.api_key_enc, old.odoo_company_id, old.include_branches, old.months_history, old.key_expires_on, old.company_id)
     and not private.is_member(private.company_org(old.company_id), 'admin') then
    raise exception 'Only an admin can change the Odoo connection.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists odoo_admin_fields on public.odoo_connections;
-- Runs before odoo_key_follows_target (alphabetical), so the key it clears is judged on what the caller sent.
create trigger odoo_admin_fields before update on public.odoo_connections for each row execute function private.odoo_admin_fields();
revoke execute on function private.odoo_admin_fields() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. append-only audit log
create table if not exists public.odoo_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  action text not null check (action in ('test', 'save', 'key_changed', 'key_cleared', 'sync', 'disconnect', 'refused')),
  ok boolean not null,
  detail text check (length(detail) <= 500),
  rows_read integer check (rows_read >= 0),
  at timestamptz not null default now()
);
create index if not exists odoo_audit_company_idx on public.odoo_audit (company_id, at desc);
alter table public.odoo_audit enable row level security;
drop policy if exists odoo_audit_select on public.odoo_audit;
create policy odoo_audit_select on public.odoo_audit for select to authenticated using (private.is_member(private.company_org(company_id), 'viewer'));
-- No insert, update or delete for anyone through the API: rows come from the trigger below and odoo_audit_log().
revoke all on public.odoo_audit from anon, authenticated;
grant select on public.odoo_audit to authenticated;

create or replace function private.odoo_audit_block()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Two changes follow from deletions elsewhere and are allowed: a deleted company takes its log with it (cascade), and
  -- a deleted user's rows keep everything but the user id (set null).
  if tg_op = 'DELETE' and not exists (select 1 from public.companies where id = old.company_id) then return old; end if;
  if tg_op = 'UPDATE' and new.user_id is null and old.user_id is not null
     and not exists (select 1 from auth.users where id = old.user_id)
     and (new.id, new.company_id, new.action, new.ok, new.detail, new.rows_read, new.at) is not distinct from (old.id, old.company_id, old.action, old.ok, old.detail, old.rows_read, old.at) then
    return new;
  end if;
  raise exception 'The Odoo audit log cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists odoo_audit_block on public.odoo_audit;
create trigger odoo_audit_block before update or delete on public.odoo_audit for each row execute function private.odoo_audit_block();
revoke execute on function private.odoo_audit_block() from public, anon, authenticated;

create or replace function public.odoo_audit_log(p_company uuid, p_action text, p_ok boolean, p_detail text default null, p_rows integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'viewer') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action not in ('test', 'sync', 'refused') then raise exception 'invalid audit action' using errcode = '22023'; end if;
  insert into public.odoo_audit (company_id, user_id, action, ok, detail, rows_read)
    values (p_company, (select auth.uid()), p_action, p_ok, left(p_detail, 500), greatest(p_rows, 0));
end $$;
revoke execute on function public.odoo_audit_log(uuid, text, boolean, text, integer) from public, anon;
grant execute on function public.odoo_audit_log(uuid, text, boolean, text, integer) to authenticated;

create or replace function private.odoo_audit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.odoo_audit (company_id, user_id, action, ok, detail) values (new.company_id, (select auth.uid()), 'save', true, left(new.url || ' · ' || new.db || ' · ' || new.login, 500));
  elsif tg_op = 'DELETE' then
    insert into public.odoo_audit (company_id, user_id, action, ok, detail) values (old.company_id, (select auth.uid()), 'disconnect', true, left(old.url, 500));
    return old;
  else
    if new.api_key_enc is distinct from old.api_key_enc then
      insert into public.odoo_audit (company_id, user_id, action, ok, detail)
        values (new.company_id, (select auth.uid()), case when coalesce(new.api_key_enc, '') = '' then 'key_cleared' else 'key_changed' end, true, null);
    end if;
    if (new.url, new.db, new.login, new.odoo_company_id, new.include_branches, new.months_history, new.key_expires_on)
       is distinct from (old.url, old.db, old.login, old.odoo_company_id, old.include_branches, old.months_history, old.key_expires_on) then
      insert into public.odoo_audit (company_id, user_id, action, ok, detail) values (new.company_id, (select auth.uid()), 'save', true, left(new.url || ' · ' || new.db || ' · ' || new.login, 500));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists odoo_audit_changes on public.odoo_connections;
create trigger odoo_audit_changes after insert or update or delete on public.odoo_connections for each row execute function private.odoo_audit_changes();
revoke execute on function private.odoo_audit_changes() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. one sync at a time
create or replace function public.odoo_claim_sync(p_company uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare n integer;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.odoo_connections set status = 'syncing', sync_started_at = now()
    where company_id = p_company and (status <> 'syncing' or sync_started_at is null or sync_started_at < now() - interval '15 minutes');
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function public.odoo_claim_sync(uuid) from public, anon;
grant execute on function public.odoo_claim_sync(uuid) to authenticated;

-- ---------------------------------------------------------------- 5. limits per company
insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values
  ('odoo_test_company', 'company', 3600, 10),
  ('odoo_sync_company', 'company', 3600, 6)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;
