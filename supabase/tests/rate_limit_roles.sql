-- Shared allowances (migration 0034): only an editor counts against a company's, only an admin against the
-- organisation's, so a viewer cannot use them up. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on
-- odoo_security.sql re-applies 0025 (an older rate_limit_hit), so this file applies 0034 again first, then 0038's grants,
-- then 0039 so the files after this one see today's functions. 0038's older audit rule would refuse the restore records
-- access.sql left behind, so they go first (test database only).
\i supabase/migrations/0034_rate_limit_roles.sql
alter table public.company_data_audit disable trigger user;
delete from public.company_data_audit where action = 'restore_company';
alter table public.company_data_audit enable trigger user;
\i supabase/migrations/0038_tenant_guards.sql
\i supabase/migrations/0039_access.sql
reset client_min_messages;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('rla@x.test', '{"full_name":"Ann"}', now()), ('rle@x.test', '{"full_name":"Ed"}', now()), ('rlv@x.test', '{"full_name":"Vi"}', now());

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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  return 'ran';
exception when others then return sqlstate;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('rla@x.test'), 'Limit Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('rla@x.test'), pg_temp.uid('rle@x.test'), 'editor'), (pg_temp.home('rla@x.test'), pg_temp.uid('rlv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Limit Co') as co, pg_temp.home('rla@x.test') as org;
grant select on ids to authenticated;

select pg_temp.login('rlv@x.test');
select pg_temp.check('a viewer cannot count the clear-data allowance', pg_temp.err($q$select public.rate_limit_hit('reset', (select co::text from ids))$q$), '42501');
select pg_temp.check('a viewer cannot count the AI allowance', pg_temp.err($q$select public.rate_limit_hit('ai_company', (select co::text from ids))$q$), '42501');
select pg_temp.check('a viewer cannot count the invite allowance', pg_temp.err($q$select public.rate_limit_hit('invite', (select org::text from ids))$q$), '42501');
select pg_temp.login('rle@x.test');
select pg_temp.check('an editor counts the company allowance', public.rate_limit_hit('reset', (select co::text from ids))::text, 'true');
select pg_temp.check('an editor cannot count the invite allowance', pg_temp.err($q$select public.rate_limit_hit('invite', (select org::text from ids))$q$), '42501');
select pg_temp.login('rla@x.test');
select pg_temp.check('an admin counts the invite allowance', public.rate_limit_hit('invite', (select org::text from ids))::text, 'true');
reset role;
