-- 0057: per-company roles, and the open access items from the security review.
--  * company_roles: an admin gives a member another role in one company (editor, viewer, or no access) than in the rest
--    of the organisation. Admins keep full access. Members read their own rows; admins read their organisation's.
--  * private.company_can(company, role): the one check for "may this person do this in this company". Every function
--    and policy that checked the organisation role for a company is rewritten to use it (below), so no check is missed.
--  * set_company_role (admin, two-step sign-in, audited) and my_company_role (the page's own role).
--  * restore_organisation needs two-step sign-in and a fresh password, like deleting it.
-- Safe to run again.

create table if not exists public.company_roles (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('none', 'viewer', 'editor')),
  set_by uuid default auth.uid() references auth.users (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists company_roles_user on public.company_roles (user_id);
alter table public.company_roles enable row level security;
revoke all on public.company_roles from anon;
revoke insert, update, delete, truncate on public.company_roles from authenticated;
grant select on public.company_roles to authenticated;
drop policy if exists company_roles_read on public.company_roles;
create policy company_roles_read on public.company_roles for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(private.company_org(company_id), 'admin'));

-- Organisation role, unless the person has a company role (admins are never limited by one).
create or replace function private.company_can(c uuid, min_role public.member_role default 'viewer')
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when x.role is null then private.is_member(g.o, min_role)
    when private.is_member(g.o, 'admin') then private.is_member(g.o, min_role)
    when x.role = 'none' then false
    else private.is_member(g.o, 'viewer') and (min_role = 'viewer' or (min_role = 'editor' and x.role = 'editor'))
  end
  from (select private.company_org(c) as o) g
  left join public.company_roles x on x.company_id = c and x.user_id = (select auth.uid());
$$;
revoke execute on function private.company_can(uuid, public.member_role) from public, anon;
grant execute on function private.company_can(uuid, public.member_role) to authenticated;

-- Every function and policy that asked "is this person a member of the company's organisation (with this role)" now
-- asks the company. Run again by later migrations' tests, so it rewrites whatever an older migration re-created.
create or replace function private.adopt_company_roles() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_def text; v_n integer := 0; v_q text; v_c text;
  -- Built from parts so this function's own text never matches what it looks for.
  v_old text := '%is_member(private.' || 'company_org(%';
  v_re text := 'private\.is_member\(private\.' || 'company_org\(([^()]+)\)';
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.prosrc like v_old loop
    v_def := regexp_replace(pg_get_functiondef(r.oid), v_re, 'private.company_can(\1', 'g');
    execute v_def;
    v_n := v_n + 1;
  end loop;
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
            where coalesce(qual, '') || coalesce(with_check, '') like v_old loop
    v_q := regexp_replace(r.qual, v_re, 'private.company_can(\1', 'g');
    v_c := regexp_replace(r.with_check, v_re, 'private.company_can(\1', 'g');
    execute format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename)
      || case when v_q is not null then format(' using (%s)', v_q) else '' end
      || case when v_c is not null then format(' with check (%s)', v_c) else '' end;
    v_n := v_n + 1;
  end loop;
  -- Three editor-level functions looked up the organisation first; they ask the company instead.
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('set_statement_mark', 'update_company_settings', 'clear_company_data')
              and p.prosrc like '%private.is_member(v_org,%' loop
    execute replace(pg_get_functiondef(r.oid), 'private.is_member(v_org,', 'private.company_can(p_company,');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function private.adopt_company_roles() from public, anon, authenticated;
select private.adopt_company_roles();

-- The company itself: hidden with no access, changed by its editors. Its own row is checked against its organisation
-- (a company being created can't be looked up yet), and hidden when the person has no access to it.
create or replace function private.company_hidden(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_roles x where x.company_id = c and x.user_id = (select auth.uid()) and x.role = 'none');
$$;
revoke execute on function private.company_hidden(uuid) from public, anon;
grant execute on function private.company_hidden(uuid) to authenticated;
drop policy if exists co_select on public.companies;
create policy co_select on public.companies for select to authenticated using (deleted_at is null and private.is_member(org_id) and not private.company_hidden(id));
drop policy if exists co_update on public.companies;
create policy co_update on public.companies for update to authenticated
  using (deleted_at is null and private.company_can(id, 'editor')) with check (private.is_member(org_id, 'editor'));

-- An admin sets (or with null, removes) a member's role in one company.
create or replace function public.set_company_role(p_company uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_member public.member_role;
begin
  select org_id, name into v_org, v_name from public.companies where id = p_company and deleted_at is null;
  if v_org is null or not private.is_member(v_org, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.require_aal2();
  if p_role is not null and p_role not in ('none', 'viewer', 'editor') then raise exception 'That role is not valid.'; end if;
  select role into v_member from public.memberships where org_id = v_org and user_id = p_user;
  if v_member is null then raise exception 'That person is not in this organisation.'; end if;
  if v_member = 'admin' or exists (select 1 from public.organizations where id = v_org and owner_id = p_user) then
    raise exception 'Admins have full access to every company.';
  end if;
  if p_role is null then
    delete from public.company_roles where company_id = p_company and user_id = p_user;
  else
    insert into public.company_roles (company_id, user_id, role) values (p_company, p_user, p_role)
    on conflict (company_id, user_id) do update set role = excluded.role, set_by = (select auth.uid()), set_at = now();
  end if;
  perform private.audit_org(v_org, 'company_role', v_name, p_user, jsonb_build_object('company', p_company, 'role', p_role));
end $$;

-- The person's own role in a company, as every check sees it (null: no access).
create or replace function public.my_company_role(p_company uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when private.company_can(p_company, 'admin') then 'admin'
              when private.company_can(p_company, 'editor') then 'editor'
              when private.company_can(p_company, 'viewer') then 'viewer' end;
$$;
revoke execute on function public.set_company_role(uuid, uuid, text), public.my_company_role(uuid) from public, anon;
grant execute on function public.set_company_role(uuid, uuid, text), public.my_company_role(uuid) to authenticated;

-- Restoring a deleted organisation is as guarded as deleting it.
create or replace function public.restore_organisation(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  perform private.require_aal2();
  perform private.require_recent();
  select name into v_name from public.organizations where id = p_org and owner_id = (select auth.uid()) and deleted_at > now() - interval '14 days' for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.organizations set deleted_at = null where id = p_org;
  perform private.audit_org(p_org, 'org_restored', v_name, null, '{}');
end $$;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('company_role', 'user', 3600, 300)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

do $$ begin
  if to_regprocedure('private.install_tenant_guards()') is not null then perform private.install_tenant_guards(); end if;
end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 57 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
