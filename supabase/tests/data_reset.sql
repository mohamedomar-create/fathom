-- Clearing imported data and deleting a company (migration 0031): members see what each module holds; an editor clears
-- one module, only an admin clears everything or deletes the company; a stale count clears nothing; one module's clear
-- never touches another module or another company; the record of a deletion outlives the company. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ra@x.test', '{"full_name":"Rana"}', now()), ('re@x.test', '{"full_name":"Reda"}', now()),
  ('rv@x.test', '{"full_name":"Rami"}', now()), ('ro@x.test', '{"full_name":"Rowan"}', now());

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
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;

insert into public.companies (org_id, name, data_version, kpi_config) values
  (pg_temp.home('ra@x.test'), 'Reset Co', 1, '{"profile":{"booksStart":"2021-07-01","openingAsAt":"2021-06-30","controlAccounts":{"receivable":["122200"]}}}'),
  (pg_temp.home('ra@x.test'), 'Other Co', 1, '{}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('ra@x.test'), pg_temp.uid('re@x.test'), 'editor'), (pg_temp.home('ra@x.test'), pg_temp.uid('rv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Reset Co') co, (select id from public.companies where name = 'Other Co') other, pg_temp.home('ra@x.test') org;
grant select on ids to authenticated;

-- Every module filled, for both companies.
create function pg_temp.fill(c uuid) returns void language plpgsql as $f$
declare a uuid; b uuid; i uuid;
begin
  insert into public.imports (company_id, kind, filename, data_version) values (c, 'upload', 'GL.xlsx', 1) returning id into i;
  insert into public.source_accounts (company_id, code, name, statement, class) values (c, '410000', 'Revenue', 'PL', 'revenue') returning id into a;
  insert into public.account_balances (account_id, company_id, period, amount, import_id) values (a, c, '2026-09', -100, i), (a, c, '2026-08', -90, i);
  insert into public.commentary (company_id, period_key, section, body) values (c, '2026-09', 'summary', 'note');
  insert into public.sales_batches (company_id, source, filename) values (c, 'ledger', 'GL.xlsx') returning id into b;
  insert into public.sales_lines (company_id, batch_id, source, period, amount) values (c, b, 'ledger', '2026-09', 100);
  insert into public.sales_batches (company_id, source, filename) values (c, 'file', 'Invoices.xlsx') returning id into b;
  insert into public.sales_lines (company_id, batch_id, source, period, amount) values (c, b, 'file', '2026-09', 60), (c, b, 'file', '2026-09', 40);
  insert into public.expense_batches (company_id, source, filename) values (c, 'file', 'Bills.xlsx') returning id into b;
  insert into public.expense_lines (company_id, batch_id, source, period, amount) values (c, b, 'file', '2026-09', 30);
  insert into public.stock_ledger_batches (company_id) values (c) returning id into b;
  insert into public.stock_ledger_lines (company_id, batch_id, period, amount) values (c, b, '2026-09', 5);
  insert into public.inventory_batches (company_id, kind, filename, status) values (c, 'valuation', 'Valuation.xlsx', 'done') returning id into b;
  insert into public.stock_layers (company_id, batch_id, odoo_key, period, value, live) values (c, b, 'k1', '2026-09', 10, true), (c, b, 'k2', '2026-09', 20, true);
  insert into public.aged_reports (company_id, side, as_of, buckets, filename) values (c, 'receivable', '2026-09-30', array['At Date'], 'AR.xlsx') returning id into b;
  insert into public.aged_items (report_id, company_id, partner, amounts, total) values (b, c, 'Cust', array[10], 10);
  insert into public.payment_batches (company_id, filename, source) values (c, 'GL.xlsx', 'ledger') returning id into b;
  insert into public.payment_lines (company_id, batch_id, day, period, direction, amount, state) values (c, b, '2026-09-01', '2026-09', 'in', 10, 'paid');
  insert into public.end_user_map (company_id, kind, key) values (c, 'agency', 'Agency');
  insert into public.account_map (company_id, key, cls) values (c, '#410000', 'revenue');
end $f$;
select pg_temp.fill((select co from ids));
select pg_temp.fill((select other from ids));
create temp table other_before as select (select count(*) from public.sales_lines where company_id = (select other from ids)) s, (select count(*) from public.stock_layers where company_id = (select other from ids)) l, (select count(*) from public.account_balances where company_id = (select other from ids)) b;
grant select on other_before to authenticated;

create temp table p (j jsonb);
grant all on p to authenticated;

-- ---------------------------------------------------------------- who sees what
select pg_temp.login('ro@x.test');
select pg_temp.check('an outsider cannot see what a company holds', pg_temp.err('select public.data_reset_preview((select co from ids))'), '42501');
select pg_temp.check('an outsider cannot clear it', pg_temp.err('select public.clear_company_data((select co from ids), ''sales'', 3)'), '42501');

select pg_temp.login('rv@x.test');
insert into p select public.data_reset_preview((select co from ids));
select pg_temp.check('a viewer sees each module''s records', (select (j #>> '{modules,sales,records}') || ' ' || (j #>> '{modules,stock,records}') || ' ' || (j #>> '{modules,financials,tables,balances}') from p), '3 2 2');
-- Financials 8 (1 account, 2 balances, 1 version, 1 ledger sales line, 1 stock posting, 1 ledger payment, 1 note), sales 3,
-- expenses 1, stock 2, payments 2, end users 1: 17, less the ledger sales line and ledger payment counted twice.
select pg_temp.check('the total counts ledger lines once', (select j ->> 'total' from p), '15');
select pg_temp.check('uploads are listed by file name', (select string_agg(u ->> 'name', ',' order by u ->> 'name') from p, jsonb_array_elements(j #> '{modules,sales,uploads}') u), 'GL.xlsx,Invoices.xlsx');
select pg_temp.check('a viewer cannot clear', pg_temp.err('select public.clear_company_data((select co from ids), ''sales'', 3)'), '42501');
truncate p;

-- ---------------------------------------------------------------- an editor clears one module
select pg_temp.login('re@x.test');
select pg_temp.check('a stale count clears nothing', pg_temp.err('select public.clear_company_data((select co from ids), ''sales'', 2)'), '40001');
select pg_temp.check('an editor cannot clear everything', pg_temp.err('select public.clear_company_data((select co from ids), ''all'', 1)'), '42501');
select pg_temp.check('an editor cannot delete the company', pg_temp.err('select public.delete_company((select co from ids), ''Reset Co'')'), '42501');
select pg_temp.check('an editor clears Sales and is told what went', (public.clear_company_data((select co from ids), 'sales', 3) #>> '{sales,sales_lines}'), '3');
select pg_temp.check('no sales lines are left', (select count(*)::text from public.sales_lines where company_id = (select co from ids)), '0');
select pg_temp.check('the books and other modules are untouched',
  (select count(*) from public.account_balances where company_id = (select co from ids)) || ' ' || (select count(*) from public.expense_lines where company_id = (select co from ids)) || ' ' || (select count(*) from public.stock_layers where company_id = (select co from ids)), '2 1 2');

insert into p select public.data_reset_preview((select co from ids));
select pg_temp.check('an editor clears Stock', (public.clear_company_data((select co from ids), 'stock', (select (j #>> '{modules,stock,records}')::bigint from p)) #>> '{stock,valuation_layers}'), '2');
select pg_temp.check('no stock records and no stock summary are left',
  (select count(*) from public.stock_layers where company_id = (select co from ids)) || ' ' || (select count(*) from public.inventory_batches where company_id = (select co from ids)) || ' ' || (select count(*) from public.inventory_rollups where company_id = (select co from ids)), '0 0 0');
truncate p;
insert into p select public.data_reset_preview((select co from ids));
select public.clear_company_data((select co from ids), 'payments', (select (j #>> '{modules,payments,records}')::bigint from p));
select pg_temp.check('clearing payments forgets the chosen control accounts, keeps the books start',
  (select (kpi_config #> '{profile}' ? 'controlAccounts')::text || ' ' || (kpi_config #>> '{profile,booksStart}') from public.companies where id = (select co from ids)), 'false 2021-07-01');
truncate p;

-- ---------------------------------------------------------------- an admin clears everything
select pg_temp.login('ra@x.test');
insert into p select public.data_reset_preview((select co from ids));
select public.clear_company_data((select co from ids), 'all', (select (j ->> 'total')::bigint from p));
select pg_temp.check('clear all leaves no imported data',
  (select count(*) from public.account_balances where company_id = (select co from ids)) + (select count(*) from public.source_accounts where company_id = (select co from ids))
  + (select count(*) from public.imports where company_id = (select co from ids)) + (select count(*) from public.expense_lines where company_id = (select co from ids))
  + (select count(*) from public.stock_ledger_lines where company_id = (select co from ids)) + (select count(*) from public.end_user_map where company_id = (select co from ids))
  + (select count(*) from public.commentary where company_id = (select co from ids)) ||'', '0');
select pg_temp.check('the company, its settings, members and account classes stay; its books read as empty',
  (select name || ' ' || data_version || ' ' || (kpi_config #>> '{profile,booksStart}') || ' ' || ((kpi_config -> 'profile') ? 'openingAsAt')::text from public.companies where id = (select co from ids))
  || ' ' || (select count(*) from public.account_map where company_id = (select co from ids)) || ' ' || (select count(*) from public.memberships where org_id = (select org from ids)),
  'Reset Co 0 2021-07-01 false 1 3');
select pg_temp.check('no stock summary is left due after clearing everything', (select count(*)::text from public.inventory_rollups where company_id = (select co from ids)), '0');
reset role;
select pg_temp.check('nothing left marked for a rebuild', (select count(*)::text from private.inventory_marks where company_id = (select co from ids)), '0');
select pg_temp.login('ra@x.test');
select pg_temp.check('every clear is recorded', (select string_agg(action || ':' || scope, ',' order by id) from public.company_data_audit), 'clear_module:sales,clear_module:stock,clear_module:payments,clear_all:all');
select pg_temp.check('the other company is untouched',
  (select (select count(*) from public.sales_lines where company_id = (select other from ids)) || ' ' || (select count(*) from public.stock_layers where company_id = (select other from ids)) || ' ' || (select count(*) from public.account_balances where company_id = (select other from ids))),
  (select s || ' ' || l || ' ' || b from other_before));
select pg_temp.check('nobody can write the record by hand', pg_temp.err('insert into public.company_data_audit (org_id, company_id, action, scope) values ((select org from ids), gen_random_uuid(), ''clear_all'', ''all'')'), '42501');

-- ---------------------------------------------------------------- deleting a company
select pg_temp.check('a wrong name deletes nothing', pg_temp.err('select public.delete_company((select other from ids), ''Other'')'), '22023');
select public.delete_company((select other from ids), 'Other Co');
select pg_temp.check('the company and all its data are gone',
  (select count(*) from public.companies where name = 'Other Co') + (select count(*) from public.sales_lines where company_id = (select other from ids)) + (select count(*) from public.stock_layers where company_id = (select other from ids)) ||'', '0');
select pg_temp.check('the deletion is still on record, with its counts',
  (select company_name || ' ' || (counts #>> '{sales,sales_lines}') from public.company_data_audit where action = 'delete_company'), 'Other Co 3');
select pg_temp.login('ro@x.test');
select pg_temp.check('an outsider cannot read the record', (select count(*)::text from public.company_data_audit), '0');
reset role;
