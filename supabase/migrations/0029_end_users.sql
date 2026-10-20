-- 0029: the end user behind sales billed to a buying agency (e.g. Egypt's Unified Procurement Authority, which is
-- invoiced for goods each hospital ordered). Each sales line keeps its sales order and, when Odoo records one, who the
-- goods were for and how that was found (order / contact / shipping); a line with no link keeps its description, where
-- an agency order number may be read. A company's own choices (one hospital for two spellings, an agency order number's
-- hospital, which customers are agencies) live in end_user_map. Adds columns, a table and two functions; removes nothing.
-- Safe to run again. Needs 0008 and 0019.

alter table public.sales_lines add column if not exists sale_order text check (length(sale_order) <= 80);
alter table public.sales_lines add column if not exists end_user text check (length(end_user) <= 200);
alter table public.sales_lines add column if not exists map_method text check (map_method in ('order', 'contact', 'shipping'));
alter table public.sales_lines add column if not exists note text check (length(note) <= 200);

create or replace function public.add_sales_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.sales_batches;
  v_count integer;
begin
  select * into b from public.sales_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  insert into public.sales_lines (company_id, batch_id, source, day, period, doc, series, customer, product, category, salesperson, qty, amount, cost,
                                  sale_order, end_user, map_method, note)
  select b.company_id, b.id, b.source, nullif(l ->> 'day', '')::date, l ->> 'period',
         left(coalesce(l ->> 'doc', ''), 80), left(coalesce(l ->> 'series', ''), 40), left(coalesce(l ->> 'customer', ''), 200),
         left(coalesce(l ->> 'product', ''), 300), left(coalesce(l ->> 'category', ''), 200), left(coalesce(l ->> 'salesperson', ''), 120),
         nullif(l ->> 'qty', '')::numeric, (l ->> 'amount')::numeric, nullif(l ->> 'cost', '')::numeric,
         nullif(left(l ->> 'saleOrder', 80), ''), nullif(left(l ->> 'endUser', 200), ''),
         case when l ->> 'mapMethod' in ('order', 'contact', 'shipping') and nullif(l ->> 'endUser', '') is not null then l ->> 'mapMethod' end,
         nullif(left(l ->> 'note', 200), '')
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.add_sales_lines(uuid, jsonb) from public, anon;
grant execute on function public.add_sales_lines(uuid, jsonb) to authenticated;

-- A company's own end-user choices: 'alias' (a hospital key → the hospital it is), 'order' (an agency order number →
-- hospital), 'agency' / 'not_agency' (a customer the company marks as an agency, or as not one).
create table if not exists public.end_user_map (
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('alias', 'order', 'agency', 'not_agency')),
  key text not null check (length(key) between 1 and 200),
  hospital text not null default '' check (length(hospital) <= 200),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind, key)
);
alter table public.end_user_map enable row level security;
drop policy if exists end_user_map_select on public.end_user_map;
drop policy if exists end_user_map_insert on public.end_user_map;
drop policy if exists end_user_map_update on public.end_user_map;
drop policy if exists end_user_map_delete on public.end_user_map;
create policy end_user_map_select on public.end_user_map for select to authenticated using (private.is_member(private.company_org(company_id)));
create policy end_user_map_insert on public.end_user_map for insert to authenticated with check (private.is_member(private.company_org(company_id), 'editor'));
create policy end_user_map_update on public.end_user_map for update to authenticated
  using (private.is_member(private.company_org(company_id), 'editor')) with check (private.is_member(private.company_org(company_id), 'editor'));
create policy end_user_map_delete on public.end_user_map for delete to authenticated using (private.is_member(private.company_org(company_id), 'editor'));
revoke all on public.end_user_map from anon;
drop trigger if exists end_user_map_touch on public.end_user_map;
create trigger end_user_map_touch before insert or update on public.end_user_map for each row execute function private.account_map_touch();

-- What the end-user page reads, in one call: the lines the sales pages use (a sales file wins its months, as in
-- sales_summary), for customers that have any linked end user or that the company marks as an agency, added up by month,
-- customer, end user, method and category; unlinked lines are kept apart by description. Plus the company's choices.
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
    return jsonb_build_object('rows', '[]'::jsonb, 'map', '[]'::jsonb);
  end if;
  with file_months as (select distinct period from public.sales_lines where company_id = p_company and source = 'file'),
  chosen as materialized (
    select l.period, l.customer, l.end_user, l.map_method, l.category, l.note, l.amount, l.qty from public.sales_lines l
     where l.company_id = p_company and (l.source = 'file' or l.period not in (select period from file_months))
  ),
  candidates as (
    select distinct customer from chosen where end_user is not null
    union select key from public.end_user_map where company_id = p_company and kind = 'agency'
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'c', customer, 'u', coalesce(end_user, ''), 'm', coalesce(map_method, ''), 'g', category, 'o', o, 'a', amount, 'q', qty, 'n', lines)) from (
      select period, customer, end_user, map_method, category, case when end_user is null then coalesce(note, '') else '' end o,
             sum(amount) amount, coalesce(sum(qty), 0) qty, count(*) lines
        from chosen where customer in (select customer from candidates)
       group by 1, 2, 3, 4, 5, 6) x), '[]'::jsonb),
    'map', coalesce((select jsonb_agg(jsonb_build_object('k', kind, 'key', key, 'h', hospital)) from public.end_user_map where company_id = p_company), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke execute on function public.end_user_summary(uuid) from public, anon;
grant execute on function public.end_user_summary(uuid) to authenticated;
