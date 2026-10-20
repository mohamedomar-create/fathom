-- 0031: clearing imported data and deleting a company, safely.
--  * data_reset_preview: what each module holds (records per table, its uploads, the stored source files), for the
--    confirmation screen. Members only.
--  * clear_company_data: removes one module's imported data, or all of it, in one transaction. One module needs an
--    editor, everything an admin. The caller sends the record count it was shown; if the data changed since, nothing is
--    removed. Running import jobs are cancelled first. The company's profile, members, settings, account classes and
--    remembered export layouts are kept, so it is ready for a clean upload.
--  * delete_company: admins only, the company's name typed exactly; the record of the deletion outlives the company.
--  * company_data_audit: who cleared or deleted what, when, with the counts. Kept after the company is gone.
--  * Stored source files ({company}/{job}/{file} in the "imports" bucket) may be removed by the company's editors, so
--    nothing is left behind (the server removes them through the Storage API before the rows go).
-- Adds objects only; removes nothing on its own. Safe to run again. Needs 0030.

create table if not exists public.company_data_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null,
  company_name text not null default '',
  actor uuid default auth.uid() references auth.users (id) on delete set null,
  action text not null check (action in ('clear_module', 'clear_all', 'delete_company')),
  scope text not null,
  counts jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists company_data_audit_org_idx on public.company_data_audit (org_id, at desc);
alter table public.company_data_audit enable row level security;
drop policy if exists company_data_audit_select on public.company_data_audit;
create policy company_data_audit_select on public.company_data_audit for select to authenticated using (private.is_member(org_id));
revoke all on public.company_data_audit from anon;
revoke insert, update, delete on public.company_data_audit from authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('reset', 'company', 3600, 20)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

-- ---------------------------------------------------------------- what each module holds
-- Records per table for one module of one company. Scopes: financials, sales, expenses, stock, payments, end_users.
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
  else
    raise exception 'unknown scope %', p_scope;
  end if;
  return r;
end $$;
revoke execute on function private.reset_counts(uuid, text) from public, anon, authenticated;

-- The uploads behind one module (newest first, at most 50): what the person recognises on the confirmation screen.
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
  ) a(u) order by u ->> 'at' desc limit 50) x
$$;
revoke execute on function private.reset_uploads(uuid, text) from public, anon, authenticated;

create or replace function public.data_reset_preview(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_counts jsonb;
  v_mods jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_n bigint;
begin
  if not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  foreach v_scope in array array['financials', 'sales', 'expenses', 'stock', 'payments', 'end_users'] loop
    v_counts := private.reset_counts(p_company, v_scope);
    select coalesce(sum(value::bigint), 0) into v_n from jsonb_each_text(v_counts);
    -- Ledger-derived sales and expense lines are counted under both Financials and their own module; the total counts each once.
    v_total := v_total + v_n - case when v_scope = 'financials' then coalesce((v_counts ->> 'sales_lines_from_ledger')::bigint, 0) + coalesce((v_counts ->> 'expense_lines_from_ledger')::bigint, 0) + coalesce((v_counts ->> 'payments_from_ledger')::bigint, 0) else 0 end;
    v_mods := v_mods || jsonb_build_object(v_scope, jsonb_build_object('records', v_n, 'tables', v_counts, 'uploads', private.reset_uploads(p_company, v_scope)));
  end loop;
  return jsonb_build_object(
    'company', (select name from public.companies where id = p_company),
    'modules', v_mods,
    'total', v_total,
    'files', (select coalesce(jsonb_agg(storage_path), '[]'::jsonb) from public.import_files where company_id = p_company and storage_path is not null));
end $$;
revoke execute on function public.data_reset_preview(uuid) from public, anon;
grant execute on function public.data_reset_preview(uuid) to authenticated;

-- ---------------------------------------------------------------- clearing
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
  else
    raise exception 'unknown scope %', p_scope;
  end if;
end $$;
revoke execute on function private.clear_scope(uuid, text) from public, anon, authenticated;

-- p_scope: one module, or 'all'. p_confirm: the record count the person was shown for that scope (the preview's
-- module "records", or its "total" for 'all'). Returns what was removed, per module.
create or replace function public.clear_company_data(p_company uuid, p_scope text, p_confirm bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.company_org(p_company);
  v_preview jsonb;
  v_shown bigint;
  v_scope text;
  v_scopes text[];
  v_counts jsonb := '{}'::jsonb;
begin
  if p_scope not in ('financials', 'sales', 'expenses', 'stock', 'payments', 'end_users', 'all') then raise exception 'unknown scope' using errcode = '22023'; end if;
  if v_org is null or not private.is_member(v_org, case when p_scope = 'all' then 'admin' else 'editor' end::public.member_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.companies where id = p_company for update;
  v_preview := public.data_reset_preview(p_company);
  v_shown := case when p_scope = 'all' then (v_preview ->> 'total')::bigint else (v_preview #>> array['modules', p_scope, 'records'])::bigint end;
  if v_shown is distinct from p_confirm then raise exception 'the data changed since it was shown; look again before clearing' using errcode = '40001'; end if;
  -- Stock last: clearing the ledger's stock postings marks the stock summary for a rebuild, and the stock clear removes it.
  v_scopes := case when p_scope = 'all' then array['payments', 'end_users', 'sales', 'expenses', 'financials', 'stock'] else array[p_scope] end;
  foreach v_scope in array v_scopes loop
    v_counts := v_counts || jsonb_build_object(v_scope, v_preview #> array['modules', v_scope, 'tables']);
    perform private.clear_scope(p_company, v_scope);
  end loop;
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (v_org, p_company, coalesce(v_preview ->> 'company', ''), case when p_scope = 'all' then 'clear_all' else 'clear_module' end, p_scope, v_counts);
  return v_counts;
end $$;
revoke execute on function public.clear_company_data(uuid, text, bigint) from public, anon;
grant execute on function public.clear_company_data(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------- deleting a company
create or replace function public.delete_company(p_company uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := private.company_org(p_company);
  v_name text;
  v_preview jsonb;
begin
  if v_org is null or not private.is_member(v_org, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  select name into v_name from public.companies where id = p_company for update;
  if v_name is distinct from p_name then raise exception 'the name typed does not match the company' using errcode = '22023'; end if;
  v_preview := public.data_reset_preview(p_company);
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (v_org, p_company, v_name, 'delete_company', 'company',
          (select coalesce(jsonb_object_agg(key, value -> 'tables'), '{}'::jsonb) from jsonb_each(v_preview -> 'modules')) || jsonb_build_object('files', jsonb_array_length(v_preview -> 'files')));
  delete from public.companies where id = p_company;
  return v_preview -> 'modules';
end $$;
revoke execute on function public.delete_company(uuid, text) from public, anon;
grant execute on function public.delete_company(uuid, text) to authenticated;

-- ---------------------------------------------------------------- stored source files (on Supabase)
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists imports_delete on storage.objects';
    -- Remove: the company's editors, for files stored under that company ({company}/...).
    execute $p$create policy imports_delete on storage.objects for delete to authenticated using (
      bucket_id = 'imports' and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
      and private.is_member(private.company_org(split_part(name, '/', 1)::uuid), 'editor'))$p$;
  end if;
end $$;
