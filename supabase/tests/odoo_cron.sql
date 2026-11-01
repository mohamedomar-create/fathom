-- Nightly Odoo sync on the server without the Supabase service key (migration 0046): the job proves itself with the
-- CRON_SECRET, checked inside the database against a stored hash, and acts with the rights of the editor who turned
-- nightly sync on (re-checked on every call), through an allowlist of the save functions the sync already uses.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0046_odoo_jobs.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('oc-ed@x.test', '{"full_name":"Eda"}', now()), ('oc-vw@x.test', '{"full_name":"Vin"}', now()), ('oc-out@x.test', '{"full_name":"Oto"}', now());
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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'aal', 'aal1')::text, false);
  set role authenticated;
end $f$;
create function pg_temp.anon() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  set role anon;
end $f$;
create function pg_temp.err(sql text) returns text language plpgsql as $f$
begin execute sql; return 'allowed'; exception when others then return sqlstate; end $f$;
grant execute on function pg_temp.err(text) to authenticated, anon;

-- Two companies the editor can edit, a viewer, and a connection with a key on the first.
insert into public.companies (org_id, name) values (pg_temp.home('oc-ed@x.test'), 'Cron Co'), (pg_temp.home('oc-ed@x.test'), 'Cron Other');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('oc-ed@x.test'), pg_temp.uid('oc-vw@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Cron Co') co, (select id from public.companies where name = 'Cron Other') other;
grant select on ids to authenticated, anon;
insert into public.odoo_connections (company_id, url, db, login, api_key_enc, odoo_company_id, odoo_company_name)
  values ((select co from ids), 'https://a.odoo.com', 'a', 'me@a', 'v2.K.t.c', 1, 'A');
create temp table s as select repeat('ab', 32) good;
grant select on s to authenticated, anon;

select pg_temp.check('schema version 46', public.schema_version()::text, '46');

-- ---------------------------------------------------------------- the secret
select pg_temp.check('signed-out visitors cannot set the secret', has_function_privilege('anon', 'private.set_cron_secret(text)', 'execute')::text, 'false');
select pg_temp.check('signed-in users cannot set the secret', has_function_privilege('authenticated', 'private.set_cron_secret(text)', 'execute')::text, 'false');
select pg_temp.anon();
select pg_temp.check('with no secret set, the job is refused', pg_temp.err($q$select public.odoo_cron_next((select good from s))$q$), '42501');
reset role;
select pg_temp.check('a short secret is refused', pg_temp.err($q$select private.set_cron_secret('short')$q$), '22023');
select private.set_cron_secret((select good from s));
select pg_temp.check('only the hash is stored', (select secret_hash = sha256(convert_to((select good from s), 'UTF8')) from private.cron_auth)::text, 'true');
select pg_temp.anon();
select pg_temp.check('a wrong secret is refused', pg_temp.err($q$select public.odoo_cron_next('wrong-wrong-wrong-wrong-wrong-wrong')$q$), '42501');
select pg_temp.check('nothing due yet', coalesce(public.odoo_cron_next((select good from s))::text, 'none'), 'none');
select pg_temp.check('signed-out visitors cannot read the jobs', pg_temp.err($q$select count(*) from public.odoo_sync_jobs$q$), '42501');

-- ---------------------------------------------------------------- turning nightly on
select pg_temp.login('oc-vw@x.test');
select pg_temp.check('a viewer cannot turn nightly sync on', pg_temp.err($q$select public.odoo_nightly_set((select co from ids), true)$q$), '42501');
select pg_temp.login('oc-ed@x.test');
select pg_temp.check('a company without a connection cannot', pg_temp.err($q$select public.odoo_nightly_set((select other from ids), true)$q$), 'P0001');
select public.odoo_nightly_set((select co from ids), true);
reset role;
select pg_temp.check('the job is recorded with who turned it on', (select concat(nightly, ' ', requested_by = pg_temp.uid('oc-ed@x.test'), ' ', next_run_at <= now()) from public.odoo_sync_jobs), 't t t');
select pg_temp.login('oc-ed@x.test');
select pg_temp.check('nobody writes jobs directly', pg_temp.err($q$update public.odoo_sync_jobs set nightly = false$q$), '42501');
select pg_temp.login('oc-vw@x.test');
select pg_temp.check('a viewer sees the job', (select count(*) from public.odoo_sync_jobs)::text, '1');
select pg_temp.login('oc-out@x.test');
select pg_temp.check('an outsider does not', (select count(*) from public.odoo_sync_jobs)::text, '0');

-- ---------------------------------------------------------------- the job claims and acts
select pg_temp.anon();
create temp table got as select public.odoo_cron_next((select good from s)) j;
reset role;
select pg_temp.check('the due company is handed out', (select j ->> 'company_id' from got), (select co::text from ids));
select pg_temp.check('with its connection and encrypted key', (select concat(j -> 'connection' ->> 'url', ' ', j -> 'connection' ->> 'api_key_enc') from got), 'https://a.odoo.com v2.K.t.c');
select pg_temp.check('the job is running and holds the sync lock', (select concat(j.status, ' ', c.status) from public.odoo_sync_jobs j join public.odoo_connections c using (company_id)), 'running syncing');
select pg_temp.anon();
select pg_temp.check('a running job is not handed out twice', coalesce(public.odoo_cron_next((select good from s))::text, 'none'), 'none');
select pg_temp.check('a function outside the allowlist is refused', pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select co from ids), 'odoo_save', '{}')$q$), '42501');
select pg_temp.check('a wrong secret is refused for calls too', pg_temp.err($q$select public.odoo_cron_rpc('wrong-wrong-wrong-wrong-wrong-wrong', (select co from ids), 'update_company_settings', jsonb_build_object('p_company', (select co from ids), 'p_patch', '{}'))$q$), '42501');
select public.odoo_cron_rpc((select good from s), (select co from ids), 'update_company_settings',
  jsonb_build_object('p_company', (select co from ids), 'p_patch', '{"profile": {"booksStart": "2021-07-01"}}'::jsonb));
reset role;
select pg_temp.check('an allowed save runs with the editor''s rights', (select kpi_config -> 'profile' ->> 'booksStart' from public.companies where id = (select co from ids)), '2021-07-01');
select pg_temp.anon();
select pg_temp.check('another company is refused, even one the editor can edit', pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select co from ids), 'update_company_settings', jsonb_build_object('p_company', (select other from ids), 'p_patch', '{}'))$q$), '42501');
select pg_temp.check('a company with no running job is refused', pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select other from ids), 'update_company_settings', jsonb_build_object('p_company', (select other from ids), 'p_patch', '{}'))$q$), '42501');
reset role;
-- A batch of the other company cannot be written through this company's job.
select pg_temp.login('oc-ed@x.test');
create temp table ob as select public.begin_stock_ledger_batch((select other from ids), array['2026-01'], 'x') b;
reset role;
grant select on ob to anon;
select pg_temp.anon();
select pg_temp.check('another company''s batch is refused', pg_temp.err($q$select public.odoo_cron_rpc((select good from s), (select co from ids), 'add_stock_ledger_lines', jsonb_build_object('p_batch', (select b from ob), 'p_lines', '[]'::jsonb))$q$), '42501');
create temp table mine as select (public.odoo_cron_rpc((select good from s), (select co from ids), 'begin_stock_ledger_batch',
  jsonb_build_object('p_company', (select co from ids), 'p_periods', '["2026-02","2026-03"]'::jsonb, 'p_filename', 'nightly')) #>> '{}')::uuid b;
reset role;
select pg_temp.check('arrays and named arguments pass through', (select array_to_string(periods, ',') from public.stock_ledger_batches where id = (select b from mine)), '2026-02,2026-03');
select pg_temp.check('the batch is recorded as the editor''s', (select (created_by = pg_temp.uid('oc-ed@x.test'))::text from public.stock_ledger_batches where id = (select b from mine)), 'true');

-- ---------------------------------------------------------------- finishing
select pg_temp.anon();
select public.odoo_cron_finish((select good from s), (select co from ids), true, '2021-07–2026-10 · 152 accounts', 1200, '17.0');
reset role;
select pg_temp.check('a good run is recorded and the next is tomorrow', (select concat(status, ' ', last_ok, ' ', next_run_at > now() + interval '19 hours') from public.odoo_sync_jobs), 'idle t t');
select pg_temp.check('the sync lock is released', (select concat(status, ' ', sync_started_at is null) from public.odoo_connections where company_id = (select co from ids)), 'ok t');
select pg_temp.check('the run is in the audit log as the editor''s', (select concat(action, ' ', ok, ' ', user_id = pg_temp.uid('oc-ed@x.test'), ' ', detail like 'Nightly:%') from public.odoo_audit where company_id = (select co from ids) order by id desc limit 1), 'sync t t t');
select pg_temp.anon();
select pg_temp.check('a finished job cannot be finished again', pg_temp.err($q$select public.odoo_cron_finish((select good from s), (select co from ids), true, null, null, null)$q$), '42501');
reset role;

-- A run cut off part-way is released after 15 minutes and tried again later, not left running.
update public.odoo_sync_jobs set status = 'running', heartbeat_at = now() - interval '20 minutes', next_run_at = now() - interval '1 hour';
update public.odoo_connections set status = 'syncing', sync_started_at = now() - interval '20 minutes' where company_id = (select co from ids);
select pg_temp.anon();
select pg_temp.check('a stale run is released, not handed out at once', coalesce(public.odoo_cron_next((select good from s))::text, 'none'), 'none');
reset role;
select pg_temp.check('and recorded as cut off, tried again later', (select concat(status, ' ', last_ok, ' ', next_run_at > now()) from public.odoo_sync_jobs), 'idle f t');

-- An editor who loses the right to edit stops the nightly sync; it never runs with rights nobody holds.
update public.memberships set role = 'editor' where user_id = pg_temp.uid('oc-vw@x.test') and org_id = pg_temp.home('oc-ed@x.test');
select pg_temp.login('oc-vw@x.test');
select public.odoo_nightly_set((select co from ids), true);
reset role;
update public.odoo_sync_jobs set next_run_at = now() - interval '1 minute';
update public.odoo_connections set status = 'ok', sync_started_at = null where company_id = (select co from ids);
update public.memberships set role = 'viewer' where user_id = pg_temp.uid('oc-vw@x.test') and org_id = pg_temp.home('oc-ed@x.test');
select pg_temp.anon();
select pg_temp.check('nothing runs for a demoted editor', coalesce(public.odoo_cron_next((select good from s))::text, 'none'), 'none');
reset role;
select pg_temp.check('nightly is switched off with the reason', (select concat(nightly, ' ', last_error like '%can no longer edit%') from public.odoo_sync_jobs), 'f t');

-- Turning it off.
select pg_temp.login('oc-ed@x.test');
select public.odoo_nightly_set((select co from ids), true);
select public.odoo_nightly_set((select co from ids), false);
reset role;
select pg_temp.check('off means no next run', (select concat(nightly, ' ', next_run_at is null) from public.odoo_sync_jobs), 'f t');
