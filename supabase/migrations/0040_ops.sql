-- 0040: operations.
--  * public.schema_version(): the database says which update it is at; the app refuses to run against an older one
--    (one clear screen and a failing health check, instead of quiet fallbacks). Each later migration raises it.
--  * AI use is counted from each reply's tokens (ai_usage) against a monthly allowance per organisation (20 dollars by
--    default; only the owner raises it, up to 200). The app records what each reply used, and use is reported by the
--    caller, so it only ever counts against the caller's own organisation: there is no site-wide cap it could fill (the
--    whole site's spend is capped in the Anthropic console).
-- Adds objects only; safe to run again. Needs 0039.
set client_min_messages = warning;
set lock_timeout = '5s';

-- ---------------------------------------------------------------- AI allowance

alter table public.organizations add column if not exists ai_monthly_usd numeric not null default 20;
alter table public.organizations drop constraint if exists organizations_ai_monthly_usd_check;
alter table public.organizations add constraint organizations_ai_monthly_usd_check check (ai_monthly_usd between 0 and 200);

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  micros bigint not null default 0,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists ai_usage_org_at on public.ai_usage (org_id, at desc);
create index if not exists ai_usage_at on public.ai_usage (at);
alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_read on public.ai_usage;
create policy ai_usage_read on public.ai_usage for select to authenticated using (private.is_member(org_id, 'admin'));
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- The owner alone changes the allowance (with the owner and deleted marks from 0039).
create or replace function private.org_marks_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (new.owner_id is distinct from old.owner_id or new.deleted_at is distinct from old.deleted_at
     or (new.ai_monthly_usd is distinct from old.ai_monthly_usd and old.owner_id is distinct from (select auth.uid()))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.record_ai_usage(p_org uuid, p_kind text, p_input integer, p_output integer, p_micros bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Only people who can ask for AI work (editors) record it, and one record is at most what one reply can cost.
  if p_org is null or not private.is_member(p_org, 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_micros, 0) > 5000000 or coalesce(p_input, 0) > 1000000 or coalesce(p_output, 0) > 200000 then
    raise exception 'more than one reply can cost' using errcode = '22023';
  end if;
  insert into public.ai_usage (org_id, kind, input_tokens, output_tokens, micros)
  values (p_org, left(coalesce(p_kind, ''), 40), greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0), greatest(coalesce(p_micros, 0), 0));
end $$;

create or replace function public.ai_budget_ok(p_org uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_month bigint; v_limit numeric;
begin
  if p_org is null or not private.is_member(p_org) then raise exception 'not allowed' using errcode = '42501'; end if;
  select ai_monthly_usd into v_limit from public.organizations where id = p_org;
  select coalesce(sum(micros), 0) into v_month from public.ai_usage where org_id = p_org and at >= date_trunc('month', now());
  return v_month < coalesce(v_limit, 20) * 1000000;
end $$;

-- This month's use, added up for the organisation's admins (the Organisation page).
create or replace function public.ai_usage_month(p_org uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
begin
  if p_org is null or not private.is_member(p_org, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select coalesce(sum(micros), 0) from public.ai_usage where org_id = p_org and at >= date_trunc('month', now()));
end $$;

revoke execute on function public.record_ai_usage(uuid, text, integer, integer, bigint), public.ai_budget_ok(uuid), public.ai_usage_month(uuid) from public, anon;
grant execute on function public.record_ai_usage(uuid, text, integer, integer, bigint), public.ai_budget_ok(uuid), public.ai_usage_month(uuid) to authenticated;

-- ---------------------------------------------------------------- encryption key rotation
-- Saved Odoo keys may name the server key they were encrypted with (v3.<key id>.…), so the key can be rotated.
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
  if p_key_enc is not null and (p_key_enc !~ '^(v2|v3\.[a-z0-9]{1,12})\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' or length(p_key_enc) > 2000) then
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

-- The same key re-encrypted under the current server key (rotation): only an admin, and only if the saved key is still
-- the one that was read (a key saved meanwhile is never put back to the old one).
drop function if exists public.odoo_rekey(uuid, text);
create or replace function public.odoo_rekey(p_company uuid, p_old text, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(private.company_org(p_company), 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_new !~ '^v3\.[a-z0-9]{1,12}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' or length(p_new) > 2000 then raise exception 'invalid key' using errcode = '22023'; end if;
  if not exists (select 1 from public.odoo_connections where company_id = p_company and api_key_enc <> '') then raise exception 'no saved key' using errcode = '22023'; end if;
  update public.odoo_connections set api_key_enc = p_new where company_id = p_company and api_key_enc = p_old;
  if not found then raise exception 'The saved key changed meanwhile; open the page again.' using errcode = '40001'; end if;
end $$;
revoke execute on function public.odoo_rekey(uuid, text, text) from public, anon;
grant execute on function public.odoo_rekey(uuid, text, text) to authenticated;

do $$ begin if to_regprocedure('private.install_tenant_guards()') is not null then perform private.install_tenant_guards(); end if; end $$;
-- Last, so a run stopped part-way never claims to be at this version.
create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 40 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;

reset client_min_messages;
