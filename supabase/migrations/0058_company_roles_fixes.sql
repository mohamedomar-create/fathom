-- 0058: fixes from the independent review of 0057 (company roles). Safe to run again.
--  * An admin is never hidden from a company: a "no access" row left from before they became admin is ignored, and
--    becoming admin (or owner), or leaving the organisation, clears the person's company roles.
--  * An admin can always remove a company role (even one left on another admin); limiting an admin is still refused.
--  * A member made editor of one company can change that company's own settings row (the update check asks the company).
--  * The reset and delete audit of a company follows company access; a deleted company's audit stays readable by members.
--  * Uploading into an import needs an editor of that company, not only being the one who started it.
--  * set_company_role counts against its rate limit inside the database, not only in the app.
--  * adopt_company_roles() fails loudly when a company check is left that it cannot rewrite, instead of skipping it.
--  * A rate limit for checking the current password when changing it.

create or replace function private.company_hidden(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_roles x where x.company_id = c and x.user_id = (select auth.uid()) and x.role = 'none')
     and not private.is_member(private.company_org(c), 'admin');
$$;
revoke execute on function private.company_hidden(uuid) from public, anon;
grant execute on function private.company_hidden(uuid) to authenticated;

-- Admins and owners have no company roles; leaving the organisation removes them.
create or replace function private.company_roles_follow_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or new.role = 'admin' then
    delete from public.company_roles x using public.companies c
     where x.company_id = c.id and c.org_id = old.org_id and x.user_id = old.user_id;
  end if;
  return null;
end $$;
revoke execute on function private.company_roles_follow_membership() from public, anon, authenticated;
drop trigger if exists memberships_company_roles on public.memberships;
create trigger memberships_company_roles after update of role or delete on public.memberships
  for each row execute function private.company_roles_follow_membership();
-- The organisation's owner has none either.
create or replace function private.company_roles_follow_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.company_roles x using public.companies c where x.company_id = c.id and c.org_id = new.id and x.user_id = new.owner_id;
  return null;
end $$;
revoke execute on function private.company_roles_follow_owner() from public, anon, authenticated;
drop trigger if exists organizations_company_roles on public.organizations;
create trigger organizations_company_roles after update of owner_id on public.organizations
  for each row when (new.owner_id is distinct from old.owner_id) execute function private.company_roles_follow_owner();
-- Rows already left on admins and owners.
delete from public.company_roles x using public.companies c, public.memberships m
 where x.company_id = c.id and m.org_id = c.org_id and m.user_id = x.user_id and m.role = 'admin';
delete from public.company_roles x using public.companies c, public.organizations o
 where x.company_id = c.id and o.id = c.org_id and o.owner_id = x.user_id;

create or replace function public.set_company_role(p_company uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text; v_member public.member_role;
begin
  select org_id, name into v_org, v_name from public.companies where id = p_company and deleted_at is null;
  if v_org is null or not private.is_member(v_org, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.require_aal2();
  if not public.rate_limit_hit('company_role', (select auth.uid())::text) then
    raise exception 'Too many changes in a short time. Try again later.' using errcode = '54000';
  end if;
  if p_role is not null and p_role not in ('none', 'viewer', 'editor') then raise exception 'That role is not valid.'; end if;
  if p_role is null then
    -- Removing is always allowed, so a row left on someone who has since become admin can be cleared.
    delete from public.company_roles where company_id = p_company and user_id = p_user;
  else
    select role into v_member from public.memberships where org_id = v_org and user_id = p_user;
    if v_member is null then raise exception 'That person is not in this organisation.'; end if;
    if v_member = 'admin' or exists (select 1 from public.organizations where id = v_org and owner_id = p_user) then
      raise exception 'Admins have full access to every company.';
    end if;
    insert into public.company_roles (company_id, user_id, role) values (p_company, p_user, p_role)
    on conflict (company_id, user_id) do update set role = excluded.role, set_by = (select auth.uid()), set_at = now();
  end if;
  perform private.audit_org(v_org, 'company_role', v_name, p_user, jsonb_build_object('company', p_company, 'role', p_role));
end $$;
revoke execute on function public.set_company_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_company_role(uuid, uuid, text) to authenticated;

drop policy if exists co_update on public.companies;
create policy co_update on public.companies for update to authenticated
  using (deleted_at is null and private.company_can(id, 'editor')) with check (private.company_can(id, 'editor'));

drop policy if exists company_data_audit_select on public.company_data_audit;
create policy company_data_audit_select on public.company_data_audit for select to authenticated
  using (private.is_member(org_id) and (private.company_org(company_id) is null or private.company_can(company_id)));

do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists imports_insert on storage.objects';
    execute $p$create policy imports_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'imports' and exists (select 1 from public.import_files f join public.import_jobs j on j.id = f.job_id
        where f.storage_path = name and j.status = 'preparing' and j.created_by = (select auth.uid())
          and private.company_can(f.company_id, 'editor')))$p$;
  end if;
end $$;

create or replace function private.adopt_company_roles() returns integer
language plpgsql security definer set search_path = '' as $$
declare r record; v_def text; v_n integer := 0; v_q text; v_c text; v_left text;
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
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('set_statement_mark', 'update_company_settings', 'clear_company_data')
              and p.prosrc like '%private.is_member(v_org,%' loop
    execute replace(pg_get_functiondef(r.oid), 'private.is_member(v_org,', 'private.company_can(p_company,');
    v_n := v_n + 1;
  end loop;
  -- Anything still asking the organisation for a company is a check this could not rewrite: stop, never skip it.
  select string_agg(x, ', ') into v_left from (
    select p.oid::regprocedure::text x from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosrc like v_old
    union all
    select format('policy %s on %s.%s', policyname, schemaname, tablename) from pg_policies
     where coalesce(qual, '') || coalesce(with_check, '') like v_old) t;
  if v_left is not null then
    raise exception 'Company checks that could not be rewritten to company_can: %', v_left;
  end if;
  return v_n;
end $$;
revoke execute on function private.adopt_company_roles() from public, anon, authenticated;
select private.adopt_company_roles();

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('password', 'user', 900, 5)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

do $$ begin
  if to_regprocedure('private.install_tenant_guards()') is not null then perform private.install_tenant_guards(); end if;
end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 58 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
