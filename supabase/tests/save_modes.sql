-- Saving sales and expenses again: month fingerprints and "Replace all" (migration 0021). Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('sm@x.test', '{"full_name":"Sara"}', now()), ('so@x.test', '{"full_name":"Sami"}', now());
grant select on all tables in schema public to authenticated;
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = e), 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;
insert into public.companies (org_id, name) select org_id, 'Modes Co' from public.memberships where user_id = (select id from auth.users where email = 'sm@x.test');
create temp table ids as select (select id from public.companies where name = 'Modes Co') co;
grant select on ids to authenticated;
create temp table bs (k text, b uuid);
grant all on bs to authenticated;

select pg_temp.login('sm@x.test');
insert into bs select 's1', public.begin_sales_batch((select co from ids), 'file', array['2025-12', '2026-01'], 'old.xlsx');
select public.add_sales_lines((select b from bs where k = 's1'), $$[
  {"day": "2026-01-05", "period": "2026-01", "doc": "INV/2026/0001", "customer": "Nile Clinic", "product": "[A1] Pump", "qty": 2, "amount": 1500.5, "cost": 900},
  {"day": null, "period": "2026-01", "doc": "INV/2026/0002", "customer": "عيادة النيل", "product": "", "qty": null, "amount": -10, "cost": null},
  {"day": "2025-12-20", "period": "2025-12", "doc": "INV/2025/0099", "customer": "Old", "product": "", "qty": null, "amount": 5, "cost": null}]$$::jsonb);
insert into bs select 'e1', public.begin_expense_batch((select co from ids), 'file', array['2026-01'], 'bills.xlsx');
select public.add_expense_lines((select b from bs where k = 'e1'), $$[
  {"day": "2026-01-07", "period": "2026-01", "doc": "BILL/2026/0003", "supplier": "مورد القاهرة", "account": "620000 Rent", "label": "January rent", "amount": 12000}]$$::jsonb);

-- The browser computes these same fingerprints for the same lines (tests/unit/month-print.test.ts).
select pg_temp.check('a month of sales has the fingerprint the browser computes',
  public.line_months((select co from ids), 'sales', 'file') -> '2026-01' ->> 'print', 'e3c2a3c5622301e6d0999656580c9326570ef65a16115ae7bfb3b48b35b0a8ce');
select pg_temp.check('and its line count', public.line_months((select co from ids), 'sales', 'file') -> '2026-01' ->> 'n', '2');
select pg_temp.check('a month of expenses too',
  public.line_months((select co from ids), 'expenses', 'file') -> '2026-01' ->> 'print', 'be3102a0fcadc65a133e93b34ff542bef173efb1dabe94702b8ce10434973e40');

-- Replace all: months the new file does not have go too.
insert into bs select 's2', public.begin_sales_batch((select co from ids), 'file', array['2026-02'], 'corrected.xlsx', '{}'::jsonb, true);
select public.add_sales_lines((select b from bs where k = 's2'), '[{"day": "2026-02-01", "period": "2026-02", "doc": "INV/2026/0100", "customer": "New", "product": "", "qty": null, "amount": 7, "cost": null}]'::jsonb);
select pg_temp.check('replace all leaves only the new file''s months', (select string_agg(distinct period, ',' order by period) from public.sales_lines where company_id = (select co from ids)), '2026-02');
select pg_temp.check('and only its batch', (select count(*)::text from public.sales_batches where company_id = (select co from ids)), '1');
select pg_temp.check('expenses are untouched', (select count(*)::text from public.expense_lines where company_id = (select co from ids)), '1');

select pg_temp.login('so@x.test');
select pg_temp.check('an outsider cannot read the fingerprints', pg_temp.err(format('select public.line_months(%L, ''sales'', ''file'')', (select co from ids))), '42501');
select pg_temp.check('nor replace everything', pg_temp.err(format('select public.begin_sales_batch(%L, ''file'', array[''2026-03''], null, ''{}''::jsonb, true)', (select co from ids))), '42501');
