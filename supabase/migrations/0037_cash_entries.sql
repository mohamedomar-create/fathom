-- 0037: the cash book, for small companies that only deal in money in and money out (kiosks, shops). Its own table of
-- entries and its own uploads; nothing here touches the ledger, balances, sales or expense lines, checks or summaries.
-- Members read; editors write, only through the functions below. Safe to run again.

create table if not exists public.cash_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  filename text not null default '' check (length(filename) <= 300),
  months text[] not null default '{}',
  mode text not null default 'add' check (mode in ('add', 'replace_months')),
  -- Which sides of the book the upload holds: "replace these months" replaces only those (a sales file keeps the expenses).
  directions text[] not null default '{in,out}' check (directions <@ '{in,out}' and cardinality(directions) >= 1),
  status text not null default 'open' check (status in ('open', 'done')),
  rows integer not null default 0,
  skipped integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.cash_uploads add column if not exists directions text[] not null default '{in,out}';
create index if not exists cash_uploads_company on public.cash_uploads (company_id, created_at desc);

create table if not exists public.cash_entries (
  id bigserial primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  upload_id uuid references public.cash_uploads (id) on delete cascade,
  day date not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric not null check (amount <> 0 and abs(amount) < 1e15),
  category text not null default '' check (length(category) <= 200),
  party text not null default '' check (length(party) <= 200),
  note text not null default '' check (length(note) <= 300),
  paid boolean,
  paid_on date,
  source text not null default 'app' check (source in ('file', 'app', 'copied')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cash_entries_company_day on public.cash_entries (company_id, day);
create index if not exists cash_entries_upload on public.cash_entries (upload_id);

alter table public.cash_uploads enable row level security;
alter table public.cash_entries enable row level security;
drop policy if exists cash_uploads_read on public.cash_uploads;
create policy cash_uploads_read on public.cash_uploads for select to authenticated using (private.is_member(private.company_org(company_id)));
drop policy if exists cash_entries_read on public.cash_entries;
create policy cash_entries_read on public.cash_entries for select to authenticated
  using (private.is_member(private.company_org(company_id)) and (upload_id is null or exists (select 1 from public.cash_uploads u where u.id = upload_id and u.status = 'done')));
revoke all on public.cash_uploads, public.cash_entries from anon;
revoke insert, update, delete on public.cash_uploads, public.cash_entries from authenticated;
grant select on public.cash_uploads, public.cash_entries to authenticated;

create or replace function private.cash_editor(p_company uuid) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

-- An entry from the app or a file, as jsonb: {day, direction, amount, category, party, note, paid, paidOn}.
create or replace function private.cash_row(p_company uuid, p_upload uuid, p_source text, e jsonb) returns public.cash_entries language plpgsql immutable set search_path = '' as $$
declare r public.cash_entries;
begin
  if nullif(e ->> 'day', '') is null then raise exception 'a date is needed' using errcode = '22023'; end if;
  if (e ->> 'direction') not in ('in', 'out') then raise exception 'say whether it is money in or money out' using errcode = '22023'; end if;
  if nullif(e ->> 'amount', '') is null or (e ->> 'amount')::numeric = 0 then raise exception 'an amount is needed' using errcode = '22023'; end if;
  r.company_id := p_company; r.upload_id := p_upload; r.source := p_source;
  r.day := (e ->> 'day')::date; r.direction := e ->> 'direction'; r.amount := (e ->> 'amount')::numeric;
  r.category := left(coalesce(e ->> 'category', ''), 200); r.party := left(coalesce(e ->> 'party', ''), 200); r.note := left(coalesce(e ->> 'note', ''), 300);
  r.paid := (e ->> 'paid')::boolean; r.paid_on := nullif(e ->> 'paidOn', '')::date;
  return r;
end $$;

-- Every entry the company's pages show (finished uploads and entries added in the app), oldest first.
create or replace function public.cash_entries_list(p_company uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'day', e.day, 'direction', e.direction, 'amount', e.amount, 'category', e.category,
      'party', e.party, 'note', e.note, 'paid', e.paid, 'paidOn', e.paid_on, 'source', e.source, 'upload', e.upload_id) order by e.day, e.id)
    from public.cash_entries e left join public.cash_uploads u on u.id = e.upload_id
    where e.company_id = p_company and (e.upload_id is null or u.status = 'done')), '[]'::jsonb);
end $$;

-- An upload in three steps, so a large file is sent in parts and shows only once all of it has arrived.
drop function if exists public.cash_upload_begin(uuid, text, text[], text, integer);
create or replace function public.cash_upload_begin(p_company uuid, p_filename text, p_months text[], p_mode text, p_skipped integer default 0, p_directions text[] default '{in,out}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.cash_editor(p_company);
  if p_mode not in ('add', 'replace_months') then raise exception 'unknown mode' using errcode = '22023'; end if;
  if coalesce(array_length(p_months, 1), 0) > 600 or exists (select 1 from unnest(p_months) m where m !~ '^\d{4}-(0[1-9]|1[0-2])$') then
    raise exception 'months must be YYYY-MM (at most 600)' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_directions), 0) = 0 or not (p_directions <@ array['in', 'out']) then raise exception 'directions are in and out' using errcode = '22023'; end if;
  -- Parts of an upload left open for a day were abandoned.
  delete from public.cash_uploads where company_id = p_company and status = 'open' and created_at < now() - interval '1 day';
  insert into public.cash_uploads (company_id, filename, months, mode, skipped, directions)
  values (p_company, left(coalesce(p_filename, ''), 300), coalesce(p_months, '{}'), p_mode, greatest(0, coalesce(p_skipped, 0)), p_directions)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.cash_upload_add(p_upload uuid, p_entries jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare u public.cash_uploads; v_count integer;
begin
  select * into u from public.cash_uploads where id = p_upload;
  if not found or u.status <> 'open' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.cash_editor(u.company_id);
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 5000 then raise exception 'send 1 to 5000 entries' using errcode = '22023'; end if;
  if (select count(*) from public.cash_entries where upload_id = p_upload) + jsonb_array_length(p_entries) > 200000 then raise exception 'an upload holds at most 200,000 entries' using errcode = '22023'; end if;
  insert into public.cash_entries (company_id, upload_id, day, direction, amount, category, party, note, paid, paid_on, source)
  select r.company_id, r.upload_id, r.day, r.direction, r.amount, r.category, r.party, r.note, r.paid, r.paid_on, 'file'
  from jsonb_array_elements(p_entries) e, lateral private.cash_row(u.company_id, p_upload, 'file', e) r;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Makes the upload live; with "replace these months", the company's other entries in its months go in the same step.
create or replace function public.cash_upload_finish(p_upload uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.cash_uploads; v_removed integer := 0; v_rows integer;
begin
  select * into u from public.cash_uploads where id = p_upload for update;
  if not found or u.status <> 'open' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.cash_editor(u.company_id);
  if u.mode = 'replace_months' then
    -- Only the sides the upload holds, and never rows of another upload still being sent (a second press on Save).
    delete from public.cash_entries e where e.company_id = u.company_id and e.upload_id is distinct from p_upload
      and to_char(e.day, 'YYYY-MM') = any (u.months) and e.direction = any (u.directions)
      and (e.upload_id is null or exists (select 1 from public.cash_uploads x where x.id = e.upload_id and x.status = 'done'));
    get diagnostics v_removed = row_count;
    -- Uploads left with nothing go from the history; the others show what is left of them.
    delete from public.cash_uploads x where x.company_id = u.company_id and x.id <> p_upload and x.status = 'done' and not exists (select 1 from public.cash_entries e where e.upload_id = x.id);
    update public.cash_uploads x set rows = (select count(*) from public.cash_entries e where e.upload_id = x.id)
      where x.company_id = u.company_id and x.id <> p_upload and x.status = 'done';
  end if;
  select count(*) into v_rows from public.cash_entries where upload_id = p_upload;
  update public.cash_uploads set status = 'done', rows = v_rows where id = p_upload;
  return jsonb_build_object('rows', v_rows, 'removed', v_removed);
end $$;

-- Takes back one upload (its entries go; entries it replaced are not brought back).
create or replace function public.cash_upload_remove(p_upload uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_count integer;
begin
  select company_id into v_company from public.cash_uploads where id = p_upload;
  perform private.cash_editor(v_company);
  select count(*) into v_count from public.cash_entries where upload_id = p_upload;
  delete from public.cash_uploads where id = p_upload;
  return v_count;
end $$;

create or replace function public.cash_entry_add(p_company uuid, p_entry jsonb) returns bigint language plpgsql security definer set search_path = '' as $$
declare r public.cash_entries; v_id bigint;
begin
  perform private.cash_editor(p_company);
  r := private.cash_row(p_company, null, 'app', p_entry);
  insert into public.cash_entries (company_id, upload_id, day, direction, amount, category, party, note, paid, paid_on, source)
  values (r.company_id, null, r.day, r.direction, r.amount, r.category, r.party, r.note, r.paid, r.paid_on, 'app') returning id into v_id;
  return v_id;
end $$;

create or replace function public.cash_entry_update(p_id bigint, p_entry jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; r public.cash_entries;
begin
  select company_id into v_company from public.cash_entries where id = p_id;
  perform private.cash_editor(v_company);
  r := private.cash_row(v_company, null, 'app', p_entry);
  update public.cash_entries set day = r.day, direction = r.direction, amount = r.amount, category = r.category, party = r.party, note = r.note,
    paid = r.paid, paid_on = r.paid_on where id = p_id;
end $$;

create or replace function public.cash_entry_delete(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.cash_entries where id = p_id;
  perform private.cash_editor(v_company);
  delete from public.cash_entries where id = p_id;
end $$;

-- Every entry and upload of the company (admins only).
create or replace function public.cash_entries_clear(p_company uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.cash_entries where company_id = p_company;
  get diagnostics v_count = row_count;
  delete from public.cash_uploads where company_id = p_company;
  return v_count;
end $$;

-- Switching to the full system: the entries become sales and expense lines once, for months that have none from a
-- file. The cash book is kept as it is.
create or replace function public.cash_to_full(p_company uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_months text[]; v_sb uuid; v_eb uuid; v_s integer := 0; v_e integer := 0;
begin
  perform private.cash_editor(p_company);
  select array_agg(distinct to_char(day, 'YYYY-MM')) into v_months from public.cash_entries e where e.company_id = p_company and e.direction = 'in'
    and not exists (select 1 from public.sales_lines s where s.company_id = p_company and s.source = 'file' and s.period = to_char(e.day, 'YYYY-MM'));
  if v_months is not null then
    insert into public.sales_batches (company_id, source, filename, periods, created_by) values (p_company, 'file', 'From the cash book', v_months, auth.uid()) returning id into v_sb;
    insert into public.sales_lines (company_id, batch_id, source, day, period, doc, series, customer, product, category, salesperson, amount, paid, paid_on)
    select p_company, v_sb, 'file', e.day, to_char(e.day, 'YYYY-MM'), '', '', e.party, '', e.category, '', e.amount, e.paid, e.paid_on
    from public.cash_entries e where e.company_id = p_company and e.direction = 'in' and to_char(e.day, 'YYYY-MM') = any (v_months);
    get diagnostics v_s = row_count;
  end if;
  select array_agg(distinct to_char(day, 'YYYY-MM')) into v_months from public.cash_entries e where e.company_id = p_company and e.direction = 'out'
    and not exists (select 1 from public.expense_lines x where x.company_id = p_company and x.source = 'file' and x.period = to_char(e.day, 'YYYY-MM'));
  if v_months is not null then
    insert into public.expense_batches (company_id, source, filename, periods, created_by) values (p_company, 'file', 'From the cash book', v_months, auth.uid()) returning id into v_eb;
    insert into public.expense_lines (company_id, batch_id, source, day, period, doc, series, supplier, account, category, label, amount, paid, paid_on)
    select p_company, v_eb, 'file', e.day, to_char(e.day, 'YYYY-MM'), '', '', e.party, e.category, e.category, e.note, e.amount, e.paid, e.paid_on
    from public.cash_entries e where e.company_id = p_company and e.direction = 'out' and to_char(e.day, 'YYYY-MM') = any (v_months);
    get diagnostics v_e = row_count;
  end if;
  return jsonb_build_object('sales', v_s, 'expenses', v_e);
end $$;

-- Switching a company to the cash book: its uploaded sales and expense lines are copied in once, when the cash book
-- is still empty. The lines themselves are kept.
create or replace function private.cash_from_lines(p_company uuid) returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_n integer;
begin
  if exists (select 1 from public.cash_entries where company_id = p_company) then return 0; end if;
  insert into public.cash_entries (company_id, day, direction, amount, category, party, paid, paid_on, source)
  select company_id, coalesce(day, (period || '-01')::date + interval '1 month' - interval '1 day'), 'in', amount,
         left(coalesce(nullif(category, ''), nullif(product, ''), ''), 200), case when customer in ('No customer', '') then '' else left(customer, 200) end, paid, paid_on, 'copied'
  from public.sales_lines where company_id = p_company and source = 'file' and amount <> 0;
  get diagnostics v_n = row_count; v_count := v_count + v_n;
  insert into public.cash_entries (company_id, day, direction, amount, category, party, note, paid, paid_on, source)
  select company_id, coalesce(day, (period || '-01')::date + interval '1 month' - interval '1 day'), 'out', amount,
         left(coalesce(nullif(category, ''), nullif(account, ''), ''), 200), case when supplier in ('No supplier', '') then '' else left(supplier, 200) end, left(label, 300), paid, paid_on, 'copied'
  from public.expense_lines where company_id = p_company and source = 'file' and amount <> 0;
  get diagnostics v_n = row_count;
  return v_count + v_n;
end $$;

create or replace function public.cash_from_full(p_company uuid) returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform private.cash_editor(p_company);
  return private.cash_from_lines(p_company);
end $$;

-- Companies already in Simple mode keep what they uploaded: copied into the cash book once.
do $$ declare c record; begin
  for c in select id from public.companies where kpi_config -> 'profile' ->> 'mode' = 'simple' loop perform private.cash_from_lines(c.id); end loop;
end $$;

-- Entries typed one by one have their own, generous limit (a day's receipts), apart from file uploads.
insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('cash_entry', 'user', 3600, 600)
  on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

revoke execute on function private.cash_editor(uuid), private.cash_row(uuid, uuid, text, jsonb), private.cash_from_lines(uuid) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['public.cash_entries_list(uuid)', 'public.cash_upload_begin(uuid, text, text[], text, integer, text[])', 'public.cash_upload_add(uuid, jsonb)',
    'public.cash_upload_finish(uuid)', 'public.cash_upload_remove(uuid)', 'public.cash_entry_add(uuid, jsonb)', 'public.cash_entry_update(bigint, jsonb)',
    'public.cash_entry_delete(bigint)', 'public.cash_entries_clear(uuid)', 'public.cash_to_full(uuid)', 'public.cash_from_full(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
