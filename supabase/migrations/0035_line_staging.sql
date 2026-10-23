-- Staged line saves. Sales, expense and payment lines used to go straight into the live tables: the months were deleted
-- first, then the lines arrived chunk by chunk, so a page could show half a month while a save ran, and a save that
-- stopped left the month half full. Now the chunks are held apart (private schema, never read by any page) and one
-- finish call replaces the months and adds every line in a single transaction. The existing begin_* / add_* functions are
-- unchanged, so an app that has not been updated keeps working. Up to 600 months per save (was 240).
-- Safe to run again.

create table if not exists private.line_stages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('sales', 'expenses', 'payments')),
  source text not null check (source in ('ledger', 'file')),
  periods text[] not null,
  filename text,
  report jsonb not null default '{}'::jsonb,
  replace_all boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists line_stages_company_idx on private.line_stages (company_id, created_at);

-- One chunk of lines as sent. Keyed by its digest, so a chunk sent again after a dropped connection is not doubled.
create table if not exists private.line_stage_chunks (
  stage_id uuid not null references private.line_stages (id) on delete cascade,
  digest text not null,
  seq bigint generated always as identity,
  lines jsonb not null,
  primary key (stage_id, digest)
);
revoke all on private.line_stages, private.line_stage_chunks from public, anon, authenticated;

-- Open a save for one kind and source. Nothing live changes until stage_lines_finish.
create or replace function public.stage_lines_begin(p_company uuid, p_kind text, p_source text, p_periods text[], p_filename text default null,
  p_report jsonb default '{}'::jsonb, p_all boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v uuid;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_kind not in ('sales', 'expenses', 'payments') then raise exception 'unknown kind'; end if;
  if p_source not in ('ledger', 'file') then raise exception 'unknown source'; end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 600 then raise exception 'periods required (1 to 600)'; end if;
  if exists (select 1 from unnest(p_periods) p where p !~ '^\d{4}-(0[1-9]|1[0-2])$') then raise exception 'bad period'; end if;
  -- Saves left open for a day (the page was closed) are cleared.
  delete from private.line_stages where company_id = p_company and created_at < now() - interval '1 day';
  insert into private.line_stages (company_id, kind, source, periods, filename, report, replace_all, created_by)
  values (p_company, p_kind, p_source, (select array_agg(distinct p order by p) from unnest(p_periods) p), left(p_filename, 300),
          coalesce(p_report, '{}'::jsonb), coalesce(p_all, false), (select auth.uid()))
  returning id into v;
  return v;
end $$;

-- Hold one chunk (up to 5,000 lines). A line outside the save's months, or without an amount, refuses the chunk.
create or replace function public.stage_lines_add(p_stage uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.line_stages;
  v_count integer;
begin
  select * into s from private.line_stages where id = p_stage;
  if not found or s.created_by is distinct from (select auth.uid()) or not private.is_member(private.company_org(s.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where not (l ->> 'period' = any (s.periods)) or l ->> 'amount' is null) then
    raise exception 'a line is outside the months of this save, or has no amount';
  end if;
  insert into private.line_stage_chunks (stage_id, digest, lines)
  values (p_stage, md5(p_lines::text), p_lines)
  on conflict (stage_id, digest) do nothing;
  get diagnostics v_count = row_count;
  return case when v_count = 0 then 0 else jsonb_array_length(p_lines) end;
end $$;

-- Replace the save's months (or every month of its source, for "replace all") and add every held line, in one
-- transaction. Returns {"batch": id, "saved": n, "sent": n}.
create or replace function public.stage_lines_finish(p_stage uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.line_stages;
  v_batch uuid;
  v_saved integer := 0;
  v_sent integer := 0;
  c record;
begin
  select * into s from private.line_stages where id = p_stage for update;
  if not found or s.created_by is distinct from (select auth.uid()) or not private.is_member(private.company_org(s.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if s.kind = 'sales' then
    if s.replace_all then
      delete from public.sales_lines where company_id = s.company_id and source = s.source;
    else
      delete from public.sales_lines where company_id = s.company_id and source = s.source and period = any (s.periods);
    end if;
    delete from public.sales_batches b where b.company_id = s.company_id and b.source = s.source
      and not exists (select 1 from public.sales_lines l where l.batch_id = b.id);
    insert into public.sales_batches (company_id, source, filename, periods, report, created_by)
    values (s.company_id, s.source, s.filename, s.periods, s.report, s.created_by) returning id into v_batch;
    for c in select lines from private.line_stage_chunks where stage_id = p_stage order by seq loop
      v_sent := v_sent + jsonb_array_length(c.lines);
      v_saved := v_saved + public.add_sales_lines(v_batch, c.lines);
    end loop;
  elsif s.kind = 'expenses' then
    if s.replace_all then
      delete from public.expense_lines where company_id = s.company_id and source = s.source;
    else
      delete from public.expense_lines where company_id = s.company_id and source = s.source and period = any (s.periods);
    end if;
    delete from public.expense_batches b where b.company_id = s.company_id and b.source = s.source
      and not exists (select 1 from public.expense_lines l where l.batch_id = b.id);
    insert into public.expense_batches (company_id, source, filename, periods, report, created_by)
    values (s.company_id, s.source, s.filename, s.periods, s.report, s.created_by) returning id into v_batch;
    for c in select lines from private.line_stage_chunks where stage_id = p_stage order by seq loop
      v_sent := v_sent + jsonb_array_length(c.lines);
      v_saved := v_saved + public.add_expense_lines(v_batch, c.lines);
    end loop;
  else
    delete from public.payment_lines l using public.payment_batches pb
     where pb.id = l.batch_id and pb.company_id = s.company_id and pb.source = s.source and (s.replace_all or l.period = any (s.periods));
    delete from public.payment_batches pb where pb.company_id = s.company_id and pb.source = s.source
      and not exists (select 1 from public.payment_lines l where l.batch_id = pb.id);
    insert into public.payment_batches (company_id, filename, periods, report, source, created_by)
    values (s.company_id, s.filename, s.periods, s.report, s.source, s.created_by) returning id into v_batch;
    for c in select lines from private.line_stage_chunks where stage_id = p_stage order by seq loop
      v_sent := v_sent + jsonb_array_length(c.lines);
      v_saved := v_saved + public.add_payment_lines(v_batch, c.lines);
    end loop;
  end if;
  -- A save that ends up holding nothing keeps no empty upload behind.
  if v_saved = 0 then
    if s.kind = 'sales' then delete from public.sales_batches where id = v_batch;
    elsif s.kind = 'expenses' then delete from public.expense_batches where id = v_batch;
    else delete from public.payment_batches where id = v_batch; end if;
    v_batch := null;
  end if;
  delete from private.line_stages where id = p_stage;
  return jsonb_build_object('batch', v_batch, 'saved', v_saved, 'sent', v_sent);
end $$;

-- Drop an open save without changing anything (the person cancelled, or a step before the finish failed).
create or replace function public.stage_lines_cancel(p_stage uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.line_stages where id = p_stage and created_by = (select auth.uid());
end $$;

revoke execute on function public.stage_lines_begin(uuid, text, text, text[], text, jsonb, boolean) from public, anon;
revoke execute on function public.stage_lines_add(uuid, jsonb) from public, anon;
revoke execute on function public.stage_lines_finish(uuid) from public, anon;
revoke execute on function public.stage_lines_cancel(uuid) from public, anon;
grant execute on function public.stage_lines_begin(uuid, text, text, text[], text, jsonb, boolean) to authenticated;
grant execute on function public.stage_lines_add(uuid, jsonb) to authenticated;
grant execute on function public.stage_lines_finish(uuid) to authenticated;
grant execute on function public.stage_lines_cancel(uuid) to authenticated;
