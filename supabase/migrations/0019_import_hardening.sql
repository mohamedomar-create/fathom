-- Uploads that never stall, and summaries that answer on a large company.
--
-- 1. Sending rows: a batch no longer locks the job row (three batches used to queue behind each other until the database
--    cut them off at its 8-second limit). The job's "last activity" is touched at most every 10 seconds, skipping the row
--    when another batch holds it.
-- 2. import_held: which rows of a file the database already holds, so an upload that stopped sends only the rest.
-- 3. The background worker closes an upload idle for 30 minutes (was 24 hours) and clears its rows, and fails a check or a
--    save the database cut off (it used to stay "checking" for ever, or be tried again on every run), keeping its rows for
--    "Try again".
-- 3b. Saving stock: the check that record keys do not mix no longer compares every new row with every saved one, and the
--    stock tables' statistics are refreshed once a batch is live (a second company's history took 8 minutes to save, and
--    "Add only new" over 20).
-- 4. The Expenses and Sales summaries check membership once instead of on every line, and the duplicate-bill check no
--    longer compares every pair of bills (28 seconds on a company with 31,000 lines; the pages could not load).
-- Safe to run again.

-- ---------------------------------------------------------------- 1. sending rows
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
  -- Still sending: at most every 10 seconds, and never waiting for another batch that is touching it.
  update public.import_jobs set updated_at = now()
   where id = (select j.id from public.import_jobs j where j.id = f.job_id and j.updated_at < now() - interval '10 seconds' for no key update skip locked);
  return v_count;
end $$;

-- ---------------------------------------------------------------- 2. the rows a file already holds, as [from, to] ranges
create or replace function public.import_held(p_file uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.import_files;
begin
  select * into f from public.import_files where id = p_file;
  if not found or not private.is_member(private.company_org(f.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(lo, hi) order by lo) from (
      select min(n) lo, max(n) hi from (select n, n - row_number() over (order by n) g from public.import_rows where file_id = p_file) x group by g
    ) y), '[]'::jsonb);
end $$;
revoke execute on function public.import_held(uuid) from public, anon;
grant execute on function public.import_held(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. the background worker
create or replace procedure private.run_import_jobs()
language plpgsql
as $$
declare
  v_id uuid;
  v_status text;
  k integer := 0;
begin
  perform set_config('statement_timeout', '600000', false);
  -- An upload no page has sent to for 30 minutes stopped: closed, and its rows cleared (a row being sent is skipped).
  update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
         message = 'The upload stopped before every row was sent. Choose the files again.'
   where id in (select id from public.import_jobs where status = 'preparing' and updated_at < now() - interval '30 minutes' for update skip locked);
  -- A check the database cut off (longer than its 10-minute limit) is failed with its rows kept, so it can be tried again.
  update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
         message = 'The check took too long for the database. Press “Try again”, or upload fewer months at a time.'
   where id in (select id from public.import_jobs where status = 'checking' and updated_at < now() - interval '15 minutes' for update skip locked);
  -- The same for a save (it would otherwise be picked up again on every run, for ever).
  update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
         message = 'The save took too long for the database. Press “Try again”, or upload fewer months at a time.'
   where id in (select id from public.import_jobs where status = 'saving' and updated_at < now() - interval '15 minutes' for update skip locked);
  delete from public.import_rows r using public.import_jobs j
   where r.job_id = j.id and (j.status = 'cancelled'
      or (j.status = 'failed' and j.queued_at is null)
      or (j.status in ('done', 'failed', 'needs_review') and j.updated_at < now() - interval '30 days'));
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
revoke execute on procedure private.run_import_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3b. saving stock on a database that already holds another company's
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
    -- Two kinds of record key never mix in the same months: four quick lookups (comparing every new row with every saved
    -- one took minutes on a full history).
    execute format($q$select (exists (select 1 from public.%1$I s where s.batch_id = $1 and s.odoo_key like 'fp:%%')
                          and exists (select 1 from public.%1$I l where l.company_id = $3 and l.live and l.period = any ($2) and l.odoo_key not like 'fp:%%'))
                      or (exists (select 1 from public.%1$I s where s.batch_id = $1 and s.odoo_key not like 'fp:%%')
                          and exists (select 1 from public.%1$I l where l.company_id = $3 and l.live and l.period = any ($2) and l.odoo_key like 'fp:%%'))$q$, t)
      into v_mixed using b.id, b.periods, b.company_id;
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
  -- The table's statistics are brought up to date before the queries below: a company saved after another one (whose rows
  -- the statistics still describe alone) otherwise got a plan comparing every layer with every move (8 minutes).
  execute format('analyze public.%I', t);
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

-- ---------------------------------------------------------------- 4. summaries
-- Expenses: the membership check once (an outsider gets an empty summary, as before), then the company's lines read
-- directly. A double payment is two bills of the same supplier and amount within 7 days, when those two are the only
-- such bills within 30 days: counted with a window over (supplier, amount), never by comparing every pair.
create or replace function private.expense_summary_of(p_company uuid, p_from text, p_to text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not private.is_member(private.company_org(p_company)) then
    return jsonb_build_object('suppliers', '[]'::jsonb, 'accounts', '[]'::jsonb, 'sources', '{}'::jsonb, 'flags', '[]'::jsonb);
  end if;
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
end $$;
revoke execute on function private.expense_summary_of(uuid, text, text) from public, anon;
grant execute on function private.expense_summary_of(uuid, text, text) to authenticated;

-- Sales: the same single membership check.
create or replace function public.sales_summary(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not private.is_member(private.company_org(p_company)) then
    return jsonb_build_object('customers', '[]'::jsonb, 'products', '[]'::jsonb, 'sources', '{}'::jsonb);
  end if;
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
end $$;
revoke execute on function public.sales_summary(uuid) from public, anon;
grant execute on function public.sales_summary(uuid) to authenticated;
