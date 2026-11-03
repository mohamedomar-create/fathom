-- 0053: budget builder storage.
--  * budget_setups: the company's budget setup (one jsonb document per company, read by members, saved by editors).
--  * budget_versions.setup: the setup a version was built with (copied when a revision is made from a version).
--  * budget_rows: the builder's rows per version and view (revenue, customer, expense): a row has a mode (a year
--    figure or twelve months), the basis and cost it was built from, and twelve month amounts.
--  * budget_rows_save: one all-or-nothing save of a draft: rows of the views named, the budget lines (replacing all
--    of them) and, when given, the version setup.
--  * budget_create is replaced to copy the setup and the rows too when it copies a version.
-- Members read. Nobody writes the tables directly. Only adds objects: safe to run again.
set client_min_messages = warning;

create table if not exists public.budget_setups (
  company_id uuid primary key references public.companies (id) on delete cascade,
  setup jsonb not null check (jsonb_typeof(setup) = 'object' and pg_column_size(setup) <= 1048576),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.budget_versions add column if not exists setup jsonb
  check (setup is null or (jsonb_typeof(setup) = 'object' and pg_column_size(setup) <= 1048576));

create table if not exists public.budget_rows (
  version_id uuid not null references public.budget_versions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  view text not null check (view in ('revenue', 'customer', 'expense')),
  key text not null check (length(key) between 1 and 220),
  label text check (label is null or length(label) <= 200),
  mode text not null check (mode in ('year', 'months')),
  basis jsonb,
  cost jsonb,
  months numeric[] not null check (cardinality(months) = 12),
  updated_at timestamptz not null default now(),
  primary key (version_id, view, key)
);
create index if not exists budget_rows_company on public.budget_rows (company_id);

alter table public.budget_setups enable row level security;
alter table public.budget_rows enable row level security;
drop policy if exists budget_setups_read on public.budget_setups;
create policy budget_setups_read on public.budget_setups for select to authenticated using (private.is_member(private.company_org(company_id)));
drop policy if exists budget_rows_read on public.budget_rows;
create policy budget_rows_read on public.budget_rows for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.budget_setups, public.budget_rows from anon;
revoke insert, update, delete, truncate on public.budget_setups, public.budget_rows from authenticated;
grant select on public.budget_setups, public.budget_rows to authenticated;

-- An editor saves the company's budget setup (replaces it).
create or replace function public.budget_setup_save(p_company uuid, p_setup jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_setup is null or jsonb_typeof(p_setup) <> 'object' then raise exception 'The budget setup is not valid.'; end if;
  if pg_column_size(p_setup) > 1048576 then raise exception 'The budget setup is too large (1 MB at most).'; end if;
  insert into public.budget_setups (company_id, setup) values (p_company, p_setup)
  on conflict (company_id) do update set setup = excluded.setup, updated_at = now(), updated_by = (select auth.uid());
end $$;

-- budget_create (0052) now also copies the setup and the rows of the version it copies.
create or replace function public.budget_create(p_company uuid, p_fy text, p_kind text, p_name text, p_from uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_from_co uuid; v_name text := btrim(coalesce(p_name, '')); v_n integer;
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_fy is null or p_fy !~ '^\d{4}$' then raise exception 'Choose a financial year.'; end if;
  if p_kind is null or p_kind not in ('original', 'revision') then raise exception 'Choose original or revision.'; end if;
  if p_from is not null then
    select company_id into v_from_co from public.budget_versions where id = p_from;
    if v_from_co is distinct from p_company then raise exception 'not allowed' using errcode = '42501'; end if;
    if (select fy from public.budget_versions where id = p_from) <> p_fy then raise exception 'A version can only be copied into the same financial year.'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('budget:' || p_company::text || ':' || p_fy));
  if p_kind = 'original' and exists (select 1 from public.budget_versions where company_id = p_company and fy = p_fy and kind = 'original') then
    raise exception 'FY % already has an original budget. Add a revision instead.', p_fy;
  end if;
  if p_kind = 'revision' and not exists (select 1 from public.budget_versions where company_id = p_company and fy = p_fy and kind = 'original') then
    raise exception 'Create the original budget for FY % first.', p_fy;
  end if;
  if v_name = '' then
    select count(*) into v_n from public.budget_versions where company_id = p_company and fy = p_fy and kind = 'revision';
    v_name := case when p_kind = 'original' then 'Budget FY ' || p_fy else 'Revision ' || (v_n + 1) end;
  end if;
  insert into public.budget_versions (company_id, fy, name, kind, based_on)
  values (p_company, p_fy, left(v_name, 80), p_kind, p_from) returning id into v_id;
  if p_from is not null then
    insert into public.budget_lines (version_id, company_id, key, cls, label, month, amount)
    select v_id, company_id, key, cls, label, month, amount from public.budget_lines where version_id = p_from;
    insert into public.budget_products (version_id, company_id, product, category, month, units, price, unit_cost)
    select v_id, company_id, product, category, month, units, price, unit_cost from public.budget_products where version_id = p_from;
    insert into public.budget_rows (version_id, company_id, view, key, label, mode, basis, cost, months)
    select v_id, company_id, view, key, label, mode, basis, cost, months from public.budget_rows where version_id = p_from;
    update public.budget_versions set setup = (select setup from public.budget_versions where id = p_from) where id = v_id;
  end if;
  return v_id;
end $$;

-- One save of a draft, all or nothing: for each view in p_views its rows are deleted and the given rows inserted
-- (each row belongs to one of those views; at most 20,000 rows; a key once per view; twelve finite months); p_lines,
-- when given, replaces all budget lines of the version (same checks as budget_save_lines); p_setup, when given, becomes
-- the version's setup. An approval waits for it (row lock in budget_draft).
create or replace function public.budget_rows_save(p_version uuid, p_rows jsonb, p_views text[], p_lines jsonb default null, p_setup jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid := private.budget_draft(p_version); v_bad integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'The budget rows are not valid.'; end if;
  if p_views is null or exists (select 1 from unnest(p_views) v where v is null or v not in ('revenue', 'customer', 'expense')) then
    raise exception 'The budget views are not valid.';
  end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'At most 20,000 budget rows in one save.'; end if;
  if p_setup is not null and (jsonb_typeof(p_setup) <> 'object' or pg_column_size(p_setup) > 1048576) then
    raise exception 'The budget setup is not valid.';
  end if;
  select count(*) into v_bad from jsonb_array_elements(p_rows) e(j) where jsonb_typeof(e.j) <> 'object';
  if v_bad > 0 then raise exception 'The budget rows are not valid.'; end if;
  select count(*) into v_bad from jsonb_to_recordset(p_rows) as r(view text, key text, label text, mode text, basis jsonb, cost jsonb, months jsonb)
  where r.view is null or r.view <> all (p_views) or r.key is null or length(r.key) not between 1 and 220
     or length(coalesce(r.label, '')) > 200 or r.mode is null or r.mode not in ('year', 'months')
     or (r.basis is not null and jsonb_typeof(r.basis) not in ('object', 'null'))
     or (r.cost is not null and jsonb_typeof(r.cost) not in ('object', 'null'))
     or r.months is null or jsonb_typeof(r.months) <> 'array'
     or case when jsonb_typeof(r.months) = 'array' then
          jsonb_array_length(r.months) <> 12
          or exists (select 1 from jsonb_array_elements(r.months) m
                     where jsonb_typeof(m) <> 'number' or case when jsonb_typeof(m) = 'number' then abs((m #>> '{}')::numeric) >= 1e15 else true end)
        else true end;
  if v_bad > 0 then raise exception '% budget row(s) are not valid: each needs a view, a key, a mode (year or months) and 12 month amounts.', v_bad; end if;
  select count(*) - count(distinct (r.view, r.key)) into v_bad from jsonb_to_recordset(p_rows) as r(view text, key text);
  if v_bad > 0 then raise exception 'A budget row key can appear only once in a view.'; end if;

  delete from public.budget_rows where version_id = p_version and view = any (p_views);
  insert into public.budget_rows (version_id, company_id, view, key, label, mode, basis, cost, months)
  select p_version, v_co, r.view, r.key, nullif(r.label, ''), r.mode,
         case when jsonb_typeof(r.basis) = 'object' then r.basis end, case when jsonb_typeof(r.cost) = 'object' then r.cost end,
         array(select (m.v #>> '{}')::numeric from jsonb_array_elements(r.months) with ordinality as m(v, o) order by m.o)
  from jsonb_array_elements(p_rows) with ordinality as e(j, n),
       jsonb_to_record(e.j) as r(view text, key text, label text, mode text, basis jsonb, cost jsonb, months jsonb);

  if p_lines is not null then perform public.budget_save_lines(p_version, p_lines, true); end if;
  update public.budget_versions set setup = coalesce(p_setup, setup), updated_at = now() where id = p_version;
end $$;

revoke execute on function public.budget_setup_save(uuid, jsonb), public.budget_rows_save(uuid, jsonb, text[], jsonb, jsonb),
  public.budget_create(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.budget_setup_save(uuid, jsonb), public.budget_rows_save(uuid, jsonb, text[], jsonb, jsonb),
  public.budget_create(uuid, text, text, text, uuid) to authenticated;

-- The tenant guards (0038) on the new tables.
do $$ begin perform private.install_tenant_guards(); end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 53 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
