-- Uploads that never stall and pages that load on a large company (migration 0019). Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ha@x.test', '{"full_name":"Hala"}', now()), ('hb@x.test', '{"full_name":"Hany"}', now());
grant select on all tables in schema public to authenticated;

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

insert into public.companies (org_id, name) values (pg_temp.home('ha@x.test'), 'Hard Co');
create temp table ids as select (select id from public.companies where name = 'Hard Co') as co;
grant select on ids to authenticated;
create temp table jobs (name text primary key, r jsonb);
grant all on jobs to authenticated;
create function pg_temp.job(n text) returns uuid language sql as $f$ select (r ->> 'job')::uuid from jobs where name = n $f$;
create function pg_temp.file(n text) returns uuid language sql as $f$ select (r -> 'files' -> 0 ->> 'id')::uuid from jobs where name = n $f$;
create function pg_temp.status(n text) returns text language sql as $f$ select status || coalesce(': ' || message, '') from public.import_jobs where id = pg_temp.job(n) $f$;

-- ---------------------------------------------------------------- 1. which rows the database holds (to continue an upload)
select pg_temp.login('ha@x.test');
insert into jobs select 'held', public.create_import_job((select co from ids), 'inventory', 'all', '[{"name":"v.xlsx","kind":"valuation"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('held'), '[{"n":1,"data":{}},{"n":2,"data":{}},{"n":5,"data":{}},{"n":6,"data":{}},{"n":9,"data":{}}]'::jsonb);
select pg_temp.check('rows held, as ranges', public.import_held(pg_temp.file('held'))::text, '[[1, 2], [5, 6], [9, 9]]');
select pg_temp.login('hb@x.test');
select pg_temp.check('someone else cannot see them', pg_temp.err(format('select public.import_held(%L)', pg_temp.file('held'))), '42501');

-- ---------------------------------------------------------------- 2. a batch never waits on another batch's lock
reset role;
select pg_temp.check('sending a batch takes no lock another batch would wait for',
  (select prosrc ~* 'for no key update skip locked' and prosrc !~* 'update public.import_jobs set updated_at = now\(\) where id = f.job_id;' from pg_proc where proname = 'stage_import_rows')::text, 'true');

-- ---------------------------------------------------------------- 3. stalled uploads and checks never stay open
update public.import_jobs set updated_at = now() - interval '31 minutes' where id = pg_temp.job('held');
call private.run_import_jobs();
select pg_temp.check('an upload idle for 30 minutes is closed', (pg_temp.status('held') like 'failed: The upload stopped%')::text, 'true');
select pg_temp.check('and its staged rows are cleared', (select count(*)::text from public.import_rows where job_id = pg_temp.job('held')), '0');

select pg_temp.login('ha@x.test');
insert into jobs select 'busy', public.create_import_job((select co from ids), 'inventory', 'all', '[{"name":"v2.xlsx","kind":"valuation"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('busy'), '[{"n":1,"data":{}}]'::jsonb);
reset role;
update public.import_jobs set status = 'checking', queued_at = now() - interval '21 minutes', updated_at = now() - interval '20 minutes' where id = pg_temp.job('busy');
call private.run_import_jobs();
select pg_temp.check('a check cut off by the database is failed, with a way to try again', (pg_temp.status('busy') like 'failed: The check took too long%')::text, 'true');
select pg_temp.check('its rows are kept for "Try again"', (select count(*)::text from public.import_rows where job_id = pg_temp.job('busy')), '1');
-- A save the database cut off stays "saving" and would be tried again every few seconds for ever: failed instead.
select pg_temp.login('ha@x.test');
insert into jobs select 'stuck', public.create_import_job((select co from ids), 'inventory', 'all', '[{"name":"v3.xlsx","kind":"valuation"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('stuck'), '[{"n":1,"data":{}}]'::jsonb);
reset role;
update public.import_jobs set status = 'saving', queued_at = now() - interval '40 minutes', updated_at = now() - interval '30 minutes' where id = pg_temp.job('stuck');
call private.run_import_jobs();
select pg_temp.check('a save cut off by the database is failed, not tried for ever', (pg_temp.status('stuck') like 'failed: The save took too long%')::text, 'true');

-- ---------------------------------------------------------------- 4. the Expenses page on a large company
-- 40,000 lines over 24 months, 2,000 of them the same monthly charge from one supplier (the case that made the
-- duplicate-bill check compare every pair). It must answer well inside the 8-second limit of a signed-in call.
create temp table eb as select gen_random_uuid() id;
insert into public.expense_batches (id, company_id, source, periods, filename)
select (select id from eb), (select co from ids), 'ledger', array(select to_char(date '2025-01-01' + (k || ' month')::interval, 'YYYY-MM') from generate_series(0, 23) k), 'big.xlsx';
insert into public.expense_lines (company_id, batch_id, source, day, period, doc, series, supplier, account, cls, category, amount)
select (select co from ids), (select id from eb), 'ledger', d, to_char(d, 'YYYY-MM'), 'BILL/' || i, 'BILL',
       case when i <= 2000 then 'Bank' else 'Supplier ' || (i % 400) end, '6' || (i % 60) || ' Costs', 'exp_fixed', 'Costs',
       case when i <= 2000 then 15 else 100 + (i % 977) end
  from generate_series(1, 40000) i, lateral (select date '2025-01-01' + (i % 730) d) x;
select pg_temp.login('ha@x.test');
create temp table t0 as select clock_timestamp() t;
create temp table es as select public.expense_summary((select co from ids)) j;
select pg_temp.check('the Expenses summary of 40,000 lines answers in under 4 seconds', (clock_timestamp() - (select t from t0) < interval '4 seconds')::text, 'true');
select pg_temp.check('and adds up every line', (select sum((a ->> 'a')::numeric)::text from es, jsonb_array_elements(j -> 'accounts') a),
  (select sum(amount)::text from public.expense_lines where company_id = (select co from ids)));
select pg_temp.login('hb@x.test');
select pg_temp.check('an outsider still sees nothing', (select jsonb_array_length(public.expense_summary((select co from ids)) -> 'accounts')::text), '0');
select pg_temp.check('nor any sales', (select jsonb_array_length(public.sales_summary((select co from ids)) -> 'customers')::text), '0');
reset role;

-- ---------------------------------------------------------------- 5. saving a second company's stock while another holds as much
-- The live database already holds one company's full history (27,000 layers, 63,000 moves); saving the next company's must
-- take seconds, never compare every row with every other (the save used to run for 8 minutes, and "Add only new" for over 20).
reset role;
insert into public.companies (org_id, name) values (pg_temp.home('ha@x.test'), 'Second Co');
create function pg_temp.co(n text) returns uuid language sql as $f$ select id from public.companies where name = n $f$;
create function pg_temp.batch(c text, k text, m text, live boolean) returns uuid language sql as $f$
  insert into public.inventory_batches (company_id, kind, periods, mode, status)
  values (pg_temp.co(c), k, array(select to_char(date '2021-07-01' + (i || ' month')::interval, 'YYYY-MM') from generate_series(0, 63) i), m, case when live then 'done' else 'open' end)
  returning id $f$;
create function pg_temp.fill(c text, b_moves uuid, b_layers uuid, live boolean) returns void language sql as $f$
  insert into public.stock_moves (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, from_loc, to_loc, qty, live)
  select pg_temp.co(c), b_moves, 'sml_' || i, d, to_char(d, 'YYYY-MM'), 'WH/OUT/' || (i % 20000), (array['delivery', 'receipt', 'internal', 'customer_return'])[1 + i % 4],
         'Product ' || (i % 450), 'Device', 'WH/Stock', 'Partner Locations/Customers', 1, live
    from generate_series(1, 50000) i, lateral (select date '2021-07-01' + (i % 1900) d) x;
  insert into public.stock_layers (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, qty, unit_value, value, live)
  select pg_temp.co(c), b_layers, 'fp:' || i, d, to_char(d, 'YYYY-MM'), 'WH/OUT/' || (i % 20000), 'other', 'Product ' || (i % 450), 'Device', -1, 100, -100, live
    from generate_series(1, 25000) i, lateral (select date '2021-07-01' + (i % 1900) d) x;
$f$;
select pg_temp.fill('Hard Co', pg_temp.batch('Hard Co', 'moves', 'all', true), pg_temp.batch('Hard Co', 'valuation', 'all', true), true);
analyze public.stock_layers; analyze public.stock_moves; analyze public.inventory_batches;

create temp table tb as select pg_temp.batch('Second Co', 'moves', 'all', false) m, pg_temp.batch('Second Co', 'valuation', 'all', false) l;
select pg_temp.fill('Second Co', (select m from tb), (select l from tb), false);
create temp table t1 as select clock_timestamp() t;
select private.finish_inventory_batch_core((select m from tb));
select private.finish_inventory_batch_core((select l from tb));
select pg_temp.check('the second company''s full history is saved in under 30 seconds', (clock_timestamp() - (select t from t1) < interval '30 seconds')::text, 'true');
select pg_temp.check('and every row of it is live', (select count(*)::text from public.stock_layers where company_id = pg_temp.co('Second Co') and live), '25000');
select pg_temp.check('the layers take their kind from their moves', (select count(*)::text from public.stock_layers where company_id = pg_temp.co('Second Co') and live and kind <> 'other'), '18750');

-- The same files again, adding only what is new: every record is already saved, and that is found out quickly.
create temp table tb2 as select pg_temp.batch('Second Co', 'moves', 'add', false) m, pg_temp.batch('Second Co', 'valuation', 'add', false) l;
select pg_temp.fill('Second Co', (select m from tb2), (select l from tb2), false);
create temp table t2 as select clock_timestamp() t;
create temp table r2 as select private.finish_inventory_batch_core((select m from tb2)) m, private.finish_inventory_batch_core((select l from tb2)) l;
select pg_temp.check('"Add only new" on a full history answers in under 30 seconds', (clock_timestamp() - (select t from t2) < interval '30 seconds')::text, 'true');
select pg_temp.check('and finds every record already saved', (select (m ->> 'already') || '/' || (l ->> 'already') || ' added ' || (m ->> 'added') || '/' || (l ->> 'added') from r2), '50000/25000 added 0/0');
-- Rows keyed differently (no Odoo ID against an Odoo ID) are still refused, as before.
create temp table tb3 as select pg_temp.batch('Second Co', 'valuation', 'add', false) l;
insert into public.stock_layers (company_id, batch_id, odoo_key, day, period, ref, product, qty, value)
values (pg_temp.co('Second Co'), (select l from tb3), 'svl_1', '2021-07-02', '2021-07', 'X', 'Product 1', 1, 1);
select pg_temp.check('mixed record keys are still refused', pg_temp.err(format('select private.finish_inventory_batch_core(%L)', (select l from tb3))), 'P0001');
