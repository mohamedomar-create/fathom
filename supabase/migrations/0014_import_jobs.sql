-- 0014: import jobs. Large Odoo exports no longer pass through the web server or one long database request:
--  1. the browser stores the original file in Supabase Storage (bucket "imports", resumable) and reads it in a background
--     thread, then sends its rows straight to the database in small chunks (stage_import_rows), resumable after a drop;
--  2. queue_import_job hands the upload to the database, which checks it (required fields, repeated Odoo records, new /
--     changed / unchanged against what is saved) and saves it in the background (private.run_import_jobs, every 5 seconds
--     by pg_cron), with no request time limit. The person can close the page; the job keeps its status, counts and errors;
--  3. any invalid row stops the job before anything is saved ("needs_review"), unless the person chooses to import the
--     valid rows only;
--  4. a new "update" mode adds new records and replaces changed ones, matched by Odoo ID and Odoo's last-updated date.
-- Needs 0013. Adds new objects, two columns and one mode; removes the unfinished uploads left open before this (their
-- rows were never shown).

-- ---------------------------------------------------------------- tables
create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('inventory')),
  mode text not null check (mode in ('replace', 'add', 'all', 'update')),
  -- preparing: the browser is storing the files and sending their rows; queued: waiting for the background worker;
  -- checking / saving: being worked on; needs_review: invalid rows found, nothing saved; done / failed / cancelled.
  status text not null default 'preparing' check (status in ('preparing', 'queued', 'checking', 'needs_review', 'saving', 'done', 'failed', 'cancelled')),
  accept_invalid boolean not null default false,
  options jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  message text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists import_jobs_company_idx on public.import_jobs (company_id, created_at desc);
create index if not exists import_jobs_status_idx on public.import_jobs (status, queued_at) where status in ('preparing', 'queued', 'checking', 'saving');

-- One file of a job: where the original is stored, which Odoo export it is, how many rows the browser read from it.
create table if not exists public.import_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  filename text not null,
  size bigint not null default 0,
  export_key text not null,
  kind text not null check (kind in ('valuation', 'moves', 'onhand', 'products')),
  storage_path text not null,
  stored boolean not null default false,
  rows_declared integer,
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists import_files_job_idx on public.import_files (job_id);

-- The rows read from a file, waiting to be checked and saved (deleted once saved; rows with an error stay for the report).
-- n is the row's place in the file's reading (so a chunk sent twice is stored once); line is its row in the sheet.
create table if not exists public.import_rows (
  file_id uuid not null references public.import_files (id) on delete cascade,
  n integer not null,
  job_id uuid not null references public.import_jobs (id) on delete cascade,
  line integer,
  data jsonb not null default '{}'::jsonb,
  error text,
  primary key (file_id, n)
);
create index if not exists import_rows_job_idx on public.import_rows (job_id);

-- A company's own column choices per Odoo export (heading text per field), used before the built-in headings.
create table if not exists public.import_templates (
  company_id uuid not null references public.companies (id) on delete cascade,
  export_key text not null,
  mapping jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, export_key)
);

-- Read: any member of the company's organisation. Write: only through the functions below.
do $$
declare t text;
begin
  foreach t in array array['import_jobs', 'import_files', 'import_rows', 'import_templates'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
  end loop;
end $$;
create policy import_jobs_select on public.import_jobs for select to authenticated using (private.is_member(private.company_org(company_id)));
create policy import_files_select on public.import_files for select to authenticated using (private.is_member(private.company_org(company_id)));
create policy import_rows_select on public.import_rows for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id and private.is_member(private.company_org(j.company_id))));
create policy import_templates_select on public.import_templates for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke insert, update, delete on public.import_jobs, public.import_files, public.import_rows, public.import_templates from anon, authenticated;

-- Odoo's last-updated date (write_date) per record, for the "update" mode.
alter table public.stock_layers add column if not exists odoo_updated_at timestamptz;
alter table public.stock_moves add column if not exists odoo_updated_at timestamptz;
alter table public.inventory_batches drop constraint if exists inventory_batches_mode_check;
alter table public.inventory_batches add constraint inventory_batches_mode_check check (mode in ('replace', 'add', 'all', 'update'));

-- Uploads started before this and never finished (their rows were never shown).
delete from public.inventory_batches where status = 'open' and created_at < now() - interval '1 hour';

-- ---------------------------------------------------------------- safe casts
create or replace function private.try_numeric(t text) returns numeric language plpgsql immutable set search_path = '' as $$
begin return t::numeric; exception when others then return null; end $$;
create or replace function private.try_date(t text) returns date language plpgsql immutable set search_path = '' as $$
begin return t::date; exception when others then return null; end $$;
create or replace function private.try_timestamptz(t text) returns timestamptz language plpgsql stable set search_path = '' as $$
begin return t::timestamptz; exception when others then return null; end $$;

-- ---------------------------------------------------------------- finishing an inventory upload
-- The body of finish_inventory_batch, callable by the background worker (no signed-in person). Modes:
--  all:     every live record of this kind is replaced by the upload (the file is the whole history);
--  replace: live records of this kind from the file's first month to its last (and older copies of its records) are removed;
--  add:     staged records already live are counted as already here and dropped; mixing rows keyed by Odoo ID with
--           fingerprinted rows for the same months is refused, as it would double them;
--  update:  every row must carry its Odoo ID. A record already live is replaced when the upload's copy is newer (Odoo's
--           last-updated date) or differs; otherwise it is counted as already here. New records are added. Nothing else
--           is removed (records deleted in Odoo stay until a "replace" upload).
-- Then the rows go live, and each valuation row takes its kind from its own product's move.
create or replace function private.finish_inventory_batch_core(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.inventory_batches;
  t text;
  cols text;
  v_mixed boolean;
  v_added integer;
  v_already integer := 0;
  v_changed integer := 0;
  v_first text;
  v_last text;
begin
  select * into b from public.inventory_batches where id = p_batch for update;
  if not found then raise exception 'no such upload'; end if;
  if b.kind not in ('valuation', 'moves') or b.status <> 'open' then raise exception 'not an open upload'; end if;
  t := case b.kind when 'valuation' then 'stock_layers' else 'stock_moves' end;
  -- What makes two copies of a record the same (the kind of a valuation row is reclassified below, so it is left out).
  cols := case b.kind when 'valuation' then 'day, period, ref, product, code, category, lot, qty, unit_value, value, partner, landed_ref'
                      else 'day, period, ref, kind, product, code, lot, from_loc, to_loc, qty, uom, partner' end;
  select min(p), max(p) into v_first, v_last from unnest(b.periods) p;
  if b.mode = 'add' then
    execute format($q$select exists (select 1 from public.%1$I s join public.%1$I l on l.company_id = s.company_id and l.live and l.period = any ($2)
                        and (l.odoo_key like 'fp:%%') <> (s.odoo_key like 'fp:%%') where s.batch_id = $1)$q$, t)
      into v_mixed using b.id, b.periods;
    if v_mixed then raise exception 'KEY_MIX: these months were saved with a different kind of record key'; end if;
    execute format('delete from public.%1$I s where s.batch_id = $1 and exists (select 1 from public.%1$I l where l.company_id = s.company_id and l.live and l.odoo_key = s.odoo_key)', t)
      using b.id;
    get diagnostics v_already = row_count;
  elsif b.mode = 'update' then
    execute format($q$select exists (select 1 from public.%1$I s where s.batch_id = $1 and s.odoo_key like 'fp:%%')$q$, t) into v_mixed using b.id;
    if v_mixed then raise exception 'NEEDS_IDS: every row needs its Odoo ID to add new and changed records'; end if;
    execute format($q$delete from public.%1$I s where s.batch_id = $1 and exists (
        select 1 from public.%1$I l where l.company_id = s.company_id and l.live and l.odoo_key = s.odoo_key
           and ((s.odoo_updated_at is not null and l.odoo_updated_at is not null and s.odoo_updated_at <= l.odoo_updated_at)
                or row(%2$s) is not distinct from row(%3$s)))$q$,
      t, 'l.' || replace(cols, ', ', ', l.'), 's.' || replace(cols, ', ', ', s.'))
      using b.id;
    get diagnostics v_already = row_count;
    execute format('delete from public.%1$I l where l.company_id = $2 and l.live and l.odoo_key in (select s.odoo_key from public.%1$I s where s.batch_id = $1)', t)
      using b.id, b.company_id;
    get diagnostics v_changed = row_count;
  elsif b.mode = 'all' then
    execute format('delete from public.%1$I l where l.company_id = $1 and l.live', t) using b.company_id;
  else
    execute format('delete from public.%1$I l where l.company_id = $2 and l.live and (l.period between $3 and $4 or l.odoo_key in (select s.odoo_key from public.%1$I s where s.batch_id = $1))', t)
      using b.id, b.company_id, v_first, v_last;
  end if;
  execute format('update public.%1$I set live = true where batch_id = $1', t) using b.id;
  get diagnostics v_added = row_count;
  update public.inventory_batches set status = 'done' where id = b.id;
  update public.stock_layers l set kind = m.kind
    from (select ref, code, product,
                 (array_agg(kind order by case kind when 'adjustment' then 1 when 'scrap' then 2 when 'supplier_return' then 3
                                                     when 'customer_return' then 4 when 'receipt' then 5 else 6 end))[1] kind
            from public.stock_moves
           where company_id = b.company_id and live and ref <> ''
             and kind in ('adjustment', 'scrap', 'supplier_return', 'customer_return', 'receipt', 'delivery')
           group by ref, code, product) m
   where l.company_id = b.company_id and l.live and l.ref = m.ref and l.code = m.code and l.product = m.product
     and l.kind not in ('landed_cost', 'revaluation') and l.kind <> m.kind;
  delete from public.inventory_batches x where x.company_id = b.company_id and x.kind = b.kind and x.status = 'done' and x.id <> b.id
    and not exists (select 1 from public.stock_layers l where l.batch_id = x.id)
    and not exists (select 1 from public.stock_moves m where m.batch_id = x.id);
  -- Changed records are replaced, so they are counted as changed, not added.
  return jsonb_build_object('added', v_added - v_changed, 'already', v_already, 'changed', v_changed);
end $$;
revoke execute on function private.finish_inventory_batch_core(uuid) from public, anon, authenticated;

create or replace function public.finish_inventory_batch(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  r jsonb;
begin
  select company_id into v_company from public.inventory_batches where id = p_batch;
  if v_company is null or not private.is_member(private.company_org(v_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  r := private.finish_inventory_batch_core(p_batch);
  return jsonb_build_object('added', (r ->> 'added')::int + (r ->> 'changed')::int, 'already', (r ->> 'already')::int);
end $$;

-- ---------------------------------------------------------------- functions the browser calls
-- Start an import: one job, one row per file (its storage path is returned). At most 6 files, 60 jobs an hour per person.
create or replace function public.create_import_job(p_company uuid, p_kind text, p_mode text, p_files jsonb, p_options jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job uuid;
  v_out jsonb := '[]'::jsonb;
  f jsonb;
  v_file uuid;
  v_path text;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind <> 'inventory' then raise exception 'unknown import'; end if;
  if p_mode not in ('replace', 'add', 'all', 'update') then raise exception 'unknown mode'; end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) not between 1 and 6 then raise exception 'send 1 to 6 files'; end if;
  if not public.hit_rate_limit('import:' || (select auth.uid())::text, 3600, 60) then raise exception 'RATE: too many imports in the last hour'; end if;
  insert into public.import_jobs (company_id, kind, mode, options, created_by)
  values (p_company, p_kind, p_mode, coalesce(p_options, '{}'::jsonb) - 'files', (select auth.uid())) returning id into v_job;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f ->> 'kind', '') not in ('valuation', 'moves', 'onhand', 'products') then raise exception 'unknown file kind'; end if;
    v_file := gen_random_uuid();
    v_path := p_company::text || '/' || v_job::text || '/' || v_file::text || '-' ||
              left(regexp_replace(coalesce(f ->> 'name', 'file'), '[^A-Za-z0-9._() -]+', '_', 'g'), 120);
    insert into public.import_files (id, job_id, company_id, filename, size, export_key, kind, storage_path)
    values (v_file, v_job, p_company, left(coalesce(f ->> 'name', 'file'), 300), coalesce((f ->> 'size')::bigint, 0), left(coalesce(f ->> 'export', ''), 60), f ->> 'kind', v_path);
    v_out := v_out || jsonb_build_object('id', v_file, 'name', f ->> 'name', 'path', v_path);
  end loop;
  return jsonb_build_object('job', v_job, 'files', v_out);
end $$;

-- The job a person may still send to (their own, still preparing).
create or replace function private.own_preparing_job(p_job uuid) returns public.import_jobs language plpgsql stable security definer set search_path = '' as $$
declare j public.import_jobs;
begin
  select * into j from public.import_jobs where id = p_job;
  if not found or j.created_by is distinct from (select auth.uid()) or not private.is_member(private.company_org(j.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if j.status <> 'preparing' then raise exception 'NOT_PREPARING: this import is no longer open'; end if;
  return j;
end $$;
revoke execute on function private.own_preparing_job(uuid) from public, anon, authenticated;

-- Up to 5,000 rows of one file: [{n, line, data, error}]. A row sent twice (same n) is stored once.
create or replace function public.stage_import_rows(p_file uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.import_files;
  v_count integer;
begin
  select * into f from public.import_files where id = p_file;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.own_preparing_job(f.job_id);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 5000 then raise exception 'send 1 to 5000 rows'; end if;
  insert into public.import_rows (file_id, n, job_id, line, data, error)
  select f.id, (r ->> 'n')::int, f.job_id, nullif(r ->> 'line', '')::int, coalesce(r -> 'data', '{}'::jsonb), left(nullif(r ->> 'error', ''), 300)
  from jsonb_array_elements(p_rows) r
  where (r ->> 'n') ~ '^\d{1,7}$'
  on conflict (file_id, n) do nothing;
  get diagnostics v_count = row_count;
  update public.import_jobs set updated_at = now() where id = f.job_id;
  return v_count;
end $$;

-- How many rows each file of a job holds (to resume sending after a drop).
create or replace function public.import_staged(p_job uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(f.id, (select count(*) from public.import_rows r where r.file_id = f.id)), '{}'::jsonb)
  from public.import_files f join public.import_jobs j on j.id = f.job_id
  where f.job_id = p_job and private.is_member(private.company_org(j.company_id));
$$;

-- The original file is in storage (checked there when storage is available).
create or replace function public.mark_import_file_stored(p_file uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.import_files;
  v_found boolean := true;
begin
  select * into f from public.import_files where id = p_file;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.own_preparing_job(f.job_id);
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = ''imports'' and name = $1)' into v_found using f.storage_path;
  end if;
  if not v_found then raise exception 'NOT_STORED: the original file is not in storage yet'; end if;
  update public.import_files set stored = true where id = f.id;
end $$;

-- Hand the job to the background worker once every file is stored and all its rows are here. p_totals: {file id: rows}.
create or replace function public.queue_import_job(p_job uuid, p_totals jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  f record;
  v_total integer;
begin
  perform private.own_preparing_job(p_job);
  for f in select * from public.import_files where job_id = p_job loop
    if not f.stored then raise exception 'NOT_STORED: % is not stored yet', f.filename; end if;
    v_total := nullif(p_totals ->> f.id::text, '')::int;
    if v_total is null or v_total < 0 then raise exception 'row count missing for %', f.filename; end if;
    if (select count(*) from public.import_rows where file_id = f.id) <> v_total then raise exception 'MISSING_ROWS: not every row of % has arrived yet', f.filename; end if;
    update public.import_files set rows_declared = v_total where id = f.id;
  end loop;
  update public.import_jobs set status = 'queued', queued_at = now(), updated_at = now() where id = p_job;
end $$;

-- The person's choices on a job: stop it, import its valid rows only, or try again after a failure.
create or replace function public.act_on_import_job(p_job uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare j public.import_jobs;
begin
  select * into j from public.import_jobs where id = p_job for update;
  if not found or not private.is_member(private.company_org(j.company_id), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action = 'cancel' then
    if j.status not in ('preparing', 'queued', 'needs_review', 'failed') then raise exception 'BUSY: this import can no longer be stopped'; end if;
    update public.import_jobs set status = 'cancelled', finished_at = now(), updated_at = now(), message = null where id = p_job;
    delete from public.import_rows where job_id = p_job;
  elsif p_action = 'accept' then
    if j.status <> 'needs_review' then raise exception 'nothing to accept'; end if;
    update public.import_jobs set status = 'queued', accept_invalid = true, queued_at = now(), updated_at = now(), message = null where id = p_job;
  elsif p_action = 'retry' then
    if j.status <> 'failed' or not exists (select 1 from public.import_rows where job_id = p_job) then raise exception 'nothing to try again'; end if;
    update public.import_jobs set status = 'queued', queued_at = now(), updated_at = now(), message = null where id = p_job;
  else
    raise exception 'unknown action';
  end if;
end $$;

-- Keep a company's column choices for one Odoo export: {field: heading}.
create or replace function public.save_import_template(p_company uuid, p_export text, p_mapping jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_mapping) <> 'object' or length(p_mapping::text) > 4000 or length(p_export) > 60 then raise exception 'invalid template'; end if;
  insert into public.import_templates (company_id, export_key, mapping, updated_by, updated_at)
  values (p_company, p_export, p_mapping, (select auth.uid()), now())
  on conflict (company_id, export_key) do update set mapping = excluded.mapping, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------- the background worker
-- Check a queued job: every row's required fields, repeated Odoo records in a file, and (per file) how many rows are new,
-- changed or already saved. Invalid rows stop the job before anything is saved, unless the person accepted them.
create or replace function private.check_import_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.import_jobs;
  fl record;
  t text;
  cols text;
  v_invalid integer := 0;
  v_counts jsonb;
  v_total jsonb := '{}'::jsonb;
begin
  select * into j from public.import_jobs where id = p_job;
  begin
    -- Required fields and readable values (the browser checks them too; this is the database's own check).
    update public.import_rows r set error = case
        when f.kind = 'valuation' and coalesce(r.data ->> 'odoo_key', '') = '' then 'No record key'
        when f.kind in ('valuation', 'moves') and private.try_date(r.data ->> 'day') is null then 'No readable date'
        when f.kind in ('valuation', 'moves') and coalesce(r.data ->> 'period', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then 'No readable month'
        when f.kind = 'onhand' and private.try_date(r.data ->> 'as_of') is null then 'No stock date'
        when coalesce(r.data ->> 'product', '') = '' and f.kind <> 'products' then 'No product'
        when f.kind in ('valuation', 'moves', 'onhand') and private.try_numeric(r.data ->> 'qty') is null then 'Quantity is not a number'
        when f.kind = 'valuation' and private.try_numeric(r.data ->> 'value') is null then 'Value is not a number'
        when f.kind = 'valuation' and coalesce(r.data ->> 'unit_value', '') <> '' and private.try_numeric(r.data ->> 'unit_value') is null then 'Unit value is not a number'
        when f.kind in ('valuation', 'moves') and abs(private.try_numeric(r.data ->> 'qty')) >= 1e14 then 'Quantity is too large'
        when f.kind = 'valuation' and (abs(private.try_numeric(r.data ->> 'value')) >= 1e16 or abs(coalesce(private.try_numeric(r.data ->> 'unit_value'), 0)) >= 1e14) then 'Value is too large'
        when f.kind = 'moves' and (coalesce(r.data ->> 'from_loc', '') = '' or coalesce(r.data ->> 'to_loc', '') = '') then 'No source or destination location'
        when coalesce(r.data ->> 'updated_at', '') <> '' and private.try_timestamptz(r.data ->> 'updated_at') is null then 'Last-updated date is not readable'
        else null end
      from public.import_files f
     where f.id = r.file_id and r.job_id = p_job and r.error is null;
    -- The same Odoo record twice in one file: the later copies are errors.
    update public.import_rows r set error = 'Repeats Odoo record ' || (r.data ->> 'odoo_key') || ' (row ' || coalesce(d.first_line::text, '?') || ')'
      from (select file_id, n, first_value(line) over w first_line, row_number() over w k
              from public.import_rows where job_id = p_job and error is null and coalesce(data ->> 'odoo_key', '') <> ''
            window w as (partition by file_id, data ->> 'odoo_key' order by n)) d
     where r.file_id = d.file_id and r.n = d.n and d.k > 1;
    if j.mode = 'update' and exists (select 1 from public.import_rows r join public.import_files f on f.id = r.file_id
                                      where r.job_id = p_job and f.kind in ('valuation', 'moves') and r.data ->> 'odoo_key' like 'fp:%') then
      raise exception 'NEEDS_IDS: “Add new and changed records” needs Odoo’s ID column. Export again with “I want to update data (import-compatible export)” ticked, or choose another option.';
    end if;
    for fl in select * from public.import_files where job_id = p_job loop
      select count(*) filter (where error is not null) into v_invalid from public.import_rows where file_id = fl.id;
      v_counts := jsonb_build_object('rows', (select count(*) from public.import_rows where file_id = fl.id), 'invalid', v_invalid);
      if fl.kind in ('valuation', 'moves') then
        t := case fl.kind when 'valuation' then 'stock_layers' else 'stock_moves' end;
        cols := case fl.kind when 'valuation' then 'day, period, ref, product, code, category, lot, qty, unit_value, value, partner, landed_ref'
                            else 'day, period, ref, kind, product, code, lot, from_loc, to_loc, qty, uom, partner' end;
        execute format($q$
          with s as (select r.data ->> 'odoo_key' k, private.try_timestamptz(r.data ->> 'updated_at') u, x.* from public.import_rows r,
                       jsonb_populate_record(null::public.%1$I, r.data || jsonb_build_object('company_id', $2, 'batch_id', $3, 'odoo_key', r.data ->> 'odoo_key')) x
                      where r.file_id = $1 and r.error is null)
          select jsonb_build_object(
            'new', count(*) filter (where l.id is null),
            'unchanged', count(*) filter (where l.id is not null and ((s.u is not null and l.odoo_updated_at is not null and s.u <= l.odoo_updated_at) or row(%2$s) is not distinct from row(%3$s))),
            'changed', count(*) filter (where l.id is not null and not ((s.u is not null and l.odoo_updated_at is not null and s.u <= l.odoo_updated_at) or row(%2$s) is not distinct from row(%3$s))))
          from s left join public.%1$I l on l.company_id = $2 and l.live and l.odoo_key = s.k$q$,
          t, 's.' || replace(cols, ', ', ', s.'), 'l.' || replace(cols, ', ', ', l.'))
          into v_counts using fl.id, j.company_id, gen_random_uuid();
        v_counts := v_counts || jsonb_build_object('rows', (select count(*) from public.import_rows where file_id = fl.id), 'invalid', v_invalid);
      end if;
      update public.import_files set counts = v_counts where id = fl.id;
      v_total := jsonb_build_object(
        'rows', coalesce((v_total ->> 'rows')::int, 0) + coalesce((v_counts ->> 'rows')::int, 0),
        'invalid', coalesce((v_total ->> 'invalid')::int, 0) + coalesce((v_counts ->> 'invalid')::int, 0),
        'new', coalesce((v_total ->> 'new')::int, 0) + coalesce((v_counts ->> 'new')::int, 0),
        'changed', coalesce((v_total ->> 'changed')::int, 0) + coalesce((v_counts ->> 'changed')::int, 0),
        'unchanged', coalesce((v_total ->> 'unchanged')::int, 0) + coalesce((v_counts ->> 'unchanged')::int, 0));
    end loop;
    if (v_total ->> 'invalid')::int > 0 and not j.accept_invalid then
      update public.import_jobs set status = 'needs_review', counts = v_total, updated_at = now(),
        message = (v_total ->> 'invalid') || ' row(s) cannot be read. Nothing was saved.' where id = p_job;
    elsif (v_total ->> 'rows')::int - (v_total ->> 'invalid')::int = 0 then
      update public.import_jobs set status = 'failed', counts = v_total, updated_at = now(), finished_at = now(), message = 'No valid rows to save.' where id = p_job;
    else
      update public.import_jobs set status = 'saving', counts = v_total, updated_at = now() where id = p_job;
    end if;
  exception when others then
    update public.import_jobs set status = 'failed', updated_at = now(), finished_at = now(), message = left(sqlerrm, 500) where id = p_job;
  end;
end $$;

-- Save a checked job, all of its files in one transaction: moves first (so valuation rows take their kind from them),
-- then valuation, stock on hand and products. Valid rows are deleted from staging afterwards; rows with errors stay.
create or replace function private.apply_import_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.import_jobs;
  f record;
  v_batch uuid;
  v_periods text[];
  r jsonb;
  v_added integer := 0;
  v_already integer := 0;
  v_changed integer := 0;
  v_n integer;
begin
  select * into j from public.import_jobs where id = p_job;
  begin
    for f in select * from public.import_files where job_id = p_job order by case kind when 'moves' then 1 when 'valuation' then 2 when 'onhand' then 3 else 4 end, created_at loop
      if f.kind in ('valuation', 'moves') then
        select array_agg(distinct data ->> 'period' order by data ->> 'period') into v_periods from public.import_rows where file_id = f.id and error is null;
        if v_periods is null then continue; end if;
        insert into public.inventory_batches (company_id, kind, filename, periods, mode, status, report, created_by)
        values (j.company_id, f.kind, left(f.filename, 300), v_periods, j.mode, 'open', jsonb_build_object('job', j.id, 'file', f.id), j.created_by)
        returning id into v_batch;
        if f.kind = 'valuation' then
          insert into public.stock_layers (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, category, lot, qty, unit_value, value, partner, landed_ref, odoo_updated_at)
          select j.company_id, v_batch, left(d ->> 'odoo_key', 200), (d ->> 'day')::date, d ->> 'period', left(coalesce(d ->> 'ref', ''), 120), left(coalesce(d ->> 'kind', 'other'), 30),
                 left(coalesce(d ->> 'product', ''), 300), left(coalesce(d ->> 'code', ''), 120), left(coalesce(d ->> 'category', ''), 200), left(coalesce(d ->> 'lot', ''), 120),
                 coalesce(private.try_numeric(d ->> 'qty'), 0), coalesce(private.try_numeric(d ->> 'unit_value'), 0), coalesce(private.try_numeric(d ->> 'value'), 0),
                 left(coalesce(d ->> 'partner', ''), 200), left(coalesce(d ->> 'landed_ref', ''), 120), private.try_timestamptz(d ->> 'updated_at')
          from (select data d from public.import_rows where file_id = f.id and error is null order by n) x
          on conflict (batch_id, odoo_key) do nothing;
        else
          insert into public.stock_moves (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, lot, from_loc, to_loc, qty, uom, partner, odoo_updated_at)
          select j.company_id, v_batch, left(d ->> 'odoo_key', 200), (d ->> 'day')::date, d ->> 'period', left(coalesce(d ->> 'ref', ''), 120), left(coalesce(d ->> 'kind', 'internal'), 30),
                 left(coalesce(d ->> 'product', ''), 300), left(coalesce(d ->> 'code', ''), 120), left(coalesce(d ->> 'lot', ''), 120), left(coalesce(d ->> 'from_loc', ''), 200),
                 left(coalesce(d ->> 'to_loc', ''), 200), coalesce(private.try_numeric(d ->> 'qty'), 0), left(coalesce(d ->> 'uom', ''), 60), left(coalesce(d ->> 'partner', ''), 200),
                 private.try_timestamptz(d ->> 'updated_at')
          from (select data d from public.import_rows where file_id = f.id and error is null order by n) x
          on conflict (batch_id, odoo_key) do nothing;
        end if;
        r := private.finish_inventory_batch_core(v_batch);
        v_added := v_added + (r ->> 'added')::int; v_already := v_already + (r ->> 'already')::int; v_changed := v_changed + (r ->> 'changed')::int;
      elsif f.kind = 'onhand' then
        insert into public.inventory_batches (company_id, kind, filename, periods, mode, status, report, created_by)
        select j.company_id, 'onhand', left(f.filename, 300), array[left(min(data ->> 'as_of'), 7)], 'replace', 'done', jsonb_build_object('job', j.id, 'file', f.id), j.created_by
          from public.import_rows where file_id = f.id and error is null
        returning id into v_batch;
        delete from public.stock_onhand where company_id = j.company_id
          and as_of in (select distinct (data ->> 'as_of')::date from public.import_rows where file_id = f.id and error is null);
        insert into public.stock_onhand (company_id, batch_id, as_of, product, code, location, lot, qty, value)
        select j.company_id, v_batch, as_of, product, code, location, lot, sum(qty), sum(value)
        from (select (data ->> 'as_of')::date as_of, left(coalesce(data ->> 'product', ''), 300) product, left(coalesce(data ->> 'code', ''), 120) code,
                     left(coalesce(data ->> 'location', ''), 200) location, left(coalesce(data ->> 'lot', ''), 120) lot,
                     coalesce(private.try_numeric(data ->> 'qty'), 0) qty, private.try_numeric(data ->> 'value') value
                from public.import_rows where file_id = f.id and error is null) x
        group by as_of, product, code, location, lot;
        get diagnostics v_n = row_count;
        v_added := v_added + v_n;
      else
        insert into public.inventory_products (company_id, code, name, category, cost, type)
        select distinct on (left(data ->> 'code', 120)) j.company_id, left(data ->> 'code', 120), left(coalesce(data ->> 'name', ''), 300), left(coalesce(data ->> 'category', ''), 200),
               private.try_numeric(data ->> 'cost'), left(coalesce(data ->> 'type', ''), 60)
        from public.import_rows where file_id = f.id and error is null and coalesce(data ->> 'code', '') <> ''
        on conflict (company_id, code) do update set name = excluded.name, category = excluded.category, cost = excluded.cost, type = excluded.type;
        get diagnostics v_n = row_count;
        v_added := v_added + v_n;
      end if;
    end loop;
    delete from public.import_rows where job_id = p_job and error is null;
    update public.import_jobs set status = 'done', finished_at = now(), updated_at = now(), message = null,
      counts = counts || jsonb_build_object('added', v_added, 'already', v_already, 'replaced', v_changed) where id = p_job;
  exception when others then
    update public.import_jobs set status = 'failed', updated_at = now(), finished_at = now(),
      message = case when sqlerrm like 'KEY_MIX%' then 'These months were saved before from an export without Odoo IDs (or with them). Choose “Replace these months” or “Replace all my stock records” instead.'
                     else left(sqlerrm, 500) end where id = p_job;
  end;
end $$;

-- Every few seconds (pg_cron): unfinished uploads older than a day are closed, then queued jobs are checked and saved, each
-- step committed on its own so the person sees it move. At most 5 jobs a run.
-- (A procedure that commits cannot be security definer or carry SET options; it runs as its owner from pg_cron and names
-- everything in full.)
create or replace procedure private.run_import_jobs()
language plpgsql
as $$
declare
  v_id uuid;
  v_status text;
  k integer := 0;
begin
  perform set_config('statement_timeout', '600000', false);
  update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
         message = 'The upload stopped before every row was sent. Choose the files again.'
   where status = 'preparing' and updated_at < now() - interval '24 hours';
  delete from public.import_rows r using public.import_jobs j
   where r.job_id = j.id and ((j.status = 'cancelled') or (j.status in ('done', 'failed', 'needs_review') and j.updated_at < now() - interval '30 days'));
  commit;
  loop
    exit when k >= 5;
    select id, status into v_id, v_status from public.import_jobs where status in ('queued', 'saving') order by queued_at nulls last limit 1 for update skip locked;
    exit when v_id is null;
    k := k + 1;
    if v_status = 'queued' then
      update public.import_jobs set status = 'checking', started_at = coalesce(started_at, now()), updated_at = now() where id = v_id;
      commit;
      perform private.check_import_job(v_id);
      commit;
      select status into v_status from public.import_jobs where id = v_id;
    end if;
    if v_status = 'saving' then
      perform private.apply_import_job(v_id);
      commit;
    end if;
    v_id := null;
  end loop;
end $$;
revoke execute on function private.check_import_job(uuid) from public, anon, authenticated;
revoke execute on function private.apply_import_job(uuid) from public, anon, authenticated;
revoke execute on procedure private.run_import_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------- storage and schedule (on Supabase)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('imports', 'imports', false, 52428800)
    on conflict (id) do update set public = false, file_size_limit = 52428800;
    execute 'drop policy if exists imports_insert on storage.objects';
    execute 'drop policy if exists imports_select on storage.objects';
    -- Upload: only into a job the person started and is still preparing ({company}/{job}/{file}).
    execute $p$create policy imports_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'imports' and exists (select 1 from public.import_files f join public.import_jobs j on j.id = f.job_id
        where f.storage_path = name and j.status = 'preparing' and j.created_by = (select auth.uid())))$p$;
    -- Read: members of the company (to download the original).
    execute $p$create policy imports_select on storage.objects for select to authenticated using (
      bucket_id = 'imports' and exists (select 1 from public.import_files f where f.storage_path = name and private.is_member(private.company_org(f.company_id))))$p$;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'ireport-imports';
    perform cron.schedule('ireport-imports', '5 seconds', 'call private.run_import_jobs()');
  end if;
end $$;

revoke execute on function public.create_import_job(uuid, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public.stage_import_rows(uuid, jsonb) from public, anon;
revoke execute on function public.import_staged(uuid) from public, anon;
revoke execute on function public.mark_import_file_stored(uuid) from public, anon;
revoke execute on function public.queue_import_job(uuid, jsonb) from public, anon;
revoke execute on function public.act_on_import_job(uuid, text) from public, anon;
revoke execute on function public.save_import_template(uuid, text, jsonb) from public, anon;
revoke execute on function public.finish_inventory_batch(uuid) from public, anon;
grant execute on function public.create_import_job(uuid, text, text, jsonb, jsonb) to authenticated;
grant execute on function public.stage_import_rows(uuid, jsonb) to authenticated;
grant execute on function public.import_staged(uuid) to authenticated;
grant execute on function public.mark_import_file_stored(uuid) to authenticated;
grant execute on function public.queue_import_job(uuid, jsonb) to authenticated;
grant execute on function public.act_on_import_job(uuid, text) to authenticated;
grant execute on function public.save_import_template(uuid, text, jsonb) to authenticated;
grant execute on function public.finish_inventory_batch(uuid) to authenticated;
