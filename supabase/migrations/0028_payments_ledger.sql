-- 0028: payments from the General Ledger. Every bank and cash entry of a ledger upload is saved as a payment, with its
-- kind (customers, suppliers, transfer between own accounts, other) and the class on the other side. Ledger and file
-- payments are kept apart by source: each upload replaces only its own source's months. Adds columns, replaces two
-- functions; nothing is removed and existing payments stay as they are (source 'file').

alter table public.payment_batches add column if not exists source text not null default 'file';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_batches_source_check') then
    alter table public.payment_batches add constraint payment_batches_source_check check (source in ('file', 'ledger'));
  end if;
end $$;
alter table public.payment_lines add column if not exists kind text not null default '';
alter table public.payment_lines add column if not exists counter text not null default '';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_lines_kind_check') then
    alter table public.payment_lines add constraint payment_lines_kind_check check (kind in ('', 'customers', 'suppliers', 'transfer', 'other'));
  end if;
end $$;

-- Start a payments batch for one source: that source's payments for these months are replaced by the lines added next.
drop function if exists public.begin_payment_batch(uuid, text[], text, jsonb);
create or replace function public.begin_payment_batch(p_company uuid, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb, p_source text default 'file')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_source not in ('file', 'ledger') then raise exception 'unknown source'; end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 240 then raise exception 'periods required'; end if;
  delete from public.payment_lines l using public.payment_batches pb
   where pb.id = l.batch_id and pb.company_id = p_company and pb.source = p_source and l.period = any (p_periods);
  delete from public.payment_batches pb where pb.company_id = p_company and pb.source = p_source and not exists (select 1 from public.payment_lines l where l.batch_id = pb.id);
  insert into public.payment_batches (company_id, filename, periods, report, source, created_by)
  values (p_company, left(p_filename, 300), p_periods, coalesce(p_report, '{}'::jsonb), p_source, (select auth.uid()))
  returning id into v_batch;
  return v_batch;
end $$;

-- Add up to 5,000 payments to a batch (the kind and other side when the ledger gives them); outside its months refused.
create or replace function public.add_payment_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.payment_batches;
  v_count integer;
begin
  select * into b from public.payment_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send up to 5000 lines'; end if;
  insert into public.payment_lines (company_id, batch_id, day, period, number, journal, method, partner, direction, amount, currency, amount_currency, state, kind, counter)
  select b.company_id, b.id, (l ->> 'day')::date, l ->> 'period', left(coalesce(l ->> 'number', ''), 80), left(coalesce(l ->> 'journal', ''), 120),
         left(coalesce(l ->> 'method', ''), 120), left(coalesce(l ->> 'partner', ''), 200), l ->> 'direction', (l ->> 'amount')::numeric,
         left(coalesce(l ->> 'currency', ''), 10), nullif(l ->> 'amount_currency', '')::numeric, l ->> 'state',
         coalesce(l ->> 'kind', ''), left(coalesce(l ->> 'counter', ''), 40)
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- What the Payments pages read, in one call: the latest ageing per side with its documents, and every payment with its
-- kind, other side and source.
create or replace function public.payments_summary(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'aged', coalesce((
      select jsonb_object_agg(r.side, jsonb_build_object('as_of', r.as_of, 'buckets', to_jsonb(r.buckets), 'total', r.totals, 'findings', r.findings, 'filename', r.filename,
        'items', coalesce((select jsonb_agg(jsonb_build_array(i.partner, i.ref, i.memo, i.day, to_jsonb(i.amounts), i.total) order by i.id) from public.aged_items i where i.report_id = r.id), '[]'::jsonb)))
      from (select distinct on (side) * from public.aged_reports where company_id = p_company order by side, as_of desc) r
    ), '{}'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_array(l.day, l.number, l.journal, l.method, l.partner, l.amount, l.currency, l.amount_currency, l.state, l.kind, l.counter, b.source) order by l.day, l.id)
      from public.payment_lines l join public.payment_batches b on b.id = l.batch_id where l.company_id = p_company
    ), '[]'::jsonb)
  );
end $$;

revoke execute on function public.begin_payment_batch(uuid, text[], text, jsonb, text) from public, anon;
revoke execute on function public.add_payment_lines(uuid, jsonb) from public, anon;
revoke execute on function public.payments_summary(uuid) from public, anon;
grant execute on function public.begin_payment_batch(uuid, text[], text, jsonb, text) to authenticated;
grant execute on function public.add_payment_lines(uuid, jsonb) to authenticated;
grant execute on function public.payments_summary(uuid) to authenticated;
