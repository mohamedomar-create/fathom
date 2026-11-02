-- Highlighted statements (migration 0050): a KPI save never drops the highlight settings, and set_statement_mark sets or
-- clears one mark at a time (editors only, five colours, short notes, a bounded key).
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0050_highlights.sql
set client_min_messages = notice;
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('hl-ed@x.test', '{"full_name":"Eda"}', now()), ('hl-vw@x.test', '{"full_name":"Vin"}', now()), ('hl-out@x.test', '{"full_name":"Oto"}', now());
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

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('hl-ed@x.test'), 'Highlight Co',
  '{"gpm": {"target": 40}, "highlights": {"pct": 10, "amount": 20000, "lines": {"cash": {"color": "blue"}}}}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('hl-ed@x.test'), pg_temp.uid('hl-vw@x.test'), 'viewer');
create temp table ids as select id co from public.companies where name = 'Highlight Co';
grant select on ids to authenticated, anon;
create function pg_temp.cfg() returns jsonb language sql as $f$ select kpi_config from public.companies where id = (select co from ids) $f$;

select pg_temp.check('schema version 50', public.schema_version()::text, '50');

-- ---------------------------------------------------------------- the KPI page's save keeps the highlight settings
select pg_temp.login('hl-ed@x.test');
select public.update_company_settings((select co from ids), '{"gpm": {"target": 45}}', true);
reset role;
select pg_temp.check('a KPI save keeps the thresholds', pg_temp.cfg()->'highlights'->>'pct', '10');
select pg_temp.check('a KPI save keeps the marks', pg_temp.cfg()->'highlights'->'lines'->'cash'->>'color', 'blue');
select pg_temp.login('hl-ed@x.test');
select public.update_company_settings((select co from ids), '{"highlights": {"pct": 30}}');
reset role;
select pg_temp.check('thresholds merge one level: the amount is kept', concat(pg_temp.cfg()->'highlights'->>'pct', ' ', pg_temp.cfg()->'highlights'->>'amount'), '30 20000');
select pg_temp.check('thresholds merge one level: the marks are kept', pg_temp.cfg()->'highlights'->'lines'->'cash'->>'color', 'blue');

-- ---------------------------------------------------------------- one mark at a time
select pg_temp.login('hl-ed@x.test');
select public.set_statement_mark((select co from ids), 'gross_profit', '{"color": "yellow", "note": "watch margin"}');
select public.set_statement_mark((select co from ids), '#4110', '{"color": "pink"}');
reset role;
select pg_temp.check('a line mark is set', pg_temp.cfg()->'highlights'->'lines'->'gross_profit'->>'note', 'watch margin');
select pg_temp.check('an account mark is set by its code', pg_temp.cfg()->'highlights'->'lines'->'#4110'->>'color', 'pink');
select pg_temp.check('other marks are kept', pg_temp.cfg()->'highlights'->'lines'->'cash'->>'color', 'blue');
select pg_temp.check('the thresholds are kept', pg_temp.cfg()->'highlights'->>'pct', '30');
select pg_temp.login('hl-ed@x.test');
select public.set_statement_mark((select co from ids), 'cash', null);
reset role;
select pg_temp.check('a mark is cleared', (pg_temp.cfg()->'highlights'->'lines' ? 'cash')::text, 'false');

-- ---------------------------------------------------------------- bad input and who may
select pg_temp.login('hl-ed@x.test');
select pg_temp.check('an unknown colour is refused', pg_temp.refused($q$select public.set_statement_mark((select co from ids), 'cash', '{"color": "purple"}')$q$), 'refused');
select pg_temp.check('a long note is refused', pg_temp.refused($q$select public.set_statement_mark((select co from ids), 'cash', jsonb_build_object('color', 'grey', 'note', repeat('x', 121)))$q$), 'refused');
select pg_temp.check('a key too long is refused', pg_temp.refused($q$select public.set_statement_mark((select co from ids), repeat('k', 201), '{"color": "grey"}')$q$), 'refused');
select pg_temp.check('an extra field is refused', pg_temp.refused($q$select public.set_statement_mark((select co from ids), 'cash', '{"color": "grey", "x": 1}')$q$), 'refused');
select pg_temp.login('hl-vw@x.test');
select pg_temp.check('a viewer cannot mark', pg_temp.refused($q$select public.set_statement_mark((select co from ids), 'cash', '{"color": "grey"}')$q$), 'refused');
select pg_temp.login('hl-out@x.test');
select pg_temp.check('an outsider cannot mark', pg_temp.refused($q$select public.set_statement_mark((select co from ids), 'cash', '{"color": "grey"}')$q$), 'refused');
reset role;
select pg_temp.check('signed-out visitors cannot run it', has_function_privilege('anon', 'public.set_statement_mark(uuid, text, jsonb)', 'execute')::text, 'false');
select pg_temp.check('set_statement_mark is definer with an empty search path', (select prosecdef::text || ' ' || array_to_string(proconfig, ',') from pg_proc where proname = 'set_statement_mark'), 'true search_path=""');
select pg_temp.check('nothing changed by refused calls', (pg_temp.cfg()->'highlights'->'lines' ? 'cash')::text, 'false');

delete from public.companies where id = (select co from ids);
