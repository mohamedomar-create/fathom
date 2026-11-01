-- 0046: nightly Odoo sync on the server, without the Supabase service key.
-- Needs 0025 (odoo_audit, the connection lock) and 0045. Only adds objects: the app ignores them until the release that
-- uses them. Safe to run again.
--  1. The nightly job proves itself with CRON_SECRET (the value set in Vercel). The database keeps only its SHA-256 hash,
--     set once by the owner in the SQL editor:  select private.set_cron_secret('<the same value as in Vercel>');
--  2. The job acts with the rights of the editor who turned nightly sync on for a company, re-checked on every call; when
--     that person can no longer edit the company, nightly sync switches itself off. It never acts for anyone else.
--  3. It can only call the save functions the sync already uses (an allowlist), only for the company whose job it is
--     running, and only while that job is running. It can read nothing else.
--  4. odoo_sync_jobs: one row per company (nightly on or off, last run, next run); members read it, nobody writes it
--     directly.
set client_min_messages = warning;

-- ---------------------------------------------------------------- 1. the secret (hash only)
create table if not exists private.cron_auth (
  id boolean primary key default true check (id),
  secret_hash bytea not null,
  set_at timestamptz not null default now()
);
revoke all on private.cron_auth from public, anon, authenticated;

create or replace function private.set_cron_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_secret is null or length(p_secret) < 32 or length(p_secret) > 200 then
    raise exception 'The secret must be 32 to 200 characters long.' using errcode = '22023';
  end if;
  insert into private.cron_auth (id, secret_hash, set_at) values (true, sha256(convert_to(p_secret, 'UTF8')), now())
  on conflict (id) do update set secret_hash = excluded.secret_hash, set_at = excluded.set_at;
end $$;
revoke execute on function private.set_cron_secret(text) from public, anon, authenticated;

-- Refuses (42501) unless the secret matches the stored hash. With no hash set, everything is refused.
create or replace function private.cron_check(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_secret is null or length(p_secret) > 200
     or not exists (select 1 from private.cron_auth where secret_hash = sha256(convert_to(p_secret, 'UTF8'))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke execute on function private.cron_check(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. the jobs
create table if not exists public.odoo_sync_jobs (
  company_id uuid primary key references public.companies (id) on delete cascade,
  nightly boolean not null default false,
  requested_by uuid references auth.users (id) on delete set null,
  status text not null default 'idle' check (status in ('idle', 'running')),
  started_at timestamptz,
  heartbeat_at timestamptz,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_ok boolean,
  last_error text check (length(last_error) <= 500),
  attempts smallint not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists odoo_sync_jobs_due_idx on public.odoo_sync_jobs (next_run_at) where nightly;
alter table public.odoo_sync_jobs enable row level security;
drop policy if exists odoo_sync_jobs_select on public.odoo_sync_jobs;
create policy odoo_sync_jobs_select on public.odoo_sync_jobs for select to authenticated using (private.is_member(private.company_org(company_id), 'viewer'));
revoke all on public.odoo_sync_jobs from public, anon, authenticated;
grant select on public.odoo_sync_jobs to authenticated;

-- Whether a user may edit a company, without relying on who is signed in (the nightly job has no sign-in).
create or replace function private.can_edit(p_user uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.companies c
    join public.organizations g on g.id = c.org_id and g.deleted_at is null
    join public.memberships m on m.org_id = c.org_id and m.user_id = p_user and m.role in ('editor', 'admin')
    where c.id = p_company and c.deleted_at is null);
$$;
revoke execute on function private.can_edit(uuid, uuid) from public, anon, authenticated;

-- An editor turns nightly sync on or off for a company that has a saved connection with its key.
create or replace function public.odoo_nightly_set(p_company uuid, p_on boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_on and not exists (select 1 from public.odoo_connections where company_id = p_company and coalesce(api_key_enc, '') <> '' and odoo_company_id is not null) then
    raise exception 'Save the Odoo connection with its API key first.' using errcode = 'P0001';
  end if;
  insert into public.odoo_sync_jobs as j (company_id, nightly, requested_by, next_run_at, last_error, updated_at)
    values (p_company, p_on, (select auth.uid()), case when p_on then now() end, null, now())
  on conflict (company_id) do update set
    nightly = excluded.nightly, requested_by = excluded.requested_by,
    next_run_at = case when p_on then coalesce(least(j.next_run_at, now() + interval '1 day'), now()) end,
    last_error = case when p_on then null else j.last_error end, attempts = 0, updated_at = now();
  insert into public.odoo_audit (company_id, user_id, action, ok, detail)
    values (p_company, (select auth.uid()), 'save', true, case when p_on then 'Nightly sync on' else 'Nightly sync off' end);
end $$;
revoke execute on function public.odoo_nightly_set(uuid, boolean) from public, anon;
grant execute on function public.odoo_nightly_set(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- 2. claiming the next due company
-- Returns the company, its connection (with the encrypted key: only the server can decrypt it) and what the sync needs
-- to read, or null when nothing is due. Takes the company's sync lock, as a person's sync does.
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
begin
  perform private.cron_check(p_secret);
  -- A run that stopped reporting for 15 minutes was cut off: release it and try again later.
  update public.odoo_connections c set status = 'error', sync_started_at = null, last_error = 'The nightly sync was cut off before it finished.'
    from public.odoo_sync_jobs s
    where s.company_id = c.company_id and s.status = 'running' and s.heartbeat_at < now() - interval '15 minutes'
      and c.status = 'syncing' and (c.sync_started_at is null or c.sync_started_at < now() - interval '15 minutes');
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
    update public.odoo_connections set status = 'syncing', sync_started_at = now()
      where company_id = j.company_id and (status <> 'syncing' or sync_started_at is null or sync_started_at < now() - interval '15 minutes');
    get diagnostics n = row_count;
    if n = 0 then
      -- Someone is syncing this company now: try again in half an hour.
      update public.odoo_sync_jobs set next_run_at = now() + interval '30 minutes', updated_at = now() where company_id = j.company_id;
      continue;
    end if;
    update public.odoo_sync_jobs set status = 'running', started_at = now(), heartbeat_at = now(), updated_at = now() where company_id = j.company_id;
    select data_version into v_version from public.companies where id = j.company_id;
    return jsonb_build_object(
      'company_id', j.company_id,
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

-- ---------------------------------------------------------------- 3. calling a save function for the running company
-- fn → how the target company is known: 'company' (p_company), or the table whose row p_batch / p_stage names.
create table if not exists private.cron_fns (
  fn text primary key,
  owner text not null
);
revoke all on private.cron_fns from public, anon, authenticated;
insert into private.cron_fns (fn, owner) values
  ('save_company_version', 'company'),
  ('update_company_settings', 'company'),
  ('company_balances', 'company'),
  ('stage_lines_begin', 'company'),
  ('stage_lines_add', 'private.line_stages'),
  ('stage_lines_finish', 'private.line_stages'),
  ('stage_lines_cancel', 'private.line_stages'),
  ('begin_stock_ledger_batch', 'company'),
  ('add_stock_ledger_lines', 'public.stock_ledger_batches'),
  ('begin_inventory_batch', 'company'),
  ('add_stock_moves', 'public.inventory_batches'),
  ('add_stock_layers', 'public.inventory_batches'),
  ('finish_inventory_batch', 'public.inventory_batches'),
  ('set_stock_onhand', 'public.inventory_batches')
on conflict (fn) do update set owner = excluded.owner;
delete from private.cron_fns where fn not in ('save_company_version', 'update_company_settings', 'company_balances', 'stage_lines_begin',
  'stage_lines_add', 'stage_lines_finish', 'stage_lines_cancel', 'begin_stock_ledger_batch', 'add_stock_ledger_lines', 'begin_inventory_batch',
  'add_stock_moves', 'add_stock_layers', 'finish_inventory_batch', 'set_stock_onhand');

-- Runs one allowlisted function with the arguments given (by name), as the editor who turned nightly sync on, for the
-- company whose job is running. Returns the function's result as JSON (null for none).
create or replace function public.odoo_cron_rpc(p_secret text, p_company uuid, p_fn text, p_args jsonb)
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
begin
  perform private.cron_check(p_secret);
  select * into j from public.odoo_sync_jobs where company_id = p_company and status = 'running' for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.can_edit(j.requested_by, p_company) then raise exception 'not allowed' using errcode = '42501'; end if;
  select owner into v_owner from private.cron_fns where fn = p_fn;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
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
  update public.odoo_sync_jobs set heartbeat_at = now() where company_id = p_company;
  update public.odoo_connections set sync_started_at = now() where company_id = p_company and status = 'syncing';

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
revoke execute on function public.odoo_cron_rpc(text, uuid, text, jsonb) from public;
grant execute on function public.odoo_cron_rpc(text, uuid, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------- finishing a run
create or replace function public.odoo_cron_finish(p_secret text, p_company uuid, p_ok boolean, p_detail text default null,
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
begin
  perform private.cron_check(p_secret);
  select * into j from public.odoo_sync_jobs where company_id = p_company and status = 'running' for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.odoo_sync_jobs set status = 'idle', last_run_at = now(), last_ok = p_ok, heartbeat_at = null, updated_at = now(),
      last_error = case when p_ok then null else left(coalesce(p_detail, 'The nightly sync failed.'), 500) end,
      attempts = case when p_ok then 0 else attempts + 1 end,
      next_run_at = case when not nightly then null when p_ok then now() + interval '20 hours' else now() + least(attempts + 1, 6) * interval '1 hour' end
    where company_id = p_company;
  update public.odoo_connections set status = case when p_ok then 'ok' else 'error' end, sync_started_at = null,
      last_sync_at = case when p_ok then now() else last_sync_at end,
      last_error = case when p_ok then null else left(coalesce(p_detail, 'The nightly sync failed.'), 500) end,
      version = coalesce(left(p_version, 40), version)
    where company_id = p_company;
  if p_ok then
    update public.companies set source = 'odoo' where id = p_company and source is distinct from 'odoo';
    -- Keep the newest versions for undo, as a person's sync does.
    select data_version into v_version from public.companies where id = p_company;
    delete from public.source_accounts where company_id = p_company and version <= coalesce(v_version, 0) - 10;
  end if;
  insert into public.odoo_audit (company_id, user_id, action, ok, detail, rows_read)
    values (p_company, j.requested_by, 'sync', p_ok, left('Nightly: ' || coalesce(p_detail, case when p_ok then 'done' else 'failed' end), 500), greatest(p_rows, 0));
end $$;
revoke execute on function public.odoo_cron_finish(text, uuid, boolean, text, integer, text) from public;
grant execute on function public.odoo_cron_finish(text, uuid, boolean, text, integer, text) to anon, authenticated;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 46 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
reset client_min_messages;
