-- 0045: the stock summary (private.inventory_wire) gains, without changing anything it already carries:
--  * uoms: products whose moves use more than one unit of measure, with the units; the pages never add their quantities
--    together and name them (their value still counts);
--  * rent: rental moves per month, product, customer and rental location (out +, back -), for units on rent vs idle,
--    utilisation, and who holds rented units.
-- Every company with stock records is marked so its summary is rebuilt with the new parts.
set client_min_messages = warning;

create or replace function private.inventory_wire(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asof text;
  v_out jsonb;
begin
  select coalesce(
           (select left(max(as_of)::text, 7) from public.stock_onhand where company_id = p_company),
           (select greatest(max(period), (select max(period) from public.stock_layers where company_id = p_company and live)) from public.stock_moves where company_id = p_company and live))
    into v_asof;
  with
  l as (select period collate "C" p, kind, code collate "C" code, product collate "C" product, category, qty, value, ref collate "C" ref
          from public.stock_layers where company_id = p_company and live),
  m as (select period collate "C" p, kind, code collate "C" code, product collate "C" product, from_loc collate "C" from_loc, to_loc collate "C" to_loc, qty, ref collate "C" ref,
                uom collate "C" uom, partner collate "C" partner
          from public.stock_moves where company_id = p_company and live),
  pk as (select code, product, max(category) category from (select code, product, category from l union all select code, product, '' from m) u group by code, product),
  px as (select code, product, category, (row_number() over (order by code, product) - 1)::int i from pk),
  la as (select l.p, l.kind, x.i, trim_scale(sum(l.qty)) q, trim_scale(sum(l.value)) v, count(*) n from l join px x on x.code = l.code and x.product = l.product group by l.p, l.kind, x.i),
  mk as (select p, kind, trim_scale(sum(qty)) q, count(*) n from m group by p, kind),
  fl as (select p, loc, trim_scale(sum(i)) i, trim_scale(sum(o)) o from (select p, to_loc loc, qty i, 0::numeric o from m union all select p, from_loc, 0, qty from m) u group by p, loc),
  pl as (select x.i, u.loc, trim_scale(sum(u.q)) q from (select code, product, to_loc loc, qty q from m where p <= v_asof union all select code, product, from_loc, -qty from m where p <= v_asof) u
           join px x on x.code = u.code and x.product = u.product group by x.i, u.loc having sum(u.q) <> 0),
  -- 0045: products whose moves use more than one unit of measure (never added together), and rental moves by customer.
  um as (select x.i, jsonb_agg(distinct m.uom order by m.uom) us from m join px x on x.code = m.code and x.product = m.product
           where m.uom <> '' group by x.i having count(distinct m.uom) > 1),
  rn as (select m.p, x.i, m.partner, case when m.kind = 'rental_out' then m.to_loc else m.from_loc end loc,
                trim_scale(sum(case when m.kind = 'rental_out' then m.qty else -m.qty end)) q
           from m join px x on x.code = m.code and x.product = m.product where m.kind in ('rental_out', 'rental_back')
          group by m.p, x.i, m.partner, case when m.kind = 'rental_out' then m.to_loc else m.from_loc end),
  rl as (select distinct to_loc loc from m where kind = 'rental_out' union select distinct from_loc from m where kind = 'rental_back'),
  rdocs as (select distinct p, ref from m where kind in ('rental_out', 'rental_back') and ref <> ''),
  br as (select p, ref, kind, trim_scale(sum(value)) v from l where ref <> '' group by p, ref, kind),
  rv as (select br.p, br.ref, trim_scale(sum(abs(br.v))) v from br join rdocs d on d.p = br.p and d.ref = br.ref group by br.p, br.ref having sum(abs(br.v)) <> 0),
  lo as (select k, max(day)::text d from (
           select case when code <> '' then '[' || code || '] ' || product else product end k, day from public.stock_moves where company_id = p_company and live and kind = 'delivery'
           union all select case when code <> '' then '[' || code || '] ' || product else product end, day from public.stock_layers where company_id = p_company and live and kind = 'delivery') u group by k),
  led as (select period p, ref, trim_scale(sum(amount)) v from public.stock_ledger_lines where company_id = p_company group by period, ref)
  select jsonb_build_object(
    'v', 3,
    'uoms', coalesce((select jsonb_agg(jsonb_build_array(i, us) order by i) from um), '[]'::jsonb),
    'rent', coalesce((select jsonb_agg(jsonb_build_array(p, i, partner, loc, q) order by p, i, partner, loc) from rn), '[]'::jsonb),
    'prods', coalesce((select jsonb_agg(jsonb_build_array(code, product, category) order by i) from px), '[]'::jsonb),
    'layers', coalesce((select jsonb_agg(jsonb_build_array(p, kind, i, q, v, n)) from la), '[]'::jsonb),
    'mk', coalesce((select jsonb_agg(jsonb_build_array(p, kind, q, n)) from mk), '[]'::jsonb),
    'flow', coalesce((select jsonb_agg(jsonb_build_array(p, loc, i, o)) from fl), '[]'::jsonb),
    'pl', coalesce((select jsonb_agg(jsonb_build_array(i, loc, q)) from pl), '[]'::jsonb),
    'asOf', case when exists (select 1 from m) then v_asof end,
    'moveMonths', coalesce((select jsonb_agg(p order by p) from (select distinct p from m) x), '[]'::jsonb),
    'rentalLocs', coalesce((select jsonb_agg(loc order by loc) from rl), '[]'::jsonb),
    'lastOut', coalesce((select jsonb_object_agg(k, d) from lo), '{}'::jsonb),
    'onhand', coalesce((select jsonb_agg(jsonb_build_array(as_of::text, product, code, location, lot, trim_scale(qty), trim_scale(value))
        order by code collate "C", product collate "C", location collate "C", lot collate "C")
      from public.stock_onhand where company_id = p_company and as_of = (select max(as_of) from public.stock_onhand where company_id = p_company)), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_array(code, name, category, trim_scale(cost), type)) from public.inventory_products where company_id = p_company), '[]'::jsonb),
    'byRef', case when exists (select 1 from led) then coalesce((select jsonb_agg(jsonb_build_array(p, ref, kind, v)) from br), '[]'::jsonb) else '[]'::jsonb end,
    'ledger', coalesce((select jsonb_agg(jsonb_build_array(p, ref, v)) from led), '[]'::jsonb),
    'rv', coalesce((select jsonb_agg(jsonb_build_array(p, ref, v)) from rv), '[]'::jsonb),
    'meta', jsonb_build_object(
      'withIds', (exists (select 1 from l) or exists (select 1 from m))
        and not exists (select 1 from public.stock_layers where company_id = p_company and live and odoo_key like 'fp:%')
        and not exists (select 1 from public.stock_moves where company_id = p_company and live and odoo_key like 'fp:%'),
      'kinds', coalesce((select jsonb_agg(distinct kind) from public.inventory_batches where company_id = p_company and status = 'done'), '[]'::jsonb),
      'periods', coalesce((select jsonb_agg(p order by p) from (select distinct p from l union select distinct p from m) q), '[]'::jsonb))
  ) into v_out;
  return v_out;
end $$;
revoke execute on function private.inventory_wire(uuid) from public, anon, authenticated;

select private.mark_inventory(c) from (
  select distinct company_id c from public.stock_layers where live
  union select distinct company_id from public.stock_moves where live
  union select distinct company_id from public.stock_onhand
  union select distinct company_id from public.inventory_products) x;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 45 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
reset client_min_messages;
