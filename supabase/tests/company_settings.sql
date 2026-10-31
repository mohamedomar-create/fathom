-- Company settings without lost updates (migration 0044): update_company_settings merges a patch into kpi_config under
-- a row lock (profile and inventory one level deep), checks the editor role, and never drops a setting it wasn't sent.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0044_status_and_settings.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('cs-ed@x.test', '{"full_name":"Eda"}', now()), ('cs-vw@x.test', '{"full_name":"Vin"}', now()), ('cs-out@x.test', '{"full_name":"Oto"}', now());
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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'aal', 'aal2')::text, false);
  set role authenticated;
end $f$;
create function pg_temp.refused(sql text) returns text language plpgsql as $f$
begin execute sql; return 'allowed'; exception when others then return 'refused'; end $f$;
grant execute on function pg_temp.refused(text) to authenticated, anon;

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('cs-ed@x.test'), 'Settings Co',
  '{"gpm": {"target": 40}, "economy": {"inflation": 25}, "profile": {"timeZone": "Africa/Cairo", "booksStart": "2021-07-01"}, "inventory": {"rentalLocation": "Rent", "locationTypes": {"WH/Stock": "internal"}}}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('cs-ed@x.test'), pg_temp.uid('cs-vw@x.test'), 'viewer');
create temp table ids as select id co from public.companies where name = 'Settings Co';
grant select on ids to authenticated, anon;
create function pg_temp.cfg() returns jsonb language sql as $f$ select kpi_config from public.companies where id = (select co from ids) $f$;

select pg_temp.check('schema version 44', public.schema_version()::text, '44');

-- ---------------------------------------------------------------- who may
select pg_temp.login('cs-vw@x.test');
select pg_temp.check('a viewer is refused', pg_temp.refused('select public.update_company_settings((select co from ids), ''{"profile": {"vatRate": 0}}'')'), 'refused');
select pg_temp.login('cs-out@x.test');
select pg_temp.check('someone outside the organisation is refused', pg_temp.refused('select public.update_company_settings((select co from ids), ''{"profile": {"vatRate": 0}}'')'), 'refused');
reset role;
select pg_temp.check('signed-out visitors cannot run it', (select has_function_privilege('anon', 'public.update_company_settings(uuid, jsonb, boolean)', 'execute'))::text, 'false');
select pg_temp.check('nothing changed', pg_temp.cfg()->'profile'->>'vatRate', null);

-- ---------------------------------------------------------------- merging
select pg_temp.login('cs-ed@x.test');
select public.update_company_settings((select co from ids), '{"profile": {"vatRate": 0.14}}');
select public.update_company_settings((select co from ids), '{"profile": {"timeZone": "UTC"}}');
reset role;
select pg_temp.check('two profile saves both stick', concat(pg_temp.cfg()->'profile'->>'vatRate', ' ', pg_temp.cfg()->'profile'->>'timeZone'), '0.14 UTC');
select pg_temp.check('a profile setting not sent is kept', pg_temp.cfg()->'profile'->>'booksStart', '2021-07-01');
select pg_temp.check('the KPI targets are kept', pg_temp.cfg()->'gpm'->>'target', '40');
select pg_temp.check('the economic assumptions are kept', pg_temp.cfg()->'economy'->>'inflation', '25');

select pg_temp.login('cs-ed@x.test');
select public.update_company_settings((select co from ids), '{"inventory": {"rentalLocation": "Rentals"}}');
select public.update_company_settings((select co from ids), '{"economy": {"inflation": 30, "fx": 50}}');
reset role;
select pg_temp.check('inventory merges one level: location types kept', pg_temp.cfg()->'inventory'->'locationTypes'->>'WH/Stock', 'internal');
select pg_temp.check('inventory rental location changed', pg_temp.cfg()->'inventory'->>'rentalLocation', 'Rentals');
select pg_temp.check('other settings are replaced whole', pg_temp.cfg()->>'economy', '{"fx": 50, "inflation": 30}');

-- A KPI save sends the whole KPI set: KPIs left out go, the reserved settings stay.
select pg_temp.login('cs-ed@x.test');
select public.update_company_settings((select co from ids), '{"profit_ratio": {"target": 15}}', true);
reset role;
select pg_temp.check('KPI set replaced', concat((pg_temp.cfg() ? 'gpm')::text, ' ', pg_temp.cfg()->'profit_ratio'->>'target'), 'false 15');
select pg_temp.check('profile survives a KPI save', pg_temp.cfg()->'profile'->>'timeZone', 'UTC');
select pg_temp.check('inventory survives a KPI save', pg_temp.cfg()->'inventory'->>'rentalLocation', 'Rentals');

-- A null removes that setting; a patch that isn't an object is refused.
select pg_temp.login('cs-ed@x.test');
select public.update_company_settings((select co from ids), '{"economy": null}');
select pg_temp.check('a patch that is not an object is refused', pg_temp.refused('select public.update_company_settings((select co from ids), ''[1]'')'), 'refused');
reset role;
select pg_temp.check('null removes the setting', (pg_temp.cfg() ? 'economy')::text, 'false');
select pg_temp.check('the merged settings are returned', (select (public.update_company_settings((select co from ids), '{}') ? 'profile')::text), 'true');
