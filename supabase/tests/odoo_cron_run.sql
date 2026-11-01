-- 0047: a night run owns the company's sync lock only while it keeps it. A person's Sync now or Stop that takes the lock
-- ends the night run's writes at once, and its finish leaves the person's lock alone. Each call names its run, so a run
-- that comes back after being released can no longer write. The next run is counted from when the run started.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0047_odoo_run_lock.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('or-ed@x.test', '{"full_name":"Ora"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.anon() returns void language plpgsql as $f$
begin reset role; perform set_config('request.jwt.claims', '{"role":"anon"}', false); set role anon; end $f$;
create function pg_temp.err(sql text) returns text language plpgsql as $f$
begin execute sql; return 'allowed'; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;
grant execute on function pg_temp.err(text) to anon;
insert into public.companies (org_id, name) select org_id, 'Run Co' from public.memberships where user_id = pg_temp.uid('or-ed@x.test') limit 1;
create temp table ids as select id co from public.companies where name = 'Run Co';
grant select on ids to anon;
insert into public.odoo_connections (company_id, url, db, login, api_key_enc, odoo_company_id, odoo_company_name)
  values ((select co from ids), 'https://a.odoo.com', 'a', 'me@a', 'v2.K.t.c', 1, 'A');
create temp table s as select repeat('cd', 32) good;
grant select on s to anon;
select private.set_cron_secret((select good from s));
insert into public.odoo_sync_jobs (company_id, nightly, requested_by, next_run_at) values ((select co from ids), true, pg_temp.uid('or-ed@x.test'), now() - interval '1 minute');

select pg_temp.check('schema version 47 or later', (public.schema_version() >= 47)::text, 'true');
select pg_temp.check('the old call shapes are gone', (select count(*) from pg_proc where proname in ('odoo_cron_rpc', 'odoo_cron_finish') and pronargs in (4, 6))::text, '0');

select pg_temp.anon();
create temp table got as select public.odoo_cron_next((select good from s)) j;
reset role;
grant select on got to anon;
select pg_temp.check('the job names its run', ((select j ->> 'run' from got) is not null)::text, 'true');

-- A call for another run of the same company is refused.
select pg_temp.anon();
select pg_temp.check('a call naming another run is refused', left(pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select co from ids), now() - interval '1 day', 'update_company_settings', jsonb_build_object('p_company', (select co from ids), 'p_patch', '{}'::jsonb))$q$), 5), '42501');
select pg_temp.check('the right run may call', pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select co from ids), (select (j ->> 'run')::timestamptz from got), 'update_company_settings', jsonb_build_object('p_company', (select co from ids), 'p_patch', '{}'::jsonb))$q$), 'allowed');
reset role;

-- A person takes the lock (Sync now after the 2-minute takeover, or Stop): the night run's next call is refused.
update public.odoo_connections set status = 'syncing', sync_started_at = now() + interval '1 second' where company_id = (select co from ids);
select pg_temp.anon();
select pg_temp.check('after a person takes the lock, the night run cannot write', (pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select co from ids), (select (j ->> 'run')::timestamptz from got), 'update_company_settings', jsonb_build_object('p_company', (select co from ids), 'p_patch', '{}'::jsonb))$q$) like '42501%lock%')::text, 'true');
select public.odoo_cron_finish((select good from s), (select co from ids), (select (j ->> 'run')::timestamptz from got), false, 'stopped', null, null);
reset role;
select pg_temp.check('its finish leaves the person''s lock alone', (select concat(status, ' ', sync_started_at > now()) from public.odoo_connections where company_id = (select co from ids)), 'syncing t');
select pg_temp.check('and records the run as failed', (select concat(status, ' ', last_ok) from public.odoo_sync_jobs where company_id = (select co from ids)), 'idle f');

-- A good run: the next run is counted from its start.
update public.odoo_connections set status = 'ok', sync_started_at = null where company_id = (select co from ids);
update public.odoo_sync_jobs set next_run_at = now() - interval '1 minute' where company_id = (select co from ids);
select pg_temp.anon();
drop table got;
create temp table got as select public.odoo_cron_next((select good from s)) j;
select public.odoo_cron_finish((select good from s), (select co from ids), (select (j ->> 'run')::timestamptz from got), true, 'done', 10, '17.0');
reset role;
select pg_temp.check('the next run is 20 hours after this one started', (select (next_run_at = started_at + interval '20 hours')::text from public.odoo_sync_jobs where company_id = (select co from ids)), 'true');
select pg_temp.check('the lock it owned is released', (select concat(status, ' ', sync_started_at is null) from public.odoo_connections where company_id = (select co from ids)), 'ok t');

-- A person's sync waits while a night run is alive (a long Odoo read makes no database calls for minutes).
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('or-ed@x.test'))::text, false);
update public.odoo_sync_jobs set status = 'running', heartbeat_at = now() - interval '5 minutes' where company_id = (select co from ids);
select pg_temp.check('a night run is alive for 15 minutes after its last call', public.odoo_night_running((select co from ids))::text, 'true');
update public.odoo_sync_jobs set heartbeat_at = now() - interval '20 minutes' where company_id = (select co from ids);
select pg_temp.check('then it counts as cut off', public.odoo_night_running((select co from ids))::text, 'false');
