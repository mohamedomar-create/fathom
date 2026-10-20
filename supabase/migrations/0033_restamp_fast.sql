-- 0033: re-applying account classes to expense lines (restamp_expense_classes, called after an import or a class change)
-- timed out on large companies. The planner folded the per-account class lookup into the update and ran it once per
-- expense line (31k calls, 5.1 s on the bench company; ~60k lines live passed the 8 s limit) instead of once per distinct
-- account. Working the classes out first ("materialized") makes it ~150 lookups: 24 ms on the same data. Same rules,
-- same result; nothing else changes. Independent of 0032.
create or replace function public.restamp_expense_classes(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with c as materialized (select account, private.expense_class_for(p_company, account) cls
               from (select distinct account from public.expense_lines where company_id = p_company) a)
  update public.expense_lines e set cls = c.cls
    from c
   where e.company_id = p_company and e.account = c.account and c.cls is not null and e.cls is distinct from c.cls;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.restamp_expense_classes(uuid) from public, anon;
grant execute on function public.restamp_expense_classes(uuid) to authenticated;
