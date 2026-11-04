-- Background jobs that run every few seconds do nothing when there is nothing to do (migration 0055).
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.scans(t text) returns bigint language plpgsql as $f$
begin
  perform pg_stat_force_next_flush();
  perform pg_stat_clear_snapshot();
  return (select coalesce(seq_scan, 0) + coalesce(idx_scan, 0) from pg_stat_user_tables where relname = t);
end $f$;

-- With no upload in progress and the clean-up done in the last minute, a tick reads none of the uploaded rows.
update private.job_housekeeping set last_at = now();
create temp table s0 as select pg_temp.scans('import_rows') as n;
call private.run_import_jobs();
call private.run_import_jobs();
call private.run_import_jobs();
select pg_temp.check('idle ticks leave the uploaded rows alone', (pg_temp.scans('import_rows') - (select n from s0))::text, '0');

-- The clean-up still runs once a minute: rows of a cancelled upload are removed.
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('idle@x.test', '{"full_name":"Idle"}', now());
insert into public.companies (org_id, name) values ((select org_id from public.memberships m join auth.users u on u.id = m.user_id where u.email = 'idle@x.test' limit 1), 'Idle Co');
insert into public.import_jobs (company_id, kind, created_by, mode, status)
  select id, 'inventory', (select id from auth.users where email = 'idle@x.test'), 'replace', 'cancelled' from public.companies where name = 'Idle Co';
insert into public.import_files (job_id, company_id, filename, export_key, kind, storage_path)
  select j.id, j.company_id, 'v.xlsx', 'valuation', 'valuation', 'x/v.xlsx' from public.import_jobs j join public.companies c on c.id = j.company_id where c.name = 'Idle Co';
insert into public.import_rows (file_id, n, job_id, data)
  select f.id, 1, f.job_id, '{}'::jsonb from public.import_files f join public.companies c on c.id = f.company_id where c.name = 'Idle Co';
update private.job_housekeeping set last_at = now() - interval '2 minutes';
call private.run_import_jobs();
select pg_temp.check('the minute clean-up removes a cancelled upload''s rows',
  (select count(*) from public.import_rows r join public.import_jobs j on j.id = r.job_id join public.companies c on c.id = j.company_id where c.name = 'Idle Co')::text, '0');
select pg_temp.check('the clean-up time is recorded', (select (last_at > now() - interval '5 seconds')::text from private.job_housekeeping), 'true');

-- An upload waiting in the queue is picked up at once, whatever the clean-up time.
update private.job_housekeeping set last_at = now();
update public.import_jobs set status = 'queued', queued_at = now() where company_id = (select id from public.companies where name = 'Idle Co');
call private.run_import_jobs();
select pg_temp.check('a queued upload is worked on by the next tick',
  (select (status <> 'queued')::text from public.import_jobs where company_id = (select id from public.companies where name = 'Idle Co')), 'true');

-- Stock summaries: one refresh at a time (a second caller returns 0 at once).
select pg_temp.check('the stock summary refresh takes a lock', (select (prosrc like '%pg_try_advisory_xact_lock%')::text from pg_proc where proname = 'refresh_inventory_rollups'), 'true');
select pg_temp.check('schema version', public.schema_version()::text, '55');
delete from public.companies where name = 'Idle Co';
