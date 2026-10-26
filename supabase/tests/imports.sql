-- Import jobs (migration 0014): staged rows sent by the browser, checked and saved by the background worker.
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ja@x.test', '{"full_name":"Jana"}', now()), ('jb@x.test', '{"full_name":"Jad"}', now());
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

insert into public.companies (org_id, name) values (pg_temp.home('ja@x.test'), 'Import Co');
create temp table ids as select (select id from public.companies where name = 'Import Co') as co;
grant select on ids to authenticated;
create temp table jobs (name text primary key, r jsonb);
grant all on jobs to authenticated;
create function pg_temp.job(n text) returns uuid language sql as $f$ select (r ->> 'job')::uuid from jobs where name = n $f$;
create function pg_temp.file(n text, i int) returns uuid language sql as $f$ select (r -> 'files' -> i ->> 'id')::uuid from jobs where name = n $f$;
create function pg_temp.status(n text) returns text language sql as $f$ select status || coalesce(': ' || message, '') from public.import_jobs where id = pg_temp.job(n) $f$;
create function pg_temp.layers() returns text language sql as $f$
  select coalesce(string_agg(odoo_key || '=' || kind || ':' || value, ',' order by odoo_key), '') from public.stock_layers where company_id = (select co from ids) and live $f$;
create function pg_temp.moves() returns text language sql as $f$
  select coalesce(string_agg(odoo_key || '=' || kind, ',' order by odoo_key), '') from public.stock_moves where company_id = (select co from ids) and live $f$;

select pg_temp.login('ja@x.test');

-- 1. A valuation and a moves file in one job (mode "all"). The worker saves moves first, so the valuation row of a
--    return to a supplier on an OUT document takes its kind from its move.
insert into jobs select 'one', public.create_import_job((select co from ids), 'inventory', 'all',
  '[{"name":"Stock Valuation Layer.xlsx","size":1000,"export":"stock.valuation.layer","kind":"valuation"},
    {"name":"Product Moves.xlsx","size":900,"export":"stock.move.line","kind":"moves"}]'::jsonb);
select pg_temp.check('the job starts preparing', pg_temp.status('one'), 'preparing');
select pg_temp.check('each file gets a path under the company and the job',
  ((select r -> 'files' -> 0 ->> 'path' from jobs where name = 'one') like (select co from ids)::text || '/' || pg_temp.job('one')::text || '/%Stock Valuation Layer.xlsx')::text, 'true');
select pg_temp.check('rows are staged', public.stage_import_rows(pg_temp.file('one', 0), '[
  {"n":1,"line":2,"data":{"odoo_key":"svl_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","qty":10,"unit_value":100,"value":1000,"updated_at":"2026-08-03 10:00:00"}},
  {"n":2,"line":3,"data":{"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","qty":-4,"unit_value":100,"value":-400,"updated_at":"2026-09-05 10:00:00"}}
]'::jsonb)::text, '2');
select pg_temp.check('the same chunk again adds nothing', public.stage_import_rows(pg_temp.file('one', 0), '[
  {"n":2,"line":3,"data":{"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","qty":-4,"unit_value":100,"value":-400}}
]'::jsonb)::text, '0');
select public.stage_import_rows(pg_temp.file('one', 1), '[
  {"n":1,"line":2,"data":{"odoo_key":"sml_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","from_loc":"Partner Locations/Vendors","to_loc":"WH/Stock","qty":10}},
  {"n":2,"line":3,"data":{"odoo_key":"sml_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"supplier_return","product":"Mask","code":"P1","from_loc":"WH/Stock","to_loc":"Partner Locations/Vendors","qty":4}}
]'::jsonb);
select pg_temp.check('staged counts per file', (select (public.import_staged(pg_temp.job('one')) ->> pg_temp.file('one', 0)::text)), '2');
do $$ begin perform public.queue_import_job(pg_temp.job('one'), jsonb_build_object(pg_temp.file('one', 0), 2, pg_temp.file('one', 1), 2)); raise exception 'FAIL queued before storing';
exception when raise_exception then if sqlerrm not like 'NOT_STORED%' then raise; end if; raise notice 'ok  a job waits for its files to be stored'; end $$;
select public.mark_import_file_stored(pg_temp.file('one', 0)), public.mark_import_file_stored(pg_temp.file('one', 1));
do $$ begin perform public.queue_import_job(pg_temp.job('one'), jsonb_build_object(pg_temp.file('one', 0), 3, pg_temp.file('one', 1), 2)); raise exception 'FAIL queued with rows missing';
exception when raise_exception then if sqlerrm not like 'MISSING_ROWS%' then raise; end if; raise notice 'ok  a job waits for every row'; end $$;
select public.queue_import_job(pg_temp.job('one'), jsonb_build_object(pg_temp.file('one', 0), 2, pg_temp.file('one', 1), 2));
select pg_temp.check('queued', pg_temp.status('one'), 'queued');

-- Someone from another organisation cannot see, send to or act on it.
select pg_temp.login('jb@x.test');
select pg_temp.check('an outsider sees no job', (select count(*) from public.import_jobs)::text, '0');
do $$ begin perform public.stage_import_rows(pg_temp.file('one', 0), '[{"n":9,"data":{}}]'::jsonb); raise exception 'FAIL outsider staged rows';
exception when insufficient_privilege then raise notice 'ok  an outsider cannot send rows'; end $$;
do $$ begin perform public.act_on_import_job(pg_temp.job('one'), 'cancel'); raise exception 'FAIL outsider cancelled';
exception when insufficient_privilege then raise notice 'ok  an outsider cannot stop a job'; end $$;
do $$ begin perform public.create_import_job((select co from ids), 'inventory', 'all', '[{"name":"x.xlsx","kind":"moves"}]'::jsonb); raise exception 'FAIL outsider created a job';
exception when insufficient_privilege then raise notice 'ok  an outsider cannot start a job'; end $$;
do $$ begin insert into public.import_rows (file_id, n, job_id) values (pg_temp.file('one', 0), 99, pg_temp.job('one')); raise exception 'FAIL direct insert';
exception when insufficient_privilege then raise notice 'ok  rows cannot be written around the functions'; end $$;

-- The background worker (pg_cron in Supabase) checks and saves it.
reset role;
call private.run_import_jobs();
select pg_temp.check('saved', pg_temp.status('one'), 'done');
select pg_temp.check('moves live', pg_temp.moves(), 'sml_1=receipt,sml_2=supplier_return');
select pg_temp.check('the valuation row takes its kind from its move', pg_temp.layers(), 'svl_1=receipt:1000.00,svl_2=supplier_return:-400.00');
select pg_temp.check('counts', (select counts::text from public.import_jobs where id = pg_temp.job('one')),
  '{"new": 4, "rows": 4, "added": 4, "already": 0, "changed": 0, "invalid": 0, "replaced": 0, "unchanged": 0}');
select pg_temp.check('saved rows leave staging', (select count(*) from public.import_rows where job_id = pg_temp.job('one'))::text, '0');
select pg_temp.check('the last-updated date is kept', (select odoo_updated_at::text from public.stock_layers where odoo_key = 'svl_1' and live), '2026-08-03 10:00:00+00');

-- 2. An invalid row (no date) and a repeated Odoo record stop the job: nothing is saved until the person accepts.
select pg_temp.login('ja@x.test');
insert into jobs select 'two', public.create_import_job((select co from ids), 'inventory', 'add', '[{"name":"v2.xlsx","kind":"valuation"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('two', 0), '[
  {"n":1,"line":2,"data":{"odoo_key":"svl_3","day":"2026-09-10","period":"2026-09","ref":"WH/IN/00002","kind":"receipt","product":"Mask","code":"P1","qty":1,"unit_value":100,"value":100}},
  {"n":2,"line":3,"data":{"odoo_key":"svl_4","day":"","period":"","ref":"WH/IN/00003","product":"Mask","code":"P1","qty":1,"value":100}},
  {"n":3,"line":4,"data":{"odoo_key":"svl_3","day":"2026-09-10","period":"2026-09","ref":"WH/IN/00002","kind":"receipt","product":"Mask","code":"P1","qty":1,"unit_value":100,"value":100}},
  {"n":4,"line":5,"error":"Quantity is not a number: \"abc\""}
]'::jsonb);
select public.mark_import_file_stored(pg_temp.file('two', 0));
select public.queue_import_job(pg_temp.job('two'), jsonb_build_object(pg_temp.file('two', 0), 4));
reset role;
call private.run_import_jobs();
select pg_temp.check('invalid rows stop the job', pg_temp.status('two'), 'needs_review: 3 row(s) cannot be read. Nothing was saved.');
select pg_temp.check('the errors name the row', (select string_agg(line || ' ' || error, ' | ' order by n) from public.import_rows where job_id = pg_temp.job('two') and error is not null),
  '3 No readable date | 4 Repeats Odoo record svl_3 (row 2) | 5 Quantity is not a number: "abc"');
select pg_temp.check('nothing saved yet', pg_temp.layers(), 'svl_1=receipt:1000.00,svl_2=supplier_return:-400.00');
select pg_temp.login('ja@x.test');
select public.act_on_import_job(pg_temp.job('two'), 'accept');
reset role;
call private.run_import_jobs();
select pg_temp.check('the valid row is saved after accepting', pg_temp.status('two'), 'done');
select pg_temp.check('one more layer', pg_temp.layers(), 'svl_1=receipt:1000.00,svl_2=supplier_return:-400.00,svl_3=receipt:100.00');
select pg_temp.check('error rows stay for the report', (select count(*) from public.import_rows where job_id = pg_temp.job('two'))::text, '3');

-- 3. Add new and changed records (by Odoo ID and last-updated date).
select pg_temp.login('ja@x.test');
insert into jobs select 'three', public.create_import_job((select co from ids), 'inventory', 'update', '[{"name":"v3.xlsx","kind":"valuation"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('three', 0), '[
  {"n":1,"line":2,"data":{"odoo_key":"svl_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","qty":10,"unit_value":100,"value":1000,"updated_at":"2026-08-03 10:00:00"}},
  {"n":2,"line":3,"data":{"odoo_key":"svl_3","day":"2026-09-10","period":"2026-09","ref":"WH/IN/00002","kind":"receipt","product":"Mask","code":"P1","qty":1,"unit_value":110,"value":110,"updated_at":"2026-10-01 09:00:00"}},
  {"n":3,"line":4,"data":{"odoo_key":"svl_5","day":"2026-10-02","period":"2026-10","ref":"WH/IN/00004","kind":"receipt","product":"Mask","code":"P1","qty":2,"unit_value":100,"value":200,"updated_at":"2026-10-02 09:00:00"}}
]'::jsonb);
select public.mark_import_file_stored(pg_temp.file('three', 0));
select public.queue_import_job(pg_temp.job('three'), jsonb_build_object(pg_temp.file('three', 0), 3));
reset role;
call private.run_import_jobs();
select pg_temp.check('update mode', pg_temp.status('three'), 'done');
select pg_temp.check('changed replaced, unchanged kept, new added', pg_temp.layers(),
  'svl_1=receipt:1000.00,svl_2=supplier_return:-400.00,svl_3=receipt:110.00,svl_5=receipt:200.00');
select pg_temp.check('update counts', (select jsonb_build_object('new', counts -> 'new', 'changed', counts -> 'changed', 'unchanged', counts -> 'unchanged', 'added', counts -> 'added', 'already', counts -> 'already', 'replaced', counts -> 'replaced')::text
  from public.import_jobs where id = pg_temp.job('three')), '{"new": 1, "added": 1, "already": 1, "changed": 1, "replaced": 1, "unchanged": 1}');

-- 4. "Update" needs Odoo IDs: fingerprinted rows fail the job with a plain message.
select pg_temp.login('ja@x.test');
insert into jobs select 'four', public.create_import_job((select co from ids), 'inventory', 'update', '[{"name":"v4.xlsx","kind":"valuation"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('four', 0), '[{"n":1,"line":2,"data":{"odoo_key":"fp:0123456789abcdef","day":"2026-10-03","period":"2026-10","ref":"WH/IN/00005","product":"Mask","code":"P1","qty":1,"value":100}}]'::jsonb);
select public.mark_import_file_stored(pg_temp.file('four', 0));
select public.queue_import_job(pg_temp.job('four'), jsonb_build_object(pg_temp.file('four', 0), 1));
reset role;
call private.run_import_jobs();
select pg_temp.check('needs IDs', (pg_temp.status('four') like 'failed: NEEDS_IDS%')::text, 'true');
select pg_temp.login('ja@x.test');
select public.act_on_import_job(pg_temp.job('four'), 'cancel');
select pg_temp.check('a failed job can be stopped, and its rows go', pg_temp.status('four') || ' ' || (select count(*) from public.import_rows where job_id = pg_temp.job('four')), 'cancelled 0');

-- 5. Stock on hand and products in one job.
insert into jobs select 'five', public.create_import_job((select co from ids), 'inventory', 'replace',
  '[{"name":"Product Variant.xlsx","kind":"onhand"},{"name":"Products.xlsx","kind":"products"}]'::jsonb);
select public.stage_import_rows(pg_temp.file('five', 0), '[
  {"n":1,"line":2,"data":{"as_of":"2026-10-15","product":"Mask","code":"P1","location":"","lot":"","qty":7,"value":700}},
  {"n":2,"line":3,"data":{"as_of":"2026-10-15","product":"Mask","code":"P1","location":"","lot":"","qty":1,"value":100}}]'::jsonb);
select public.stage_import_rows(pg_temp.file('five', 1), '[{"n":1,"line":2,"data":{"code":"P1","name":"Mask","category":"Masks","cost":100,"type":"Storable"}}]'::jsonb);
select public.mark_import_file_stored(pg_temp.file('five', 0)), public.mark_import_file_stored(pg_temp.file('five', 1));
select public.queue_import_job(pg_temp.job('five'), jsonb_build_object(pg_temp.file('five', 0), 2, pg_temp.file('five', 1), 1));
reset role;
call private.run_import_jobs();
select pg_temp.check('on hand and products saved', pg_temp.status('five') || ' ' || (select qty::text || '/' || value::text from public.stock_onhand where company_id = (select co from ids))
  || ' ' || (select category from public.inventory_products where company_id = (select co from ids)), 'done 8.0000/800.00 Masks');

-- 6. An upload left preparing for a day is closed.
select pg_temp.login('ja@x.test');
insert into jobs select 'six', public.create_import_job((select co from ids), 'inventory', 'add', '[{"name":"v6.xlsx","kind":"valuation"}]'::jsonb);
reset role;
update public.import_jobs set updated_at = now() - interval '25 hours' where id = pg_temp.job('six');
call private.run_import_jobs();
select pg_temp.check('stale upload closed', (pg_temp.status('six') like 'failed: The upload stopped%')::text, 'true');

-- 7. Column choices are kept per company and export.
select pg_temp.login('ja@x.test');
select public.save_import_template((select co from ids), 'stock.valuation.layer', '{"value":"Valeur totale"}'::jsonb);
select pg_temp.check('template kept', (select mapping ->> 'value' from public.import_templates where company_id = (select co from ids)), 'Valeur totale');

set role anon;
do $$ begin perform public.create_import_job((select co from ids), 'inventory', 'all', '[]'::jsonb); raise exception 'FAIL anon started a job';
exception when insufficient_privilege then raise notice 'ok  anon cannot start a job'; end $$;
reset role;
