-- The end user behind agency sales (migration 0029): lines keep their order, end user and method; the summary covers
-- customers with linked end users or marked as agencies, keeps unlinked lines apart by description, and is the company's
-- own; end_user_map is read by members and written by editors only. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ea@x.test', '{"full_name":"Eman"}', now()), ('ev@x.test', '{"full_name":"Essam"}', now()), ('eo@x.test', '{"full_name":"Ehab"}', now());

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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('ea@x.test'), 'Agency Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('ea@x.test'), pg_temp.uid('ev@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Agency Co') as co;
grant select on ids to authenticated;
create temp table bs (b uuid);
grant all on bs to authenticated;

select pg_temp.login('ea@x.test');
insert into bs select public.begin_sales_batch((select co from ids), 'file', array['2026-09'], 'sync');
select public.add_sales_lines((select b from bs), $$[
  {"day": "2026-09-29", "period": "2026-09", "doc": "INV2/2026/0901", "customer": "UPA", "product": "Cannula", "category": "Consumables", "qty": 5, "amount": 250000, "saleOrder": "S00010", "endUser": "Shifa Hospital", "mapMethod": "order"},
  {"day": "2026-09-30", "period": "2026-09", "doc": "INV/2026/0100", "customer": "UPA", "product": "Mask", "category": "Consumables", "qty": 1, "amount": 2000, "endUser": "Wadi University", "mapMethod": "contact"},
  {"day": "2026-09-30", "period": "2026-09", "doc": "INV/2026/0101", "customer": "UPA", "product": "Airtech", "category": "Devices", "qty": 1, "amount": 3000, "note": "( PRO 501 / 22 ) - Airtech"},
  {"day": "2026-09-30", "period": "2026-09", "doc": "INV/2026/0102", "customer": "UPA", "product": "Airtech", "category": "Devices", "qty": 1, "amount": 1000, "note": "( PRO 501 / 22 ) - Airtech"},
  {"day": "2026-09-30", "period": "2026-09", "doc": "INV/2026/0103", "customer": "Cash patient", "product": "CPAP", "category": "Devices", "qty": 1, "amount": 900, "note": "CPAP"},
  {"day": "2026-09-30", "period": "2026-09", "doc": "INV/2026/0104", "customer": "UPA", "product": "Mask", "category": "Consumables", "qty": 1, "amount": 10, "endUser": "", "mapMethod": "order"}
]$$::jsonb);
select pg_temp.check('order, end user and method are kept', (select sale_order || ' ' || end_user || ' ' || map_method from public.sales_lines where doc = 'INV2/2026/0901'), 'S00010 Shifa Hospital order');
select pg_temp.check('a method without an end user is not kept', (select coalesce(map_method, 'none') from public.sales_lines where doc = 'INV/2026/0104'), 'none');

create temp table s as select public.end_user_summary((select co from ids)) j;
grant select on s to authenticated;
select pg_temp.check('only customers with linked end users are summed', (select string_agg(distinct r ->> 'c', ',') from s, jsonb_array_elements(j -> 'rows') r), 'UPA');
select pg_temp.check('unlinked lines keep their description, invoice by invoice', (select sum((r ->> 'a')::numeric) || ' ' || count(*) || ' ' || string_agg(r ->> 'd', ',' order by r ->> 'd') from s, jsonb_array_elements(j -> 'rows') r where r ->> 'o' like '( PRO 501%'), '4000.00 2 INV/2026/0101,INV/2026/0102');
select pg_temp.check('every agency pound is in the summary', (select sum((r ->> 'a')::numeric)::text from s, jsonb_array_elements(j -> 'rows') r), '256010.00');

insert into public.end_user_map (company_id, kind, key, hospital) values ((select co from ids), 'order', 'PRO 501/22', 'Rahma Hospital'), ((select co from ids), 'agency', 'Cash patient', '');
select pg_temp.check('a customer marked as an agency joins the summary',
  (select count(*)::text from jsonb_array_elements(public.end_user_summary((select co from ids)) -> 'rows') r where r ->> 'c' = 'Cash patient'), '1');
select pg_temp.check('the company''s choices come with it', (select jsonb_array_length(public.end_user_summary((select co from ids)) -> 'map')::text), '2');
select pg_temp.check('an unknown kind of choice is refused',
  pg_temp.err($q$insert into public.end_user_map (company_id, kind, key) values ((select co from ids), 'guess', 'x')$q$), '23514');

select pg_temp.login('ev@x.test');
select pg_temp.check('a viewer reads the summary', (select (jsonb_array_length(public.end_user_summary((select co from ids)) -> 'rows') > 0)::text), 'true');
select pg_temp.check('a viewer cannot change the choices',
  pg_temp.err($q$insert into public.end_user_map (company_id, kind, key, hospital) values ((select co from ids), 'alias', 'x', 'y')$q$), '42501');
select pg_temp.check('a viewer cannot add lines', pg_temp.err($q$select public.add_sales_lines((select b from bs), '[]'::jsonb)$q$), '42501');

select pg_temp.login('eo@x.test');
select pg_temp.check('an outsider gets an empty summary', (select jsonb_array_length(public.end_user_summary((select co from ids)) -> 'rows')::text), '0');
select pg_temp.check('an outsider sees no choices', (select count(*)::text from public.end_user_map), '0');
reset role;
set role anon;
select pg_temp.check('signed-out visitors cannot run the summary', pg_temp.err($q$select public.end_user_summary(gen_random_uuid())$q$), '42501');
reset role;
