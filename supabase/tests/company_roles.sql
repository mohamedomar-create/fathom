-- Per-company roles (migration 0057): an admin can give a member a different role in one company (editor, viewer or
-- no access) than in the rest of the organisation. Admins keep full access. Every check in the database follows it.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0057_company_roles.sql
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('cra@x.test', '{"full_name":"Ada"}', now()), ('cre@x.test', '{"full_name":"Eve"}', now()),
  ('crv@x.test', '{"full_name":"Vic"}', now()), ('cro@x.test', '{"full_name":"Out"}', now());
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

insert into public.companies (org_id, name) values (pg_temp.home('cra@x.test'), 'Roles A'), (pg_temp.home('cra@x.test'), 'Roles B'), (pg_temp.home('cro@x.test'), 'Roles Outside');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('cra@x.test'), pg_temp.uid('cre@x.test'), 'editor'),
  (pg_temp.home('cra@x.test'), pg_temp.uid('crv@x.test'), 'viewer');
create temp table ids (a uuid, b uuid, outside uuid, ada uuid, eve uuid, vic uuid, out_ uuid);
insert into ids select (select id from public.companies where name = 'Roles A'), (select id from public.companies where name = 'Roles B'),
  (select id from public.companies where name = 'Roles Outside'), pg_temp.uid('cra@x.test'), pg_temp.uid('cre@x.test'), pg_temp.uid('crv@x.test'), pg_temp.uid('cro@x.test');
grant select on ids to authenticated;

select pg_temp.check('schema version 57', public.schema_version()::text, '57');
select pg_temp.check('no check in the database still uses the organisation role for a company',
  ((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc like '%is_member(private.company_org(%')
 + (select count(*) from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%is_member(private.company_org(%'))::text, '0');
select pg_temp.check('restoring a deleted organisation needs two-step sign-in and a fresh password',
  (select (prosrc like '%require_aal2%' and prosrc like '%require_recent%')::text from pg_proc where proname = 'restore_organisation'), 'true');

-- An editor still creates companies (and sees the one just created).
select pg_temp.login('cre@x.test');
select pg_temp.check('an editor creates a company', pg_temp.fails($$insert into public.companies (org_id, name) values ((select org_id from public.companies where id = (select a from ids)), 'Roles New') returning id$$), 'ran');
reset role; delete from public.companies where name = 'Roles New';

-- Before any company role: everyone has their organisation role everywhere.
select pg_temp.login('cre@x.test');
select pg_temp.check('an editor writes in A', pg_temp.fails($$select public.doctor_accept((select a from ids), 'k1', 't', 'reason', null)$$), 'ran');
select pg_temp.check('and in B', pg_temp.fails($$select public.doctor_accept((select b from ids), 'k1', 't', 'reason', null)$$), 'ran');
select pg_temp.check('my role in B is editor', public.my_company_role((select b from ids)), 'editor');

-- Only an admin sets company roles, only for members of the organisation, never for another admin.
select pg_temp.check('an editor cannot set roles', pg_temp.fails($$select public.set_company_role((select b from ids), (select vic from ids), 'editor')$$), 'refused');
select pg_temp.login('cra@x.test');
select public.set_company_role((select b from ids), (select eve from ids), 'viewer');
select public.set_company_role((select a from ids), (select vic from ids), 'editor');
select pg_temp.check('an admin cannot be limited', pg_temp.fails($$select public.set_company_role((select a from ids), (select ada from ids), 'viewer')$$), 'refused');
select pg_temp.check('only members of the organisation', pg_temp.fails($$select public.set_company_role((select a from ids), (select out_ from ids), 'editor')$$), 'refused');
select pg_temp.check('not for another organisation''s company', pg_temp.fails($$select public.set_company_role((select outside from ids), (select eve from ids), 'editor')$$), 'refused');
select pg_temp.check('a bad role is refused', pg_temp.fails($$select public.set_company_role((select a from ids), (select eve from ids), 'admin')$$), 'refused');
select pg_temp.check('the change is in the organisation audit', (select count(*)::text from public.org_audit where action = 'company_role'), '2');

select pg_temp.login('cre@x.test');
select pg_temp.check('the editor still writes in A', pg_temp.fails($$select public.doctor_accept((select a from ids), 'k2', 't', 'reason', null)$$), 'ran');
select pg_temp.check('but only views B', pg_temp.fails($$select public.doctor_accept((select b from ids), 'k2', 't', 'reason', null)$$), 'refused');
select pg_temp.check('and still reads B', (select count(*)::text from public.doctor_decisions where company_id = (select b from ids)), '1');
select pg_temp.check('my role in B is viewer', public.my_company_role((select b from ids)), 'viewer');

select pg_temp.login('crv@x.test');
select pg_temp.check('a viewer made editor of A writes in A', pg_temp.fails($$select public.doctor_accept((select a from ids), 'k3', 't', 'reason', null)$$), 'ran');
select pg_temp.check('but not in B', pg_temp.fails($$select public.doctor_accept((select b from ids), 'k3', 't', 'reason', null)$$), 'refused');

-- No access: the company disappears for that person.
select pg_temp.login('cra@x.test');
select public.set_company_role((select b from ids), (select eve from ids), 'none');
select pg_temp.login('cre@x.test');
select pg_temp.check('with no access the company is not listed', (select count(*)::text from public.companies where id = (select b from ids)), '0');
select pg_temp.check('nor its data', (select count(*)::text from public.doctor_decisions where company_id = (select b from ids)), '0');
select pg_temp.check('my role in B is none', coalesce(public.my_company_role((select b from ids)), 'none'), 'none');
select pg_temp.check('A is still listed', (select count(*)::text from public.companies where id = (select a from ids)), '1');
select pg_temp.check('a person reads their own company roles', (select count(*)::text from public.company_roles where user_id = (select eve from ids)), '1');
select pg_temp.check('nobody writes company roles directly', pg_temp.fails($$insert into public.company_roles (company_id, user_id, role) values ((select a from ids), (select eve from ids), 'editor')$$), 'refused');

-- Removing the company role brings back the organisation role; an outsider sees nothing.
select pg_temp.login('cra@x.test');
select public.set_company_role((select b from ids), (select eve from ids), null);
select pg_temp.login('cre@x.test');
select pg_temp.check('back to the organisation role', public.my_company_role((select b from ids)), 'editor');
select pg_temp.login('cro@x.test');
select pg_temp.check('an outsider has no role', coalesce(public.my_company_role((select a from ids)), 'none'), 'none');
select pg_temp.check('an outsider sees no company roles', (select count(*)::text from public.company_roles), '0');

reset role;
select pg_temp.check('the company role rate limit exists', (select count(*)::text from private.rate_scopes where scope = 'company_role'), '1');
select pg_temp.check('anon cannot run the functions', (has_function_privilege('anon', 'public.set_company_role(uuid, uuid, text)', 'execute') or has_function_privilege('anon', 'public.my_company_role(uuid)', 'execute'))::text, 'false');
delete from public.companies where name in ('Roles A', 'Roles B', 'Roles Outside');
