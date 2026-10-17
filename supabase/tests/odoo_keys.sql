-- An Odoo record's External ID and its database ID give one key (migration 0020). Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;

select pg_temp.check('an External ID Odoo made gives its database ID', private.odoo_key('__export__.stock_move_line_10000_ecc1e8c3'), '10000');
select pg_temp.check('a database ID stays as it is', private.odoo_key('10000'), '10000');
select pg_temp.check('a number read as 10000.0 is the same ID', private.odoo_key('10000.0'), '10000');
select pg_temp.check('a named XML ID is kept', private.odoo_key('stock.move_line_demo_1'), 'stock.move_line_demo_1');
select pg_temp.check('a contents key is kept', private.odoo_key('fp:000207f6408eb400#2'), 'fp:000207f6408eb400#2');

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('ok@x.test', '{"full_name":"Omar"}', now());
insert into public.companies (org_id, name) select org_id, 'Key Co' from public.memberships where user_id = (select id from auth.users where email = 'ok@x.test');
create temp table b as
  select (select id from public.companies where name = 'Key Co') co,
         gen_random_uuid() m1;
insert into public.inventory_batches (id, company_id, kind, periods, mode, status) select m1, co, 'moves', array['2026-01'], 'all', 'done' from b;
insert into public.stock_moves (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, from_loc, to_loc, qty, live)
select co, m1, '__export__.stock_move_line_77_ab12cd', '2026-01-05', '2026-01', 'WH/OUT/1', 'delivery', 'P', '', 'WH/Stock', 'Customers', 1, true from b;
select pg_temp.check('a move saved with an External ID is stored under its database ID', (select odoo_key from public.stock_moves where batch_id = (select m1 from b)), '77');
-- The same move again, exported with ".id", is the same record: the live key refuses a second copy.
select pg_temp.check('the same move with ".id" is the same record',
  (select count(*)::text from public.stock_moves where company_id = (select co from b) and live and odoo_key = private.odoo_key('77')), '1');

-- Rows being staged are reduced the same way, so a file's repeated records and "Add new and changed" compare like with like.
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = e))::text, false);
  set role authenticated;
end $f$;
create temp table j (r jsonb);
grant all on j to authenticated;
grant select on b to authenticated;
select pg_temp.login('ok@x.test');
insert into j select public.create_import_job((select co from b), 'inventory', 'add', '[{"name":"m.xlsx","kind":"moves"}]'::jsonb);
select public.stage_import_rows((select (r -> 'files' -> 0 ->> 'id')::uuid from j), '[{"n":1,"data":{"odoo_key":"__export__.stock_move_line_77_ab12cd"}}]'::jsonb);
reset role;
select pg_temp.check('a staged row carries the database ID', (select data ->> 'odoo_key' from public.import_rows where job_id = (select (r ->> 'job')::uuid from j)), '77');
