-- O12 (migration 0044): a stock summary that fails to build keeps the last good copy, records the error beside it, and
-- is tried again after 10 minutes; the page reads both (stale figures with their time, never an error in place of them).
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0044_status_and_settings.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('ir-ed@x.test', '{"full_name":"Ira"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
insert into public.companies (org_id, name) select org_id, 'Rollup Error Co' from public.memberships where user_id = pg_temp.uid('ir-ed@x.test') limit 1;
create temp table ids as select id co from public.companies where name = 'Rollup Error Co';
grant select on ids to authenticated;
create temp table wire_def as select pg_get_functiondef('private.inventory_wire(uuid)'::regprocedure) def;
create function pg_temp.state() returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('ir-ed@x.test'))::text, true);
  set local role authenticated;
  r := public.inventory_state((select co from ids));
  reset role;
  return r;
end $f$;

-- A good summary first.
select private.mark_inventory((select co from ids));
select private.refresh_inventory_rollups(50);
select pg_temp.check('first summary built', (pg_temp.state() -> 'summary' ? 'error')::text, 'false');
create temp table good as select summary s, built_at b from public.inventory_rollups where company_id = (select co from ids);

-- The next build fails.
create or replace function private.inventory_wire(p_company uuid) returns jsonb language plpgsql set search_path = '' as $f$ begin raise exception 'boom'; end $f$;
select private.mark_inventory((select co from ids));
select private.refresh_inventory_rollups(50);
select pg_temp.check('the last good copy is kept', ((select summary from public.inventory_rollups where company_id = (select co from ids)) = (select s from good))::text, 'true');
select pg_temp.check('its time is kept', ((pg_temp.state() ->> 'built_at')::timestamptz = (select b from good))::text, 'true');
select pg_temp.check('the error is recorded beside it', pg_temp.state() ->> 'error', 'boom');
select pg_temp.check('a failed build is not pending', pg_temp.state() ->> 'pending', 'false');
select pg_temp.check('not tried again at once', private.refresh_inventory_rollups(50)::text, '0');

-- After 10 minutes it is tried again; once it works, the error goes.
select pg_temp.check('a failed company with nothing built still has no summary', (select count(*) from public.inventory_rollups where summary is null)::text, '0');
do $$ begin execute (select def from wire_def); end $$;
update public.inventory_rollups set error_at = now() - interval '11 minutes' where company_id = (select co from ids);
select pg_temp.check('tried again after 10 minutes', private.refresh_inventory_rollups(50)::text, '1');
select pg_temp.check('the error is cleared', coalesce(pg_temp.state() ->> 'error', 'none'), 'none');

-- A company whose very first build fails has no summary and says why.
insert into public.companies (org_id, name) select org_id, 'Rollup Error Two' from public.memberships where user_id = pg_temp.uid('ir-ed@x.test') limit 1;
create or replace function private.inventory_wire(p_company uuid) returns jsonb language plpgsql set search_path = '' as $f$ begin raise exception 'first'; end $f$;
select private.mark_inventory((select id from public.companies where name = 'Rollup Error Two'));
select private.refresh_inventory_rollups(50);
select pg_temp.check('first build failed: no summary, the error kept', (select concat((summary is null)::text, ' ', error) from public.inventory_rollups where company_id = (select id from public.companies where name = 'Rollup Error Two')), 'true first');
do $$ begin execute (select def from wire_def); end $$;
