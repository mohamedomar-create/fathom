-- 0030: a buying agency's own statement (each delivery's hospital, funding type and region), kept only to say which
-- hospital each Odoo invoice to the agency was for. It is not connected to sales lines, balances or receivables: its
-- values are never revenue and its collections never AR. A new upload replaces the company's statement, all or nothing.
-- end_user_summary now keeps agency invoices apart (invoice number and day) so the statement can be matched to them.
-- Adds tables and replaces one function; removes nothing. Safe to run again. Needs 0029.

create table if not exists public.agency_statement_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  filename text check (length(filename) <= 300),
  sheets text[] not null default '{}',
  report jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.agency_statement_lines (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.agency_statement_batches (id) on delete cascade,
  day date not null,
  dn text not null default '' check (length(dn) <= 80),
  ref text not null default '' check (length(ref) <= 80),
  hospital text not null check (length(hospital) between 1 and 200),
  funding text not null default '' check (length(funding) <= 120),
  region text not null default '' check (length(region) <= 60),
  value numeric not null check (abs(value) < 1e15),
  sheet text not null default '' check (length(sheet) <= 120)
);
create index if not exists agency_statement_lines_company_idx on public.agency_statement_lines (company_id, day);
alter table public.agency_statement_batches enable row level security;
alter table public.agency_statement_lines enable row level security;
drop policy if exists agency_statement_batches_select on public.agency_statement_batches;
drop policy if exists agency_statement_lines_select on public.agency_statement_lines;
create policy agency_statement_batches_select on public.agency_statement_batches for select to authenticated using (private.is_member(private.company_org(company_id)));
create policy agency_statement_lines_select on public.agency_statement_lines for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.agency_statement_batches, public.agency_statement_lines from anon;

-- Replaces the company's statement with these lines in one call (editors only). Up to 20,000 lines.
create or replace function public.save_agency_statement(p_company uuid, p_filename text, p_sheets text[], p_report jsonb, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
  v_count integer;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 20000 then raise exception 'send 1 to 20000 lines'; end if;
  delete from public.agency_statement_batches where company_id = p_company;
  insert into public.agency_statement_batches (company_id, filename, sheets, report) values (p_company, left(p_filename, 300), coalesce(p_sheets, '{}'), coalesce(p_report, '{}'::jsonb)) returning id into v_batch;
  insert into public.agency_statement_lines (company_id, batch_id, day, dn, ref, hospital, funding, region, value, sheet)
  select p_company, v_batch, (l ->> 'day')::date, left(coalesce(l ->> 'dn', ''), 80), left(coalesce(l ->> 'ref', ''), 80), left(l ->> 'hospital', 200),
         left(coalesce(l ->> 'funding', ''), 120), left(coalesce(l ->> 'region', ''), 60), (l ->> 'value')::numeric, left(coalesce(l ->> 'sheet', ''), 120)
    from jsonb_array_elements(p_lines) l
   where nullif(l ->> 'hospital', '') is not null and l ->> 'day' ~ '^\d{4}-\d{2}-\d{2}$' and (l ->> 'value') is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.remove_agency_statement(p_company uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.agency_statement_batches where company_id = p_company;
end $$;

-- The end-user page in one call: agency sales by invoice (number, first day), end user, method and category; the
-- company's choices; and its agency statement.
create or replace function public.end_user_summary(p_company uuid)
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
    return jsonb_build_object('rows', '[]'::jsonb, 'map', '[]'::jsonb, 'statement', '[]'::jsonb);
  end if;
  with file_months as (select distinct period from public.sales_lines where company_id = p_company and source = 'file'),
  chosen as materialized (
    select l.period, l.day, l.doc, l.customer, l.end_user, l.map_method, l.category, l.note, l.amount, l.qty from public.sales_lines l
     where l.company_id = p_company and (l.source = 'file' or l.period not in (select period from file_months))
  ),
  candidates as (
    select distinct customer from chosen where end_user is not null
    union select key from public.end_user_map where company_id = p_company and kind = 'agency'
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'd', doc, 'day', day, 'c', customer, 'u', coalesce(end_user, ''), 'm', coalesce(map_method, ''), 'g', category, 'o', o, 'a', amount, 'q', qty, 'n', lines)) from (
      select period, doc, min(day) as day, customer, end_user, map_method, category, case when end_user is null then coalesce(note, '') else '' end o,
             sum(amount) amount, coalesce(sum(qty), 0) qty, count(*) lines
        from chosen where customer in (select customer from candidates)
       group by period, doc, customer, end_user, map_method, category, 8) x), '[]'::jsonb),
    'map', coalesce((select jsonb_agg(jsonb_build_object('k', kind, 'key', key, 'h', hospital)) from public.end_user_map where company_id = p_company), '[]'::jsonb),
    'statement', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'dn', dn, 'ref', ref, 'h', hospital, 'f', funding, 'r', region, 'v', value, 's', sheet) order by day, id)
      from public.agency_statement_lines where company_id = p_company), '[]'::jsonb),
    'statementFile', (select jsonb_build_object('filename', filename, 'sheets', sheets, 'at', created_at, 'report', report) from public.agency_statement_batches where company_id = p_company order by created_at desc limit 1)
  ) into v;
  return v;
end $$;

revoke execute on function public.save_agency_statement(uuid, text, text[], jsonb, jsonb) from public, anon;
revoke execute on function public.remove_agency_statement(uuid) from public, anon;
revoke execute on function public.end_user_summary(uuid) from public, anon;
grant execute on function public.save_agency_statement(uuid, text, text[], jsonb, jsonb) to authenticated;
grant execute on function public.remove_agency_statement(uuid) to authenticated;
grant execute on function public.end_user_summary(uuid) to authenticated;
