-- Each company chooses its modules (0063): admins open, close and build modules and set who sees each one; the shared
-- store answers only to people who may see a module (HR starts admins-only); a custom key belongs to one company.
-- Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0063_company_modules.sql
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('cma@x.test', '{"full_name":"Ada"}', now()), ('cme@x.test', '{"full_name":"Eve"}', now()),
  ('cmv@x.test', '{"full_name":"Vic"}', now()), ('cmo@x.test', '{"full_name":"Out"}', now());
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

insert into public.companies (org_id, name) values (pg_temp.home('cma@x.test'), 'Modules Co'), (pg_temp.home('cmo@x.test'), 'Modules Outsider Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('cma@x.test'), pg_temp.uid('cme@x.test'), 'editor'),
  (pg_temp.home('cma@x.test'), pg_temp.uid('cmv@x.test'), 'viewer');
create temp table ids (co uuid, other uuid);
insert into ids select (select id from public.companies where name = 'Modules Co'), (select id from public.companies where name = 'Modules Outsider Co');
grant select on ids to authenticated;
create temp table u (eve uuid, outsider uuid);
insert into u select pg_temp.uid('cme@x.test'), pg_temp.uid('cmo@x.test');
grant select on u to authenticated;
create temp table b (id uuid);
grant all on b to authenticated;

select pg_temp.check('schema version 63', public.schema_version()::text, '63');
select pg_temp.check('row security is on', (select relrowsecurity from pg_class where oid = 'public.company_modules'::regclass)::text, 'true');
select pg_temp.check('the catalog is listed', (select count(*)::text from private.module_keys where key in ('hr', 'payroll', 'crm', 'manufacturing', 'projects', 'pos', 'assets', 'fleet', 'service')), '9');
select pg_temp.check('HR is admins-only by default', (select default_role::text from private.module_keys where key = 'hr'), 'admin');

-- Nothing is saved into a catalog module the company hasn't opened; editors can't open one.
select pg_temp.login('cme@x.test');
select pg_temp.check('a module not opened refuses saves', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'crm', array['2026-10'])$$), 'refused');
select pg_temp.check('an editor can''t open a module', pg_temp.fails($$select public.module_enable((select co from ids), 'crm')$$), 'refused');
select pg_temp.check('no direct writes', pg_temp.fails($$insert into public.company_modules (company_id, key, kind) values ((select co from ids), 'crm', 'catalog')$$), 'refused');
select pg_temp.check('Purchasing stays open as before', pg_temp.fails($$select public.module_batch_cancel(public.module_batch_begin((select co from ids), 'purchasing', array['2026-10']))$$), 'ran');

-- The admin opens CRM and HR; the editor saves CRM rows.
select pg_temp.login('cma@x.test');
select public.module_enable((select co from ids), 'crm');
select public.module_enable((select co from ids), 'hr');
select pg_temp.check('opening is recorded', (select count(*)::text from public.company_data_audit where company_id = (select co from ids) and action = 'module_enable'), '2');
select pg_temp.check('a built-in module never takes store rows', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'sales', array['2026-10'])$$), 'refused');
select pg_temp.check('an unknown module can''t be opened', pg_temp.fails($$select public.module_enable((select co from ids), 'nope')$$), 'refused');

select pg_temp.login('cme@x.test');
insert into b select public.module_batch_begin((select co from ids), 'crm', array['2026-10', '2026-11'], 'crm.xlsx');
select public.module_rows_add((select id from b), '[{"period":"2026-10","doc":"O1","partner":"Acme","amount":100,"data":{"stage":"won","owner":"Sam","value":"100"}},{"period":"2026-10","doc":"O2","partner":"Beta","amount":50,"data":{"stage":"lost","owner":"Sam","value":"50"}},{"period":"2026-11","doc":"O3","partner":"Acme","amount":70,"data":{"stage":"won","owner":"Lee","value":"70"}}]');
select public.module_batch_finish((select id from b));
delete from b;

-- Filters, a month range, totals by dimension and measure.
select pg_temp.check('the whole module', (public.module_summary((select co from ids), 'crm') ->> 'amount'), '220');
select pg_temp.check('one month', (public.module_summary((select co from ids), 'crm', '2026-11', '2026-11') ->> 'amount'), '70');
select pg_temp.check('filtered on a field', (public.module_summary((select co from ids), 'crm', null, null, '{"stage":["won"]}') ->> 'amount'), '170');
select pg_temp.check('months stay whole for the picker', jsonb_array_length(public.module_summary((select co from ids), 'crm', '2026-11', '2026-11') -> 'periods')::text, '2');
select pg_temp.check('totals by a dimension', (public.module_summary((select co from ids), 'crm', null, null, '{}', array['owner']) #>> '{dims,owner,0,value}'), 'Sam');
select pg_temp.check('a measure by month', (public.module_summary((select co from ids), 'crm', null, null, '{}', '{}', array['value']) #>> '{measures,value,2026-10}'), '150');
select pg_temp.check('a bad field is refused', pg_temp.fails($$select public.module_summary((select co from ids), 'crm', null, null, '{}', array['x; drop'])$$), 'refused');
select pg_temp.check('rows filtered and searched', jsonb_array_length(public.module_rows_page((select co from ids), 'crm', 0, 100, null, null, '{"stage":["won"]}', 'acme'))::text, '2');

-- HR: an editor without access is refused everywhere, until the admin names them.
select pg_temp.check('HR refuses an editor without access', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'hr', array['2026-10'])$$), 'refused');
select pg_temp.login('cma@x.test');
insert into b select public.module_batch_begin((select co from ids), 'hr', array['2026-10'], 'staff.xlsx');
select public.module_rows_add((select id from b), '[{"period":"2026-10","doc":"E1","partner":"Mona","amount":30000,"data":{"department":"Sales"}}]');
select public.module_batch_finish((select id from b));
delete from b;
select pg_temp.check('the admin reads HR', (public.module_summary((select co from ids), 'hr') ->> 'rows'), '1');
select pg_temp.login('cme@x.test');
select pg_temp.check('HR rows are hidden from the editor', (select count(*)::text from public.module_rows where module = 'hr'), '0');
select pg_temp.check('HR batches are hidden from the editor', (select count(*)::text from public.module_batches where module = 'hr'), '0');
select pg_temp.check('the HR summary refuses the editor', pg_temp.fails($$select public.module_summary((select co from ids), 'hr')$$), 'refused');
select pg_temp.check('CRM is still open to the editor', (select count(*)::text from public.module_rows where module = 'crm'), '3');
select pg_temp.check('an editor can''t change access', pg_temp.fails($$select public.module_set_access((select co from ids), 'hr', 'viewer')$$), 'refused');
select pg_temp.login('cma@x.test');
select pg_temp.check('only members of the organisation can be named', pg_temp.fails($$select public.module_set_access((select co from ids), 'hr', 'admin', array[(select outsider from u)])$$), 'refused');
select public.module_set_access((select co from ids), 'hr', 'admin', array[(select eve from u)]);
select pg_temp.login('cme@x.test');
select pg_temp.check('a named person reads HR', (select count(*)::text from public.module_rows where module = 'hr'), '1');
select pg_temp.login('cmv@x.test');
select pg_temp.check('the viewer still can''t', (select count(*)::text from public.module_rows where module = 'hr'), '0');
select pg_temp.check('the viewer reads CRM', (select count(*)::text from public.module_rows where module = 'crm'), '3');

-- A custom module belongs to its company.
select pg_temp.login('cma@x.test');
select pg_temp.check('a custom key starts with c_', pg_temp.fails($$select public.module_save_custom((select co from ids), 'mine', 'Mine', '{"fields":[]}')$$), 'refused');
select public.module_save_custom((select co from ids), 'c_visits', 'Clinic visits', '{"fields":[{"key":"clinic"}]}');
insert into b select public.module_batch_begin((select co from ids), 'c_visits', array['2026-10']);
select pg_temp.check('saves into its own custom module', (select count(*)::text from b), '1');
select public.module_batch_cancel((select id from b));
select pg_temp.login('cmo@x.test');
select pg_temp.check('another company can''t use that key', pg_temp.fails($$select public.module_batch_begin((select other from ids), 'c_visits', array['2026-10'])$$), 'refused');
select pg_temp.check('another company can''t read the modules list', (select count(*)::text from public.company_modules where company_id = (select co from ids)), '0');
select pg_temp.check('an outsider can''t read the summary', pg_temp.fails($$select public.module_summary((select co from ids), 'crm')$$), 'refused');

-- Closing a module stops new saves; what is saved stays.
select pg_temp.login('cma@x.test');
select public.module_enable((select co from ids), 'crm', false);
select pg_temp.login('cme@x.test');
select pg_temp.check('a closed module refuses saves', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'crm', array['2026-12'])$$), 'refused');
select pg_temp.check('its saved rows stay', (select count(*)::text from public.module_rows where module = 'crm'), '3');
select pg_temp.login('cma@x.test');
select public.module_enable((select co from ids), 'purchasing', false);
select pg_temp.login('cme@x.test');
select pg_temp.check('a closed Purchasing refuses saves', pg_temp.fails($$select public.module_batch_begin((select co from ids), 'purchasing', array['2026-10'])$$), 'refused');
select pg_temp.check('signed-out visitors can''t open modules', (select has_function_privilege('anon', 'public.module_enable(uuid, text, boolean)', 'execute'))::text, 'false');
reset role;
-- Later tests re-run older migrations whose audit check doesn't know these actions.
delete from public.company_data_audit where action like 'module\_%';
