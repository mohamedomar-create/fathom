-- 0047: the night run and a person's sync never write at the same time. Needs 0046. Safe to run again.
--  1. A night run owns the company's sync lock only while the connection's sync_started_at equals its job's heartbeat
--     (both set together on every call). A person's Sync now or Stop that takes the lock ends the night run's writes at
--     once, and the night run's finish then leaves that person's lock alone.
--  2. Every call names its run (the time it was handed out), so a run released as cut off cannot write after a new one.
--  3. A person's sync waits while a night run is alive (public.odoo_night_running, for the app's takeover check).
--  4. A function name that is ever overloaded is refused by the night run's caller; the next run is counted from the
--     start of this one, so a company is due every night.
set client_min_messages = warning;

drop function if exists public.odoo_cron_rpc(text, uuid, text, jsonb);
drop function if exists public.odoo_cron_finish(text, uuid, boolean, text, integer, text);

create or replace function public.odoo_cron_next(p_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.odoo_sync_jobs;
  n integer;
  v_version integer;
  v_now timestamptz := now();
begin
  perform private.cron_check(p_secret);
  -- A run that stopped reporting for 15 minutes was cut off: release it and try again later.
  -- The lock is released only when the cut-off run still holds it (a person may have taken it since).
  update public.odoo_connections c set status = 'error', sync_started_at = null, last_error = 'The nightly sync was cut off before it finished.'
    from public.odoo_sync_jobs s
    where s.company_id = c.company_id and s.status = 'running' and s.heartbeat_at < now() - interval '15 minutes'
      and c.status = 'syncing' and c.sync_started_at = s.heartbeat_at;
  update public.odoo_sync_jobs set status = 'idle', last_ok = false, last_run_at = now(), attempts = attempts + 1,
      last_error = 'The nightly sync was cut off before it finished.',
      next_run_at = now() + least(attempts + 1, 6) * interval '1 hour', updated_at = now()
    where status = 'running' and heartbeat_at < now() - interval '15 minutes';

  for j in
    select s.* from public.odoo_sync_jobs s
    where s.nightly and s.status = 'idle' and s.next_run_at <= now()
    order by s.next_run_at
    for update of s skip locked
  loop
    if not private.can_edit(j.requested_by, j.company_id) then
      update public.odoo_sync_jobs set nightly = false, next_run_at = null, updated_at = now(),
          last_error = 'Nightly sync stopped: the person who turned it on can no longer edit this company. An editor can turn it on again.'
        where company_id = j.company_id;
      insert into public.odoo_audit (company_id, user_id, action, ok, detail)
        select j.company_id, j.requested_by, 'refused', false, 'Nightly sync stopped: the person who turned it on can no longer edit this company.'
        where exists (select 1 from public.companies where id = j.company_id);
      continue;
    end if;
    if not exists (select 1 from public.odoo_connections where company_id = j.company_id and coalesce(api_key_enc, '') <> '' and odoo_company_id is not null) then
      update public.odoo_sync_jobs set nightly = false, next_run_at = null, updated_at = now(),
          last_error = 'Nightly sync stopped: enter the API key again in the Odoo connection, then turn it on again.'
        where company_id = j.company_id;
      continue;
    end if;
    -- The run owns the lock while the connection's sync_started_at equals the job's heartbeat (both set together).
    update public.odoo_connections set status = 'syncing', sync_started_at = v_now
      where company_id = j.company_id and (status <> 'syncing' or sync_started_at is null or sync_started_at < now() - interval '15 minutes');
    get diagnostics n = row_count;
    if n = 0 then
      -- Someone is syncing this company now: try again in half an hour.
      update public.odoo_sync_jobs set next_run_at = now() + interval '30 minutes', updated_at = now() where company_id = j.company_id;
      continue;
    end if;
    update public.odoo_sync_jobs set status = 'running', started_at = v_now, heartbeat_at = v_now, updated_at = now() where company_id = j.company_id;
    select data_version into v_version from public.companies where id = j.company_id;
    return jsonb_build_object(
      'company_id', j.company_id,
      'run', v_now,
      'connection', (select jsonb_build_object('url', c.url, 'db', c.db, 'login', c.login, 'api_key_enc', c.api_key_enc,
          'odoo_company_id', c.odoo_company_id, 'odoo_company_name', c.odoo_company_name, 'include_branches', c.include_branches,
          'months_history', c.months_history) from public.odoo_connections c where c.company_id = j.company_id),
      'company', (select jsonb_build_object('kpi_config', co.kpi_config, 'closed_through', co.closed_through, 'data_version', co.data_version)
          from public.companies co where co.id = j.company_id),
      'last_import', (select jsonb_build_object('created_at', i.created_at, 'report', i.report) from public.imports i
          where i.company_id = j.company_id order by i.created_at desc limit 1),
      'account_map', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'cls', m.cls)) from public.account_map m
          where m.company_id = j.company_id and m.cls is not null), '[]'::jsonb),
      'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'class', a.class, 'odoo_id', a.odoo_id,
          'odoo_type', a.odoo_type, 'confidence', a.confidence, 'mapped_by', a.mapped_by, 'refs', a.refs, 'sort_order', a.sort_order) order by a.sort_order)
          from public.source_accounts a where a.company_id = j.company_id and a.version = v_version), '[]'::jsonb));
  end loop;
  return null;
end $$;
revoke execute on function public.odoo_cron_next(text) from public;
grant execute on function public.odoo_cron_next(text) to anon, authenticated;

create or replace function public.odoo_cron_rpc(p_secret text, p_company uuid, p_run timestamptz, p_fn text, p_args jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.odoo_sync_jobs;
  v_owner text;
  v_proc oid;
  v_ret regtype;
  v_names text[];
  v_types oid[];
  v_exprs text[] := '{}';
  v_key text;
  v_i integer;
  v_type text;
  v_target uuid;
  v_co uuid;
  v_out jsonb;
  v_now timestamptz := clock_timestamp();
  v_n integer;
begin
  perform private.cron_check(p_secret);
  select * into j from public.odoo_sync_jobs where company_id = p_company and status = 'running' and started_at = p_run for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  -- A person's Sync now or Stop took the lock: the night run stops writing.
  if not exists (select 1 from public.odoo_connections where company_id = p_company and status = 'syncing' and sync_started_at = j.heartbeat_at) then
    raise exception 'not allowed: the sync lock was taken by a person''s sync or Stop' using errcode = '42501';
  end if;
  if not private.can_edit(j.requested_by, p_company) then raise exception 'not allowed' using errcode = '42501'; end if;
  select owner into v_owner from private.cron_fns where fn = p_fn;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  select count(*) into v_n from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = p_fn;
  if v_n <> 1 then raise exception 'not allowed' using errcode = '42501'; end if;
  select p.oid, p.prorettype, p.proargnames, string_to_array(p.proargtypes::text, ' ')::oid[] into v_proc, v_ret, v_names, v_types
    from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = p_fn and p.prosecdef;
  if v_proc is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then raise exception 'invalid arguments' using errcode = '22023'; end if;

  -- The company the call writes to must be this job's company.
  if v_owner = 'company' then
    if (p_args ->> 'p_company') is distinct from p_company::text then raise exception 'not allowed' using errcode = '42501'; end if;
  else
    v_key := case when v_owner = 'private.line_stages' then 'p_stage' else 'p_batch' end;
    begin
      v_target := (p_args ->> v_key)::uuid;
    exception when others then raise exception 'invalid arguments' using errcode = '22023';
    end;
    execute format('select company_id from %s where id = $1', v_owner) into v_co using v_target;
    if v_co is distinct from p_company then raise exception 'not allowed' using errcode = '42501'; end if;
  end if;

  -- Arguments by name, each converted to the function's own type; any name the function doesn't have is refused.
  for v_key in select jsonb_object_keys(p_args) loop
    v_i := array_position(v_names, v_key);
    if v_i is null or v_i > coalesce(array_length(v_types, 1), 0) then raise exception 'invalid arguments' using errcode = '22023'; end if;
    v_type := format_type(v_types[v_i], null);
    v_exprs := v_exprs || case
      when v_types[v_i] = 'jsonb'::regtype then format('%I => $1 -> %L', v_key, v_key)
      when v_types[v_i] = 'json'::regtype then format('%I => ($1 -> %L)::json', v_key, v_key)
      when v_type like '%[]' then format('%I => (select coalesce(array_agg(x), ''{}'') from jsonb_array_elements_text($1 -> %L) x)::%s', v_key, v_key, v_type)
      else format('%I => ($1 ->> %L)::%s', v_key, v_key, v_type) end;
  end loop;

  -- Act as the editor who turned nightly sync on (for this transaction only). The two-step sign-in level is theirs: they
  -- turned nightly sync on while signed in, and the allowlist holds no function that asks for a fresh sign-in.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', j.requested_by, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('request.jwt.claim.sub', j.requested_by::text, true);
  update public.odoo_sync_jobs set heartbeat_at = v_now where company_id = p_company;
  update public.odoo_connections set sync_started_at = v_now where company_id = p_company;

  if v_ret = 'void'::regtype then
    execute format('select public.%I(%s)', p_fn, array_to_string(v_exprs, ', ')) using p_args;
    v_out := null;
  else
    execute format('select to_jsonb(public.%I(%s))', p_fn, array_to_string(v_exprs, ', ')) into v_out using p_args;
  end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_out;
end $$;
revoke execute on function public.odoo_cron_rpc(text, uuid, timestamptz, text, jsonb) from public;
grant execute on function public.odoo_cron_rpc(text, uuid, timestamptz, text, jsonb) to anon, authenticated;

create or replace function public.odoo_cron_finish(p_secret text, p_company uuid, p_run timestamptz, p_ok boolean, p_detail text default null,
  p_rows integer default null, p_version text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  j public.odoo_sync_jobs;
  v_version integer;
  v_owned boolean;
begin
  perform private.cron_check(p_secret);
  select * into j from public.odoo_sync_jobs where company_id = p_company and status = 'running' and started_at = p_run for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  v_owned := exists (select 1 from public.odoo_connections where company_id = p_company and status = 'syncing' and sync_started_at = j.heartbeat_at);
  update public.odoo_sync_jobs set status = 'idle', last_run_at = now(), last_ok = p_ok, heartbeat_at = null, updated_at = now(),
      last_error = case when p_ok then null else left(coalesce(p_detail, 'The nightly sync failed.'), 500) end,
      attempts = case when p_ok then 0 else attempts + 1 end,
      next_run_at = case when not nightly then null when p_ok then j.started_at + interval '20 hours' else now() + least(attempts + 1, 6) * interval '1 hour' end
    where company_id = p_company;
  update public.odoo_connections set status = case when p_ok then 'ok' else 'error' end, sync_started_at = null,
      last_sync_at = case when p_ok then now() else last_sync_at end,
      last_error = case when p_ok then null else left(coalesce(p_detail, 'The nightly sync failed.'), 500) end,
      version = coalesce(left(p_version, 40), version)
    where company_id = p_company and v_owned;
  if p_ok then
    update public.companies set source = 'odoo' where id = p_company and source is distinct from 'odoo';
    -- Keep the newest versions for undo, as a person's sync does.
    select data_version into v_version from public.companies where id = p_company;
    delete from public.source_accounts where company_id = p_company and version <= coalesce(v_version, 0) - 10;
  end if;
  insert into public.odoo_audit (company_id, user_id, action, ok, detail, rows_read)
    values (p_company, j.requested_by, 'sync', p_ok, left('Nightly: ' || coalesce(p_detail, case when p_ok then 'done' else 'failed' end), 500), greatest(p_rows, 0));
end $$;
revoke execute on function public.odoo_cron_finish(text, uuid, timestamptz, boolean, text, integer, text) from public;
grant execute on function public.odoo_cron_finish(text, uuid, timestamptz, boolean, text, integer, text) to anon, authenticated;

-- Whether a night run is alive for the company (its last call under 15 minutes ago). Members of the company may ask.
create or replace function public.odoo_night_running(p_company uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'viewer') then raise exception 'not allowed' using errcode = '42501'; end if;
  return exists (select 1 from public.odoo_sync_jobs where company_id = p_company and status = 'running' and heartbeat_at > now() - interval '15 minutes');
end $$;
revoke execute on function public.odoo_night_running(uuid) from public, anon;
grant execute on function public.odoo_night_running(uuid) to authenticated;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 47 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
-- The API layer picks up the new call shapes at once.
notify pgrst, 'reload schema';
reset client_min_messages;
