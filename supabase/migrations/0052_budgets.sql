-- 0052: budgets.
--  * budget_versions: one ORIGINAL budget per company and financial year, plus any number of REVISIONS. fy is the
--    calendar year the financial year starts in ('2026'); the app works out its months from the company's FY start.
--    A version is a draft until an owner or admin approves it; an approved version is locked for good (a change is a
--    new revision).
--  * budget_lines: the budget by account and month. key is the account the same way the app keys marks ('#<code>',
--    '@<name>') or a whole class ('cls:<class>', for budgets seeded from the forecast). amount is in the sign the
--    statements show (income and costs both positive, as the app's natural sign), so it goes through the same statements
--    as the actual figures.
--  * budget_products: units × price (and the budget unit cost) per product and month; the app adds them up to revenue
--    and cost of sales.
--  * The month column is called "month", not "period", so closing a month (0043) never locks a budget: approval does.
--  * Members read. Nobody writes the tables directly: editors write through the functions below, admins approve.
-- Only adds objects: safe to run again.
set client_min_messages = warning;

create table if not exists public.budget_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  fy text not null check (fy ~ '^\d{4}$'),
  name text not null check (length(name) between 1 and 80),
  kind text not null check (kind in ('original', 'revision')),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  based_on uuid references public.budget_versions (id) on delete set null,
  created_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists budget_versions_one_original on public.budget_versions (company_id, fy) where kind = 'original';
create index if not exists budget_versions_company on public.budget_versions (company_id, fy, created_at);

create table if not exists public.budget_lines (
  version_id uuid not null references public.budget_versions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  key text not null check (length(key) between 1 and 220),
  cls text not null check (length(cls) between 1 and 40),
  label text check (label is null or length(label) <= 200),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric not null check (abs(amount) < 1e15),
  primary key (version_id, key, month)
);
create index if not exists budget_lines_company on public.budget_lines (company_id);

create table if not exists public.budget_products (
  version_id uuid not null references public.budget_versions (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  product text not null check (length(product) between 1 and 200),
  category text check (category is null or length(category) <= 200),
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  units numeric not null check (abs(units) < 1e12),
  price numeric not null check (abs(price) < 1e12),
  unit_cost numeric check (unit_cost is null or abs(unit_cost) < 1e12),
  primary key (version_id, product, month)
);
create index if not exists budget_products_company on public.budget_products (company_id);

alter table public.budget_versions enable row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_products enable row level security;
drop policy if exists budget_versions_read on public.budget_versions;
create policy budget_versions_read on public.budget_versions for select to authenticated using (private.is_member(private.company_org(company_id)));
drop policy if exists budget_lines_read on public.budget_lines;
create policy budget_lines_read on public.budget_lines for select to authenticated using (private.is_member(private.company_org(company_id)));
drop policy if exists budget_products_read on public.budget_products;
create policy budget_products_read on public.budget_products for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.budget_versions, public.budget_lines, public.budget_products from anon;
revoke insert, update, delete, truncate on public.budget_versions, public.budget_lines, public.budget_products from authenticated;
grant select on public.budget_versions, public.budget_lines, public.budget_products to authenticated;

-- The version an editor may change: it exists, the caller edits its company, and it is still a draft. Locks the version
-- row so an approval can't land half-way through a save.
create or replace function private.budget_draft(p_version uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v_status text;
begin
  select company_id, status into v_co, v_status from public.budget_versions where id = p_version for update;
  if v_co is null or not private.is_member(private.company_org(v_co), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_status = 'approved' then raise exception 'This budget is approved and locked. Add a revision to change it.'; end if;
  return v_co;
end $$;

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
  end if;
  return v_id;
end $$;

-- Saves budget lines: each (account, month) is added or changed; with p_replace the version's lines are replaced.
-- At most 20,000 lines a call; the same (account, month) twice in one call keeps the last.
create or replace function public.budget_save_lines(p_version uuid, p_lines jsonb, p_replace boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_co uuid := private.budget_draft(p_version); v_bad integer; v_n integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'The budget lines are not valid.'; end if;
  if jsonb_array_length(p_lines) > 20000 then raise exception 'At most 20,000 budget lines in one save.'; end if;
  select count(*) into v_bad from jsonb_to_recordset(p_lines) as r(key text, cls text, label text, month text, amount numeric)
  where r.key is null or length(r.key) not between 1 and 220 or r.cls is null or length(r.cls) not between 1 and 40
     or length(coalesce(r.label, '')) > 200 or r.month is null or r.month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or r.amount is null or abs(r.amount) >= 1e15
     or r.cls not in ('revenue', 'cos_variable', 'cos_fixed', 'cos_depreciation', 'exp_variable', 'exp_fixed', 'exp_depreciation',
                      'other_income', 'other_expenses', 'interest_income', 'interest_expenses', 'tax_expenses', 'adjustments', 'dividends');
  if v_bad > 0 then raise exception '% budget line(s) are not valid: each needs an account, a P&L class, a month (YYYY-MM) and an amount.', v_bad; end if;
  if p_replace then delete from public.budget_lines where version_id = p_version; end if;
  insert into public.budget_lines (version_id, company_id, key, cls, label, month, amount)
  select distinct on (r.key, r.month) p_version, v_co, r.key, r.cls, nullif(r.label, ''), r.month, r.amount
  from jsonb_array_elements(p_lines) with ordinality as e(j, n),
       jsonb_to_record(e.j) as r(key text, cls text, label text, month text, amount numeric)
  order by r.key, r.month, e.n desc
  on conflict (version_id, key, month) do update set cls = excluded.cls, label = excluded.label, amount = excluded.amount;
  get diagnostics v_n = row_count;
  update public.budget_versions set updated_at = now() where id = p_version;
  return v_n;
end $$;

-- Saves product rows (units, price and, when budgeted, the unit cost) the same way.
create or replace function public.budget_save_products(p_version uuid, p_rows jsonb, p_replace boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_co uuid := private.budget_draft(p_version); v_bad integer; v_n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'The budget products are not valid.'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'At most 20,000 product rows in one save.'; end if;
  select count(*) into v_bad from jsonb_to_recordset(p_rows) as r(product text, category text, month text, units numeric, price numeric, unit_cost numeric)
  where r.product is null or length(btrim(r.product)) not between 1 and 200 or length(coalesce(r.category, '')) > 200
     or r.month is null or r.month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or r.units is null or abs(r.units) >= 1e12 or r.price is null or abs(r.price) >= 1e12 or abs(coalesce(r.unit_cost, 0)) >= 1e12;
  if v_bad > 0 then raise exception '% product row(s) are not valid: each needs a product, a month (YYYY-MM), units and a price.', v_bad; end if;
  if p_replace then delete from public.budget_products where version_id = p_version; end if;
  insert into public.budget_products (version_id, company_id, product, category, month, units, price, unit_cost)
  select distinct on (btrim(r.product), r.month) p_version, v_co, btrim(r.product), nullif(btrim(coalesce(r.category, '')), ''), r.month, r.units, r.price, r.unit_cost
  from jsonb_array_elements(p_rows) with ordinality as e(j, n),
       jsonb_to_record(e.j) as r(product text, category text, month text, units numeric, price numeric, unit_cost numeric)
  order by btrim(r.product), r.month, e.n desc
  on conflict (version_id, product, month) do update set category = excluded.category, units = excluded.units, price = excluded.price, unit_cost = excluded.unit_cost;
  get diagnostics v_n = row_count;
  update public.budget_versions set updated_at = now() where id = p_version;
  return v_n;
end $$;

-- One save of a draft, all or nothing: lines (added or changed, or replacing all with p_replace_lines) and products
-- (when given, they replace the version's products). Null leaves that part as it is. An approval waits for it (row lock).
create or replace function public.budget_save(p_version uuid, p_lines jsonb default null, p_products jsonb default null, p_replace_lines boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_l integer; v_p integer;
begin
  perform private.budget_draft(p_version);
  if p_lines is not null then v_l := public.budget_save_lines(p_version, p_lines, p_replace_lines); end if;
  if p_products is not null then v_p := public.budget_save_products(p_version, p_products, true); end if;
  return jsonb_build_object('lines', v_l, 'products', v_p);
end $$;

-- An owner or admin approves a draft; from then on it is locked.
create or replace function public.budget_approve(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v_status text;
begin
  select company_id, status into v_co, v_status from public.budget_versions where id = p_version for update;
  if v_co is null or not private.is_member(private.company_org(v_co), 'admin') then
    raise exception 'Only the owner or an admin can approve a budget.' using errcode = '42501';
  end if;
  if v_status = 'approved' then raise exception 'This budget is already approved.'; end if;
  update public.budget_versions set status = 'approved', approved_by = (select auth.uid()), approved_at = now(), updated_at = now()
  where id = p_version;
end $$;

-- An editor deletes a draft (an approved budget stays).
create or replace function public.budget_delete(p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.budget_draft(p_version);
  delete from public.budget_versions where id = p_version;
end $$;

revoke execute on function private.budget_draft(uuid) from public, anon, authenticated;
revoke execute on function public.budget_create(uuid, text, text, text, uuid), public.budget_save_lines(uuid, jsonb, boolean),
  public.budget_save_products(uuid, jsonb, boolean), public.budget_save(uuid, jsonb, jsonb, boolean), public.budget_approve(uuid), public.budget_delete(uuid) from public, anon;
grant execute on function public.budget_create(uuid, text, text, text, uuid), public.budget_save_lines(uuid, jsonb, boolean),
  public.budget_save_products(uuid, jsonb, boolean), public.budget_save(uuid, jsonb, jsonb, boolean), public.budget_approve(uuid), public.budget_delete(uuid) to authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('budget', 'user', 3600, 600)
  on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

-- The tenant guards (0038) on the new tables.
do $$ begin perform private.install_tenant_guards(); end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 52 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
