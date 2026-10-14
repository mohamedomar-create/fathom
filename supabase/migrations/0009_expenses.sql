-- 0009: expense lines (from the General Ledger's cost lines or a purchases export), for the Expenses sector.
-- Adds new objects only; nothing existing is changed.

-- One upload of expense lines: which source, which months it replaced, and a short report.
create table if not exists public.expense_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source text not null check (source in ('ledger', 'file')),
  filename text,
  periods text[] not null default '{}',
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expense_batches_company_idx on public.expense_batches (company_id, created_at desc);

-- One bill or ledger line. amount is net of VAT in the company currency (refunds negative); cls is the iReport class when known.
create table if not exists public.expense_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.expense_batches (id) on delete cascade,
  source text not null check (source in ('ledger', 'file')),
  day date,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  doc text not null default '',
  series text not null default '',
  supplier text not null default '',
  account text not null default '',
  cls text,
  category text not null default '',
  label text not null default '',
  amount numeric(18, 2) not null
);
create index if not exists expense_lines_company_period_idx on public.expense_lines (company_id, period);
create index if not exists expense_lines_batch_idx on public.expense_lines (batch_id);

alter table public.expense_batches enable row level security;
alter table public.expense_lines enable row level security;

-- Read: any member of the company's organisation. Write: editors (the save functions below are the normal path).
do $$
declare t text;
begin
  foreach t in array array['expense_batches', 'expense_lines'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (private.is_member(private.company_org(company_id)))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (private.is_member(private.company_org(company_id), ''editor'')) with check (private.is_member(private.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (private.is_member(private.company_org(company_id), ''editor''))', t);
  end loop;
end $$;

-- Start a batch: the source's lines for these months are replaced by the lines added to the batch.
create or replace function public.begin_expense_batch(p_company uuid, p_source text, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb)
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
  delete from public.expense_lines where company_id = p_company and source = p_source and period = any (p_periods);
  insert into public.expense_batches (company_id, source, filename, periods, report, created_by)
  values (p_company, p_source, left(p_filename, 300), p_periods, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Add up to 5,000 lines to a batch. Lines outside the batch's months are refused, so a batch never touches other months.
create or replace function public.add_expense_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.expense_batches;
  v_count integer;
begin
  select * into b from public.expense_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  insert into public.expense_lines (company_id, batch_id, source, day, period, doc, series, supplier, account, cls, category, label, amount)
  select b.company_id, b.id, b.source, nullif(l ->> 'day', '')::date, l ->> 'period',
         left(coalesce(l ->> 'doc', ''), 80), left(coalesce(l ->> 'series', ''), 40), left(coalesce(l ->> 'supplier', ''), 200),
         left(coalesce(l ->> 'account', ''), 200), nullif(left(coalesce(l ->> 'cls', ''), 40), ''), left(coalesce(l ->> 'category', ''), 200),
         left(coalesce(l ->> 'label', ''), 200), (l ->> 'amount')::numeric
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The expense lines of a company between two months, added up for the Expenses pages, with the entries worth a look:
--  large: one entry bigger than twice the account's usual (median) month, on an account with 4+ months of costs, and at
--         least 2% of that month's costs;
--  double: the same supplier and amount on two different vendor bills (or file lines) within 7 days, when that amount
--          appears only those two times within 30 days (a regular purchase repeats more often) and is not trivial.
-- Where both sources hold a month, the purchases file wins. Runs with the caller's rights (row-level security applies).
create or replace function private.expense_summary_of(p_company uuid, p_from text, p_to text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with chosen as (
    select l.* from public.expense_lines l
     where l.company_id = p_company and l.period between p_from and p_to
       and (l.source = 'file' or not exists (select 1 from public.expense_lines f where f.company_id = p_company and f.source = 'file' and f.period = l.period))
  ),
  month_total as (select period, sum(amount) total from chosen group by period),
  acct_month as (
    select account, period, sum(amount) a from chosen where coalesce(cls, '') not in ('cos_depreciation', 'exp_depreciation') group by account, period
  ),
  typical as (
    select account, percentile_cont(0.5) within group (order by a) med, count(*) n from acct_month where a > 0 group by account
  ),
  large as (
    select c.day, c.period, c.doc, c.supplier, c.account, c.amount, t.med
      from chosen c join typical t on t.account = c.account join month_total m on m.period = c.period
     where t.n >= 4 and c.amount > 2 * t.med and c.amount >= 0.02 * m.total
       and coalesce(c.cls, '') not in ('cos_depreciation', 'exp_depreciation')
     order by c.amount desc, c.day, c.doc limit 100
  ),
  bills as (
    select * from chosen
     where day is not null and amount > 0 and supplier not in ('', 'No supplier', 'Journal entries', 'Depreciation (no payment)')
       and coalesce(cls, '') not in ('cos_depreciation', 'exp_depreciation')
       and (source = 'file' or doc ~* '^R?BILL[/-]')
  ),
  doubles as (
    select a.day, a.period, a.doc, a.supplier, a.account, a.amount, b.day day2, b.doc doc2
      from bills a join bills b on b.supplier = a.supplier and b.amount = a.amount and b.id > a.id
       and abs(b.day - a.day) <= 7 and (a.doc is distinct from b.doc or a.doc = '')
      join month_total m on m.period = a.period
     where a.amount >= 0.0005 * m.total
       and (select count(*) from bills z where z.supplier = a.supplier and z.amount = a.amount and abs(z.day - a.day) <= 30) = 2
     order by a.amount desc, a.day, a.doc limit 100
  )
  select jsonb_build_object(
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('p', period, 's', supplier, 'j', series, 'c', cls, 'a', amount, 'd', docs, 'n', lines)) from (
      select period, supplier, series, cls, sum(amount) amount, count(distinct nullif(doc, '')) docs, count(*) lines
        from chosen group by period, supplier, series, cls) x), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('p', period, 't', account, 'g', category, 'c', cls, 'a', amount, 'n', lines)) from (
      select period, account, category, cls, sum(amount) amount, count(*) lines
        from chosen group by period, account, category, cls) y), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(period, src) from (select period, min(source) src from chosen group by period) z), '{}'::jsonb),
    'flags', coalesce((select jsonb_agg(f) from (
      select jsonb_build_object('k', 'large', 'd', day, 'p', period, 'doc', doc, 's', supplier, 't', account, 'a', amount, 'm', round(med::numeric, 2)) f from large
      union all
      select jsonb_build_object('k', 'double', 'd', day, 'p', period, 'doc', doc, 's', supplier, 't', account, 'a', amount, 'd2', day2, 'doc2', doc2) from doubles
    ) q), '[]'::jsonb)
  );
$$;

-- What the Expenses pages read, for every month of the company.
create or replace function public.expense_summary(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.expense_summary_of(p_company, '0000-01', '9999-12'); $$;

revoke execute on function public.begin_expense_batch(uuid, text, text[], text, jsonb) from public, anon;
revoke execute on function public.add_expense_lines(uuid, jsonb) from public, anon;
revoke execute on function private.expense_summary_of(uuid, text, text) from public, anon;
revoke execute on function public.expense_summary(uuid) from public, anon;
grant execute on function public.begin_expense_batch(uuid, text, text[], text, jsonb) to authenticated;
grant execute on function public.add_expense_lines(uuid, jsonb) to authenticated;
grant execute on function private.expense_summary_of(uuid, text, text) to authenticated;
grant execute on function public.expense_summary(uuid) to authenticated;

-- Expenses for a published report link: the same summary, for the 36 months to the report's period, without signing in.
create or replace function public.get_published_expenses(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.reports;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  return private.expense_summary_of(r.company_id, to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM'), r.period_end);
end $$;
revoke execute on function public.get_published_expenses(text) from public;
grant execute on function public.get_published_expenses(text) to anon, authenticated;
