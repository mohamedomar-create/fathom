-- 0013: Inventory fixes found on a real company's Odoo exports. Replaces three functions and widens one check; no table,
-- column or record is removed.
--  1. A product is its internal reference AND its name: many companies put a product group in the internal reference
--     ("[Device] …"), so grouping by the reference alone merged hundreds of products.
--  2. "Replace these months" clears every month from the file's first to its last (not only the months it has rows in),
--     and a new "Replace all" mode makes the file the whole history, so nothing from an earlier upload can stay behind.
--  3. Each valuation row takes its kind from its own product's move (adjustments, scrap and returns included).

alter table public.inventory_batches drop constraint if exists inventory_batches_mode_check;
alter table public.inventory_batches add constraint inventory_batches_mode_check check (mode in ('replace', 'add', 'all'));

create or replace function public.begin_inventory_batch(p_company uuid, p_kind text, p_periods text[], p_filename text default null, p_mode text default 'replace', p_report jsonb default '{}'::jsonb)
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
  if p_kind not in ('valuation', 'moves', 'onhand', 'products') then raise exception 'unknown kind'; end if;
  if p_mode not in ('replace', 'add', 'all') then raise exception 'unknown mode'; end if;
  if p_mode = 'all' and p_kind not in ('valuation', 'moves') then raise exception 'replace all is for valuation and moves'; end if;
  if p_kind <> 'products' and (coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 240) then raise exception 'periods required'; end if;
  delete from public.inventory_batches where company_id = p_company and kind = p_kind and status = 'open';
  insert into public.inventory_batches (company_id, kind, filename, periods, mode, status, report, created_by)
  values (p_company, p_kind, left(p_filename, 300), coalesce(p_periods, '{}'), p_mode,
          case when p_kind in ('valuation', 'moves') then 'open' else 'done' end, coalesce(p_report, '{}'::jsonb), (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Finish a valuation or moves upload in one step, so the pages never see half an upload:
--  all:     every live record of this kind is replaced by the upload (the file is the whole history);
--  replace: live records of this kind from the file's first month to its last (and older copies of its records) are removed;
--  add:     staged records already live are counted as already here and dropped; mixing rows keyed by Odoo ID with
--           fingerprinted rows for the same months is refused, as it would double them.
-- Then its rows go live, and each valuation row takes its kind from its own product's move.
create or replace function public.finish_inventory_batch(p_batch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.inventory_batches;
  t text;
  v_mixed boolean;
  v_added integer;
  v_already integer := 0;
  v_first text;
  v_last text;
begin
  select * into b from public.inventory_batches where id = p_batch for update;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if b.kind not in ('valuation', 'moves') or b.status <> 'open' then raise exception 'not an open upload'; end if;
  t := case b.kind when 'valuation' then 'stock_layers' else 'stock_moves' end;
  select min(p), max(p) into v_first, v_last from unnest(b.periods) p;
  if b.mode = 'add' then
    execute format($q$select exists (select 1 from public.%1$I s join public.%1$I l on l.company_id = s.company_id and l.live and l.period = any ($2)
                        and (l.odoo_key like 'fp:%%') <> (s.odoo_key like 'fp:%%') where s.batch_id = $1)$q$, t)
      into v_mixed using b.id, b.periods;
    if v_mixed then raise exception 'KEY_MIX: these months were saved with a different kind of record key'; end if;
    execute format('delete from public.%1$I s where s.batch_id = $1 and exists (select 1 from public.%1$I l where l.company_id = s.company_id and l.live and l.odoo_key = s.odoo_key)', t)
      using b.id;
    get diagnostics v_already = row_count;
  elsif b.mode = 'all' then
    execute format('delete from public.%1$I l where l.company_id = $1 and l.live', t) using b.company_id;
  else
    execute format('delete from public.%1$I l where l.company_id = $2 and l.live and (l.period between $3 and $4 or l.odoo_key in (select s.odoo_key from public.%1$I s where s.batch_id = $1))', t)
      using b.id, b.company_id, v_first, v_last;
  end if;
  execute format('update public.%1$I set live = true where batch_id = $1', t) using b.id;
  get diagnostics v_added = row_count;
  update public.inventory_batches set status = 'done' where id = b.id;
  -- A valuation row is what its own product's move did: an adjustment, scrap, a return or a receipt or delivery.
  update public.stock_layers l set kind = m.kind
    from (select ref, code, product,
                 (array_agg(kind order by case kind when 'adjustment' then 1 when 'scrap' then 2 when 'supplier_return' then 3
                                                     when 'customer_return' then 4 when 'receipt' then 5 else 6 end))[1] kind
            from public.stock_moves
           where company_id = b.company_id and live and ref <> ''
             and kind in ('adjustment', 'scrap', 'supplier_return', 'customer_return', 'receipt', 'delivery')
           group by ref, code, product) m
   where l.company_id = b.company_id and l.live and l.ref = m.ref and l.code = m.code and l.product = m.product
     and l.kind not in ('landed_cost', 'revaluation') and l.kind <> m.kind;
  -- Earlier uploads left with no records are dropped.
  delete from public.inventory_batches x where x.company_id = b.company_id and x.kind = b.kind and x.status = 'done' and x.id <> b.id
    and not exists (select 1 from public.stock_layers l where l.batch_id = x.id)
    and not exists (select 1 from public.stock_moves m where m.batch_id = x.id);
  return jsonb_build_object('added', v_added, 'already', v_already);
end $$;

-- What the Inventory pages read: monthly totals per product (its internal reference and name), never every row.
create or replace function public.inventory_summary(p_company uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'layers', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'kind', kind, 'code', code, 'product', product, 'category', category, 'q', q, 'v', v, 'n', n)) from (
      select period, kind, code, product, max(category) category, sum(qty) q, sum(value) v, count(*) n
        from public.stock_layers where company_id = p_company and live group by period, kind, code, product) x), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'kind', kind, 'code', code, 'product', product, 'from', from_loc, 'to', to_loc, 'q', q, 'n', n)) from (
      select period, kind, code, product, from_loc, to_loc, sum(qty) q, count(*) n
        from public.stock_moves where company_id = p_company and live group by period, kind, code, product, from_loc, to_loc) y), '[]'::jsonb),
    'last_out', coalesce((select jsonb_object_agg(k, d) from (
      select k, max(day)::text d from (
        select case when code <> '' then '[' || code || '] ' || product else product end k, day from public.stock_moves where company_id = p_company and live and kind = 'delivery'
        union all select case when code <> '' then '[' || code || '] ' || product else product end, day from public.stock_layers where company_id = p_company and live and kind = 'delivery') u group by k) z), '{}'::jsonb),
    'onhand', coalesce((select jsonb_agg(jsonb_build_object('asOf', as_of::text, 'product', product, 'code', code, 'location', location, 'lot', lot, 'qty', qty, 'value', value))
      from public.stock_onhand where company_id = p_company and as_of = (select max(as_of) from public.stock_onhand where company_id = p_company)), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'category', category, 'cost', cost, 'type', type))
      from public.inventory_products where company_id = p_company), '[]'::jsonb),
    'byRef', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'ref', ref, 'kind', kind, 'v', v)) from (
      select period, ref, kind, sum(value) v from public.stock_layers where company_id = p_company and live and ref <> '' group by period, ref, kind) r), '[]'::jsonb),
    'rental', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'ref', ref)) from (
      select distinct period, ref from public.stock_moves where company_id = p_company and live and kind in ('rental_out', 'rental_back') and ref <> '') rr), '[]'::jsonb),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'ref', ref, 'v', v)) from (
      select period, ref, sum(amount) v from public.stock_ledger_lines where company_id = p_company group by period, ref) g), '[]'::jsonb),
    'meta', jsonb_build_object(
      'withIds', (exists (select 1 from public.stock_layers where company_id = p_company and live) or exists (select 1 from public.stock_moves where company_id = p_company and live))
        and not exists (select 1 from public.stock_layers where company_id = p_company and live and odoo_key like 'fp:%')
        and not exists (select 1 from public.stock_moves where company_id = p_company and live and odoo_key like 'fp:%'),
      'kinds', coalesce((select jsonb_agg(distinct kind) from public.inventory_batches where company_id = p_company and status = 'done'), '[]'::jsonb),
      'periods', coalesce((select jsonb_agg(p order by p) from (select distinct period p from public.stock_layers where company_id = p_company and live
        union select distinct period from public.stock_moves where company_id = p_company and live) q), '[]'::jsonb))
  );
$$;

revoke execute on function public.begin_inventory_batch(uuid, text, text[], text, text, jsonb) from public, anon;
revoke execute on function public.finish_inventory_batch(uuid) from public, anon;
revoke execute on function public.inventory_summary(uuid) from public, anon;
grant execute on function public.begin_inventory_batch(uuid, text, text[], text, text, jsonb) to authenticated;
grant execute on function public.finish_inventory_batch(uuid) to authenticated;
grant execute on function public.inventory_summary(uuid) to authenticated;
