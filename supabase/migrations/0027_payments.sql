-- 0027: the Payments module. Odoo's Aged Receivable / Aged Payable (one report per side and date, its open documents) and
-- its payments list (customer and vendor payments, posted). Adds new objects only; nothing existing is changed.

-- One ageing report: its side, the date it is as of, the buckets as the company's Odoo names them, its totals and what
-- the reader pointed out. A new upload for the same side and date replaces it.
create table if not exists public.aged_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  side text not null check (side in ('receivable', 'payable')),
  as_of date not null,
  buckets text[] not null,
  totals jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  filename text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, side, as_of)
);

-- One open document of a report: its partner, reference, memo, date and amount per bucket (Odoo's sign: positive owed).
create table if not exists public.aged_items (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.aged_reports (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  partner text not null default '',
  ref text not null default '',
  memo text not null default '',
  day date,
  amounts numeric(18, 2)[] not null,
  total numeric(18, 2) not null
);
create index if not exists aged_items_report_idx on public.aged_items (report_id);

-- One upload of payments: which months it replaced.
create table if not exists public.payment_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  filename text,
  periods text[] not null default '{}',
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payment_batches_company_idx on public.payment_batches (company_id, created_at desc);

-- One posted payment, in the company's currency, signed: positive received, negative paid.
create table if not exists public.payment_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.payment_batches (id) on delete cascade,
  day date not null,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  number text not null default '',
  journal text not null default '',
  method text not null default '',
  partner text not null default '',
  direction text not null check (direction in ('in', 'out')),
  amount numeric(18, 2) not null,
  currency text not null default '',
  amount_currency numeric(18, 2),
  state text not null check (state in ('paid', 'in_process'))
);
create index if not exists payment_lines_company_period_idx on public.payment_lines (company_id, period);
create index if not exists payment_lines_batch_idx on public.payment_lines (batch_id);

alter table public.aged_reports enable row level security;
alter table public.aged_items enable row level security;
alter table public.payment_batches enable row level security;
alter table public.payment_lines enable row level security;

-- Read: any member of the company's organisation. Write: editors (the save functions below are the normal path).
do $$
declare t text;
begin
  foreach t in array array['aged_reports', 'aged_items', 'payment_batches', 'payment_lines'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.is_member(private.company_org(company_id)))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_member(private.company_org(company_id), ''editor'')) with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_member(private.company_org(company_id), ''editor''))', t);
  end loop;
end $$;

-- Save one ageing report with its documents, replacing the company's report for that side and date. Returns the number
-- of documents saved.
create or replace function public.save_aged_report(p_company uuid, p_side text, p_as_of date, p_buckets text[], p_totals jsonb, p_findings jsonb, p_filename text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report uuid;
  v_count integer;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_side not in ('receivable', 'payable') then raise exception 'unknown side'; end if;
  if coalesce(array_length(p_buckets, 1), 0) not between 1 and 12 then raise exception 'buckets required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20000 then raise exception 'send up to 20000 documents'; end if;
  delete from public.aged_reports where company_id = p_company and side = p_side and as_of = p_as_of;
  insert into public.aged_reports (company_id, side, as_of, buckets, totals, findings, filename, created_by)
  values (p_company, p_side, p_as_of, p_buckets, coalesce(p_totals, '{}'::jsonb), coalesce(p_findings, '[]'::jsonb), left(p_filename, 300), (select auth.uid()))
  returning id into v_report;
  insert into public.aged_items (report_id, company_id, partner, ref, memo, day, amounts, total)
  select v_report, p_company, left(coalesce(i ->> 'partner', ''), 200), left(coalesce(i ->> 'ref', ''), 120), left(coalesce(i ->> 'memo', ''), 300),
         nullif(i ->> 'day', '')::date, array(select jsonb_array_elements_text(i -> 'amounts')::numeric), (i ->> 'total')::numeric
  from jsonb_array_elements(p_items) i;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Start a payments batch: the company's payments for these months are replaced by the lines added to the batch.
create or replace function public.begin_payment_batch(p_company uuid, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 240 then raise exception 'periods required'; end if;
  delete from public.payment_lines where company_id = p_company and period = any (p_periods);
  delete from public.payment_batches pb where pb.company_id = p_company and not exists (select 1 from public.payment_lines l where l.batch_id = pb.id);
  insert into public.payment_batches (company_id, filename, periods, report, created_by)
  values (p_company, left(p_filename, 300), p_periods, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Add up to 5,000 payments to a batch; payments outside the batch's months are refused.
create or replace function public.add_payment_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payment_batches;
  v_count integer;
begin
  select * into b from public.payment_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send up to 5000 lines'; end if;
  insert into public.payment_lines (company_id, batch_id, day, period, number, journal, method, partner, direction, amount, currency, amount_currency, state)
  select b.company_id, b.id, (l ->> 'day')::date, l ->> 'period', left(coalesce(l ->> 'number', ''), 80), left(coalesce(l ->> 'journal', ''), 120),
         left(coalesce(l ->> 'method', ''), 120), left(coalesce(l ->> 'partner', ''), 200), l ->> 'direction', (l ->> 'amount')::numeric,
         left(coalesce(l ->> 'currency', ''), 10), nullif(l ->> 'amount_currency', '')::numeric, l ->> 'state'
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- What the Payments pages read, in one call: the latest ageing per side with its documents, and every payment.
create or replace function public.payments_summary(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'aged', coalesce((
      select jsonb_object_agg(r.side, jsonb_build_object('as_of', r.as_of, 'buckets', to_jsonb(r.buckets), 'total', r.totals, 'findings', r.findings, 'filename', r.filename,
        'items', coalesce((select jsonb_agg(jsonb_build_array(i.partner, i.ref, i.memo, i.day, to_jsonb(i.amounts), i.total) order by i.id) from public.aged_items i where i.report_id = r.id), '[]'::jsonb)))
      from (select distinct on (side) * from public.aged_reports where company_id = p_company order by side, as_of desc) r
    ), '{}'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_array(l.day, l.number, l.journal, l.method, l.partner, l.amount, l.currency, l.amount_currency, l.state) order by l.day, l.id)
      from public.payment_lines l where l.company_id = p_company
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.save_aged_report(uuid, text, date, text[], jsonb, jsonb, text, jsonb) from public, anon;
revoke execute on function public.begin_payment_batch(uuid, text[], text, jsonb) from public, anon;
revoke execute on function public.add_payment_lines(uuid, jsonb) from public, anon;
revoke execute on function public.payments_summary(uuid) from public, anon;
grant execute on function public.save_aged_report(uuid, text, date, text[], jsonb, jsonb, text, jsonb) to authenticated;
grant execute on function public.begin_payment_batch(uuid, text[], text, jsonb) to authenticated;
grant execute on function public.add_payment_lines(uuid, jsonb) to authenticated;
grant execute on function public.payments_summary(uuid) to authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('payments', 'user', 3600, 60)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;
