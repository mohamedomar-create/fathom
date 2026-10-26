-- Inventory summaries kept ready (migration 0015): changes mark the company, the background worker rebuilds the summary,
-- a page reads it in one call. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ra@x.test', '{"full_name":"Rana"}', now()), ('rb@x.test', '{"full_name":"Ramy"}', now());
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

insert into public.companies (org_id, name) values (pg_temp.home('ra@x.test'), 'Rollup Co');
create temp table ids as select (select id from public.companies where name = 'Rollup Co') as co;
grant select on ids to authenticated;
create temp table st (k text primary key, j jsonb);
grant all on st to authenticated;
create function pg_temp.state() returns jsonb language sql as $f$ select public.inventory_state((select co from ids)) $f$;
create function pg_temp.w() returns jsonb language sql as $f$ select public.inventory_state((select co from ids)) -> 'summary' $f$;
-- The background worker's run (as the scheduler does it, not as a signed-in person).
create function pg_temp.refresh() returns integer language plpgsql as $f$
declare n integer;
begin
  reset role;
  n := private.refresh_inventory_rollups();
  perform pg_temp.login('ra@x.test');
  return n;
end $f$;

select pg_temp.login('ra@x.test');
select pg_temp.check('no stock yet: nothing due, no summary', pg_temp.state()::text, '{"pending": false, "summary": null, "built_at": null}');

-- A valuation upload: nothing is due while it is open; finishing it marks the company.
create temp table b1 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-08', '2026-09'], 'v.xlsx', 'replace', '{}'::jsonb) as id;
select public.add_stock_layers((select id from b1), '[
  {"odoo_key":"svl_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","category":"Masks","qty":10,"unit_value":100,"value":1000},
  {"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","category":"Masks","qty":-4,"unit_value":100,"value":-400},
  {"odoo_key":"svl_3","day":"2026-09-06","period":"2026-09","ref":"WH/OUT/00002","kind":"delivery","product":"جهاز أكسجين","code":"","category":"","qty":-1,"unit_value":50,"value":-50},
  {"odoo_key":"svl_4","day":"2026-09-07","period":"2026-09","ref":"WH/INT/00007","kind":"other","product":"Mask","code":"P1","category":"Masks","qty":0,"unit_value":0,"value":25}
]'::jsonb);
select public.finish_inventory_batch((select id from b1));
select pg_temp.check('a finished upload is due', pg_temp.state() ->> 'pending', 'true');
select pg_temp.check('the worker builds the summary', (pg_temp.refresh() >= 1)::text, 'true');
select pg_temp.check('then nothing is due', pg_temp.state() ->> 'pending', 'false');
select pg_temp.check('a second run has nothing to do', pg_temp.refresh()::text, '0');
select pg_temp.check('each product written once', (pg_temp.w() -> 'prods')::text, '[["", "جهاز أكسجين", ""], ["P1", "Mask", "Masks"]]');
select pg_temp.check('layers per month, kind and product',
  (select string_agg(x::text, ' ' order by x::text) from jsonb_array_elements(pg_temp.w() -> 'layers') x),
  '["2026-08", "receipt", 1, 10, 1000, 1] ["2026-09", "delivery", 0, -1, -50, 1] ["2026-09", "delivery", 1, -4, -400, 1] ["2026-09", "other", 1, 0, 25, 1]');
select pg_temp.check('no moves yet', (pg_temp.w() -> 'moveMonths')::text || ' ' || coalesce(pg_temp.w() ->> 'asOf', 'null'), '[] null');
select pg_temp.check('documents are kept only when the ledger is loaded', (pg_temp.w() -> 'byRef')::text, '[]');
select pg_temp.check('last day out per product', (pg_temp.w() -> 'lastOut')::text, '{"[P1] Mask": "2026-09-05", "جهاز أكسجين": "2026-09-06"}');

-- Moves: per month and kind, per location, each product's net units per location, and rentals.
create temp table b2 as select public.begin_inventory_batch((select co from ids), 'moves', array['2026-08', '2026-09'], 'm.xlsx', 'replace', '{}'::jsonb) as id;
select public.add_stock_moves((select id from b2), '[
  {"odoo_key":"sml_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","from_loc":"Partners/Vendors","to_loc":"WH/Stock","qty":10},
  {"odoo_key":"sml_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","from_loc":"WH/Stock","to_loc":"Partners/Customers","qty":4},
  {"odoo_key":"sml_3","day":"2026-09-07","period":"2026-09","ref":"WH/INT/00007","kind":"rental_out","product":"Mask","code":"P1","from_loc":"WH/Stock","to_loc":"Virtual Locations/Rental","qty":2}
]'::jsonb);
select public.finish_inventory_batch((select id from b2));
select pg_temp.check('moves are due', pg_temp.state() ->> 'pending', 'true');
select pg_temp.refresh();
select pg_temp.check('move months and the month stock is placed at', (pg_temp.w() -> 'moveMonths')::text || ' ' || (pg_temp.w() ->> 'asOf'), '["2026-08", "2026-09"] 2026-09');
select pg_temp.check('moves per month and kind',
  (select string_agg(x::text, ' ' order by x::text) from jsonb_array_elements(pg_temp.w() -> 'mk') x),
  '["2026-08", "receipt", 10, 1] ["2026-09", "delivery", 4, 1] ["2026-09", "rental_out", 2, 1]');
select pg_temp.check('units into and out of each location',
  (select string_agg(x::text, ' ' order by x::text) from jsonb_array_elements(pg_temp.w() -> 'flow') x),
  '["2026-08", "Partners/Vendors", 0, 10] ["2026-08", "WH/Stock", 10, 0] ["2026-09", "Partners/Customers", 4, 0] ["2026-09", "Virtual Locations/Rental", 2, 0] ["2026-09", "WH/Stock", 0, 6]');
select pg_temp.check('net units per product and location',
  (select string_agg(x::text, ' ' order by x::text) from jsonb_array_elements(pg_temp.w() -> 'pl') x),
  '[1, "Partners/Customers", 4] [1, "Partners/Vendors", -10] [1, "Virtual Locations/Rental", 2] [1, "WH/Stock", 4]');
select pg_temp.check('rental locations', (pg_temp.w() -> 'rentalLocs')::text, '["Virtual Locations/Rental"]');
select pg_temp.check('a rental document carrying value is listed', (pg_temp.w() -> 'rv')::text, '[["2026-09", "WH/INT/00007", 25]]');

-- A stock-on-hand list marks the company too, and places stock at its date.
create temp table b3 as select public.begin_inventory_batch((select co from ids), 'onhand', array['2026-10'], 'onhand.xlsx', 'replace', '{}'::jsonb) as id;
select public.set_stock_onhand((select id from b3), '2026-10-16', '[{"product":"Mask","code":"P1","location":"WH/Stock","lot":"","qty":4,"value":400}]'::jsonb);
select pg_temp.check('a stock-on-hand list is due', pg_temp.state() ->> 'pending', 'true');
select pg_temp.refresh();
select pg_temp.check('stock is placed at the list''s month', pg_temp.w() ->> 'asOf', '2026-10');
select pg_temp.check('the list is in the summary', (pg_temp.w() -> 'onhand')::text, '[["2026-10-16", "Mask", "P1", "WH/Stock", "", 4, 400]]');

-- The ledger's stock postings: the documents behind a difference are kept from then on.
create temp table b4 as select public.begin_stock_ledger_batch((select co from ids), array['2026-09'], 'gl.xlsx') as id;
select public.add_stock_ledger_lines((select id from b4), '[{"day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","account":"Inventory","amount":-400}]'::jsonb);
select pg_temp.check('ledger postings are due', pg_temp.state() ->> 'pending', 'true');
select pg_temp.refresh();
select pg_temp.check('ledger postings by document', (pg_temp.w() -> 'ledger')::text, '[["2026-09", "WH/OUT/00001", -400]]');
select pg_temp.check('and the module''s documents', jsonb_array_length(pg_temp.w() -> 'byRef')::text, '4');
select pg_temp.check('the summary says when it was built', (pg_temp.state() ->> 'built_at' is not null)::text, 'true');

-- Who can read it: members only, never signed-out visitors.
select pg_temp.login('rb@x.test');
do $$ begin perform public.inventory_state((select co from ids)); raise exception 'FAIL an outsider read the summary';
exception when insufficient_privilege then raise notice 'ok  an outsider cannot read the summary'; end $$;
select pg_temp.check('an outsider sees no summary row', (select count(*)::text from public.inventory_rollups), '0');
reset role;
set role anon;
do $$ begin perform public.inventory_state((select co from ids)); raise exception 'FAIL anon read the summary';
exception when insufficient_privilege then raise notice 'ok  signed-out visitors cannot read the summary'; end $$;
reset role;
do $$ begin perform private.refresh_inventory_rollups(); raise notice 'ok  the worker runs as the scheduler'; end $$;

-- Deleting the company takes its summary and marks with it.
create temp table gone as select co from ids;
delete from public.companies where id = (select co from gone);
select pg_temp.check('company deleted with its summary and marks',
  ((select count(*) from public.inventory_rollups where company_id = (select co from gone)) + (select count(*) from private.inventory_marks where company_id = (select co from gone)))::text, '0');
