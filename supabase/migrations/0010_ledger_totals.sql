-- 0010: what the ledger-derived sales and expense lines add up to per month, to keep them in step with the accounts
-- (after an undo or restore, months whose lines no longer tie to the P&L are cleared). Adds new objects only.
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
      select period, sum(amount) a from public.expense_lines where company_id = p_company and source = 'ledger' group by period) y), '{}'::jsonb)
  );
$$;
revoke execute on function public.ledger_line_totals(uuid) from public, anon;
grant execute on function public.ledger_line_totals(uuid) to authenticated;
