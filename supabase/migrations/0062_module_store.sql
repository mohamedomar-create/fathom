-- 0062: storage for modules added by definition (Purchasing first), and AI assist for the intake.
--  * module_batches / module_rows: one store every new module shares. A row keeps the common columns typed (month, day,
--    document, partner, amount, quantity) and every other field as read (data). Members read live batches; editors write
--    through the functions below (a staged save: begin, add chunks, finish replaces the months in one step).
--  * private.module_keys: the modules the store accepts. A new module adds one row here, not a new table.
--  * module_summary / module_rows_page: what the module's page draws, in one call.
--  * Clearing data and deleting a company know the new store (scope "modules").
--  * Rate limits: intake AI assist (per company and per person, a day) and module saves.
-- Adds and replaces objects only; removes nothing. Safe to run again. Needs 0058.
set client_min_messages = warning;

create table if not exists private.module_keys (key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'), name text not null);
insert into private.module_keys (key, name) values ('purchasing', 'Purchasing') on conflict (key) do update set name = excluded.name;
revoke all on private.module_keys from public, anon, authenticated;

create table if not exists public.module_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  module text not null check (module ~ '^[a-z][a-z0-9_]{1,39}$'),
  filename text check (length(filename) <= 300),
  periods text[] not null default '{}',
  rows integer not null default 0,
  status text not null default 'open' check (status in ('open', 'live')),
  report jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists module_batches_company on public.module_batches (company_id, module, status);

create table if not exists public.module_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.module_batches (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  module text not null,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  day date,
  doc text not null default '' check (length(doc) <= 120),
  partner text not null default '' check (length(partner) <= 200),
  amount numeric not null default 0 check (abs(amount) < 1e15),
  qty numeric check (qty is null or abs(qty) < 1e15),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 8000)
);
create index if not exists module_rows_company on public.module_rows (company_id, module, period);
create index if not exists module_rows_batch on public.module_rows (batch_id);

alter table public.module_batches enable row level security;
alter table public.module_rows enable row level security;
drop policy if exists module_batches_read on public.module_batches;
create policy module_batches_read on public.module_batches for select to authenticated using (status = 'live' and private.company_can(company_id));
drop policy if exists module_rows_read on public.module_rows;
create policy module_rows_read on public.module_rows for select to authenticated
  using (private.company_can(company_id) and exists (select 1 from public.module_batches b where b.id = batch_id and b.status = 'live'));
revoke all on public.module_batches, public.module_rows from anon;
revoke insert, update, delete, truncate on public.module_batches, public.module_rows from authenticated;
grant select on public.module_batches, public.module_rows to authenticated;

-- ---------------------------------------------------------------- saving (a staged save)
create or replace function public.module_batch_begin(p_company uuid, p_module text, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if p_company is null or not private.company_can(p_company, 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from private.module_keys where key = p_module) then raise exception 'unknown module' using errcode = '22023'; end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 600 then raise exception 'periods required (1 to 600)'; end if;
  if exists (select 1 from unnest(p_periods) p where p !~ '^\d{4}-(0[1-9]|1[0-2])$') then raise exception 'bad period'; end if;
  if pg_column_size(coalesce(p_report, '{}'::jsonb)) > 100000 then raise exception 'report too large'; end if;
  -- Saves left open for a day (the page was closed) are cleared.
  delete from public.module_batches where company_id = p_company and status = 'open' and created_at < now() - interval '1 day';
  insert into public.module_batches (company_id, module, filename, periods, report)
  values (p_company, p_module, left(p_filename, 300), (select array_agg(distinct p order by p) from unnest(p_periods) p), coalesce(p_report, '{}'::jsonb))
  returning id into v;
  return v;
end $$;

-- Up to 5,000 rows a call. A row outside the save's months is refused (the whole chunk); a closed month is refused by its lock.
create or replace function public.module_rows_add(p_batch uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare b public.module_batches; v_n integer;
begin
  select * into b from public.module_batches where id = p_batch;
  if not found or b.status <> 'open' or b.created_by is distinct from (select auth.uid()) or not private.company_can(b.company_id, 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then raise exception 'send 1 to 5000 rows'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where not ((r ->> 'period') = any (b.periods))) then raise exception 'a row is outside the months of this save'; end if;
  insert into public.module_rows (batch_id, company_id, module, period, day, doc, partner, amount, qty, data)
  select b.id, b.company_id, b.module, r ->> 'period', nullif(r ->> 'day', '')::date, left(coalesce(r ->> 'doc', ''), 120), left(coalesce(r ->> 'partner', ''), 200),
         coalesce((r ->> 'amount')::numeric, 0), nullif(r ->> 'qty', '')::numeric, coalesce(r -> 'data', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r;
  get diagnostics v_n = row_count;
  update public.module_batches set rows = rows + v_n where id = b.id;
  return v_n;
end $$;

-- The new rows replace the module's rows for the save's months, in one step: never half a month.
create or replace function public.module_batch_finish(p_batch uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare b public.module_batches;
begin
  select * into b from public.module_batches where id = p_batch for update;
  if not found or b.status <> 'open' or b.created_by is distinct from (select auth.uid()) or not private.company_can(b.company_id, 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = b.company_id for update;
  delete from public.module_rows r using public.module_batches o
   where r.batch_id = o.id and o.company_id = b.company_id and o.module = b.module and o.status = 'live' and r.period = any (b.periods);
  delete from public.module_batches o where o.company_id = b.company_id and o.module = b.module and o.status = 'live'
     and not exists (select 1 from public.module_rows r where r.batch_id = o.id);
  update public.module_batches set status = 'live' where id = b.id;
  return b.rows;
end $$;

create or replace function public.module_batch_cancel(p_batch uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.module_batches b where b.id = p_batch and b.status = 'open' and b.created_by = (select auth.uid()) and private.company_can(b.company_id, 'editor');
end $$;

-- ---------------------------------------------------------------- reading
create or replace function public.module_summary(p_company uuid, p_module text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_company is null or not private.company_can(p_company) then raise exception 'not allowed' using errcode = '42501'; end if;
  return (
    with r as (select x.* from public.module_rows x join public.module_batches b on b.id = x.batch_id and b.status = 'live' where x.company_id = p_company and x.module = p_module)
    select jsonb_build_object(
      'rows', (select count(*) from r),
      'docs', (select count(distinct doc) from r where doc <> ''),
      'amount', (select coalesce(sum(amount), 0) from r),
      'periods', (select coalesce(jsonb_agg(jsonb_build_object('period', period, 'amount', a, 'qty', q, 'rows', n) order by period), '[]'::jsonb)
                    from (select period, sum(amount) a, sum(qty) q, count(*) n from r group by period) p),
      'partners', (select coalesce(jsonb_agg(jsonb_build_object('partner', partner, 'amount', a, 'rows', n) order by a desc), '[]'::jsonb)
                     from (select partner, sum(amount) a, count(*) n from r group by partner order by sum(amount) desc limit 50) p),
      'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'filename', filename, 'at', created_at, 'rows', rows) order by created_at desc), '[]'::jsonb)
                    from public.module_batches where company_id = p_company and module = p_module and status = 'live'))
  );
end $$;

create or replace function public.module_rows_page(p_company uuid, p_module text, p_offset integer default 0, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_company is null or not private.company_can(p_company) then raise exception 'not allowed' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) - 'company_id' - 'module' - 'batch_id' order by x.period desc, x.id), '[]'::jsonb) from (
    select r.* from public.module_rows r join public.module_batches b on b.id = r.batch_id and b.status = 'live'
     where r.company_id = p_company and r.module = p_module order by r.period desc, r.id
     offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 100), 1), 200)) x);
end $$;

revoke execute on function public.module_batch_begin(uuid, text, text[], text, jsonb), public.module_rows_add(uuid, jsonb), public.module_batch_finish(uuid),
  public.module_batch_cancel(uuid), public.module_summary(uuid, text), public.module_rows_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.module_batch_begin(uuid, text, text[], text, jsonb), public.module_rows_add(uuid, jsonb), public.module_batch_finish(uuid),
  public.module_batch_cancel(uuid), public.module_summary(uuid, text), public.module_rows_page(uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------- clearing data knows the new store
create or replace function private.reset_counts(p_company uuid, p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
begin
  if p_scope = 'financials' then
    select count(*) into n from public.source_accounts where company_id = p_company; r := r || jsonb_build_object('accounts', n);
    select count(*) into n from public.account_balances where company_id = p_company; r := r || jsonb_build_object('balances', n);
    select count(*) into n from public.imports where company_id = p_company; r := r || jsonb_build_object('versions', n);
    select count(*) into n from public.sales_lines where company_id = p_company and source = 'ledger'; r := r || jsonb_build_object('sales_lines_from_ledger', n);
    select count(*) into n from public.expense_lines where company_id = p_company and source = 'ledger'; r := r || jsonb_build_object('expense_lines_from_ledger', n);
    select count(*) into n from public.stock_ledger_lines where company_id = p_company; r := r || jsonb_build_object('stock_postings', n);
    select count(*) into n from public.payment_lines l join public.payment_batches b on b.id = l.batch_id where b.company_id = p_company and b.source = 'ledger'; r := r || jsonb_build_object('payments_from_ledger', n);
    select count(*) into n from public.commentary where company_id = p_company; r := r || jsonb_build_object('commentary', n);
    select count(*) into n from public.reports where company_id = p_company; r := r || jsonb_build_object('reports', n);
  elsif p_scope = 'sales' then
    select count(*) into n from public.sales_lines where company_id = p_company; r := r || jsonb_build_object('sales_lines', n);
  elsif p_scope = 'expenses' then
    select count(*) into n from public.expense_lines where company_id = p_company; r := r || jsonb_build_object('expense_lines', n);
  elsif p_scope = 'stock' then
    select count(*) into n from public.stock_layers where company_id = p_company; r := r || jsonb_build_object('valuation_layers', n);
    select count(*) into n from public.stock_moves where company_id = p_company; r := r || jsonb_build_object('stock_moves', n);
    select count(*) into n from public.stock_onhand where company_id = p_company; r := r || jsonb_build_object('on_hand', n);
    select count(*) into n from public.inventory_products where company_id = p_company; r := r || jsonb_build_object('products', n);
    select count(*) into n from public.import_jobs where company_id = p_company; r := r || jsonb_build_object('import_jobs', n);
  elsif p_scope = 'payments' then
    select count(*) into n from public.aged_items where company_id = p_company; r := r || jsonb_build_object('ageing_items', n);
    select count(*) into n from public.payment_lines where company_id = p_company; r := r || jsonb_build_object('payment_lines', n);
  elsif p_scope = 'end_users' then
    select count(*) into n from public.end_user_map where company_id = p_company; r := r || jsonb_build_object('end_user_choices', n);
    select count(*) into n from public.agency_statement_lines where company_id = p_company; r := r || jsonb_build_object('statement_lines', n);
  elsif p_scope = 'modules' then
    select count(*) into n from public.module_rows x join public.module_batches b on b.id = x.batch_id and b.status = 'live' where x.company_id = p_company; r := r || jsonb_build_object('module_rows', n);
  else
    raise exception 'unknown scope %', p_scope;
  end if;
  return r;
end $$;
revoke execute on function private.reset_counts(uuid, text) from public, anon, authenticated;

create or replace function private.reset_uploads(p_company uuid, p_scope text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(u order by u ->> 'at' desc), '[]'::jsonb) from (select u from (
    select jsonb_build_object('name', coalesce(filename, kind), 'at', created_at, 'kind', kind) u from public.imports where p_scope = 'financials' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Sales lines'), 'at', created_at, 'kind', source) from public.sales_batches where p_scope = 'sales' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Expense lines'), 'at', created_at, 'kind', source) from public.expense_batches where p_scope = 'expenses' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, kind), 'at', created_at, 'kind', kind) from public.inventory_batches where p_scope = 'stock' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, side), 'at', created_at, 'kind', side) from public.aged_reports where p_scope = 'payments' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Payments'), 'at', created_at, 'kind', source) from public.payment_batches where p_scope = 'payments' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Agency statement'), 'at', created_at, 'kind', 'statement') from public.agency_statement_batches where p_scope = 'end_users' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, module), 'at', created_at, 'kind', module) from public.module_batches where p_scope = 'modules' and company_id = p_company and status = 'live'
  ) a(u) order by u ->> 'at' desc limit 50) x
$$;
revoke execute on function private.reset_uploads(uuid, text) from public, anon, authenticated;

create or replace function public.data_reset_preview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_counts jsonb;
  v_mods jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_n bigint;
begin
  if not private.company_can(p_company) then raise exception 'not allowed' using errcode = '42501'; end if;
  foreach v_scope in array array['financials', 'sales', 'expenses', 'stock', 'payments', 'end_users', 'modules'] loop
    v_counts := private.reset_counts(p_company, v_scope);
    select coalesce(sum(value::bigint), 0) into v_n from jsonb_each_text(v_counts);
    -- Ledger-derived sales and expense lines are counted under both Financials and their own module; the total counts each once.
    v_total := v_total + v_n - case when v_scope = 'financials' then coalesce((v_counts ->> 'sales_lines_from_ledger')::bigint, 0) + coalesce((v_counts ->> 'expense_lines_from_ledger')::bigint, 0) + coalesce((v_counts ->> 'payments_from_ledger')::bigint, 0) else 0 end;
    v_mods := v_mods || jsonb_build_object(v_scope, jsonb_build_object('records', v_n, 'tables', v_counts, 'uploads', private.reset_uploads(p_company, v_scope)));
  end loop;
  return jsonb_build_object(
    'company', (select name from public.companies where id = p_company),
    'modules', v_mods,
    'total', v_total,
    'files', (select coalesce(jsonb_agg(storage_path), '[]'::jsonb) from public.import_files where company_id = p_company and storage_path is not null));
end $$;
revoke execute on function public.data_reset_preview(uuid) from public, anon;
grant execute on function public.data_reset_preview(uuid) to authenticated;

create or replace function private.clear_scope(p_company uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb;
begin
  if p_scope = 'financials' then
    delete from public.sales_batches where company_id = p_company and source = 'ledger';
    delete from public.expense_batches where company_id = p_company and source = 'ledger';
    delete from public.stock_ledger_batches where company_id = p_company;
    delete from public.payment_batches where company_id = p_company and source = 'ledger';
    delete from public.account_balances where company_id = p_company;
    delete from public.source_accounts where company_id = p_company;
    delete from public.imports where company_id = p_company;
    delete from public.commentary where company_id = p_company;
    delete from public.reports where company_id = p_company;
    -- No figures left: the books read as empty, and the opening and Trial Balance check that described them go too.
    select kpi_config into v_cfg from public.companies where id = p_company;
    update public.companies set data_version = 0, last_synced_at = null,
      kpi_config = case when v_cfg ? 'profile' then jsonb_set(v_cfg, '{profile}', (v_cfg -> 'profile') - 'openingAsAt' - 'tbCheck') else v_cfg end
     where id = p_company;
  elsif p_scope = 'sales' then
    delete from public.sales_batches where company_id = p_company;
  elsif p_scope = 'expenses' then
    delete from public.expense_batches where company_id = p_company;
  elsif p_scope = 'stock' then
    -- An import the background runner is saving holds its job row: wait for nobody, refuse instead. Jobs still waiting or
    -- being prepared are stopped and removed with the stock (D18).
    begin
      perform 1 from public.import_jobs where company_id = p_company for update nowait;
    exception when lock_not_available then
      raise exception 'A stock import is being saved right now; clear stock again once it has finished';
    end;
    if exists (select 1 from public.import_jobs where company_id = p_company and status in ('checking', 'saving')) then
      raise exception 'A stock import is being saved right now; clear stock again once it has finished';
    end if;
    delete from public.import_jobs where company_id = p_company;
    delete from public.stock_layers where company_id = p_company;
    delete from public.stock_moves where company_id = p_company;
    delete from public.stock_onhand where company_id = p_company;
    delete from public.inventory_products where company_id = p_company;
    delete from public.inventory_batches where company_id = p_company;
    delete from public.inventory_rollups where company_id = p_company;
    delete from private.inventory_marks where company_id = p_company;
  elsif p_scope = 'payments' then
    delete from public.aged_reports where company_id = p_company;
    delete from public.payment_batches where company_id = p_company;
    select kpi_config into v_cfg from public.companies where id = p_company;
    update public.companies set kpi_config = jsonb_set(v_cfg, '{profile}', (v_cfg -> 'profile') - 'controlAccounts') where id = p_company and v_cfg ? 'profile';
  elsif p_scope = 'end_users' then
    delete from public.end_user_map where company_id = p_company;
    delete from public.agency_statement_batches where company_id = p_company;
  elsif p_scope = 'modules' then
    delete from public.module_batches where company_id = p_company;
  else
    raise exception 'unknown scope %', p_scope;
  end if;
end $$;
revoke execute on function private.clear_scope(uuid, text) from public, anon, authenticated;

create or replace function public.clear_company_data(p_company uuid, p_scope text, p_confirm bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.company_org(p_company);
  v_preview jsonb;
  v_shown bigint;
  v_scope text;
  v_scopes text[];
  v_counts jsonb := '{}'::jsonb;
begin
  if p_scope not in ('financials', 'sales', 'expenses', 'stock', 'payments', 'end_users', 'modules', 'all') then raise exception 'unknown scope' using errcode = '22023'; end if;
  if v_org is null or not private.company_can(p_company, case when p_scope = 'all' then 'admin' else 'editor' end::public.member_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = p_company for update;
  v_preview := public.data_reset_preview(p_company);
  v_shown := case when p_scope = 'all' then (v_preview ->> 'total')::bigint else (v_preview #>> array['modules', p_scope, 'records'])::bigint end;
  if v_shown is distinct from p_confirm then raise exception 'the data changed since it was shown; look again before clearing' using errcode = '40001'; end if;
  -- Stock last: clearing the ledger's stock postings marks the stock summary for a rebuild, and the stock clear removes it.
  v_scopes := case when p_scope = 'all' then array['payments', 'end_users', 'modules', 'sales', 'expenses', 'financials', 'stock'] else array[p_scope] end;
  foreach v_scope in array v_scopes loop
    v_counts := v_counts || jsonb_build_object(v_scope, v_preview #> array['modules', v_scope, 'tables']);
    perform private.clear_scope(p_company, v_scope);
  end loop;
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (v_org, p_company, coalesce(v_preview ->> 'company', ''), case when p_scope = 'all' then 'clear_all' else 'clear_module' end, p_scope, v_counts);
  return v_counts;
end $$;
revoke execute on function public.clear_company_data(uuid, text, bigint) from public, anon;
grant execute on function public.clear_company_data(uuid, text, bigint) to authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values
  ('intake_ai_company', 'company', 86400, 300), ('intake_ai_user', 'user', 86400, 500), ('module', 'user', 3600, 120)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

select private.adopt_company_roles();
do $$ begin
  perform private.install_tenant_guards();
  perform private.install_period_locks();
end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 62 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
