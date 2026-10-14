-- Expense lines (migration 0009): saving by batch, who can read them, and the summary's flags. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ea@x.test', '{"full_name":"Ann"}', now()), ('eb@x.test', '{"full_name":"Ben"}', now());
grant select on all tables in schema public to authenticated;
grant delete on public.expense_lines to authenticated;

create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.home(e text) returns uuid language sql as $f$ select org_id from public.memberships where user_id = pg_temp.uid(e) order by created_at limit 1 $f$;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e))::text, false);
  set role authenticated;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('ea@x.test'), 'Exp Co');
create temp table ids as select (select id from public.companies where name = 'Exp Co') as co;
grant select on ids to authenticated;

-- Ann saves the ledger's lines for Jan–Apr: rent of 1,000 a month, one large repair in April, and the same bill entered twice.
select pg_temp.login('ea@x.test');
create temp table b1 as select public.begin_expense_batch((select co from ids), 'ledger', array['2026-01', '2026-02', '2026-03', '2026-04'], 'gl.xlsx') as id;
select pg_temp.check('ledger lines saved', public.add_expense_lines((select id from b1), '[
  {"day":"2026-01-05","period":"2026-01","doc":"BILL/2026/0001","series":"BILL","supplier":"Landlord","account":"6101 Rent","cls":"exp_fixed","category":"Rent","amount":1000},
  {"day":"2026-02-05","period":"2026-02","doc":"BILL/2026/0002","series":"BILL","supplier":"Landlord","account":"6101 Rent","cls":"exp_fixed","category":"Rent","amount":1000},
  {"day":"2026-03-05","period":"2026-03","doc":"BILL/2026/0003","series":"BILL","supplier":"Landlord","account":"6101 Rent","cls":"exp_fixed","category":"Rent","amount":1000},
  {"day":"2026-04-05","period":"2026-04","doc":"BILL/2026/0004","series":"BILL","supplier":"Landlord","account":"6101 Rent","cls":"exp_fixed","category":"Rent","amount":1000},
  {"day":"2026-04-10","period":"2026-04","doc":"BILL/2026/0005","series":"BILL","supplier":"Fixit","account":"6101 Rent","cls":"exp_fixed","category":"Rent","amount":9000},
  {"day":"2026-04-11","period":"2026-04","doc":"BILL/2026/0006","series":"BILL","supplier":"Ink Co","account":"6200 Office","cls":"exp_fixed","category":"Office","amount":250},
  {"day":"2026-04-14","period":"2026-04","doc":"BILL/2026/0007","series":"BILL","supplier":"Ink Co","account":"6200 Office","cls":"exp_fixed","category":"Office","amount":250},
  {"day":"2026-02-11","period":"2026-02","doc":"BILL/2026/0008","series":"BILL","supplier":"Paper Co","account":"6200 Office","cls":"exp_fixed","category":"Office","amount":80},
  {"day":"2026-02-12","period":"2026-02","doc":"BILL/2026/0009","series":"BILL","supplier":"Paper Co","account":"6200 Office","cls":"exp_fixed","category":"Office","amount":80},
  {"day":"2026-02-14","period":"2026-02","doc":"BILL/2026/0010","series":"BILL","supplier":"Paper Co","account":"6200 Office","cls":"exp_fixed","category":"Office","amount":80},
  {"day":"2026-02-28","period":"2026-02","doc":"ASSTE/2026/0001","series":"ASSTE","supplier":"Depreciation (no payment)","account":"6900 Depreciation","cls":"exp_depreciation","category":"Depreciation","amount":500},
  {"day":"2026-05-01","period":"2026-05","doc":"BILL/2026/0011","series":"BILL","supplier":"Landlord","account":"6101 Rent","cls":"exp_fixed","category":"Rent","amount":1000}
]'::jsonb)::text, '11');
create temp table s as select public.expense_summary((select co from ids)) j;
select pg_temp.check('months', (select string_agg(k, ',' order by k) from s, jsonb_object_keys(j -> 'sources') k), '2026-01,2026-02,2026-03,2026-04');
select pg_temp.check('rent in April', (select sum((a ->> 'a')::numeric)::text from s, jsonb_array_elements(j -> 'accounts') a where a ->> 't' = '6101 Rent' and a ->> 'p' = '2026-04'), '10000.00');
select pg_temp.check('large entry', (select string_agg(f ->> 'doc', ',') from s, jsonb_array_elements(j -> 'flags') f where f ->> 'k' = 'large'), 'BILL/2026/0005');
select pg_temp.check('double payment (a regular purchase is not one)', (select string_agg((f ->> 'doc') || '+' || (f ->> 'doc2'), ',') from s, jsonb_array_elements(j -> 'flags') f where f ->> 'k' = 'double'), 'BILL/2026/0006+BILL/2026/0007');

-- A purchases file for February wins over the ledger for that month; saving the ledger again replaces only its own lines.
create temp table b2 as select public.begin_expense_batch((select co from ids), 'file', array['2026-02'], 'bills.xlsx') as id;
select pg_temp.check('file lines saved', public.add_expense_lines((select id from b2), '[{"day":"2026-02-03","period":"2026-02","doc":"B-1","supplier":"Landlord","account":"Rent","category":"Rent","amount":1200}]'::jsonb)::text, '1');
truncate s; insert into s select public.expense_summary((select co from ids));
select pg_temp.check('file wins its month', (select sum((a ->> 'a')::numeric)::text from s, jsonb_array_elements(j -> 'accounts') a where a ->> 'p' = '2026-02'), '1200.00');
select pg_temp.check('ledger kept in January', (select j -> 'sources' ->> '2026-01' from s), 'ledger');
create temp table b3 as select public.begin_expense_batch((select co from ids), 'ledger', array['2026-01'], 'gl2.xlsx') as id;
select pg_temp.check('january replaced', (select count(*)::text from public.expense_lines where company_id = (select co from ids) and period = '2026-01'), '0');
select pg_temp.check('february ledger kept', (select count(*)::text from public.expense_lines where company_id = (select co from ids) and period = '2026-02' and source = 'ledger'), '5');
select pg_temp.check('ledger totals', (select public.ledger_line_totals((select co from ids)) -> 'expenses' ->> '2026-02'), '1740.00');
reset role;

-- Ben belongs to another organisation: he sees nothing and cannot add to Ann's batches.
select pg_temp.login('eb@x.test');
select pg_temp.check('outsider reads nothing', (select count(*)::text from public.expense_lines), '0');
select pg_temp.check('outsider summary empty', (select jsonb_array_length(public.expense_summary((select co from ids)) -> 'accounts')::text), '0');
delete from public.expense_lines where source = 'ledger';
select pg_temp.check('outsider totals empty', (select public.ledger_line_totals((select co from ids)) ->> 'expenses'), '{}');
do $$ begin perform public.add_expense_lines((select id from b2), '[]'::jsonb); raise exception 'FAIL outsider could add lines';
exception when insufficient_privilege then raise notice 'ok  outsider cannot add lines'; end $$;
reset role;
select pg_temp.check('outsider could not clear ledger lines', (select count(*)::text from public.expense_lines where company_id = (select co from ids) and source = 'ledger'), '10');

set role anon;
do $$ begin perform public.expense_summary((select co from ids)); raise exception 'FAIL anon could read the summary';
exception when insufficient_privilege then raise notice 'ok  anon cannot read the summary'; end $$;
reset role;
