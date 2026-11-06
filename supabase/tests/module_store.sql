-- The store new modules share (migration 0062): staged saves that replace whole months, members read only live rows,
-- viewers and outsiders refused, a row can't point at another company's batch, clearing data includes the store.
-- Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0062_module_store.sql
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('msa@x.test', '{"full_name":"Ada"}', now()), ('mse@x.test', '{"full_name":"Eve"}', now()),
  ('msv@x.test', '{"full_name":"Vic"}', now()), ('mso@x.test', '{"full_name":"Out"}', now());
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
create function pg_temp.fails(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  return 'ran';
exception when others then return 'refused';
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('msa@x.test'), 'Store Co'), (pg_temp.home('mso@x.test'), 'Store Outsider Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('msa@x.test'), pg_temp.uid('mse@x.test'), 'editor'),
  (pg_temp.home('msa@x.test'), pg_temp.uid('msv@x.test'), 'viewer');
create temp table ids (co uuid, other uuid);
insert into ids select (select id from public.companies where name = 'Store Co'), (select id from public.companies where name = 'Store Outsider Co');
grant select on ids to authenticated;
create temp table b (id uuid, n int);
grant all on b to authenticated;

select pg_temp.check('schema version 62', public.schema_version()::text, '62');
select pg_temp.check('row security is on (rows)', (select relrowsecurity from pg_class where oid = 'public.module_rows'::regclass)::text, 'true');
select pg_temp.check('row security is on (batches)', (select relrowsecurity from pg_class where oid = 'public.module_batches'::regclass)::text, 'true');

-- An editor saves October and November purchase orders.
select pg_temp.login('mse@x.test');
insert into b (id) select public.module_batch_begin((select co from ids), 'purchasing', array['2026-10', '2026-11'], 'po.xlsx');
select pg_temp.check('an unknown module is refused', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'payroll', array['2026-10'])$$), 'refused');
select pg_temp.check('a row outside the save''s months is refused', pg_temp.fails($$select public.module_rows_add((select id from b), '[{"period":"2026-12","doc":"P9","amount":1}]')$$), 'refused');
select pg_temp.check('rows are added in chunks', public.module_rows_add((select id from b),
  '[{"period":"2026-10","day":"2026-10-01","doc":"P1","partner":"Acme","amount":1000,"qty":10,"data":{"received":8}},{"period":"2026-11","doc":"P2","partner":"Beta","amount":500}]')::text, '2');
select pg_temp.check('nothing shows before the save finishes', (select count(*)::text from public.module_rows where company_id = (select co from ids)), '0');
select pg_temp.check('finishing makes the rows live', public.module_batch_finish((select id from b))::text, '2');
select pg_temp.check('members read the live rows', (select count(*)::text from public.module_rows where company_id = (select co from ids)), '2');
select pg_temp.check('the summary adds them up', (public.module_summary((select co from ids), 'purchasing') ->> 'amount'), '1500');
select pg_temp.check('by month', (public.module_summary((select co from ids), 'purchasing') -> 'periods' -> 0 ->> 'period'), '2026-10');
select pg_temp.check('the extra fields are kept', (select data ->> 'received' from public.module_rows where doc = 'P1'), '8');

-- A second save of October replaces October only.
delete from b;
insert into b (id) select public.module_batch_begin((select co from ids), 'purchasing', array['2026-10'], 'po-oct.xlsx');
select public.module_rows_add((select id from b), '[{"period":"2026-10","doc":"P3","partner":"Acme","amount":700}]');
select public.module_batch_finish((select id from b));
select pg_temp.check('October replaced, November kept', (select string_agg(doc, ',' order by doc) from public.module_rows where company_id = (select co from ids)), 'P2,P3');
select pg_temp.check('the emptied batch is removed', (select count(*)::text from public.module_batches where company_id = (select co from ids)), '2');

select pg_temp.login('msv@x.test');
select pg_temp.check('a viewer reads', (select count(*)::text from public.module_rows where company_id = (select co from ids)), '2');
select pg_temp.check('a viewer cannot save', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'purchasing', array['2026-10'])$$), 'refused');
select pg_temp.check('nobody writes the rows directly', pg_temp.fails($$insert into public.module_rows (batch_id, company_id, module, period) values ((select id from b), (select co from ids), 'purchasing', '2026-10')$$), 'refused');

select pg_temp.login('mso@x.test');
select pg_temp.check('an outsider sees nothing', (select count(*)::text from public.module_rows where company_id = (select co from ids)), '0');
select pg_temp.check('an outsider gets no summary', pg_temp.fails($$select public.module_summary((select co from ids), 'purchasing')$$), 'refused');
select pg_temp.check('an outsider cannot add to another''s batch', pg_temp.fails($$select public.module_rows_add((select id from b), '[{"period":"2026-10","amount":1}]')$$), 'refused');

-- Clearing the company's data includes the store.
select pg_temp.login('mse@x.test');
select pg_temp.check('the reset preview counts the module rows', (public.data_reset_preview((select co from ids)) #>> '{modules,modules,records}'), '2');
select public.clear_company_data((select co from ids), 'modules', 2);
select pg_temp.check('clearing removes them', (select count(*)::text from public.module_rows where company_id = (select co from ids)), '0');

reset role;
-- Rows are written only by the functions, which take the company from the batch; a client write is checked by the guard.
select pg_temp.check('a row is guarded against another company''s batch', (select count(*)::text from pg_trigger where tgrelid = 'public.module_rows'::regclass and tgname in ('tenant_parent_batch_id', 'tenant_guard', 'period_lock')), '3');
select pg_temp.check('signed-out visitors can''t call the store', (select has_function_privilege('anon', 'public.module_summary(uuid, text)', 'execute'))::text, 'false');
