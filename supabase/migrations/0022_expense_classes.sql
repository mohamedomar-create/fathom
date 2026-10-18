-- Expense lines follow the company's account map (fix plan 4.3, register D11). A line's class is written when it is saved;
-- a class changed later in Chart of accounts used to leave the stored lines on the old class, so a view or export reading
-- them misstated fixed and variable costs. restamp_expense_classes writes the account map's class onto the lines of each
-- coded account ("620300 Advertisement" follows the map's "#620300"); the app calls it after every reclassification.
-- Accounts the person left out ('') are not touched. The update at the end brings every company's lines in step once.
-- Safe to run again.

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
  update public.expense_lines e set cls = m.cls
    from public.account_map m
   where e.company_id = p_company and m.company_id = p_company
     and m.cls <> '' and m.key = '#' || split_part(e.account, ' ', 1) and split_part(e.account, ' ', 1) ~ '\d'
     and e.cls is distinct from m.cls;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.restamp_expense_classes(uuid) from public, anon;
grant execute on function public.restamp_expense_classes(uuid) to authenticated;

-- Once, for every company: the lines already stored take today's classes.
update public.expense_lines e set cls = m.cls
  from public.account_map m
 where m.company_id = e.company_id and m.cls <> '' and m.key = '#' || split_part(e.account, ' ', 1)
   and split_part(e.account, ' ', 1) ~ '\d' and e.cls is distinct from m.cls;
