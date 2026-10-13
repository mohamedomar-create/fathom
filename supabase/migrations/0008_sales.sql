-- 0008: sales lines (from the General Ledger's revenue lines or a sales export), for the Sales and Business Lines sectors.
-- Adds new objects only; nothing existing is changed.

-- One upload of sales lines: which source, which months it replaced, and a short report.
create table if not exists public.sales_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('ledger', 'file')),
  filename text,
  periods text[] not null default '{}',
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sales_batches_company_idx on public.sales_batches (company_id, created_at desc);

-- One invoice line. amount is net of tax in the company currency (credit notes negative); cost is null when unknown.
create table if not exists public.sales_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.sales_batches (id) on delete cascade,
  source text not null check (source in ('ledger', 'file')),
  day date,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  doc text not null default '',
  series text not null default '',
  customer text not null default '',
  product text not null default '',
  category text not null default '',
  salesperson text not null default '',
  qty numeric(18, 4),
  amount numeric(18, 2) not null,
  cost numeric(18, 2)
);
create index if not exists sales_lines_company_period_idx on public.sales_lines (company_id, period);
create index if not exists sales_lines_batch_idx on public.sales_lines (batch_id);

alter table public.sales_batches enable row level security;
alter table public.sales_lines enable row level security;

-- Read: any member of the company's organisation. Write: editors (the save functions below are the normal path).
do $$
declare t text;
begin
  foreach t in array array['sales_batches', 'sales_lines'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.is_member(private.company_org(company_id)))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_member(private.company_org(company_id), ''editor'')) with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_member(private.company_org(company_id), ''editor''))', t);
  end loop;
end $$;

-- Start a batch: the source's lines for these months are replaced by the lines added to the batch.
create or replace function public.begin_sales_batch(p_company uuid, p_source text, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb)
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
  if p_source not in ('ledger', 'file') then raise exception 'unknown source'; end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 240 then raise exception 'periods required'; end if;
  delete from public.sales_lines where company_id = p_company and source = p_source and period = any (p_periods);
  insert into public.sales_batches (company_id, source, filename, periods, report, created_by)
  values (p_company, p_source, left(p_filename, 300), p_periods, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Add up to 5,000 lines to a batch. Lines outside the batch's months are refused, so a batch never touches other months.
create or replace function public.add_sales_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.sales_batches;
  v_count integer;
begin
  select * into b from public.sales_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  insert into public.sales_lines (company_id, batch_id, source, day, period, doc, series, customer, product, category, salesperson, qty, amount, cost)
  select b.company_id, b.id, b.source, nullif(l ->> 'day', '')::date, l ->> 'period',
         left(coalesce(l ->> 'doc', ''), 80), left(coalesce(l ->> 'series', ''), 40), left(coalesce(l ->> 'customer', ''), 200),
         left(coalesce(l ->> 'product', ''), 300), left(coalesce(l ->> 'category', ''), 200), left(coalesce(l ->> 'salesperson', ''), 120),
         nullif(l ->> 'qty', '')::numeric, (l ->> 'amount')::numeric, nullif(l ->> 'cost', '')::numeric
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- What the sales pages read: lines added up by customer and by product per month (row-level security applies).
-- Where both sources hold a month, the sales file wins (it carries quantities, salespeople and cost).
create or replace function public.sales_summary(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with chosen as (
    select l.* from public.sales_lines l
     where l.company_id = p_company
       and (l.source = 'file' or not exists (select 1 from public.sales_lines f where f.company_id = p_company and f.source = 'file' and f.period = l.period))
  )
  select jsonb_build_object(
    'customers', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'c', customer, 's', series, 'sp', salesperson, 'a', amount, 'k', cost, 'ka', costed, 'q', qty, 'd', docs, 'n', lines)) from (
      select period, customer, series, salesperson, sum(amount) amount, sum(cost) cost, sum(amount) filter (where cost is not null) costed,
             sum(qty) qty, count(distinct nullif(doc, '')) docs, count(*) lines
        from chosen group by period, customer, series, salesperson) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'r', product, 'g', category, 's', series, 'a', amount, 'k', cost, 'ka', costed, 'q', qty, 'n', lines)) from (
      select period, product, category, series, sum(amount) amount, sum(cost) cost, sum(amount) filter (where cost is not null) costed,
             sum(qty) qty, count(*) lines
        from chosen group by period, product, category, series) y), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(period, src) from (select period, min(source) src from chosen group by period) z), '{}'::jsonb)
  );
$$;

revoke execute on function public.begin_sales_batch(uuid, text, text[], text, jsonb) from public, anon;
revoke execute on function public.add_sales_lines(uuid, jsonb) from public, anon;
revoke execute on function public.sales_summary(uuid) from public, anon;
grant execute on function public.begin_sales_batch(uuid, text, text[], text, jsonb) to authenticated;
grant execute on function public.add_sales_lines(uuid, jsonb) to authenticated;
grant execute on function public.sales_summary(uuid) to authenticated;

-- Sales for a published report link: the same summary, for the 36 months to the report's period, without signing in.
create or replace function public.get_published_sales(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.reports;
  v_from text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  v_from := to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM');
  return (
    with chosen as (
      select l.* from public.sales_lines l
       where l.company_id = r.company_id and l.period between v_from and r.period_end
         and (l.source = 'file' or not exists (select 1 from public.sales_lines f where f.company_id = r.company_id and f.source = 'file' and f.period = l.period))
    )
    select jsonb_build_object(
      'customers', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'c', customer, 's', series, 'sp', salesperson, 'a', amount, 'k', cost, 'ka', costed, 'q', qty, 'd', docs, 'n', lines)) from (
        select period, customer, series, salesperson, sum(amount) amount, sum(cost) cost, sum(amount) filter (where cost is not null) costed,
               sum(qty) qty, count(distinct nullif(doc, '')) docs, count(*) lines
          from chosen group by period, customer, series, salesperson) x), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'r', product, 'g', category, 's', series, 'a', amount, 'k', cost, 'ka', costed, 'q', qty, 'n', lines)) from (
        select period, product, category, series, sum(amount) amount, sum(cost) cost, sum(amount) filter (where cost is not null) costed,
               sum(qty) qty, count(*) lines
          from chosen group by period, product, category, series) y), '[]'::jsonb),
      'sources', coalesce((select jsonb_object_agg(period, src) from (select period, min(source) src from chosen group by period) z), '{}'::jsonb)
    )
  );
end $$;
revoke execute on function public.get_published_sales(text) from public;
grant execute on function public.get_published_sales(text) to anon, authenticated;
