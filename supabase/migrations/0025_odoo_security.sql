-- 0025: layered protection for the live Odoo connection. Needs 0016. Nothing is removed from the data.
--  1. The encrypted API key cannot be read through the database API: signed-in users see every column but the key; the
--     server reads it through odoo_secret(), which checks the caller edits that company. The app also binds each key to
--     its company, address, database and login when it encrypts it (a copy moved anywhere else cannot be decrypted).
--  2. A connection is written only through odoo_save(), by an admin of the company; editors may update the sync status
--     columns only. Admins remove a connection.
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
-- No direct writes but the sync's status columns; the key, address and settings go through odoo_save() below.
revoke insert, update on public.odoo_connections from authenticated;
grant update (status, last_error, last_sync_at, version, sync_started_at) on public.odoo_connections to authenticated;

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
  if new.company_id is distinct from old.company_id then
    raise exception 'An Odoo connection cannot move to another company.' using errcode = '42501';
  end if;
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

-- The one way to save a connection: an admin of the company, a key the app encrypted (v2, bound to this connection), or
-- no key to keep the saved one (cleared by odoo_key_follows_target if the address, database or login changed).
create or replace function public.odoo_save(p_company uuid, p_url text, p_db text, p_login text, p_key_enc text, p_odoo_company_id integer,
  p_odoo_company_name text, p_include_branches boolean, p_months integer, p_version text, p_key_expires_on date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'admin') then raise exception 'Only an admin can change the Odoo connection.' using errcode = '42501'; end if;
  if p_key_enc is not null and (p_key_enc !~ '^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' or length(p_key_enc) > 2000) then
    raise exception 'invalid key' using errcode = '22023';
  end if;
  if p_url !~ '^https://' or length(p_url) > 300 or length(p_db) > 120 or length(p_login) > 200 or length(coalesce(p_odoo_company_name, '')) > 200 or length(coalesce(p_version, '')) > 40 then
    raise exception 'invalid connection' using errcode = '22023';
  end if;
  if p_key_enc is null and not exists (select 1 from public.odoo_connections where company_id = p_company and api_key_enc <> '') then
    raise exception 'Enter the API key.' using errcode = 'P0001';
  end if;
  insert into public.odoo_connections as c (company_id, url, db, login, api_key_enc, odoo_company_id, odoo_company_name, include_branches, months_history, version, status, last_error, key_expires_on)
    values (p_company, p_url, p_db, p_login, coalesce(p_key_enc, ''), p_odoo_company_id, p_odoo_company_name, p_include_branches, p_months, p_version, 'saved', null, p_key_expires_on)
  on conflict (company_id) do update set
    url = excluded.url, db = excluded.db, login = excluded.login,
    api_key_enc = coalesce(p_key_enc, c.api_key_enc),
    odoo_company_id = excluded.odoo_company_id, odoo_company_name = excluded.odoo_company_name, include_branches = excluded.include_branches,
    months_history = excluded.months_history, version = excluded.version, key_expires_on = excluded.key_expires_on, last_error = null,
    -- A sync running now keeps its claim.
    status = case when c.status = 'syncing' then c.status else 'saved' end;
end $$;
revoke execute on function public.odoo_save(uuid, text, text, text, text, integer, text, boolean, integer, text, date) from public, anon;
grant execute on function public.odoo_save(uuid, text, text, text, text, integer, text, boolean, integer, text, date) to authenticated;

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
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action not in ('test', 'sync', 'refused') then raise exception 'invalid audit action' using errcode = '22023'; end if;
  -- More than the Odoo limits allow in an hour is not the app writing.
  if (select count(*) from public.odoo_audit where company_id = p_company and user_id = (select auth.uid()) and at > now() - interval '1 hour') >= 100 then
    raise exception 'too many log entries' using errcode = '54000';
  end if;
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
    -- When the company itself is being deleted its log goes with it; nothing to record.
    if exists (select 1 from public.companies where id = old.company_id) then
      insert into public.odoo_audit (company_id, user_id, action, ok, detail) values (old.company_id, (select auth.uid()), 'disconnect', true, left(old.url, 500));
    end if;
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

-- Only editors may count the company's Odoo limits, so a viewer cannot use them up and block syncing.
create or replace function public.rate_limit_hit(p_scope text, p_subject text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s private.rate_scopes;
  k text;
  n integer;
begin
  select * into s from private.rate_scopes where scope = p_scope;
  if not found or p_subject is null or length(p_subject) = 0 or length(p_subject) > 80 then raise exception 'invalid rate limit'; end if;
  if s.subject_kind = 'user' and p_subject is distinct from (select auth.uid())::text then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.subject_kind = 'company' and not private.is_member(private.company_org(p_subject::uuid)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.subject_kind = 'company' and p_scope like 'odoo\_%' and not private.is_member(private.company_org(p_subject::uuid), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.subject_kind = 'org' and not private.is_member(p_subject::uuid) then raise exception 'not allowed' using errcode = '42501'; end if;
  k := p_scope || ':' || p_subject;
  delete from private.rate_events where key = k and at < now() - make_interval(secs => s.window_s);
  if random() < 0.01 then delete from private.rate_events where at < now() - interval '8 days'; end if;
  select count(*) into n from private.rate_events where key = k;
  if n >= s.max_hits then return false; end if;
  insert into private.rate_events (key) values (k);
  return true;
end $$;
revoke execute on function public.rate_limit_hit(text, text) from public;
grant execute on function public.rate_limit_hit(text, text) to anon, authenticated;
