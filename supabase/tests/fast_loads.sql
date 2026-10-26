-- company_balances (migration 0026): one call returns a version's balances to members only. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('fl@x.test', '{"full_name":"F"}', now()), ('fo@x.test', '{"full_name":"O"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin execute q; return ''; exception when others then return sqlstate; end $f$;
insert into public.companies (org_id, name) values ((select org_id from public.memberships where user_id = pg_temp.uid('fl@x.test') limit 1), 'Fast Co');
create temp table f as select id as co from public.companies where name = 'Fast Co';
grant select on f to authenticated;
insert into public.source_accounts (id, company_id, version, code, name, statement, class) values
  ('00000000-0000-0000-0000-0000000000a1', (select co from f), 1, '101', 'Bank', 'BS', 'cash'),
  ('00000000-0000-0000-0000-0000000000a2', (select co from f), 2, '101', 'Bank', 'BS', 'cash');
insert into public.account_balances (account_id, company_id, period, amount) values
  ('00000000-0000-0000-0000-0000000000a1', (select co from f), '2026-08', 100), ('00000000-0000-0000-0000-0000000000a2', (select co from f), '2026-08', 200),
  ('00000000-0000-0000-0000-0000000000a2', (select co from f), '2026-09', 300);
select pg_temp.login('fl@x.test');
select pg_temp.check('a member gets the version''s balances, in order', (select public.company_balances((select co from f), 2)::text), '[["00000000-0000-0000-0000-0000000000a2", "2026-08", 200.00, null], ["00000000-0000-0000-0000-0000000000a2", "2026-09", 300.00, null]]');
select pg_temp.check('another version is not mixed in', (select jsonb_array_length(public.company_balances((select co from f), 1))::text), '1');
select pg_temp.login('fo@x.test');
select pg_temp.check('an outsider is refused', pg_temp.err($q$select public.company_balances((select co from f), 2)$q$), '42501');
reset role;
select pg_temp.check('signed-out visitors cannot call it', (select has_function_privilege('anon', 'public.company_balances(uuid, integer)', 'execute')::text), 'false');
