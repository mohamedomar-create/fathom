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
create function pg_temp.live_keys() returns text language sql as $f$ select coalesce(string_agg(odoo_key, ',' order by odoo_key), '') from public.stock_layers where company_id = (select co from ids) and live $f$;

select pg_temp.login('ia@x.test');

-- August and September layers, keyed by Odoo ID. Rows are staged first: nothing shows until the upload is finished.
create temp table b1 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-08', '2026-09'], 'valuation.xlsx', 'replace', '{}'::jsonb) as id;
create temp table rows1 as select '[
  {"odoo_key":"svl_1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","kind":"receipt","product":"Mask","code":"P1","category":"","lot":"","qty":10,"unit_value":100,"value":1000,"partner":"","landed_ref":""},
  {"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","category":"","lot":"","qty":-4,"unit_value":100,"value":-400,"partner":"","landed_ref":""}
]'::jsonb as j;
grant select on rows1 to authenticated;
select pg_temp.check('first chunk staged', public.add_stock_layers((select id from b1), (select j from rows1))::text, '{"staged": 2, "repeated": 0}');
select pg_temp.check('the same chunk again is a repeat', public.add_stock_layers((select id from b1), (select j from rows1))::text, '{"staged": 0, "repeated": 2}');
select pg_temp.check('nothing shows before the upload is finished', pg_temp.live_keys(), '');
select pg_temp.check('finish adds both', public.finish_inventory_batch((select id from b1))::text, '{"added": 2, "already": 0}');
select pg_temp.check('two layers live', pg_temp.live_keys(), 'svl_1,svl_2');

-- Add only new: a later file with one old and one new layer.
create temp table b2 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'valuation-2.xlsx', 'add', '{}'::jsonb) as id;
select public.add_stock_layers((select id from b2), '[
  {"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","qty":-4,"unit_value":100,"value":-400},
  {"odoo_key":"svl_3","day":"2026-09-06","period":"2026-09","ref":"LC/2026/0001","kind":"landed_cost","product":"Mask","code":"P1","qty":0,"unit_value":0,"value":120,"landed_ref":"LC/2026/0001"}
]'::jsonb);
-- Rows outside the batch's months are refused.
select pg_temp.check('a row outside the months is not staged', public.add_stock_layers((select id from b2), '[{"odoo_key":"svl_x","day":"2026-07-01","period":"2026-07","ref":"WH/IN/9","kind":"receipt","product":"Mask","code":"P1","qty":1,"unit_value":1,"value":1}]'::jsonb)::text, '{"staged": 0, "repeated": 0}');
select pg_temp.check('add-only-new counts the old one', public.finish_inventory_batch((select id from b2))::text, '{"added": 1, "already": 1}');
select pg_temp.check('three layers live', pg_temp.live_keys(), 'svl_1,svl_2,svl_3');

-- An upload that never finishes changes nothing, and the next upload of that kind drops it.
create temp table bx as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'broken.xlsx', 'replace', '{}'::jsonb) as id;
select public.add_stock_layers((select id from bx), '[{"odoo_key":"svl_9","day":"2026-09-07","period":"2026-09","ref":"WH/IN/00009","kind":"receipt","product":"Mask","code":"P1","qty":1,"unit_value":1,"value":1}]'::jsonb);
select pg_temp.check('an unfinished replace removes nothing', pg_temp.live_keys(), 'svl_1,svl_2,svl_3');

-- Replace September with a file holding svl_2 again: August stays, September is exactly the new file.
create temp table b3 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'valuation-3.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('the unfinished upload was dropped', (select count(*)::text from public.stock_layers where odoo_key = 'svl_9'), '0');
select public.add_stock_layers((select id from b3), '[{"odoo_key":"svl_2","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","qty":-4,"unit_value":100,"value":-400}]'::jsonb);
select pg_temp.check('replace finished', public.finish_inventory_batch((select id from b3))::text, '{"added": 1, "already": 0}');
select pg_temp.check('replace cleared September only', pg_temp.live_keys(), 'svl_1,svl_2');

-- Odoo names every valuation export the same: a file with the same name for October leaves August and September alone.
create temp table b6 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-10'], 'valuation.xlsx', 'replace', '{}'::jsonb) as id;
select public.add_stock_layers((select id from b6), '[{"odoo_key":"svl_10","day":"2026-10-02","period":"2026-10","ref":"WH/OUT/00002","kind":"delivery","product":"Mask","code":"P1","qty":-2,"unit_value":100,"value":-200}]'::jsonb);
select public.finish_inventory_batch((select id from b6));
select pg_temp.check('same file name, another month: earlier months kept', pg_temp.live_keys(), 'svl_1,svl_10,svl_2');

-- Add only new refuses rows keyed differently from those already saved for the months (a re-export without the ID column).
create temp table b7 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-09'], 'no-ids.xlsx', 'add', '{}'::jsonb) as id;
select public.add_stock_layers((select id from b7), '[{"odoo_key":"fp:00000000000000aa","day":"2026-09-05","period":"2026-09","ref":"WH/OUT/00001","kind":"delivery","product":"Mask","code":"P1","qty":-4,"unit_value":100,"value":-400}]'::jsonb);
do $$ begin perform public.finish_inventory_batch((select id from b7)); raise exception 'FAIL keys were mixed';
exception when raise_exception then if sqlerrm not like '%KEY_MIX%' then raise; end if; raise notice 'ok  add-only-new refuses mixed keys'; end $$;
select pg_temp.check('mixed keys added nothing', pg_temp.live_keys(), 'svl_1,svl_10,svl_2');

-- Moves, keyed the same way. A move returning goods to a supplier makes its layer a supplier return, not a delivery.
create temp table b4 as select public.begin_inventory_batch((select co from ids), 'moves', array['2026-09', '2026-10'], 'moves.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('moves staged', public.add_stock_moves((select id from b4), '[
  {"odoo_key":"sml_1","day":"2026-09-10","period":"2026-09","ref":"WH/INT/00007","kind":"rental_out","product":"Device","code":"D1","lot":"S1","from_loc":"WH/Stock","to_loc":"WH/Rental","qty":1,"uom":"Units","partner":""},
  {"odoo_key":"sml_2","day":"2026-10-02","period":"2026-10","ref":"WH/OUT/00002","kind":"supplier_return","product":"Mask","code":"P1","lot":"","from_loc":"WH/Stock","to_loc":"Partners/Vendors","qty":2,"uom":"Units","partner":""}
]'::jsonb)::text, '{"staged": 2, "repeated": 0}');
select pg_temp.check('moves finished', public.finish_inventory_batch((select id from b4))::text, '{"added": 2, "already": 0}');
select pg_temp.check('the layer follows its move', (select kind from public.stock_layers where odoo_key = 'svl_10' and live), 'supplier_return');

-- Products without an internal reference stay apart (by name).
create temp table b9 as select public.begin_inventory_batch((select co from ids), 'valuation', array['2026-11'], 'nocode.xlsx', 'replace', '{}'::jsonb) as id;
select public.add_stock_layers((select id from b9), '[
  {"odoo_key":"svl_20","day":"2026-11-02","period":"2026-11","ref":"WH/IN/00020","kind":"receipt","product":"Glove","code":"","qty":5,"unit_value":10,"value":50},
  {"odoo_key":"svl_21","day":"2026-11-02","period":"2026-11","ref":"WH/IN/00020","kind":"receipt","product":"Gown","code":"","qty":2,"unit_value":30,"value":60}
]'::jsonb);
select public.finish_inventory_batch((select id from b9));

-- Stock on hand is a snapshot: the same date again replaces it.
create temp table b5 as select public.begin_inventory_batch((select co from ids), 'onhand', array['2026-09'], 'stock.xlsx', 'replace', '{}'::jsonb) as id;
select pg_temp.check('snapshot saved', public.set_stock_onhand((select id from b5), '2026-09-30', '[{"product":"Mask","code":"P1","location":"WH/Stock","lot":"","qty":6,"value":600}]'::jsonb)::text, '1');
select pg_temp.check('snapshot replaced', public.set_stock_onhand((select id from b5), '2026-09-30', '[{"product":"Mask","code":"P1","location":"WH/Stock","lot":"","qty":7,"value":700}]'::jsonb)::text, '1');
select pg_temp.check('one snapshot row', (select string_agg(qty::text, ',') from public.stock_onhand where company_id = (select co from ids)), '7.0000');
select pg_temp.check('two codes with one name stay apart', public.set_stock_onhand((select id from b5), '2026-09-30', '[{"product":"Mask","code":"P1","location":"WH/Stock","lot":"","qty":7,"value":700},{"product":"Mask","code":"P9","location":"WH/Stock","lot":"","qty":1,"value":50}]'::jsonb)::text, '2');

select pg_temp.check('products upserted', public.set_inventory_products((select co from ids), '[{"code":"P1","name":"Mask","category":"Masks","cost":100,"type":"Goods"}]'::jsonb)::text, '1');

-- The ledger's stock postings: a new upload of the same months replaces them.
create temp table g1 as select public.begin_stock_ledger_batch((select co from ids), array['2026-08'], 'gl.xlsx') as id;
select pg_temp.check('ledger stock lines saved', public.add_stock_ledger_lines((select id from g1), '[{"day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","account":"110500 Stock","amount":1000}]'::jsonb)::text, '1');
create temp table g2 as select public.begin_stock_ledger_batch((select co from ids), array['2026-08'], 'gl-2.xlsx') as id;
select pg_temp.check('ledger stock lines replaced', public.add_stock_ledger_lines((select id from g2), '[{"day":"2026-08-03","period":"2026-08","ref":"WH/IN/00001","account":"110500 Stock","amount":1000}]'::jsonb)::text, '1');
select pg_temp.check('one ledger stock line', (select count(*)::text from public.stock_ledger_lines where company_id = (select co from ids)), '1');

-- The summary: monthly totals only.
create temp table s as select public.inventory_summary((select co from ids)) j;
select pg_temp.check('summary layers', (select string_agg((x ->> 'p') || ' ' || (x ->> 'kind') || ' ' || coalesce(nullif(x ->> 'code', ''), x ->> 'product') || ' ' || (x ->> 'v'), ',' order by x ->> 'p', x ->> 'product') from s, jsonb_array_elements(j -> 'layers') x),
  '2026-08 receipt P1 1000.00,2026-09 delivery P1 -400.00,2026-10 supplier_return P1 -200.00,2026-11 receipt Glove 50.00,2026-11 receipt Gown 60.00');
select pg_temp.check('summary moves', (select string_agg((x ->> 'kind') || ' ' || (x ->> 'q'), ',' order by x ->> 'kind') from s, jsonb_array_elements(j -> 'moves') x), 'rental_out 1.0000,supplier_return 2.0000');
select pg_temp.check('summary ledger refs', (select string_agg((x ->> 'ref') || ' ' || (x ->> 'v'), ',') from s, jsonb_array_elements(j -> 'ledger') x), 'WH/IN/00001 1000.00');
select pg_temp.check('summary rental documents', (select string_agg((x ->> 'p') || ' ' || (x ->> 'ref'), ',') from s, jsonb_array_elements(j -> 'rental') x), '2026-09 WH/INT/00007');
select pg_temp.check('summary knows the IDs', (select j -> 'meta' ->> 'withIds' from s), 'true');

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
