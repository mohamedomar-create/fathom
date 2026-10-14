-- 0011: goods bought for stock and cost of goods sold. A General Ledger's vendor bills on stock accounts are kept as
-- expense lines under their supplier (with the stock account's class); the summary's checks and the P&L tie-out count costs only.
-- Cost of sales from stock moves and customer invoices is grouped under 'Cost of goods sold (stock)', never a supplier.
-- Replaces two functions; no table or data changes.
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


create or replace function public.ledger_line_totals(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'sales', coalesce((select jsonb_object_agg(period, a) from (
      select period, sum(amount) a from public.sales_lines where company_id = p_company and source = 'ledger' group by period) x), '{}'::jsonb),
    'expenses', coalesce((select jsonb_object_agg(period, a) from (
      select period, sum(amount) a from public.expense_lines where company_id = p_company and source = 'ledger'
         and (cls is null or cls in ('cos_variable', 'cos_fixed', 'cos_depreciation', 'exp_variable', 'exp_fixed', 'exp_depreciation', 'other_expenses', 'interest_expenses', 'tax_expenses', 'adjustments')) group by period) y), '{}'::jsonb)
  );
$$;
