-- The company's account map (migration 0017): members read it, editors write it, outsiders see nothing.
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ma@x.test', '{"full_name":"Mona"}', now()), ('mv@x.test', '{"full_name":"Vera"}', now()), ('mo@x.test', '{"full_name":"Omar"}', now());

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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('ma@x.test'), 'Map Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('ma@x.test'), pg_temp.uid('mv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Map Co') as co, pg_temp.uid('ma@x.test') as ua;
grant select on ids to authenticated;

select pg_temp.login('ma@x.test');
insert into public.account_map (company_id, key, cls, name) values ((select co from ids), '#620300', 'exp_variable', 'Marketing');
select pg_temp.check('editor saves a class', (select cls from public.account_map where key = '#620300'), 'exp_variable');
select pg_temp.check('who changed it is recorded', (select (updated_by = (select ua from ids))::text from public.account_map where key = '#620300'), 'true');
insert into public.account_map (company_id, key, cls, name) values ((select co from ids), '#620300', 'other_expenses', 'Advertising')
  on conflict (company_id, key) do update set cls = excluded.cls, name = excluded.name;
select pg_temp.check('a later choice replaces it', (select cls || ' ' || name from public.account_map where key = '#620300'), 'other_expenses Advertising');

select pg_temp.login('mv@x.test');
select pg_temp.check('a viewer reads it', (select count(*)::text from public.account_map), '1');
select pg_temp.check('a viewer cannot change it',
  pg_temp.err($q$insert into public.account_map (company_id, key, cls) values ((select co from ids), '#1', 'cash')$q$), '42501');

select pg_temp.login('mo@x.test');
select pg_temp.check('an outsider sees nothing', (select count(*)::text from public.account_map), '0');
select pg_temp.check('an outsider cannot write',
  pg_temp.err($q$insert into public.account_map (company_id, key, cls) values ((select co from ids), '#2', 'cash')$q$), '42501');
reset role;
set role anon;
select pg_temp.check('signed-out visitors cannot read', pg_temp.err($q$select count(*) from public.account_map$q$), '42501');
reset role;
