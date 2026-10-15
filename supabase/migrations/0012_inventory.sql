-- 0012: the Inventory module. Odoo's valuation layers, done moves, stock on hand and products, each record stored once
-- under its Odoo ID (or a fingerprint when the export has no ID), and the General Ledger's stock postings for the tie-outs.
-- Adds new objects only; nothing existing is changed.

-- One upload of one kind of Inventory sheet: which months it covered and whether it replaced them or added new records only.
create table if not exists public.inventory_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('valuation', 'moves', 'onhand', 'products')),
  filename text,
  periods text[] not null default '{}',
  mode text not null default 'replace' check (mode in ('replace', 'add')),
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_batches_company_idx on public.inventory_batches (company_id, kind, created_at desc);

-- One FIFO valuation layer (stock.valuation.layer). value is in the company currency: incoming positive, outgoing negative.
create table if not exists public.stock_layers (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.inventory_batches (id) on delete cascade,
  odoo_key text not null,
  day date,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ref text not null default '',
  kind text not null default 'other',
  product text not null default '',
  code text not null default '',
  category text not null default '',
  lot text not null default '',
  qty numeric(18, 4) not null default 0,
  unit_value numeric(18, 4) not null default 0,
  value numeric(18, 2) not null default 0,
  partner text not null default '',
  landed_ref text not null default '',
  unique (company_id, odoo_key)
);
create index if not exists stock_layers_company_period_idx on public.stock_layers (company_id, period);
create index if not exists stock_layers_batch_idx on public.stock_layers (batch_id);

-- One done move line (stock.move.line): where a quantity went.
create table if not exists public.stock_moves (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.inventory_batches (id) on delete cascade,
  odoo_key text not null,
  day date,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ref text not null default '',
  kind text not null default 'internal',
  product text not null default '',
  code text not null default '',
  lot text not null default '',
  from_loc text not null default '',
  to_loc text not null default '',
  qty numeric(18, 4) not null default 0,
  uom text not null default '',
  partner text not null default '',
  unique (company_id, odoo_key)
);
create index if not exists stock_moves_company_period_idx on public.stock_moves (company_id, period);
create index if not exists stock_moves_batch_idx on public.stock_moves (batch_id);

-- Stock on hand at a date (stock.quant): a snapshot, replaced when the same date is uploaded again.
create table if not exists public.stock_onhand (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.inventory_batches (id) on delete cascade,
  as_of date not null,
  product text not null default '',
  code text not null default '',
  location text not null default '',
  lot text not null default '',
  qty numeric(18, 4) not null default 0,
  value numeric(18, 2),
  unique (company_id, as_of, product, location, lot)
);

-- The latest products list: category and cost per product code.
create table if not exists public.inventory_products (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null default '',
  category text not null default '',
  cost numeric(18, 4),
  type text not null default '',
  unique (company_id, code)
);

-- The General Ledger's entries on the stock accounts (debit positive), by reference: the ledger side of the tie-outs.
-- Kept like the ledger's sales and expense lines: replaced month by month when accounts are uploaded again.
create table if not exists public.stock_ledger_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null default 'ledger' check (source = 'ledger'),
  filename text,
  periods text[] not null default '{}',
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.stock_ledger_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.stock_ledger_batches (id) on delete cascade,
  source text not null default 'ledger' check (source = 'ledger'),
  day date,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ref text not null default '',
  account text not null default '',
  amount numeric(18, 2) not null
);
create index if not exists stock_ledger_lines_company_period_idx on public.stock_ledger_lines (company_id, period);

-- Read: any member of the company's organisation. Write: editors (the save functions below are the normal path).
do $$
declare t text;
begin
  foreach t in array array['inventory_batches', 'stock_layers', 'stock_moves', 'stock_onhand', 'inventory_products', 'stock_ledger_batches', 'stock_ledger_lines'] loop
    execute format('alter table public.%1$s enable row level security', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.is_member(private.company_org(company_id)))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_member(private.company_org(company_id), ''editor'')) with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_member(private.company_org(company_id), ''editor''))', t);
  end loop;
end $$;

-- Start an upload of one kind of sheet.
--  replace: this kind's records for these months are removed first, and so is every earlier upload of the same file
--           (a file uploaded again never leaves its old copy behind);
--  add:     nothing is removed; records already stored (same Odoo ID) are counted, not added again.
create or replace function public.begin_inventory_batch(p_company uuid, p_kind text, p_periods text[], p_filename text default null, p_mode text default 'replace', p_report jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_file text := left(p_filename, 300);
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('valuation', 'moves', 'onhand', 'products') then raise exception 'unknown kind'; end if;
  if p_mode not in ('replace', 'add') then raise exception 'unknown mode'; end if;
  if p_kind <> 'products' and (coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 240) then raise exception 'periods required'; end if;
  if p_mode = 'replace' then
    if p_kind = 'valuation' then
      delete from public.stock_layers where company_id = p_company and (period = any (p_periods)
        or (v_file is not null and batch_id in (select id from public.inventory_batches where company_id = p_company and kind = 'valuation' and filename = v_file)));
    elsif p_kind = 'moves' then
      delete from public.stock_moves where company_id = p_company and (period = any (p_periods)
        or (v_file is not null and batch_id in (select id from public.inventory_batches where company_id = p_company and kind = 'moves' and filename = v_file)));
    end if;
    -- Uploads left with no records are dropped (snapshots and products keep their batch: they are replaced by date or code).
    delete from public.inventory_batches b where b.company_id = p_company and b.kind = p_kind and p_kind in ('valuation', 'moves')
      and not exists (select 1 from public.stock_layers l where l.batch_id = b.id)
      and not exists (select 1 from public.stock_moves m where m.batch_id = b.id);
  end if;
  insert into public.inventory_batches (company_id, kind, filename, periods, mode, report, created_by)
  values (p_company, p_kind, v_file, coalesce(p_periods, '{}'), p_mode, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Add up to 5,000 layers to a valuation upload. Rows outside its months are refused; rows already stored are counted.
create or replace function public.add_stock_layers(p_batch uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.inventory_batches;
  v_in integer;
  v_added integer;
begin
  select * into b from public.inventory_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.kind <> 'valuation' then raise exception 'not a valuation upload'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'send 1 to 5000 rows'; end if;
  select count(*) into v_in from jsonb_array_elements(p_rows) r where r ->> 'period' = any (b.periods) and coalesce(r ->> 'odoo_key', '') <> '';
  insert into public.stock_layers (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, category, lot, qty, unit_value, value, partner, landed_ref)
  select b.company_id, b.id, left(r ->> 'odoo_key', 200), nullif(r ->> 'day', '')::date, r ->> 'period',
         left(coalesce(r ->> 'ref', ''), 120), left(coalesce(r ->> 'kind', 'other'), 30), left(coalesce(r ->> 'product', ''), 300),
         left(coalesce(r ->> 'code', ''), 120), left(coalesce(r ->> 'category', ''), 200), left(coalesce(r ->> 'lot', ''), 120),
         coalesce(nullif(r ->> 'qty', '')::numeric, 0), coalesce(nullif(r ->> 'unit_value', '')::numeric, 0), coalesce(nullif(r ->> 'value', '')::numeric, 0),
         left(coalesce(r ->> 'partner', ''), 200), left(coalesce(r ->> 'landed_ref', ''), 120)
  from jsonb_array_elements(p_rows) r
  where r ->> 'period' = any (b.periods) and coalesce(r ->> 'odoo_key', '') <> ''
  on conflict (company_id, odoo_key) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('added', v_added, 'already', v_in - v_added);
end $$;

-- Add up to 5,000 done move lines to a moves upload, the same way.
create or replace function public.add_stock_moves(p_batch uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.inventory_batches;
  v_in integer;
  v_added integer;
begin
  select * into b from public.inventory_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.kind <> 'moves' then raise exception 'not a moves upload'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'send 1 to 5000 rows'; end if;
  select count(*) into v_in from jsonb_array_elements(p_rows) r where r ->> 'period' = any (b.periods) and coalesce(r ->> 'odoo_key', '') <> '';
  insert into public.stock_moves (company_id, batch_id, odoo_key, day, period, ref, kind, product, code, lot, from_loc, to_loc, qty, uom, partner)
  select b.company_id, b.id, left(r ->> 'odoo_key', 200), nullif(r ->> 'day', '')::date, r ->> 'period',
         left(coalesce(r ->> 'ref', ''), 120), left(coalesce(r ->> 'kind', 'internal'), 30), left(coalesce(r ->> 'product', ''), 300),
         left(coalesce(r ->> 'code', ''), 120), left(coalesce(r ->> 'lot', ''), 120), left(coalesce(r ->> 'from_loc', ''), 200),
         left(coalesce(r ->> 'to_loc', ''), 200), coalesce(nullif(r ->> 'qty', '')::numeric, 0), left(coalesce(r ->> 'uom', ''), 60),
         left(coalesce(r ->> 'partner', ''), 200)
  from jsonb_array_elements(p_rows) r
  where r ->> 'period' = any (b.periods) and coalesce(r ->> 'odoo_key', '') <> ''
  on conflict (company_id, odoo_key) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('added', v_added, 'already', v_in - v_added);
end $$;

-- Replace the stock-on-hand snapshot of one date (rows for the same product, location and lot are added together).
create or replace function public.set_stock_onhand(p_batch uuid, p_as_of date, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.inventory_batches;
  v_count integer;
begin
  select * into b from public.inventory_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.kind <> 'onhand' then raise exception 'not a stock-on-hand upload'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then raise exception 'send 1 to 20000 rows'; end if;
  delete from public.stock_onhand where company_id = b.company_id and as_of = p_as_of;
  insert into public.stock_onhand (company_id, batch_id, as_of, product, code, location, lot, qty, value)
  select b.company_id, b.id, p_as_of, product, max(code), location, lot, sum(qty), sum(value)
  from (select left(coalesce(r ->> 'product', ''), 300) product, left(coalesce(r ->> 'code', ''), 120) code, left(coalesce(r ->> 'location', ''), 200) location,
               left(coalesce(r ->> 'lot', ''), 120) lot, coalesce(nullif(r ->> 'qty', '')::numeric, 0) qty, nullif(r ->> 'value', '')::numeric value
          from jsonb_array_elements(p_rows) r) x
  group by product, location, lot;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Keep the latest products list (by product code).
create or replace function public.set_inventory_products(p_company uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then raise exception 'send 1 to 20000 rows'; end if;
  insert into public.inventory_products (company_id, code, name, category, cost, type)
  select distinct on (left(r ->> 'code', 120)) p_company, left(r ->> 'code', 120), left(coalesce(r ->> 'name', ''), 300), left(coalesce(r ->> 'category', ''), 200),
         nullif(r ->> 'cost', '')::numeric, left(coalesce(r ->> 'type', ''), 60)
  from jsonb_array_elements(p_rows) r where coalesce(r ->> 'code', '') <> ''
  on conflict (company_id, code) do update set name = excluded.name, category = excluded.category, cost = excluded.cost, type = excluded.type;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The ledger's stock postings, saved like its sales and expense lines: a batch replaces those months, then the lines.
create or replace function public.begin_stock_ledger_batch(p_company uuid, p_periods text[], p_filename text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 600 then raise exception 'periods required'; end if;
  delete from public.stock_ledger_lines where company_id = p_company and period = any (p_periods);
  delete from public.stock_ledger_batches b where b.company_id = p_company and not exists (select 1 from public.stock_ledger_lines l where l.batch_id = b.id);
  insert into public.stock_ledger_batches (company_id, filename, periods, created_by)
  values (p_company, left(p_filename, 300), p_periods, (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

create or replace function public.add_stock_ledger_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.stock_ledger_batches;
  v_count integer;
begin
  select * into b from public.stock_ledger_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  insert into public.stock_ledger_lines (company_id, batch_id, day, period, ref, account, amount)
  select b.company_id, b.id, nullif(l ->> 'day', '')::date, l ->> 'period', left(coalesce(l ->> 'ref', ''), 120), left(coalesce(l ->> 'account', ''), 200), (l ->> 'amount')::numeric
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- What the Inventory pages read: monthly totals (row-level security applies), never every row.
create or replace function public.inventory_summary(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'layers', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'kind', kind, 'code', code, 'product', product, 'category', category, 'q', q, 'v', v, 'n', n)) from (
      select period, kind, code, max(product) product, max(category) category, sum(qty) q, sum(value) v, count(*) n
        from public.stock_layers where company_id = p_company group by period, kind, code) x), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'kind', kind, 'code', code, 'product', product, 'from', from_loc, 'to', to_loc, 'q', q, 'n', n)) from (
      select period, kind, code, max(product) product, from_loc, to_loc, sum(qty) q, count(*) n
        from public.stock_moves where company_id = p_company group by period, kind, code, from_loc, to_loc) y), '[]'::jsonb),
    'last_out', coalesce((select jsonb_object_agg(code, d) from (
      select code, max(day)::text d from (
        select code, day from public.stock_moves where company_id = p_company and kind = 'delivery'
        union all select code, day from public.stock_layers where company_id = p_company and kind = 'delivery') u group by code) z), '{}'::jsonb),
    'onhand', coalesce((select jsonb_agg(jsonb_build_object('asOf', as_of::text, 'product', product, 'code', code, 'location', location, 'lot', lot, 'qty', qty, 'value', value))
      from public.stock_onhand where company_id = p_company and as_of = (select max(as_of) from public.stock_onhand where company_id = p_company)), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'category', category, 'cost', cost, 'type', type))
      from public.inventory_products where company_id = p_company), '[]'::jsonb),
    'byRef', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'ref', ref, 'kind', kind, 'v', v)) from (
      select period, ref, kind, sum(value) v from public.stock_layers where company_id = p_company and ref <> '' group by period, ref, kind) r), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'ref', ref, 'v', v)) from (
      select period, ref, sum(amount) v from public.stock_ledger_lines where company_id = p_company group by period, ref) g), '[]'::jsonb),
    'meta', jsonb_build_object(
      'withIds', (exists (select 1 from public.stock_layers where company_id = p_company) or exists (select 1 from public.stock_moves where company_id = p_company))
        and not exists (select 1 from public.stock_layers where company_id = p_company and odoo_key like 'fp:%')
        and not exists (select 1 from public.stock_moves where company_id = p_company and odoo_key like 'fp:%'),
      'kinds', coalesce((select jsonb_agg(distinct kind) from public.inventory_batches where company_id = p_company), '[]'::jsonb),
      'periods', coalesce((select jsonb_agg(p order by p) from (select distinct period p from public.stock_layers where company_id = p_company
        union select distinct period from public.stock_moves where company_id = p_company) q), '[]'::jsonb))
  );
$$;

revoke execute on function public.begin_inventory_batch(uuid, text, text[], text, text, jsonb) from public, anon;
revoke execute on function public.add_stock_layers(uuid, jsonb) from public, anon;
revoke execute on function public.add_stock_moves(uuid, jsonb) from public, anon;
revoke execute on function public.set_stock_onhand(uuid, date, jsonb) from public, anon;
revoke execute on function public.set_inventory_products(uuid, jsonb) from public, anon;
revoke execute on function public.inventory_summary(uuid) from public, anon;
revoke execute on function public.begin_stock_ledger_batch(uuid, text[], text) from public, anon;
revoke execute on function public.add_stock_ledger_lines(uuid, jsonb) from public, anon;
grant execute on function public.begin_inventory_batch(uuid, text, text[], text, text, jsonb) to authenticated;
grant execute on function public.add_stock_layers(uuid, jsonb) to authenticated;
grant execute on function public.add_stock_moves(uuid, jsonb) to authenticated;
grant execute on function public.set_stock_onhand(uuid, date, jsonb) to authenticated;
grant execute on function public.set_inventory_products(uuid, jsonb) to authenticated;
grant execute on function public.inventory_summary(uuid) to authenticated;
grant execute on function public.begin_stock_ledger_batch(uuid, text[], text) to authenticated;
grant execute on function public.add_stock_ledger_lines(uuid, jsonb) to authenticated;
