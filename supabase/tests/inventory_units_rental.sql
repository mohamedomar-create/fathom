-- 0045: the stock summary names products kept in more than one unit of measure, and carries rental moves by customer
-- and rental location (out +, back −), so the pages can show on rent vs idle, utilisation and who has what.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0045_inventory_units_rental.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('iu@x.test', '{"full_name":"Ivo"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
insert into public.companies (org_id, name) select org_id, 'Units Rental Co' from public.memberships where user_id = (select id from auth.users where email = 'iu@x.test') limit 1;
create temp table ids as select id co from public.companies where name = 'Units Rental Co';
grant select on ids to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'iu@x.test'))::text, false);
set role authenticated;
reset role; create temp table b (id uuid); grant all on b to authenticated; set role authenticated;
insert into b select public.begin_inventory_batch((select co from ids), 'moves', array['2026-08', '2026-09'], 'm.xlsx', 'replace', '{}'::jsonb);
select public.add_stock_moves((select id from b), '[
  {"odoo_key":"m1","day":"2026-08-03","period":"2026-08","ref":"WH/IN/1","kind":"receipt","product":"Filter","code":"F1","from_loc":"Partners/Vendors","to_loc":"WH/Stock","qty":10,"uom":"Units"},
  {"odoo_key":"m2","day":"2026-08-04","period":"2026-08","ref":"WH/IN/2","kind":"receipt","product":"Filter","code":"F1","from_loc":"Partners/Vendors","to_loc":"WH/Stock","qty":2,"uom":"Box of 10"},
  {"odoo_key":"m3","day":"2026-08-05","period":"2026-08","ref":"WH/IN/3","kind":"receipt","product":"Vent","code":"V1","from_loc":"Partners/Vendors","to_loc":"WH/Stock","qty":5,"uom":"Units"},
  {"odoo_key":"m4","day":"2026-08-10","period":"2026-08","ref":"RENT/1","kind":"rental_out","product":"Vent","code":"V1","from_loc":"WH/Stock","to_loc":"Rental/Out","qty":3,"uom":"Units","partner":"Salam Hospital"},
  {"odoo_key":"m5","day":"2026-09-10","period":"2026-09","ref":"RENT/2","kind":"rental_back","product":"Vent","code":"V1","from_loc":"Rental/Out","to_loc":"WH/Stock","qty":1,"uom":"Units","partner":"Salam Hospital"}
]'::jsonb);
select public.finish_inventory_batch((select id from b));
reset role;
create temp table w as select private.inventory_wire((select co from ids)) j;
select pg_temp.check('summary version 3', (select j ->> 'v' from w), '3');
select pg_temp.check('a product in two units is named with both',
  (select string_agg((j -> 'prods' -> ((x ->> 0)::int) ->> 1) || ': ' || (x -> 1)::text, '; ') from w, jsonb_array_elements(j -> 'uoms') x), 'Filter: ["Box of 10", "Units"]');
select pg_temp.check('rental moves by month, customer and location (back is negative)',
  (select string_agg(x ->> 0 || ' ' || (j -> 'prods' -> ((x ->> 1)::int) ->> 1) || ' ' || (x ->> 2) || ' ' || (x ->> 3) || ' ' || (x ->> 4), '; ' order by x ->> 0) from w, jsonb_array_elements(j -> 'rent') x),
  '2026-08 Vent Salam Hospital Rental/Out 3; 2026-09 Vent Salam Hospital Rental/Out -1');
select pg_temp.check('everything earlier is still there', (select (j ? 'flow' and j ? 'layers' and j ? 'onhand')::text from w), 'true');
