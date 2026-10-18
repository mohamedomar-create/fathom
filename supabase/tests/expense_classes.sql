-- Expense lines follow the company's account map (migration 0022, register D11): a class changed in Chart of accounts is
-- written onto the stored lines, so no view or export reads a stale class. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('xa@x.test', '{"full_name":"Xena"}', now()), ('xv@x.test', '{"full_name":"Vik"}', now()), ('xo@x.test', '{"full_name":"Olu"}', now());
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

insert into public.companies (org_id, name) values (pg_temp.home('xa@x.test'), 'Class Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('xa@x.test'), pg_temp.uid('xv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Class Co') as co;
grant select on ids to authenticated;
insert into public.expense_batches (id, company_id, source) values ('00000000-0000-4000-8000-0000000000e1', (select co from ids), 'ledger');
insert into public.expense_lines (company_id, batch_id, source, period, account, cls, amount) values
  ((select co from ids), '00000000-0000-4000-8000-0000000000e1', 'ledger', '2026-09', '620300 Advertisement', 'exp_fixed', 100),
  ((select co from ids), '00000000-0000-4000-8000-0000000000e1', 'ledger', '2026-09', '522015 Bank charges', 'exp_variable', 7),
  ((select co from ids), '00000000-0000-4000-8000-0000000000e1', 'ledger', '2026-09', 'Rent', 'exp_fixed', 50);
insert into public.account_map (company_id, key, cls, name) values
  ((select co from ids), '#620300', 'exp_variable', 'Advertisement'), ((select co from ids), '#522015', 'interest_expenses', 'Bank charges'),
  ((select co from ids), 'rent', '', 'Rent');

select pg_temp.login('xv@x.test');
select pg_temp.check('a viewer cannot restamp', pg_temp.err($q$select public.restamp_expense_classes((select co from ids))$q$), '42501');
select pg_temp.login('xo@x.test');
select pg_temp.check('an outsider cannot restamp', pg_temp.err($q$select public.restamp_expense_classes((select co from ids))$q$), '42501');

select pg_temp.login('xa@x.test');
select pg_temp.check('an editor restamps the lines whose class changed', (select public.restamp_expense_classes((select co from ids)))::text, '2');
select pg_temp.check('lines take the class by account code', (select string_agg(cls, ',' order by account) from public.expense_lines where company_id = (select co from ids)),
  'interest_expenses,exp_variable,exp_fixed');
select pg_temp.check('a second run changes nothing', (select public.restamp_expense_classes((select co from ids)))::text, '0');
reset role;
