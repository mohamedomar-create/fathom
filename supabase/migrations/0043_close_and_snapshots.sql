-- 0043: month close and report snapshots.
--  * companies.closed_through ('YYYY-MM'): the books are closed up to and including that month. Only the owner or an
--    admin, with two-step sign-in and a fresh sign-in, closes or reopens a month (close_month / reopen_month), and each
--    is recorded in company_data_audit. Nobody sets the column directly.
--  * Nothing in a closed month changes, by any path (the app, a direct write, or the database's own save functions):
--      - every company table with a month (period) and the cash book (day) refuses an insert, change or delete that
--        touches a closed month (trigger period_lock, put on every such table by private.install_period_locks());
--      - stored balances: the current version's closed months cannot be changed or deleted, an account with closed
--        balances cannot be reclassified, and a new or restored version must carry the closed months unchanged
--        (checked when the transaction ends);
--      - re-applying expense classes leaves closed months as they are.
--    Removing the company itself is still possible (the rows go with it).
--  * report_snapshots: publishing freezes the figures a shared link shows (the report, its sales and its expenses).
--    The link keeps showing them until an editor updates them (freeze_report, recorded) or sharing stops. Reports already
--    published are frozen now, as they stand.
-- Safe to run again. Needs 0042.
set client_min_messages = warning;

-- ---------------------------------------------------------------- the closed month
alter table public.companies add column if not exists closed_through text check (closed_through ~ '^\d{4}-(0[1-9]|1[0-2])$');

create or replace function private.closed_through_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.closed_through is distinct from old.closed_through and current_user in ('authenticated', 'anon') then
    raise exception 'Months are closed and reopened in Settings, Month close.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists closed_through_guard on public.companies;
create trigger closed_through_guard before update of closed_through on public.companies for each row execute function private.closed_through_guard();

create or replace function private.month_closed(p_company uuid, p_month text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_month is not null and coalesce(p_month <= (select c.closed_through from public.companies c where c.id = p_company), false)
$$;
revoke execute on function private.month_closed(uuid, text) from public, anon, authenticated;

create or replace function private.refuse_closed(p_month text) returns void language plpgsql set search_path = '' as $$
begin
  raise exception '% is a closed month. Reopen it in Settings, Month close, to change it.', p_month using errcode = 'P0001', hint = 'month_closed';
end $$;

-- One trigger for every table with a month. Argument: 'period' (a YYYY-MM column) or 'day' (a date column).
create or replace function private.period_lock() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_m text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_m := case tg_argv[0] when 'day' then to_char((to_jsonb(old) ->> 'day')::date, 'YYYY-MM') else to_jsonb(old) ->> 'period' end;
    if private.month_closed(old.company_id, v_m) then perform private.refuse_closed(v_m); end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_m := case tg_argv[0] when 'day' then to_char((to_jsonb(new) ->> 'day')::date, 'YYYY-MM') else to_jsonb(new) ->> 'period' end;
    if private.month_closed(new.company_id, v_m) then perform private.refuse_closed(v_m); end if;
    return new;
  end if;
  return old;
end $$;

-- Stored balances keep every version; only the current version's closed months are locked (older versions may be pruned).
create or replace function private.balance_lock() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.month_closed(old.company_id, old.period)
     and exists (select 1 from public.source_accounts s join public.companies c on c.id = s.company_id and c.data_version = s.version where s.id = old.account_id) then
    perform private.refuse_closed(old.period);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function private.account_class_lock() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_m text;
begin
  if (new.class, new.statement) is distinct from (old.class, old.statement)
     and exists (select 1 from public.companies c where c.id = old.company_id and c.data_version = old.version) then
    select max(b.period) into v_m from public.account_balances b
     where b.account_id = old.id and b.amount <> 0 and private.month_closed(old.company_id, b.period);
    if v_m is not null then perform private.refuse_closed(v_m); end if;
  end if;
  return new;
end $$;
drop trigger if exists account_class_lock on public.source_accounts;
create trigger account_class_lock before update of class, statement on public.source_accounts for each row execute function private.account_class_lock();

-- A new or restored version of the books must agree with the current one in every closed month, account by account
-- (by code, or by name where there is no code) and class. Checked when the save's transaction ends, once its rows exist.
create or replace function private.closed_books_kept() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_closed text; v_now int; v_m text;
begin
  select c.closed_through, c.data_version into v_closed, v_now from public.companies c where c.id = new.id;
  if v_closed is null or v_now is not distinct from old.data_version then return null; end if;
  with a as (
    select coalesce(nullif(s.code, ''), s.name) k, s.class, b.period, sum(b.amount) amt from public.source_accounts s
      join public.account_balances b on b.account_id = s.id
     where s.company_id = new.id and s.version = old.data_version and b.period <= v_closed group by 1, 2, 3
  ), z as (
    select coalesce(nullif(s.code, ''), s.name) k, s.class, b.period, sum(b.amount) amt from public.source_accounts s
      join public.account_balances b on b.account_id = s.id
     where s.company_id = new.id and s.version = v_now and b.period <= v_closed group by 1, 2, 3
  )
  select max(coalesce(a.period, z.period)) into v_m from a full join z on z.k = a.k and z.class = a.class and z.period = a.period
   where abs(coalesce(a.amt, 0) - coalesce(z.amt, 0)) >= 0.005;
  if v_m is not null then perform private.refuse_closed(v_m); end if;
  return null;
end $$;
drop trigger if exists closed_books_kept on public.companies;
create constraint trigger closed_books_kept after update of data_version on public.companies
  deferrable initially deferred for each row execute function private.closed_books_kept();

-- Puts the lock on every company table with a month, so a table added later is covered by running this again (the
-- database test fails while any table is missing it).
create or replace function private.install_period_locks() returns void language plpgsql set search_path = '' as $$
declare r record;
begin
  for r in
    select c.relname, case when exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'period' and not a.attisdropped) then 'period' else 'day' end kind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'account_balances'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
       and (exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'period' and not a.attisdropped) or c.relname = 'cash_entries')
  loop
    execute format('drop trigger if exists period_lock on public.%I', r.relname);
    execute format('create trigger period_lock before insert or update or delete on public.%I for each row execute function private.period_lock(%L)', r.relname, r.kind);
  end loop;
  drop trigger if exists balance_lock on public.account_balances;
  create trigger balance_lock before update or delete on public.account_balances for each row execute function private.balance_lock();
end $$;
revoke execute on function private.install_period_locks() from public;

-- Closing and reopening: the owner or an admin, with two-step sign-in and a fresh sign-in. Recorded.
alter table public.company_data_audit drop constraint if exists company_data_audit_action_check;
alter table public.company_data_audit add constraint company_data_audit_action_check
  check (action in ('clear_module', 'clear_all', 'delete_company', 'transfer_company', 'restore_company', 'close_month', 'reopen_month', 'freeze_report'));
create or replace function private.company_audit_mfa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action in ('clear_all', 'delete_company', 'transfer_company', 'restore_company', 'close_month', 'reopen_month') then perform private.require_aal2(); end if;
  if new.action in ('clear_all', 'delete_company', 'transfer_company', 'close_month', 'reopen_month') then perform private.require_recent(); end if;
  return new;
end $$;

create or replace function public.close_month(p_company uuid, p_month text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.company_org(p_company); v_cur text; v_name text;
begin
  if v_org is null or not private.is_member(v_org, 'admin') then raise exception 'Only the owner or an admin can close a month.' using errcode = '42501'; end if;
  perform private.require_aal2();
  perform private.require_recent();
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Choose a month to close.'; end if;
  select c.closed_through, c.name into v_cur, v_name from public.companies c where c.id = p_company for update;
  if v_cur is not null and p_month <= v_cur then raise exception '% is already closed.', p_month; end if;
  update public.companies set closed_through = p_month where id = p_company;
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (v_org, p_company, coalesce(v_name, ''), 'close_month', p_month, jsonb_build_object('from', v_cur));
  return p_month;
end $$;

create or replace function public.reopen_month(p_company uuid, p_month text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.company_org(p_company); v_cur text; v_name text; v_to text;
begin
  if v_org is null or not private.is_member(v_org, 'admin') then raise exception 'Only the owner or an admin can reopen a month.' using errcode = '42501'; end if;
  perform private.require_aal2();
  perform private.require_recent();
  select c.closed_through, c.name into v_cur, v_name from public.companies c where c.id = p_company for update;
  if v_cur is null or p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_month > v_cur then raise exception '% is not closed.', coalesce(p_month, 'That month'); end if;
  -- Reopening a month reopens every later one too: the books stay closed up to the month before.
  v_to := to_char(to_date(p_month || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM');
  update public.companies set closed_through = v_to where id = p_company;
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (v_org, p_company, coalesce(v_name, ''), 'reopen_month', p_month, jsonb_build_object('from', v_cur, 'to', v_to));
  return v_to;
end $$;
revoke execute on function public.close_month(uuid, text), public.reopen_month(uuid, text) from public, anon;
grant execute on function public.close_month(uuid, text), public.reopen_month(uuid, text) to authenticated;

-- Re-applying expense classes (0033) leaves closed months as they are.
create or replace function public.restamp_expense_classes(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_closed text := coalesce((select closed_through from public.companies where id = p_company), '');
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  with c as materialized (select account, private.expense_class_for(p_company, account) cls
               from (select distinct account from public.expense_lines where company_id = p_company and period > v_closed) a)
  update public.expense_lines e set cls = c.cls
    from c
   where e.company_id = p_company and e.period > v_closed and e.account = c.account and c.cls is not null and e.cls is distinct from c.cls;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.restamp_expense_classes(uuid) from public, anon;
grant execute on function public.restamp_expense_classes(uuid) to authenticated;

-- ---------------------------------------------------------------- report snapshots
create table if not exists public.report_snapshots (
  report_id uuid primary key references public.reports (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  report jsonb not null,
  sales jsonb,
  expenses jsonb,
  data_version integer,
  frozen_at timestamptz not null default now(),
  frozen_by uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists report_snapshots_company_idx on public.report_snapshots (company_id);
alter table public.report_snapshots enable row level security;
drop policy if exists report_snapshots_select on public.report_snapshots;
create policy report_snapshots_select on public.report_snapshots for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.report_snapshots from anon, authenticated;
grant select on public.report_snapshots to authenticated;

-- The functions that build a link's figures from the live books move to private (once), and the public names read the
-- snapshot first.
do $$ begin
  if to_regprocedure('private.published_report_live(text)') is null then
    alter function public.get_published_report(text) set schema private;
    alter function private.get_published_report(text) rename to published_report_live;
  end if;
  if to_regprocedure('private.published_sales_live(text)') is null then
    alter function public.get_published_sales(text) set schema private;
    alter function private.get_published_sales(text) rename to published_sales_live;
  end if;
  if to_regprocedure('private.published_expenses_live(text)') is null then
    alter function public.get_published_expenses(text) set schema private;
    alter function private.get_published_expenses(text) rename to published_expenses_live;
  end if;
end $$;
revoke execute on function private.published_report_live(text), private.published_sales_live(text), private.published_expenses_live(text) from public, anon, authenticated;

create or replace function private.shared_report(p_token text) returns uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.reports r where r.share_token = p_token and r.status = 'published' and (r.expires_at is null or r.expires_at > now())
$$;
revoke execute on function private.shared_report(text) from public, anon, authenticated;

create or replace function public.get_published_report(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := private.shared_report(p_token); s public.report_snapshots;
begin
  if v_id is null then return null; end if;
  select * into s from public.report_snapshots where report_id = v_id;
  if found then return s.report || jsonb_build_object('frozen_at', s.frozen_at); end if;
  return private.published_report_live(p_token);
end $$;
create or replace function public.get_published_sales(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := private.shared_report(p_token); s public.report_snapshots;
begin
  if v_id is null then return null; end if;
  select * into s from public.report_snapshots where report_id = v_id;
  if found then return s.sales; end if;
  return private.published_sales_live(p_token);
end $$;
create or replace function public.get_published_expenses(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := private.shared_report(p_token); s public.report_snapshots;
begin
  if v_id is null then return null; end if;
  select * into s from public.report_snapshots where report_id = v_id;
  if found then return s.expenses; end if;
  return private.published_expenses_live(p_token);
end $$;
revoke execute on function public.get_published_report(text), public.get_published_sales(text), public.get_published_expenses(text) from public;
grant execute on function public.get_published_report(text), public.get_published_sales(text), public.get_published_expenses(text) to anon, authenticated;

create or replace function private.freeze(p_report uuid) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare r public.reports; v_rep jsonb; v_at timestamptz := now();
begin
  select * into r from public.reports where id = p_report;
  if r.share_token is null or private.shared_report(r.share_token) is null then raise exception 'Publish the report first.'; end if;
  v_rep := private.published_report_live(r.share_token);
  if v_rep is null then raise exception 'Publish the report first.'; end if;
  delete from public.report_snapshots where report_id = p_report;
  insert into public.report_snapshots (report_id, company_id, report, sales, expenses, data_version, frozen_at)
  values (p_report, r.company_id, v_rep, private.published_sales_live(r.share_token), private.published_expenses_live(r.share_token),
          (select data_version from public.companies where id = r.company_id), v_at);
  return v_at;
end $$;
revoke execute on function private.freeze(uuid) from public, anon, authenticated;

-- Editors freeze a published report's figures, at publishing and whenever they choose to update them. Recorded.
create or replace function public.freeze_report(p_report uuid) returns timestamptz language plpgsql security definer set search_path = '' as $$
declare r public.reports; v_at timestamptz;
begin
  select * into r from public.reports where id = p_report;
  if not found or not private.is_member(private.company_org(r.company_id), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_at := private.freeze(p_report);
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (private.company_org(r.company_id), r.company_id, coalesce((select name from public.companies where id = r.company_id), ''), 'freeze_report', r.title, jsonb_build_object('report', p_report));
  return v_at;
end $$;
revoke execute on function public.freeze_report(uuid) from public, anon;
grant execute on function public.freeze_report(uuid) to authenticated;

-- Stopping sharing (or a new link) drops the frozen figures; publishing again freezes them afresh.
create or replace function private.report_unshared() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'published' or new.share_token is distinct from old.share_token then
    delete from public.report_snapshots where report_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists report_unshared on public.reports;
create trigger report_unshared after update of status, share_token on public.reports for each row execute function private.report_unshared();

-- Reports already published are frozen as they stand now.
do $$ declare r record; begin
  for r in select x.id from public.reports x where x.share_token is not null and private.shared_report(x.share_token) is not null
             and not exists (select 1 from public.report_snapshots s where s.report_id = x.id) loop
    begin
      perform private.freeze(r.id);
    exception when others then null;  -- a link whose figures can't be read stays live, as before
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- finish
select private.install_period_locks();
do $$ begin if to_regprocedure('private.install_tenant_guards()') is not null then perform private.install_tenant_guards(); end if; end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 43 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
reset client_min_messages;
