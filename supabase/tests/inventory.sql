-- Inventory (migration 0012): records keyed by Odoo ID, replace / add-only-new, who can save and read, and the summary.
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ia@x.test', '{"full_name":"Ines"}', now()), ('ib@x.test', '{"full_name":"Ivo"}', now());
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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e))::text, false);
  set role authenticated;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('ia@x.test'), 'Stock Co');
create temp table ids as select (select id from public.companies where name = 'Stock Co') as co;
grant select on ids to authenticated;

select pg_temp.login('ia@x.test');

-- August and September layers, keyed by Odoo ID.
create temp table b1 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-08', '2026-09'], 'valuation.xlsx', 'replace', '{}'::jsonb) as id;
create temp table rows1 as select '[
  {"odoo_key":"svl_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","category":"","lot":"","qty":10,"unit_value":100,"value":1000,"partner":"","landed_ref":""},
  {"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","category":"","lot":"","qty":-4,"unit_value":100,"value":-400,"partner":"","landed_ref":""}
]'::jsonb as j;
grant select on rows1 to authenticated;
select pg_temp.check('first save adds both', public.add_stock_layers((select id from b1), (select j from rows1))::text, '{"added": 2, "already": 0}');
select pg_temp.check('the same rows again add nothing', public.add_stock_layers((select id from b1), (select j from rows1))::text, '{"added": 0, "already": 2}');
select pg_temp.check('two layers stored', (select count(*)::text from public.stock_layers where company_id = (select co from ids)), '2');

-- Add only new: a later file with one old and one new layer.
create temp table b2 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'valuation-2.xlsx', 'add', '{}'::jsonb) as id;
select pg_temp.check('add-only-new counts the old one', public.add_stock_layers((select id from b2), '[
  {"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","qty":-4,"unit_value":100,"value":-400},
  {"odoo_key":"svl_3","day":"2026-09-06","period":"2026-09","ref":"LC/2026/0001","kind":"landed_cost","product":"Mask","code":"P1","qty":0,"unit_value":0,"value":120,"landed_ref":"LC/2026/0001"}
]'::jsonb)::text, '{"added": 1, "already": 1}');

-- Rows outside the batch's months are refused.
select pg_temp.check('a row outside the months is not added', public.add_stock_layers((select id from b2), '[{"odoo_key":"svl_x","day":"2026-07-01","period":"2026-07","ref":"WH/IN/9","kind":"receipt","product":"Mask","code":"P1","qty":1,"unit_value":1,"value":1}]'::jsonb)::text, '{"added": 0, "already": 0}');

-- Replace September: August stays.
create temp table b3 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'valuation-3.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('replace cleared September only', (select string_agg(odoo_key, ',' order by odoo_key) from public.stock_layers where company_id = (select co from ids)), 'svl_1');

-- Moves, keyed the same way.
create temp table b4 as select public.begin_inventory_batch((select co from ids), 'moves', array['2026-09'], 'moves.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('moves saved', public.add_stock_moves((select id from b4), '[
  {"odoo_key":"sml_1","day":"2026-09-10","period":"2026-09","ref":"WH/INT/00007","kind":"rental_out","product":"Device","code":"D1","lot":"S1","from_loc":"WH/Stock","to_loc":"WH/Rental","qty":1,"uom":"Units","partner":""}
]'::jsonb)::text, '{"added": 1, "already": 0}');

-- Stock on hand is a snapshot: the same date again replaces it.
create temp table b5 as select public.begin_inventory_batch((select co from ids), 'onhand', array['2026-09'], 'stock.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('snapshot saved', public.set_stock_onhand((select id from b5), '2026-09-30', '[{"product":"Mask","code":"P1","location":"WH/Stock","lot":"","qty":6,"value":600}]'::jsonb)::text, '1');
select pg_temp.check('snapshot replaced', public.set_stock_onhand((select id from b5), '2026-09-30', '[{"product":"Mask","code":"P1","location":"WH/Stock","lot":"","qty":7,"value":700}]'::jsonb)::text, '1');
select pg_temp.check('one snapshot row', (select string_agg(qty::text, ',') from public.stock_onhand where company_id = (select co from ids)), '7.0000');

select pg_temp.check('products upserted', public.set_inventory_products((select co from ids), '[{"code":"P1","name":"Mask","category":"Masks","cost":100,"type":"Goods"}]'::jsonb)::text, '1');

-- The ledger's stock postings: a new upload of the same months replaces them.
create temp table g1 as select public.begin_stock_ledger_batch((select co from ids), array['2026-08'], 'gl.xlsx') as id;
select pg_temp.check('ledger stock lines saved', public.add_stock_ledger_lines((select id from g1), '[{"day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","account":"110500 Stock","amount":1000}]'::jsonb)::text, '1');
create temp table g2 as select public.begin_stock_ledger_batch((select co from ids), array['2026-08'], 'gl-2.xlsx') as id;
select pg_temp.check('ledger stock lines replaced', public.add_stock_ledger_lines((select id from g2), '[{"day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","account":"110500 Stock","amount":1000}]'::jsonb)::text, '1');
select pg_temp.check('one ledger stock line', (select count(*)::text from public.stock_ledger_lines where company_id = (select co from ids)), '1');

-- The summary: monthly totals only.
create temp table s as select public.inventory_summary((select co from ids)) j;
select pg_temp.check('summary layers', (select string_agg((x ->> 'p') || ' ' || (x ->> 'kind') || ' ' || (x ->> 'v'), ',') from s, jsonb_array_elements(j -> 'layers') x), '2026-08 receipt 1000.00');
select pg_temp.check('summary moves', (select string_agg((x ->> 'kind') || ' ' || (x ->> 'q'), ',') from s, jsonb_array_elements(j -> 'moves') x), 'rental_out 1.0000');
select pg_temp.check('summary ledger refs', (select string_agg((x ->> 'ref') || ' ' || (x ->> 'v'), ',') from s, jsonb_array_elements(j -> 'ledger') x), 'WH/IN/00001 1000.00');
select pg_temp.check('summary knows the IDs', (select j -> 'meta' ->> 'withIds' from s), 'true');

-- The same file uploaded again under Replace removes its earlier copy, even in months the new upload does not cover.
create temp table b6 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-10'], 'valuation.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('same file again leaves no old copy', (select count(*)::text from public.stock_layers where company_id = (select co from ids)), '0');
select pg_temp.check('empty uploads dropped', (select count(*)::text from public.inventory_batches where company_id = (select co from ids) and kind = 'valuation'), '1');
reset role;

-- Ivo belongs to another organisation: he reads nothing and cannot save.
select pg_temp.login('ib@x.test');
select pg_temp.check('outsider reads no layers', (select count(*)::text from public.stock_layers), '0');
do $$ begin perform public.begin_stock_ledger_batch((select co from ids), array['2026-08'], 'x.xlsx'); raise exception 'FAIL outsider could clear ledger stock';
exception when insufficient_privilege then raise notice 'ok  outsider cannot touch ledger stock lines'; end $$;
select pg_temp.check('outsider summary empty', (select jsonb_array_length(public.inventory_summary((select co from ids)) -> 'layers')::text), '0');
do $$ begin perform public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'x.xlsx', 'replace', '{}'::jsonb); raise exception 'FAIL outsider could start a batch';
exception when insufficient_privilege then raise notice 'ok  outsider cannot start a batch'; end $$;
do $$ begin perform public.add_stock_layers((select id from b1), '[]'::jsonb); raise exception 'FAIL outsider could add layers';
exception when insufficient_privilege then raise notice 'ok  outsider cannot add layers'; end $$;
reset role;

set role anon;
do $$ begin perform public.inventory_summary((select co from ids)); raise exception 'FAIL anon could read the summary';
exception when insufficient_privilege then raise notice 'ok  anon cannot read the summary'; end $$;
reset role;
