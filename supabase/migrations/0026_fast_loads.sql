-- 0026: company pages load their balances in one call. Reading account_balances through the API ran the row security
-- check (two membership functions) on every row, in 1,000-row pages: a company with a few thousand balances took several
-- seconds per page. company_balances() checks membership once and returns the balances of one data version.
create or replace function public.company_balances(p_company uuid, p_version integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'viewer') then raise exception 'not allowed' using errcode = '42501'; end if;
  -- [account id, period, amount, import id] per balance
  return coalesce((
    select jsonb_agg(jsonb_build_array(b.account_id, b.period, b.amount, b.import_id) order by b.account_id, b.period)
    from public.account_balances b
    join public.source_accounts s on s.id = b.account_id
    where b.company_id = p_company and s.company_id = p_company and s.version = p_version
  ), '[]'::jsonb);
end $$;
revoke execute on function public.company_balances(uuid, integer) from public, anon;
grant execute on function public.company_balances(uuid, integer) to authenticated;
