-- Per-company roles, review fixes (migration 0058): an admin can give a member a different role in one company (editor, viewer or
-- no access) than in the rest of the organisation. Admins keep full access. Every check in the database follows it.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0058_company_roles_fixes.sql
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('cfa@x.test', '{"full_name":"Ada"}', now()), ('cfe@x.test', '{"full_name":"Eve"}', now()),
  ('cfv@x.test', '{"full_name":"Vic"}', now()), ('cfo@x.test', '{"full_name":"Out"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.home(e text) returns uuid language sql as $f$ select org_id from public.memberships where user_id = pg_temp.uid(e) order by created_at limit 1 $f$;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now()))))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.fails(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  return 'ran';
exception when others then return 'refused';
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('cfa@x.test'), 'Fix A'), (pg_temp.home('cfa@x.test'), 'Fix B');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('cfa@x.test'), pg_temp.uid('cfe@x.test'), 'viewer'),
  (pg_temp.home('cfa@x.test'), pg_temp.uid('cfv@x.test'), 'viewer');
create temp table ids (a uuid, b uuid, ada uuid, eve uuid, vic uuid, org uuid);
insert into ids select (select id from public.companies where name = 'Fix A'), (select id from public.companies where name = 'Fix B'),
  pg_temp.uid('cfa@x.test'), pg_temp.uid('cfe@x.test'), pg_temp.uid('cfv@x.test'), pg_temp.home('cfa@x.test');
grant select on ids to authenticated;

select pg_temp.check('schema version 58', public.schema_version()::text, '58');

-- A viewer made editor of one company can change that company's own settings row.
select pg_temp.login('cfa@x.test');
select public.set_company_role((select a from ids), (select vic from ids), 'editor');
select pg_temp.login('cfv@x.test');
select pg_temp.check('an editor of A (viewer elsewhere) renames A', pg_temp.fails($$update public.companies set name = 'Fix A' where id = (select a from ids)$$), 'ran');
select pg_temp.check('the rename really happened', (select count(*)::text from public.companies where id = (select a from ids)), '1');

-- No access hides the reset audit too.
reset role;
insert into public.company_data_audit (org_id, company_id, company_name, actor, action, scope, counts)
  values ((select org from ids), (select b from ids), 'Fix B', (select ada from ids), 'clear_module', 'sales', '{}');
insert into public.company_data_audit (org_id, company_id, company_name, actor, action, scope, counts)
  values ((select org from ids), gen_random_uuid(), 'Gone Co', (select ada from ids), 'delete_company', 'all', '{}');
select pg_temp.login('cfa@x.test');
select public.set_company_role((select b from ids), (select eve from ids), 'none');
select pg_temp.login('cfe@x.test');
select pg_temp.check('no access: the company''s reset audit is hidden', (select count(*)::text from public.company_data_audit where company_id = (select b from ids)), '0');
select pg_temp.check('a deleted company''s audit is still readable by members', (select count(*)::text from public.company_data_audit where company_name = 'Gone Co'), '1');

-- A member promoted to admin is never hidden from a company, and the old row goes.
select pg_temp.login('cfa@x.test');
update public.memberships set role = 'admin' where org_id = (select org from ids) and user_id = (select eve from ids);
select pg_temp.login('cfe@x.test');
select pg_temp.check('an admin sees every company', (select count(*)::text from public.companies where id = (select b from ids)), '1');
reset role;
select pg_temp.check('promotion to admin clears their company roles', (select count(*)::text from public.company_roles where user_id = (select eve from ids)), '0');

-- A company role left on an admin (e.g. from before this fix) can still be removed.
insert into public.company_roles (company_id, user_id, role) values ((select b from ids), (select eve from ids), 'none');
select pg_temp.login('cfa@x.test');
select pg_temp.check('an admin removes a stale role on another admin', pg_temp.fails($$select public.set_company_role((select b from ids), (select eve from ids), null)$$), 'ran');
select pg_temp.check('but still cannot limit an admin', pg_temp.fails($$select public.set_company_role((select b from ids), (select eve from ids), 'viewer')$$), 'refused');
reset role;
select pg_temp.check('the stale role is gone', (select count(*)::text from public.company_roles where user_id = (select eve from ids)), '0');

-- Leaving the organisation clears company roles.
select pg_temp.check('vic has a company role', (select count(*)::text from public.company_roles where user_id = (select vic from ids)), '1');
delete from public.memberships where org_id = (select org from ids) and user_id = (select vic from ids);
select pg_temp.check('leaving the organisation clears it', (select count(*)::text from public.company_roles where user_id = (select vic from ids)), '0');

-- The database counts company-role changes itself.
select pg_temp.check('set_company_role counts against the rate limit', (select (prosrc like '%rate_limit_hit%')::text from pg_proc where proname = 'set_company_role'), 'true');
-- Uploads into a company need an editor there.
select pg_temp.check('the upload policy asks the company', (select (coalesce(with_check, '') like '%company_can(%')::text from pg_policies where policyname = 'imports_insert'), (select 'true' from pg_policies where policyname = 'imports_insert'));
-- adopt refuses to leave a check it can't rewrite.
create function private.zz_leftover(c uuid) returns boolean language sql stable as $f$ select private.is_member(private.company_org(split_part(c::text, ',', 1)::uuid)) $f$;
select pg_temp.check('adopt fails loudly on a check it cannot rewrite', pg_temp.fails($$select private.adopt_company_roles()$$), 'refused');
drop function private.zz_leftover(uuid);
select pg_temp.check('and runs clean otherwise', (select private.adopt_company_roles()::text), '0');
select pg_temp.check('the password rate limit exists', (select count(*)::text from private.rate_scopes where scope = 'password'), '1');

delete from public.company_data_audit where company_name in ('Fix B', 'Gone Co');
delete from public.companies where name in ('Fix A', 'Fix B');
