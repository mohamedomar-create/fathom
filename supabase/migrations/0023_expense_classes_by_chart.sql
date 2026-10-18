-- Expense lines follow the Chart of accounts too (register D11, after 0022). Lines saved from a purchases file can hold the
-- account name only ("Advertisement"), with no code, so 0022's match on the account map's codes never reached them. A line's
-- class now comes from, in order:
--   1. the account map, by code ("620300 Advertisement" follows "#620300"), as in 0022;
--   2. the current Chart of accounts, by code, when the line starts with one;
--   3. the current Chart of accounts, by exact name (trimmed, any case), only when no other account in it has that name.
-- Classes the person left out ('') and lines no rule reaches are not touched. The update at the end brings every company's
-- lines in step once. Run after 0022. Safe to run again.

create or replace function private.expense_class_for(p_company uuid, p_account text)
returns text
language sql
stable
set search_path = ''
as $$
  with code as (select split_part(p_account, ' ', 1) c),
       chart as (select s.code, s.name, s.class from public.source_accounts s join public.companies co on co.id = s.company_id
                 where s.company_id = p_company and s.version = co.data_version and s.class <> '')
  select coalesce(
    (select m.cls from public.account_map m, code where m.company_id = p_company and m.cls <> '' and code.c ~ '\d' and m.key = '#' || code.c),
    (select min(ch.class) from chart ch, code where code.c ~ '\d' and ch.code = code.c having count(distinct ch.class) = 1),
    (select min(ch.class) from chart ch where lower(trim(ch.name)) = lower(trim(p_account)) having count(*) = 1)
  )
$$;
revoke all on function private.expense_class_for(uuid, text) from public, anon, authenticated;

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
  with c as (select account, private.expense_class_for(p_company, account) cls
               from (select distinct account from public.expense_lines where company_id = p_company) a)
  update public.expense_lines e set cls = c.cls
    from c
   where e.company_id = p_company and e.account = c.account and c.cls is not null and e.cls is distinct from c.cls;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.restamp_expense_classes(uuid) from public, anon;
grant execute on function public.restamp_expense_classes(uuid) to authenticated;

-- Once, for every company.
with c as (select company_id, account, private.expense_class_for(company_id, account) cls
             from (select distinct company_id, account from public.expense_lines) a)
update public.expense_lines e set cls = c.cls
  from c
 where e.company_id = c.company_id and e.account = c.account and c.cls is not null and e.cls is distinct from c.cls;
