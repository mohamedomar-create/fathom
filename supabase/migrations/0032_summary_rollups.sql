-- 0032: the Sales, Expenses and Payments pages read summaries the database keeps ready, instead of adding up every line on
-- each page view. On a company with 60k expense lines one summary took ~3 s; several pages asking at once went past the
-- 8 s limit for signed-in calls and failed (SQLSTATE 57014). Same pattern as the stock summaries (0015):
--  1. any change to sales, expense or payment lines (upload, undo, clearing a module, a class restamp) marks the company;
--  2. every 5 seconds the background worker rebuilds marked summaries once the changes have settled for 3 seconds, one at a
--     time, with the same calculation as the existing summary functions (copied below without the membership check, which
--     the reading function makes instead). A summary that cannot be built keeps its last good copy and records the error;
--  3. a page reads one row (summary_state): the summary, when it was built, whether a newer one is due, and any error.
-- Adds new objects only: sales_summary, expense_summary, expense_summary_of and payments_summary are unchanged, so the
-- previous app version keeps working. Undo: supabase/rollback/0032_summary_rollups_down.sql.

-- ---------------------------------------------------------------- tables
create table if not exists public.summary_rollups (
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('sales', 'expenses', 'payments')),
  summary jsonb,                       -- the last summary built without error
  built_seq bigint,                    -- the mark it was built from
  built_at timestamptz,
  error text,                          -- the last failure, kept until a later build succeeds
  error_seq bigint,
  error_at timestamptz,
  primary key (company_id, kind)
);
alter table public.summary_rollups enable row level security;
drop policy if exists summary_rollups_select on public.summary_rollups;
create policy summary_rollups_select on public.summary_rollups for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke insert, update, delete on public.summary_rollups from anon, authenticated;
revoke all on public.summary_rollups from anon;

create sequence if not exists private.summary_mark_seq;
create table if not exists private.summary_marks (
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('sales', 'expenses', 'payments')),
  seq bigint not null,
  marked_at timestamptz not null default now(),
  primary key (company_id, kind)
);

-- ---------------------------------------------------------------- marking changes
create or replace function private.mark_summary(p_company uuid, p_kind text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- A company being deleted is not marked (its rows are going with it).
  insert into private.summary_marks (company_id, kind, seq, marked_at)
  select p_company, p_kind, nextval('private.summary_mark_seq'), now()
  where p_company is not null and exists (select 1 from public.companies c where c.id = p_company)
  on conflict (company_id, kind) do update set seq = excluded.seq, marked_at = excluded.marked_at;
$$;

-- Rows saved, changed or removed in one statement: each company they belong to is marked once for the trigger's kind.
create or replace function private.mark_summary_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_summary(c, tg_argv[0]) from (select distinct company_id c from changed) x;
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values ('sales_lines', 'sales'), ('expense_lines', 'expenses'), ('payment_lines', 'payments'),
                                 ('payment_batches', 'payments'), ('aged_reports', 'payments'), ('aged_items', 'payments')) v(t, k) loop
    execute format('drop trigger if exists %1$s_summary_ins on public.%1$s', r.t);
    execute format('drop trigger if exists %1$s_summary_upd on public.%1$s', r.t);
    execute format('drop trigger if exists %1$s_summary_del on public.%1$s', r.t);
    execute format('create trigger %1$s_summary_ins after insert on public.%1$s referencing new table as changed for each statement execute function private.mark_summary_rows(%2$L)', r.t, r.k);
    execute format('create trigger %1$s_summary_upd after update on public.%1$s referencing new table as changed for each statement execute function private.mark_summary_rows(%2$L)', r.t, r.k);
    execute format('create trigger %1$s_summary_del after delete on public.%1$s referencing old table as changed for each statement execute function private.mark_summary_rows(%2$L)', r.t, r.k);
  end loop;
end $$;

-- ---------------------------------------------------------------- the calculations (copies of the live summary bodies)
-- Byte-for-byte the bodies of private.expense_summary_of (0019), public.sales_summary (0019) and public.payments_summary
-- (0028) without their membership check. supabase/tests/summary_rollups.sql checks the outputs stay identical.
CREATE OR REPLACE FUNCTION private.expense_summary_calc(p_company uuid, p_from text, p_to text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  -- Where a bills file and the ledger both hold a month, the file wins: the file's months worked out once, never per line
  -- (a page opened straight after an upload, before the table's statistics are refreshed, must not slow down).
  with file_months as (
    select distinct period from public.expense_lines where company_id = p_company and source = 'file' and period between p_from and p_to
  ),
  chosen as materialized (
    select l.* from public.expense_lines l
     where l.company_id = p_company and l.period between p_from and p_to
       and (l.source = 'file' or l.period not in (select period from file_months))
  ),
  -- Costs only: goods bought for stock (a stock account's class) count under their supplier, never in costs or the checks on them.
  costs as (select * from chosen where cls is null or cls in ('cos_variable', 'cos_fixed', 'cos_depreciation', 'exp_variable', 'exp_fixed', 'exp_depreciation', 'other_expenses', 'interest_expenses', 'tax_expenses', 'adjustments')),
  month_total as (select period, sum(amount) total from costs group by period),
  acct_month as (
    select account, period, sum(amount) a from costs where coalesce(cls, '') not in ('cos_depreciation', 'exp_depreciation') group by account, period
  ),
  typical as (
    select account, percentile_cont(0.5) within group (order by a) med, count(*) n from acct_month where a > 0 group by account
  ),
  large as (
    select c.day, c.period, c.doc, c.supplier, c.account, c.amount, t.med
      from costs c join typical t on t.account = c.account join month_total m on m.period = c.period
     where t.n >= 4 and c.amount > 2 * t.med and c.amount >= 0.02 * m.total
       and coalesce(c.cls, '') not in ('cos_depreciation', 'exp_depreciation')
     order by c.amount desc, c.day, c.doc limit 100
  ),
  bills as (
    select * from chosen
     where day is not null and amount > 0 and supplier not in ('', 'No supplier', 'Journal entries', 'Depreciation (no payment)', 'Cost of goods sold (stock)', 'Customer invoices (no supplier)')
       and coalesce(cls, '') not in ('cos_depreciation', 'exp_depreciation')
       and (source = 'file' or doc ~* '^R?BILL[/-]')
  ),
  near as (
    select b.*, count(*) over (partition by supplier, amount order by day range between interval '30 days' preceding and interval '30 days' following) n30
      from bills b
  ),
  doubles as (
    select a.day, a.period, a.doc, a.supplier, a.account, a.amount, b.day day2, b.doc doc2
      from near a join bills b on b.supplier = a.supplier and b.amount = a.amount and b.id > a.id
       and abs(b.day - a.day) <= 7 and (a.doc is distinct from b.doc or a.doc = '')
      join month_total m on m.period = a.period
     where a.n30 = 2 and a.amount >= 0.0005 * m.total
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
  ) into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION private.sales_summary_calc(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  with file_months as (select distinct period from public.sales_lines where company_id = p_company and source = 'file'),
  chosen as materialized (
    select l.* from public.sales_lines l
     where l.company_id = p_company and (l.source = 'file' or l.period not in (select period from file_months))
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
  ) into v;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION private.payments_summary_calc(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return jsonb_build_object(
    'aged', coalesce((
      select jsonb_object_agg(r.side, jsonb_build_object('as_of', r.as_of, 'buckets', to_jsonb(r.buckets), 'total', r.totals, 'findings', r.findings, 'filename', r.filename,
        'items', coalesce((select jsonb_agg(jsonb_build_array(i.partner, i.ref, i.memo, i.day, to_jsonb(i.amounts), i.total) order by i.id) from public.aged_items i where i.report_id = r.id), '[]'::jsonb)))
      from (select distinct on (side) * from public.aged_reports where company_id = p_company order by side, as_of desc) r
    ), '{}'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_array(l.day, l.number, l.journal, l.method, l.partner, l.amount, l.currency, l.amount_currency, l.state, l.kind, l.counter, b.source) order by l.day, l.id)
      from public.payment_lines l join public.payment_batches b on b.id = l.batch_id where l.company_id = p_company
    ), '[]'::jsonb)
  );
end $function$;

-- ---------------------------------------------------------------- rebuilding
create or replace function private.build_summary(p_company uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return case p_kind
    when 'sales' then private.sales_summary_calc(p_company)
    when 'expenses' then private.expense_summary_calc(p_company, '0000-01', '9999-12')
    when 'payments' then private.payments_summary_calc(p_company)
  end;
end $$;

-- Rebuilds up to p_limit marked summaries, oldest mark first, once their changes have settled (an upload still sending
-- chunks keeps re-marking). One worker at a time; a failure is retried after 10 minutes or on the next change.
create or replace function private.refresh_summary_rollups(p_limit integer default 3)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v jsonb;
  v_done integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('private.refresh_summary_rollups')) then return 0; end if;
  for r in
    select k.company_id, k.kind, k.seq from private.summary_marks k
      left join public.summary_rollups x on x.company_id = k.company_id and x.kind = k.kind
     where (x.company_id is null or x.built_seq is distinct from k.seq)
       and (x.error_seq is distinct from k.seq or x.error_at < now() - interval '10 minutes')
       and k.marked_at < now() - interval '3 seconds'
     order by k.seq limit p_limit
  loop
    begin
      v := private.build_summary(r.company_id, r.kind);
      insert into public.summary_rollups (company_id, kind, summary, built_seq, built_at, error, error_seq, error_at)
      values (r.company_id, r.kind, v, r.seq, now(), null, null, null)
      on conflict (company_id, kind) do update set summary = excluded.summary, built_seq = excluded.built_seq, built_at = excluded.built_at,
        error = null, error_seq = null, error_at = null;
    exception when others then
      insert into public.summary_rollups (company_id, kind, error, error_seq, error_at)
      values (r.company_id, r.kind, left(sqlstate || ' ' || sqlerrm, 300), r.seq, now())
      on conflict (company_id, kind) do update set error = excluded.error, error_seq = excluded.error_seq, error_at = excluded.error_at;
    end;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

-- What a page reads. Not a member: refused (never an empty summary that would read as "no sales").
--  status: ready (built from the latest change), pending (a newer one is being prepared; summary is the previous one, if
--  any), failed (the latest build failed; summary is the last good one, if any), empty (nothing was ever recorded).
create or replace function public.summary_state(p_company uuid, p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k private.summary_marks;
  x public.summary_rollups;
begin
  if p_kind not in ('sales', 'expenses', 'payments') then raise exception 'unknown summary' using errcode = '22023'; end if;
  if not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into k from private.summary_marks where company_id = p_company and kind = p_kind;
  select * into x from public.summary_rollups where company_id = p_company and kind = p_kind;
  return jsonb_build_object(
    'status', case
      when k.company_id is null and x.company_id is null then 'empty'
      when x.error_seq is not null and x.error_seq = k.seq then 'failed'
      when x.built_seq is not distinct from k.seq and x.summary is not null then 'ready'
      else 'pending' end,
    'summary', x.summary,
    'built_at', x.built_at,
    'built_seq', x.built_seq,
    'error', case when x.error_seq is not null and x.error_seq = k.seq then x.error end);
end $$;

revoke execute on function private.mark_summary(uuid, text) from public, anon, authenticated;
revoke execute on function private.mark_summary_rows() from public, anon, authenticated;
revoke execute on function private.sales_summary_calc(uuid) from public, anon, authenticated;
revoke execute on function private.expense_summary_calc(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.payments_summary_calc(uuid) from public, anon, authenticated;
revoke execute on function private.build_summary(uuid, text) from public, anon, authenticated;
revoke execute on function private.refresh_summary_rollups(integer) from public, anon, authenticated;
revoke execute on function public.summary_state(uuid, text) from public, anon;
grant execute on function public.summary_state(uuid, text) to authenticated;
grant select on public.summary_rollups to authenticated;

-- Every company that already has lines gets its summaries on the next runs.
do $$
begin
  perform private.mark_summary(c, 'sales') from (select distinct company_id c from public.sales_lines) x;
  perform private.mark_summary(c, 'expenses') from (select distinct company_id c from public.expense_lines) x;
  perform private.mark_summary(c, 'payments') from (select distinct company_id c from public.payment_lines union select distinct company_id from public.aged_reports) x;
  -- Marked in the past, so the first run does not wait for the settle time.
  update private.summary_marks set marked_at = now() - interval '1 minute';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ireport-summary-rollups';
    perform cron.schedule('ireport-summary-rollups', '5 seconds', 'select private.refresh_summary_rollups()');
  end if;
end $$;
