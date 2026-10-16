-- 0015: the Inventory pages read a summary kept ready by the database instead of adding up every stock record on each
-- page view. A company with tens of thousands of valuation rows and move lines took longer to add up than a page request
-- may run, so its pages came back empty.
--  1. Whenever stock records change (an upload is finished, a stock-on-hand list, products or the ledger's stock postings
--     are saved), the company is marked;
--  2. every 5 seconds (pg_cron) the background worker rebuilds the summary of marked companies (private.inventory_wire):
--     monthly totals per product and kind, the moves per month and kind, per location, and each product's net units per
--     location, in a compact form;
--  3. a page reads it in one small call (inventory_state), with whether a newer summary is being prepared.
-- Needs 0014. Adds new objects only; nothing is removed.

-- ---------------------------------------------------------------- tables
create table if not exists public.inventory_rollups (
  company_id uuid primary key references public.companies (id) on delete cascade,
  summary jsonb not null,
  -- The mark the summary was built from: a newer mark means a newer summary is due.
  built_seq bigint not null,
  built_at timestamptz not null default now()
);
alter table public.inventory_rollups enable row level security;
drop policy if exists inventory_rollups_select on public.inventory_rollups;
create policy inventory_rollups_select on public.inventory_rollups for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke insert, update, delete on public.inventory_rollups from anon, authenticated;

create sequence if not exists private.inventory_mark_seq;
-- One row per company whose stock records changed; seq takes a new number at each change.
create table if not exists private.inventory_marks (
  company_id uuid primary key references public.companies (id) on delete cascade,
  seq bigint not null,
  marked_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- marking changes
create or replace function private.mark_inventory(p_company uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  -- A company being deleted is not marked (its rows are going with it).
  insert into private.inventory_marks (company_id, seq, marked_at)
  select p_company, nextval('private.inventory_mark_seq'), now()
  where p_company is not null and exists (select 1 from public.companies c where c.id = p_company)
  on conflict (company_id) do update set seq = excluded.seq, marked_at = excluded.marked_at;
$$;

-- A valuation or moves upload goes live when its batch is finished; a stock-on-hand or products batch when it is started.
create or replace function private.mark_inventory_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_inventory(case when tg_op = 'DELETE' then old.company_id else new.company_id end);
  return null;
end $$;

-- Rows saved, changed or removed in one statement: each company they belong to is marked once.
create or replace function private.mark_inventory_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.mark_inventory(c) from (select distinct company_id c from changed) x;
  return null;
end $$;

drop trigger if exists inventory_batches_mark on public.inventory_batches;
create trigger inventory_batches_mark after insert or update or delete on public.inventory_batches
  for each row execute function private.mark_inventory_row();
drop trigger if exists stock_ledger_batches_mark on public.stock_ledger_batches;
create trigger stock_ledger_batches_mark after insert or update or delete on public.stock_ledger_batches
  for each row execute function private.mark_inventory_row();
do $$
declare t text;
begin
  foreach t in array array['stock_onhand', 'inventory_products', 'stock_ledger_lines'] loop
    execute format('drop trigger if exists %1$s_mark_ins on public.%1$s', t);
    execute format('drop trigger if exists %1$s_mark_upd on public.%1$s', t);
    execute format('drop trigger if exists %1$s_mark_del on public.%1$s', t);
    execute format('create trigger %1$s_mark_ins after insert on public.%1$s referencing new table as changed for each statement execute function private.mark_inventory_new()', t);
    execute format('create trigger %1$s_mark_upd after update on public.%1$s referencing new table as changed for each statement execute function private.mark_inventory_new()', t);
    execute format('create trigger %1$s_mark_del after delete on public.%1$s referencing old table as changed for each statement execute function private.mark_inventory_new()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- the summary
-- The same summary as summarizeInventory + toWire in src/lib (src/lib/engine/inventory.ts, src/lib/company/inventory-wire.ts):
--  prods [code, name, category]; layers [month, kind, product, qty, value, rows]; mk [month, kind, units, rows];
--  flow [month, location, units in, units out]; pl [product, location, net units up to asOf]; asOf; moveMonths; rentalLocs;
--  lastOut; onhand [as of, name, code, location, lot, qty, value]; products [code, name, category, cost, type];
--  byRef [month, document, kind, value] (only when the ledger's stock postings are loaded); ledger [month, document, value];
--  rv [month, rental document, value it carries]; meta.
-- Text is grouped byte by byte (collate "C"): the same groups, many times faster on Arabic names.
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
  m as (select period collate "C" p, kind, code collate "C" code, product collate "C" product, from_loc collate "C" from_loc, to_loc collate "C" to_loc, qty, ref collate "C" ref
          from public.stock_moves where company_id = p_company and live),
  pk as (select code, product, max(category) category from (select code, product, category from l union all select code, product, '' from m) u group by code, product),
  px as (select code, product, category, (row_number() over (order by code, product) - 1)::int i from pk),
  la as (select l.p, l.kind, x.i, trim_scale(sum(l.qty)) q, trim_scale(sum(l.value)) v, count(*) n from l join px x on x.code = l.code and x.product = l.product group by l.p, l.kind, x.i),
  mk as (select p, kind, trim_scale(sum(qty)) q, count(*) n from m group by p, kind),
  fl as (select p, loc, trim_scale(sum(i)) i, trim_scale(sum(o)) o from (select p, to_loc loc, qty i, 0::numeric o from m union all select p, from_loc, 0, qty from m) u group by p, loc),
  pl as (select x.i, u.loc, trim_scale(sum(u.q)) q from (select code, product, to_loc loc, qty q from m where p <= v_asof union all select code, product, from_loc, -qty from m where p <= v_asof) u
           join px x on x.code = u.code and x.product = u.product group by x.i, u.loc having sum(u.q) <> 0),
  rl as (select distinct to_loc loc from m where kind = 'rental_out' union select distinct from_loc from m where kind = 'rental_back'),
  rdocs as (select distinct p, ref from m where kind in ('rental_out', 'rental_back') and ref <> ''),
  br as (select p, ref, kind, trim_scale(sum(value)) v from l where ref <> '' group by p, ref, kind),
  rv as (select br.p, br.ref, trim_scale(sum(abs(br.v))) v from br join rdocs d on d.p = br.p and d.ref = br.ref group by br.p, br.ref having sum(abs(br.v)) <> 0),
  lo as (select k, max(day)::text d from (
           select case when code <> '' then '[' || code || '] ' || product else product end k, day from public.stock_moves where company_id = p_company and live and kind = 'delivery'
           union all select case when code <> '' then '[' || code || '] ' || product else product end, day from public.stock_layers where company_id = p_company and live and kind = 'delivery') u group by k),
  led as (select period p, ref, trim_scale(sum(amount)) v from public.stock_ledger_lines where company_id = p_company group by period, ref)
  select jsonb_build_object(
    'v', 2,
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

-- Rebuilds the summaries of up to p_limit marked companies (oldest mark first). A summary that cannot be built is kept as
-- its error, so the page says so instead of waiting.
create or replace function private.refresh_inventory_rollups(p_limit integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_summary jsonb;
  v_done integer := 0;
begin
  for r in
    select k.company_id, k.seq from private.inventory_marks k
      left join public.inventory_rollups x on x.company_id = k.company_id
     where x.company_id is null or x.built_seq <> k.seq
     order by k.seq limit p_limit
  loop
    begin
      v_summary := private.inventory_wire(r.company_id);
    exception when others then
      v_summary := jsonb_build_object('error', left(sqlerrm, 300));
    end;
    insert into public.inventory_rollups (company_id, summary, built_seq, built_at)
    values (r.company_id, v_summary, r.seq, now())
    on conflict (company_id) do update set summary = excluded.summary, built_seq = excluded.built_seq, built_at = excluded.built_at;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;

-- What a page reads: the summary, when it was built, and whether a newer one is due (just after an upload).
create or replace function public.inventory_state(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seq bigint;
  x public.inventory_rollups;
begin
  if not private.is_member(private.company_org(p_company)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select seq into v_seq from private.inventory_marks where company_id = p_company;
  select * into x from public.inventory_rollups where company_id = p_company;
  return jsonb_build_object(
    'summary', x.summary,
    'built_at', x.built_at,
    'pending', v_seq is not null and (x.company_id is null or x.built_seq <> v_seq));
end $$;

revoke execute on function private.mark_inventory(uuid) from public, anon, authenticated;
revoke execute on function private.inventory_wire(uuid) from public, anon, authenticated;
revoke execute on function private.refresh_inventory_rollups(integer) from public, anon, authenticated;
revoke execute on function public.inventory_state(uuid) from public, anon;
grant execute on function public.inventory_state(uuid) to authenticated;

-- Every company that already has stock records gets its first summary on the next run.
select private.mark_inventory(c) from (
  select distinct company_id c from public.stock_layers where live
  union select distinct company_id from public.stock_moves where live
  union select distinct company_id from public.stock_onhand
  union select distinct company_id from public.inventory_products) x;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ireport-inventory-rollups';
    perform cron.schedule('ireport-inventory-rollups', '5 seconds', 'select private.refresh_inventory_rollups()');
  end if;
end $$;
