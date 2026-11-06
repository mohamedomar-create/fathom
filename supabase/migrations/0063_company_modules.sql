-- 0063: each company chooses its modules, may build its own, and limits who sees each one.
--  * private.module_keys gains the module catalog (HR, payroll, CRM, manufacturing, projects, POS, fixed assets, fleet,
--    service) and the built-in modules, with each one's kind and who may see it by default (HR and payroll: admins).
--  * company_modules: the modules a company has opened, a custom module's definition (key c_...), and who may see it
--    (a lowest role, plus named people). Members read; admins change it through the functions below; every change is
--    recorded in company_data_audit.
--  * private.module_visible: company access AND the module's own access. The shared store (module_batches/module_rows),
--    its summary and its rows answer only to people who may see that module, so HR is protected in the database.
--  * The store accepts a catalog or custom module only once the company has opened it (Purchasing stays open as before).
--  * module_summary / module_rows_page gain a month range, filters on any field, and totals by dimension and measure.
-- Adds and replaces objects only; removes nothing. Safe to run again. Needs 0062.
set client_min_messages = warning;

alter table private.module_keys add column if not exists kind text not null default 'store' check (kind in ('builtin', 'store'));
alter table private.module_keys add column if not exists default_role public.member_role not null default 'viewer';
-- Open for every company without being chosen (Purchasing, as 0062 left it); catalog modules must be opened first.
alter table private.module_keys add column if not exists open_by_default boolean not null default false;
update private.module_keys set open_by_default = true where key = 'purchasing';
insert into private.module_keys (key, name, kind, default_role, open_by_default) values
  ('financials', 'Financials', 'builtin', 'viewer', true), ('sales', 'Sales', 'builtin', 'viewer', true),
  ('expenses', 'Expenses', 'builtin', 'viewer', true), ('inventory', 'Inventory', 'builtin', 'viewer', true),
  ('payments', 'Payments', 'builtin', 'viewer', true), ('ar_open', 'Receivables', 'builtin', 'viewer', true),
  ('ap_open', 'Payables', 'builtin', 'viewer', true),
  ('hr', 'HR (employees)', 'store', 'admin', false), ('payroll', 'Payroll', 'store', 'admin', false),
  ('crm', 'CRM (opportunities)', 'store', 'viewer', false), ('manufacturing', 'Manufacturing', 'store', 'viewer', false),
  ('projects', 'Projects and timesheets', 'store', 'viewer', false), ('pos', 'Point of sale', 'store', 'viewer', false),
  ('assets', 'Fixed assets', 'store', 'viewer', false), ('fleet', 'Fleet', 'store', 'viewer', false),
  ('service', 'Service and helpdesk', 'store', 'viewer', false)
on conflict (key) do update set name = excluded.name, kind = excluded.kind, default_role = excluded.default_role, open_by_default = excluded.open_by_default;

create table if not exists public.company_modules (
  company_id uuid not null references public.companies (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  kind text not null check (kind in ('builtin', 'catalog', 'custom')),
  enabled boolean not null default true,
  -- A custom module's definition (fields, measures, dimensions, nature); null for catalog and built-in modules.
  spec jsonb check (spec is null or (jsonb_typeof(spec) = 'object' and pg_column_size(spec) <= 60000)),
  name text check (length(name) <= 80),
  min_role public.member_role not null default 'viewer',
  members uuid[] not null default '{}' check (coalesce(array_length(members, 1), 0) <= 200),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, key),
  check ((kind = 'custom') = (key like 'c\_%')),
  check (kind <> 'custom' or spec is not null)
);
alter table public.company_modules enable row level security;
drop policy if exists company_modules_read on public.company_modules;
create policy company_modules_read on public.company_modules for select to authenticated using (private.company_can(company_id));
revoke all on public.company_modules from anon;
revoke insert, update, delete, truncate on public.company_modules from authenticated;
grant select on public.company_modules to authenticated;

-- ---------------------------------------------------------------- who may see a module
create or replace function private.module_visible(p_company uuid, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.company_can(p_company), false) and coalesce(
    (select private.company_can(p_company, m.min_role) or (select auth.uid()) = any (m.members)
       from public.company_modules m where m.company_id = p_company and m.key = p_key),
    (select private.company_can(p_company, k.default_role) from private.module_keys k where k.key = p_key),
    private.company_can(p_company, 'admin'))
$$;
revoke execute on function private.module_visible(uuid, text) from public, anon;
grant execute on function private.module_visible(uuid, text) to authenticated;

-- A module the store may save into for this company: open by default, or opened by the company (catalog or custom).
create or replace function private.module_open(p_company uuid, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_modules m where m.company_id = p_company and m.key = p_key and m.enabled)
      or exists (select 1 from private.module_keys k where k.key = p_key and k.kind = 'store' and k.open_by_default
                  and not exists (select 1 from public.company_modules m where m.company_id = p_company and m.key = p_key and not m.enabled))
$$;
revoke execute on function private.module_open(uuid, text) from public, anon, authenticated;

drop policy if exists module_batches_read on public.module_batches;
create policy module_batches_read on public.module_batches for select to authenticated using (status = 'live' and private.module_visible(company_id, module));
drop policy if exists module_rows_read on public.module_rows;
create policy module_rows_read on public.module_rows for select to authenticated
  using (private.module_visible(company_id, module) and exists (select 1 from public.module_batches b where b.id = batch_id and b.status = 'live'));

-- ---------------------------------------------------------------- choosing modules (admins)
create or replace function private.modules_audit(p_company uuid, p_action text, p_key text, p_detail jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (private.company_org(p_company), p_company, coalesce((select name from public.companies where id = p_company), ''), p_action, p_key, coalesce(p_detail, '{}'::jsonb));
end $$;
revoke execute on function private.modules_audit(uuid, text, text, jsonb) from public, anon, authenticated;

alter table public.company_data_audit drop constraint if exists company_data_audit_action_check;
alter table public.company_data_audit add constraint company_data_audit_action_check
  check (action in ('clear_module', 'clear_all', 'delete_company', 'transfer_company', 'restore_company', 'close_month', 'reopen_month', 'freeze_report', 'plan_create', 'plan_delete',
                    'module_enable', 'module_disable', 'module_custom', 'module_access'));

create or replace function public.module_enable(p_company uuid, p_key text, p_enabled boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare v_kind text; v_role public.member_role;
begin
  if p_company is null or not private.company_can(p_company, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.rate_limit_hit('module_admin', (select auth.uid())::text) then raise exception 'too many changes; try again later' using errcode = '53400'; end if;
  select case when k.kind = 'builtin' then 'builtin' else 'catalog' end, k.default_role into v_kind, v_role from private.module_keys k where k.key = p_key;
  -- A module the company built: its row (and definition) exists already; closing and opening it again only flips enabled.
  if v_kind is null and exists (select 1 from public.company_modules where company_id = p_company and key = p_key and kind = 'custom') then
    v_kind := 'custom';
  end if;
  if v_kind is null then raise exception 'unknown module' using errcode = '22023'; end if;
  if v_kind = 'custom' then
    update public.company_modules set enabled = coalesce(p_enabled, true), updated_by = (select auth.uid()), updated_at = now()
     where company_id = p_company and key = p_key;
  else
  insert into public.company_modules (company_id, key, kind, enabled, min_role)
  values (p_company, p_key, v_kind, coalesce(p_enabled, true), coalesce(v_role, 'viewer'))
  on conflict (company_id, key) do update set enabled = excluded.enabled, updated_by = (select auth.uid()), updated_at = now();
  end if;
  perform private.modules_audit(p_company, case when coalesce(p_enabled, true) then 'module_enable' else 'module_disable' end, p_key, '{}'::jsonb);
end $$;

-- A module the company builds from its own file. The definition is checked in the app (its schema) and here (key, size,
-- at most 30 per company). Saving again updates it; the rows already saved stay.
-- p_new: a module being built, never an edit, so a key already used (by any module of the company) is refused instead
-- of overwriting that module's definition.
drop function if exists public.module_save_custom(uuid, text, text, jsonb);
create or replace function public.module_save_custom(p_company uuid, p_key text, p_name text, p_spec jsonb, p_new boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_company is null or not private.company_can(p_company, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.rate_limit_hit('module_admin', (select auth.uid())::text) then raise exception 'too many changes; try again later' using errcode = '53400'; end if;
  if p_key !~ '^c_[a-z0-9_]{1,37}$' then raise exception 'a custom module key starts with c_' using errcode = '22023'; end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'object' or pg_column_size(p_spec) > 60000 then raise exception 'bad definition' using errcode = '22023'; end if;
  if coalesce(length(trim(p_name)), 0) = 0 or length(p_name) > 80 then raise exception 'name required (80 characters at most)' using errcode = '22023'; end if;
  if coalesce(p_new, false) and exists (select 1 from public.company_modules where company_id = p_company and key = p_key) then
    raise exception 'a module with this key exists already; choose another name' using errcode = '23505';
  end if;
  if not exists (select 1 from public.company_modules where company_id = p_company and key = p_key)
     and (select count(*) from public.company_modules where company_id = p_company and kind = 'custom') >= 30 then
    raise exception 'at most 30 custom modules per company' using errcode = '22023';
  end if;
  insert into public.company_modules (company_id, key, kind, enabled, spec, name)
  values (p_company, p_key, 'custom', true, p_spec, trim(p_name))
  on conflict (company_id, key) do update set spec = excluded.spec, name = excluded.name, enabled = true, updated_by = (select auth.uid()), updated_at = now();
  perform private.modules_audit(p_company, 'module_custom', p_key, jsonb_build_object('name', trim(p_name)));
end $$;

-- Who may see a module: everyone from a role up, plus named people of the company's organisation.
create or replace function public.module_set_access(p_company uuid, p_key text, p_min_role public.member_role, p_members uuid[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.company_org(p_company);
begin
  if p_company is null or not private.company_can(p_company, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.rate_limit_hit('module_admin', (select auth.uid())::text) then raise exception 'too many changes; try again later' using errcode = '53400'; end if;
  if coalesce(array_length(p_members, 1), 0) > 200 then raise exception 'at most 200 people' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_members, '{}')) u where not exists (select 1 from public.memberships m where m.org_id = v_org and m.user_id = u)) then
    raise exception 'everyone named must be a member of this organisation' using errcode = '22023';
  end if;
  -- Access is set on a module the company has open; it never opens one. A module open by default (Purchasing) gets its
  -- row here, as it is.
  if not private.module_open(p_company, p_key) or exists (select 1 from private.module_keys where key = p_key and kind = 'builtin') then
    raise exception 'open the module first' using errcode = '22023';
  end if;
  insert into public.company_modules (company_id, key, kind, enabled, min_role)
  select p_company, p_key, 'catalog', true, k.default_role from private.module_keys k where k.key = p_key
  on conflict (company_id, key) do nothing;
  update public.company_modules set min_role = p_min_role, members = (select coalesce(array_agg(distinct u), '{}') from unnest(coalesce(p_members, '{}')) u),
         updated_by = (select auth.uid()), updated_at = now()
   where company_id = p_company and key = p_key;
  perform private.modules_audit(p_company, 'module_access', p_key, jsonb_build_object('min_role', p_min_role, 'members', coalesce(array_length(p_members, 1), 0)));
end $$;

revoke execute on function public.module_enable(uuid, text, boolean), public.module_save_custom(uuid, text, text, jsonb, boolean),
  public.module_set_access(uuid, text, public.member_role, uuid[]) from public, anon;
grant execute on function public.module_enable(uuid, text, boolean), public.module_save_custom(uuid, text, text, jsonb, boolean),
  public.module_set_access(uuid, text, public.member_role, uuid[]) to authenticated;

-- ---------------------------------------------------------------- saving: only into an opened module the person may see
create or replace function public.module_batch_begin(p_company uuid, p_module text, p_periods text[], p_filename text default null, p_report jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if p_company is null or not private.company_can(p_company, 'editor') or not private.module_visible(p_company, p_module) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.module_open(p_company, p_module) or exists (select 1 from private.module_keys where key = p_module and kind = 'builtin') then
    raise exception 'unknown module' using errcode = '22023';
  end if;
  if coalesce(array_length(p_periods, 1), 0) = 0 or array_length(p_periods, 1) > 600 then raise exception 'periods required (1 to 600)'; end if;
  if exists (select 1 from unnest(p_periods) p where p !~ '^\d{4}-(0[1-9]|1[0-2])$') then raise exception 'bad period'; end if;
  if pg_column_size(coalesce(p_report, '{}'::jsonb)) > 100000 then raise exception 'report too large'; end if;
  delete from public.module_batches where company_id = p_company and status = 'open' and created_at < now() - interval '1 day';
  insert into public.module_batches (company_id, module, filename, periods, report)
  values (p_company, p_module, left(p_filename, 300), (select array_agg(distinct p order by p) from unnest(p_periods) p), coalesce(p_report, '{}'::jsonb))
  returning id into v;
  return v;
end $$;

-- ---------------------------------------------------------------- reading, with filters
-- p_filters: {"field": ["value", ...]} on any saved field (partner and doc included); p_dims: fields to total by (top 20
-- each); p_measures: numeric fields to total by month. Months come back for the whole history (the period picker);
-- everything else for p_from..p_to.
-- The module's live rows that pass the filters (shared by the summary and the rows page).
create or replace function private.module_rows_of(p_company uuid, p_module text, p_filters jsonb)
returns table (id bigint, period text, day date, doc text, partner text, amount numeric, qty numeric, data jsonb)
language sql stable security definer set search_path = '' as $$
  select x.id, x.period, x.day, x.doc, x.partner, x.amount, x.qty, x.data
    from public.module_rows x join public.module_batches b on b.id = x.batch_id and b.status = 'live'
   where x.company_id = p_company and x.module = p_module
     and not exists (select 1 from jsonb_each(coalesce(p_filters, '{}'::jsonb)) f
                      where not coalesce(case f.key when 'partner' then x.partner when 'doc' then x.doc else x.data ->> f.key end, '') in (select jsonb_array_elements_text(f.value)))
$$;
revoke execute on function private.module_rows_of(uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.module_filters_ok(p_filters jsonb) returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) = 'object'
     and not exists (select 1 from jsonb_each(coalesce(p_filters, '{}'::jsonb)) f where f.key !~ '^[a-z][a-z0-9_]{0,39}$' or jsonb_typeof(f.value) <> 'array' or jsonb_array_length(f.value) > 100)
$$;

drop function if exists public.module_summary(uuid, text);
create or replace function public.module_summary(p_company uuid, p_module text, p_from text default null, p_to text default null,
  p_filters jsonb default '{}'::jsonb, p_dims text[] default '{}', p_measures text[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_dims jsonb := '{}'::jsonb; v_meas jsonb := '{}'::jsonb; d text;
begin
  if p_company is null or not private.module_visible(p_company, p_module) then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(array_length(p_dims, 1), 0) > 8 or coalesce(array_length(p_measures, 1), 0) > 8 then raise exception 'at most 8 dimensions and 8 measures' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_dims, '{}') || coalesce(p_measures, '{}')) k where k !~ '^[a-z][a-z0-9_]{0,39}$') then raise exception 'bad field' using errcode = '22023'; end if;
  if not private.module_filters_ok(p_filters) then raise exception 'bad filter' using errcode = '22023'; end if;
  foreach d in array coalesce(p_dims, '{}') loop
    v_dims := v_dims || jsonb_build_object(d, (select coalesce(jsonb_agg(jsonb_build_object('value', v, 'amount', a, 'rows', n) order by a desc), '[]'::jsonb) from (
      select coalesce(case d when 'partner' then r.partner when 'doc' then r.doc else r.data ->> d end, '') v, sum(r.amount) a, count(*) n
        from private.module_rows_of(p_company, p_module, p_filters) r
       where (p_from is null or r.period >= p_from) and (p_to is null or r.period <= p_to) group by 1 order by sum(r.amount) desc limit 20) q));
  end loop;
  foreach d in array coalesce(p_measures, '{}') loop
    v_meas := v_meas || jsonb_build_object(d, (select coalesce(jsonb_object_agg(q.period, q.s), '{}'::jsonb) from (
      select r.period, sum(case when (r.data ->> d) ~ '^-?[0-9]+(\.[0-9]+)?$' then (r.data ->> d)::numeric else 0 end) s
        from private.module_rows_of(p_company, p_module, p_filters) r group by r.period) q));
  end loop;
  return (
    with a as (select * from private.module_rows_of(p_company, p_module, p_filters)),
         w as (select * from a where (p_from is null or period >= p_from) and (p_to is null or period <= p_to))
    select jsonb_build_object(
      'rows', (select count(*) from w),
      'docs', (select count(distinct doc) from w where doc <> ''),
      'amount', (select coalesce(sum(amount), 0) from w),
      'periods', (select coalesce(jsonb_agg(jsonb_build_object('period', period, 'amount', s, 'qty', q, 'rows', n) order by period), '[]'::jsonb)
                    from (select period, sum(amount) s, sum(qty) q, count(*) n from a group by period) p),
      'partners', (select coalesce(jsonb_agg(jsonb_build_object('partner', partner, 'amount', s, 'rows', n) order by s desc), '[]'::jsonb)
                     from (select partner, sum(amount) s, count(*) n from w group by partner order by sum(amount) desc limit 50) p),
      'dims', v_dims, 'measures', v_meas,
      'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'filename', filename, 'at', created_at, 'rows', rows) order by created_at desc), '[]'::jsonb)
                    from public.module_batches where company_id = p_company and module = p_module and status = 'live'))
  );
end $$;

drop function if exists public.module_rows_page(uuid, text, integer, integer);
create or replace function public.module_rows_page(p_company uuid, p_module text, p_offset integer default 0, p_limit integer default 100,
  p_from text default null, p_to text default null, p_filters jsonb default '{}'::jsonb, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_company is null or not private.module_visible(p_company, p_module) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.module_filters_ok(p_filters) then raise exception 'bad filter' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.period desc, x.id), '[]'::jsonb) from (
    select r.* from private.module_rows_of(p_company, p_module, p_filters) r
     where (p_from is null or r.period >= p_from) and (p_to is null or r.period <= p_to)
       and (coalesce(p_search, '') = '' or r.partner ilike '%' || left(p_search, 80) || '%' or r.doc ilike '%' || left(p_search, 80) || '%')
     order by r.period desc, r.id
     offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 100), 1), 200)) x);
end $$;

revoke execute on function public.module_summary(uuid, text, text, text, jsonb, text[], text[]),
  public.module_rows_page(uuid, text, integer, integer, text, text, jsonb, text) from public, anon;
grant execute on function public.module_summary(uuid, text, text, text, jsonb, text[], text[]),
  public.module_rows_page(uuid, text, integer, integer, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------- clearing data respects who may see a module
-- 0062's preview and clear counted, listed and removed every module's rows; they now see only the modules the person may
-- see (module_visible), so HR's file names and counts never reach someone without HR access, and their clear leaves HR.
create or replace function private.reset_counts(p_company uuid, p_scope text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
begin
  if p_scope = 'financials' then
    select count(*) into n from public.source_accounts where company_id = p_company; r := r || jsonb_build_object('accounts', n);
    select count(*) into n from public.account_balances where company_id = p_company; r := r || jsonb_build_object('balances', n);
    select count(*) into n from public.imports where company_id = p_company; r := r || jsonb_build_object('versions', n);
    select count(*) into n from public.sales_lines where company_id = p_company and source = 'ledger'; r := r || jsonb_build_object('sales_lines_from_ledger', n);
    select count(*) into n from public.expense_lines where company_id = p_company and source = 'ledger'; r := r || jsonb_build_object('expense_lines_from_ledger', n);
    select count(*) into n from public.stock_ledger_lines where company_id = p_company; r := r || jsonb_build_object('stock_postings', n);
    select count(*) into n from public.payment_lines l join public.payment_batches b on b.id = l.batch_id where b.company_id = p_company and b.source = 'ledger'; r := r || jsonb_build_object('payments_from_ledger', n);
    select count(*) into n from public.commentary where company_id = p_company; r := r || jsonb_build_object('commentary', n);
    select count(*) into n from public.reports where company_id = p_company; r := r || jsonb_build_object('reports', n);
  elsif p_scope = 'sales' then
    select count(*) into n from public.sales_lines where company_id = p_company; r := r || jsonb_build_object('sales_lines', n);
  elsif p_scope = 'expenses' then
    select count(*) into n from public.expense_lines where company_id = p_company; r := r || jsonb_build_object('expense_lines', n);
  elsif p_scope = 'stock' then
    select count(*) into n from public.stock_layers where company_id = p_company; r := r || jsonb_build_object('valuation_layers', n);
    select count(*) into n from public.stock_moves where company_id = p_company; r := r || jsonb_build_object('stock_moves', n);
    select count(*) into n from public.stock_onhand where company_id = p_company; r := r || jsonb_build_object('on_hand', n);
    select count(*) into n from public.inventory_products where company_id = p_company; r := r || jsonb_build_object('products', n);
    select count(*) into n from public.import_jobs where company_id = p_company; r := r || jsonb_build_object('import_jobs', n);
  elsif p_scope = 'payments' then
    select count(*) into n from public.aged_items where company_id = p_company; r := r || jsonb_build_object('ageing_items', n);
    select count(*) into n from public.payment_lines where company_id = p_company; r := r || jsonb_build_object('payment_lines', n);
  elsif p_scope = 'end_users' then
    select count(*) into n from public.end_user_map where company_id = p_company; r := r || jsonb_build_object('end_user_choices', n);
    select count(*) into n from public.agency_statement_lines where company_id = p_company; r := r || jsonb_build_object('statement_lines', n);
  elsif p_scope = 'modules' then
    select count(*) into n from public.module_rows x join public.module_batches b on b.id = x.batch_id and b.status = 'live' where x.company_id = p_company and private.module_visible(p_company, x.module); r := r || jsonb_build_object('module_rows', n);
  else
    raise exception 'unknown scope %', p_scope;
  end if;
  return r;
end $$;
revoke execute on function private.reset_counts(uuid, text) from public, anon, authenticated;

create or replace function private.reset_uploads(p_company uuid, p_scope text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(u order by u ->> 'at' desc), '[]'::jsonb) from (select u from (
    select jsonb_build_object('name', coalesce(filename, kind), 'at', created_at, 'kind', kind) u from public.imports where p_scope = 'financials' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Sales lines'), 'at', created_at, 'kind', source) from public.sales_batches where p_scope = 'sales' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Expense lines'), 'at', created_at, 'kind', source) from public.expense_batches where p_scope = 'expenses' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, kind), 'at', created_at, 'kind', kind) from public.inventory_batches where p_scope = 'stock' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, side), 'at', created_at, 'kind', side) from public.aged_reports where p_scope = 'payments' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Payments'), 'at', created_at, 'kind', source) from public.payment_batches where p_scope = 'payments' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, 'Agency statement'), 'at', created_at, 'kind', 'statement') from public.agency_statement_batches where p_scope = 'end_users' and company_id = p_company
    union all select jsonb_build_object('name', coalesce(filename, module), 'at', created_at, 'kind', module) from public.module_batches where p_scope = 'modules' and company_id = p_company and status = 'live' and private.module_visible(p_company, module)
  ) a(u) order by u ->> 'at' desc limit 50) x
$$;
revoke execute on function private.reset_uploads(uuid, text) from public, anon, authenticated;

create or replace function private.clear_scope(p_company uuid, p_scope text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb;
begin
  if p_scope = 'financials' then
    delete from public.sales_batches where company_id = p_company and source = 'ledger';
    delete from public.expense_batches where company_id = p_company and source = 'ledger';
    delete from public.stock_ledger_batches where company_id = p_company;
    delete from public.payment_batches where company_id = p_company and source = 'ledger';
    delete from public.account_balances where company_id = p_company;
    delete from public.source_accounts where company_id = p_company;
    delete from public.imports where company_id = p_company;
    delete from public.commentary where company_id = p_company;
    delete from public.reports where company_id = p_company;
    -- No figures left: the books read as empty, and the opening and Trial Balance check that described them go too.
    select kpi_config into v_cfg from public.companies where id = p_company;
    update public.companies set data_version = 0, last_synced_at = null,
      kpi_config = case when v_cfg ? 'profile' then jsonb_set(v_cfg, '{profile}', (v_cfg -> 'profile') - 'openingAsAt' - 'tbCheck') else v_cfg end
     where id = p_company;
  elsif p_scope = 'sales' then
    delete from public.sales_batches where company_id = p_company;
  elsif p_scope = 'expenses' then
    delete from public.expense_batches where company_id = p_company;
  elsif p_scope = 'stock' then
    -- An import the background runner is saving holds its job row: wait for nobody, refuse instead. Jobs still waiting or
    -- being prepared are stopped and removed with the stock (D18).
    begin
      perform 1 from public.import_jobs where company_id = p_company for update nowait;
    exception when lock_not_available then
      raise exception 'A stock import is being saved right now; clear stock again once it has finished';
    end;
    if exists (select 1 from public.import_jobs where company_id = p_company and status in ('checking', 'saving')) then
      raise exception 'A stock import is being saved right now; clear stock again once it has finished';
    end if;
    delete from public.import_jobs where company_id = p_company;
    delete from public.stock_layers where company_id = p_company;
    delete from public.stock_moves where company_id = p_company;
    delete from public.stock_onhand where company_id = p_company;
    delete from public.inventory_products where company_id = p_company;
    delete from public.inventory_batches where company_id = p_company;
    delete from public.inventory_rollups where company_id = p_company;
    delete from private.inventory_marks where company_id = p_company;
  elsif p_scope = 'payments' then
    delete from public.aged_reports where company_id = p_company;
    delete from public.payment_batches where company_id = p_company;
    select kpi_config into v_cfg from public.companies where id = p_company;
    update public.companies set kpi_config = jsonb_set(v_cfg, '{profile}', (v_cfg -> 'profile') - 'controlAccounts') where id = p_company and v_cfg ? 'profile';
  elsif p_scope = 'end_users' then
    delete from public.end_user_map where company_id = p_company;
    delete from public.agency_statement_batches where company_id = p_company;
  elsif p_scope = 'modules' then
    -- Only the modules this person may see: an editor without HR access never removes (or learns of) HR rows.
    delete from public.module_batches where company_id = p_company and private.module_visible(p_company, module);
  else
    raise exception 'unknown scope %', p_scope;
  end if;
end $$;
revoke execute on function private.clear_scope(uuid, text) from public, anon, authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('module_admin', 'user', 3600, 120)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

select private.adopt_company_roles();
do $$ begin
  perform private.install_tenant_guards();
  perform private.install_period_locks();
end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 63 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
