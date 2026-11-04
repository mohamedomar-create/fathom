-- 0054: business plans (the Planning screen).
--  * business_plans: one jsonb document per plan (the app's cleaned BusinessPlan), up to 20 a company.
--  * plan_create / plan_save / plan_delete: editors only, all-or-nothing; creating and deleting are recorded in
--    company_data_audit. A save names the version it was edited from (updated_at): a stale one is refused (hint stale_plan), so
--    two tabs or two people never silently overwrite each other.
--  * Note: company_data_audit_action_check gains plan_create / plan_delete. A later migration that redefines that
--    check must keep them, or it fails once plan audit rows exist.
-- Members read. Nobody writes the table directly. Only adds objects: safe to run again.
set client_min_messages = warning;

create table if not exists public.business_plans (
  company_id uuid not null references public.companies (id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,40}$'),
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 2097152),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, id)
);

alter table public.business_plans enable row level security;
drop policy if exists business_plans_read on public.business_plans;
create policy business_plans_read on public.business_plans for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.business_plans from anon;
revoke insert, update, delete, truncate on public.business_plans from authenticated;
grant select on public.business_plans to authenticated;

alter table public.company_data_audit drop constraint if exists company_data_audit_action_check;
alter table public.company_data_audit add constraint company_data_audit_action_check
  check (action in ('clear_module', 'clear_all', 'delete_company', 'transfer_company', 'restore_company', 'close_month', 'reopen_month', 'freeze_report', 'plan_create', 'plan_delete'));

create or replace function private.plan_guard(p_company uuid, p_id text, p_data jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,40}$' then raise exception 'The plan id is not valid.'; end if;
  if p_data is not null and jsonb_typeof(p_data) <> 'object' then raise exception 'The business plan is not valid.'; end if;
  if p_data is not null and pg_column_size(p_data) > 2097152 then raise exception 'The business plan is too large (2 MB at most).'; end if;
end $$;

drop function if exists public.plan_create(uuid, text, jsonb);
drop function if exists public.plan_save(uuid, text, jsonb);

create or replace function public.plan_create(p_company uuid, p_id text, p_data jsonb) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz := clock_timestamp();
begin
  perform private.plan_guard(p_company, p_id, coalesce(p_data, '{}'::jsonb));
  perform 1 from public.companies where id = p_company for update;
  if (select count(*) from public.business_plans where company_id = p_company) >= 20 then
    raise exception 'Up to 20 business plans: delete an old one first.';
  end if;
  insert into public.business_plans (company_id, id, data, created_at, updated_at) values (p_company, p_id, coalesce(p_data, '{}'::jsonb), v_at, v_at);
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  select c.org_id, c.id, c.name, 'plan_create', p_id, jsonb_build_object('name', coalesce(p_data->>'name', '')) from public.companies c where c.id = p_company;
  return v_at;
end $$;

create or replace function public.plan_save(p_company uuid, p_id text, p_data jsonb, p_expected timestamptz default null) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_was timestamptz; v_at timestamptz := clock_timestamp();
begin
  if p_data is null then raise exception 'The business plan is not valid.'; end if;
  perform private.plan_guard(p_company, p_id, p_data);
  select updated_at into v_was from public.business_plans where company_id = p_company and id = p_id for update;
  if not found then raise exception 'That business plan does not exist.'; end if;
  if p_expected is not null and v_was <> p_expected then
    -- Not 40001: PostgREST retries serialization failures, so a stale save would hang instead of being refused.
    raise exception 'This plan was changed in another tab or by someone else.' using hint = 'stale_plan';
  end if;
  update public.business_plans set data = p_data, updated_at = v_at, updated_by = (select auth.uid())
   where company_id = p_company and id = p_id;
  return v_at;
end $$;

create or replace function public.plan_delete(p_company uuid, p_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  perform private.plan_guard(p_company, p_id, null);
  delete from public.business_plans where company_id = p_company and id = p_id returning data->>'name' into v_name;
  if not found then raise exception 'That business plan does not exist.'; end if;
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  select c.org_id, c.id, c.name, 'plan_delete', p_id, jsonb_build_object('name', coalesce(v_name, '')) from public.companies c where c.id = p_company;
end $$;

revoke execute on function private.plan_guard(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.plan_create(uuid, text, jsonb), public.plan_save(uuid, text, jsonb, timestamptz), public.plan_delete(uuid, text) from public, anon;
grant execute on function public.plan_create(uuid, text, jsonb), public.plan_save(uuid, text, jsonb, timestamptz), public.plan_delete(uuid, text) to authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('plan', 'user', 3600, 1200)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

do $$ begin perform private.install_tenant_guards(); end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 54 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
