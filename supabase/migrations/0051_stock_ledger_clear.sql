-- 0051: clearing the ledger's stock postings on the server.
--  * clear_stock_ledger(company, months) removes the stock postings an earlier General Ledger left for those months (null:
--    every month), in one call: editors only, closed months kept (0043). The browser used to delete them row by row
--    through the API, which checked each row's rights and timed out on large companies.
--  * Batches keep only the months they still hold; a batch left with none goes.
--  * stock_ledger_lines gets an index on its batch, so a batch's lines are found without reading the whole table.
-- Only adds an index and a function: safe to run again.
set client_min_messages = warning;

create index if not exists stock_ledger_lines_batch_idx on public.stock_ledger_lines (batch_id);

create or replace function public.clear_stock_ledger(p_company uuid, p_periods text[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_closed text;
  v_n integer;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_periods is not null and array_length(p_periods, 1) > 600 then raise exception 'too many months'; end if;
  select closed_through into v_closed from public.companies where id = p_company;
  delete from public.stock_ledger_lines
  where company_id = p_company
    and (p_periods is null or period = any (p_periods))
    and (v_closed is null or period > v_closed);
  get diagnostics v_n = row_count;
  -- Each batch keeps the months it still has lines for; a batch with none left goes.
  update public.stock_ledger_batches b set periods = coalesce((
      select array_agg(distinct l.period order by l.period) from public.stock_ledger_lines l where l.batch_id = b.id), '{}')
  where b.company_id = p_company
    and (p_periods is null or b.periods && p_periods);
  delete from public.stock_ledger_batches b
  where b.company_id = p_company and not exists (select 1 from public.stock_ledger_lines l where l.batch_id = b.id);
  return v_n;
end $$;
revoke execute on function public.clear_stock_ledger(uuid, text[]) from public, anon;
grant execute on function public.clear_stock_ledger(uuid, text[]) to authenticated;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 51 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
