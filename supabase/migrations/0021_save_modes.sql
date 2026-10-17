-- Saving sales and expense lines again, four ways (spec R2.2), so a corrected file never needs a trip to Data health:
--   Replace all          every month of this source goes, then the file is saved;
--   Replace these months  the file's months are replaced (as before);
--   Add only new          only months not loaded yet (as before, decided in the browser);
--   Add new and changed   new months added, months whose lines differ replaced, identical months left alone.
-- line_months gives each loaded month's line count and fingerprint (a SHA-256 of its line hashes, sorted), built exactly
-- as the browser builds it from a file (src/lib/company/month-print.ts).
-- Safe to run again.

drop function if exists public.begin_sales_batch(uuid, text, text[], text, jsonb);
create or replace function public.begin_sales_batch(p_company uuid, p_source text, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb, p_all boolean default false)
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
  if p_all then
    delete from public.sales_lines where company_id = p_company and source = p_source;
    delete from public.sales_batches where company_id = p_company and source = p_source;
  else
    delete from public.sales_lines where company_id = p_company and source = p_source and period = any (p_periods);
  end if;
  insert into public.sales_batches (company_id, source, filename, periods, report, created_by)
  values (p_company, p_source, left(p_filename, 300), p_periods, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

drop function if exists public.begin_expense_batch(uuid, text, text[], text, jsonb);
create or replace function public.begin_expense_batch(p_company uuid, p_source text, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb, p_all boolean default false)
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
  if p_all then
    delete from public.expense_lines where company_id = p_company and source = p_source;
    delete from public.expense_batches where company_id = p_company and source = p_source;
  else
    delete from public.expense_lines where company_id = p_company and source = p_source and period = any (p_periods);
  end if;
  insert into public.expense_batches (company_id, source, filename, periods, report, created_by)
  values (p_company, p_source, left(p_filename, 300), p_periods, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Each loaded month of a source: how many lines, and their fingerprint. {"2026-01": {"n": 2, "print": "e3c2…"}, …}
create or replace function public.line_months(p_company uuid, p_kind text, p_source text)
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
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind = 'sales' then
    select coalesce(jsonb_object_agg(period, jsonb_build_object('n', n, 'print', print)), '{}'::jsonb) into v from (
      select period, count(*) n, encode(sha256(convert_to(string_agg(h, '' order by h collate "C"), 'UTF8')), 'hex') print
      from (select period, encode(sha256(convert_to(
              coalesce(day::text, '') || chr(31) || doc || chr(31) || customer || chr(31) || product || chr(31) || round(amount * 100)::bigint::text
              || chr(31) || coalesce(round(qty * 10000)::bigint::text, '') || chr(31) || coalesce(round(cost * 100)::bigint::text, ''), 'UTF8')), 'hex') h
            from public.sales_lines where company_id = p_company and source = p_source) l
      group by period) m;
  elsif p_kind = 'expenses' then
    select coalesce(jsonb_object_agg(period, jsonb_build_object('n', n, 'print', print)), '{}'::jsonb) into v from (
      select period, count(*) n, encode(sha256(convert_to(string_agg(h, '' order by h collate "C"), 'UTF8')), 'hex') print
      from (select period, encode(sha256(convert_to(
              coalesce(day::text, '') || chr(31) || doc || chr(31) || supplier || chr(31) || account || chr(31) || label || chr(31) || round(amount * 100)::bigint::text, 'UTF8')), 'hex') h
            from public.expense_lines where company_id = p_company and source = p_source) l
      group by period) m;
  else
    raise exception 'unknown kind';
  end if;
  return v;
end $$;

revoke execute on function public.begin_sales_batch(uuid, text, text[], text, jsonb, boolean) from public, anon;
revoke execute on function public.begin_expense_batch(uuid, text, text[], text, jsonb, boolean) from public, anon;
revoke execute on function public.line_months(uuid, text, text) from public, anon;
grant execute on function public.begin_sales_batch(uuid, text, text[], text, jsonb, boolean) to authenticated;
grant execute on function public.begin_expense_batch(uuid, text, text[], text, jsonb, boolean) to authenticated;
grant execute on function public.line_months(uuid, text, text) to authenticated;
