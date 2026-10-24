-- 0038: tenant guards (security hotfix from the expert panel: C01, H01, H02, M01).
--  C01  co_update only checked that the caller edits the old and the new organisation, so an editor who belongs to two
--       organisations could move a company (with its data and Odoo key) into their own. The same was true of every row
--       with a company_id. Now no company, organisation, author or parent link can be changed by a signed-in or
--       signed-out caller; a company moves only through transfer_company (admin of both organisations, audited).
--  H02  created_by / updated_by / invited_by were typed by the caller, so an editor could sign as the owner; the import
--       history (with the reasons checks were accepted) could be edited or deleted. Authors are now the caller, and the
--       import history is written only by the database functions.
--  H01  a public report link returned 36 months of ledger, internal notes, KPI settings, every commentary, accepted
--       issues and every customer line, whatever pages the report shows. Each part is now sent only with its page.
--  M01  signed-out callers could count any rate limit (lock out an address, or fill the table). They now count only a
--       real published link's PDF allowance; the address limit is kept by the server.
--       A new row must also belong to the same company as the row it hangs off (an account, a batch, a report), so no
--       one can add figures under another company's account or batch.
-- Also: TRUNCATE, TRIGGER and REFERENCES are taken from signed-in and signed-out users; a profile's email is no longer
-- editable by its owner. Only adds triggers and functions and narrows grants; safe to run again. The guards skip work
-- done inside the database's own functions (they run as their owner), so uploads, saves and clears are unchanged.
set client_min_messages = warning;
-- Adding triggers locks each table briefly; give up rather than queue behind live traffic (run it again if it times out).
set lock_timeout = '5s';

-- ---------------------------------------------------------------- the guards
-- Columns no client statement may change. Checked only when the statement comes from a signed-in or signed-out caller;
-- security definer functions run as their owner and keep their own checks.
create or replace function private.tenant_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
  o jsonb;
  n jsonb;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  o := to_jsonb(old);
  n := to_jsonb(new);
  foreach k in array tg_argv loop
    if n -> k is distinct from o -> k then
      raise exception '% cannot be changed', k using errcode = '42501', hint = 'A company moves only through transfer_company.';
    end if;
  end loop;
  return new;
end $$;

-- Authors are the caller: created_by on insert, updated_by and invited_by on every write.
create or replace function private.tenant_author()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
  s jsonb := '{}'::jsonb;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  foreach k in array tg_argv loop
    if tg_op = 'INSERT' or k <> 'created_by' then s := s || jsonb_build_object(k, (select auth.uid())); end if;
  end loop;
  new := jsonb_populate_record(new, s);
  return new;
end $$;

-- A child row's company is its parent's: checked on insert and update for signed-in and signed-out callers.
-- Arguments: the parent table and the column that points at it.
create or replace function private.tenant_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ref text;
  ok boolean;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  ref := to_jsonb(new) ->> tg_argv[1];
  if ref is null then return new; end if;
  execute format('select exists (select 1 from %s p where p.id::text = $1 and p.company_id = $2)', tg_argv[0]) into ok using ref, new.company_id;
  if not ok then raise exception '% belongs to another company', tg_argv[1] using errcode = '42501'; end if;
  return new;
end $$;

-- Puts both triggers on every public table that has the columns, so a table added later is covered by running this
-- again (the database test fails while any table is missing them).
create or replace function private.install_tenant_guards()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
  g text[];
  au text[];
begin
  for r in select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' loop
    select array_agg(a.attname::text order by a.attnum) into g from pg_attribute a
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
       and a.attname in ('org_id', 'company_id', 'created_by', 'data_version', 'batch_id', 'report_id', 'account_id', 'import_id', 'job_id', 'user_id');
    select array_agg(a.attname::text order by a.attnum) into au from pg_attribute a
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and a.attname in ('created_by', 'invited_by', 'updated_by');
    execute format('drop trigger if exists tenant_guard on public.%I', r.relname);
    execute format('drop trigger if exists tenant_author on public.%I', r.relname);
    if g is not null or au is not null then
      execute format('create trigger tenant_guard before update on public.%I for each row execute function private.tenant_guard(%s)',
                     r.relname, coalesce((select string_agg(quote_literal(x), ', ') from unnest(g) x), ''));
    end if;
    if au is not null then
      execute format('create trigger tenant_author before insert or update on public.%I for each row execute function private.tenant_author(%s)',
                     r.relname, (select string_agg(quote_literal(x), ', ') from unnest(au) x));
    end if;
    execute format('revoke truncate, trigger, references on public.%I from public, anon, authenticated', r.relname);
  end loop;
  -- Every link from a company table to another company table (other than the company itself).
  for r in
    select c.conrelid::regclass as child, c.confrelid::regclass as parent, a.attname::text as col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
       and c.confrelid <> 'public.companies'::regclass
       and exists (select 1 from pg_attribute x where x.attrelid = c.conrelid and x.attname = 'company_id' and not x.attisdropped)
       and exists (select 1 from pg_attribute x where x.attrelid = c.confrelid and x.attname = 'company_id' and not x.attisdropped)
  loop
    execute format('drop trigger if exists %I on %s', 'tenant_parent_' || r.col, r.child);
    execute format('create trigger %I before insert or update on %s for each row execute function private.tenant_parent(%L, %L)',
                   'tenant_parent_' || r.col, r.child, r.parent::text, r.col);
  end loop;
end $$;
revoke execute on function private.install_tenant_guards() from public;

select private.install_tenant_guards();
alter default privileges in schema public revoke truncate, trigger, references on tables from public, anon, authenticated;

-- ---------------------------------------------------------------- the import history is append-only
revoke insert, update, delete on public.imports from anon, authenticated;

-- ---------------------------------------------------------------- a profile's email comes from sign-in only
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------- moving a company
alter table public.company_data_audit drop constraint if exists company_data_audit_action_check;
alter table public.company_data_audit add constraint company_data_audit_action_check
  check (action in ('clear_module', 'clear_all', 'delete_company', 'transfer_company'));

-- An admin of both organisations moves a company with all its data. Recorded in both organisations' audit.
create or replace function public.transfer_company(p_company uuid, p_target_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.companies;
begin
  select * into c from public.companies where id = p_company for update;
  if not found or p_target_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if not private.is_member(c.org_id, 'admin') or not private.is_member(p_target_org, 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if c.org_id = p_target_org then return; end if;
  update public.companies set org_id = p_target_org where id = p_company;
  insert into public.company_data_audit (org_id, company_id, company_name, actor, action, scope, counts)
  select o, c.id, c.name, (select auth.uid()), 'transfer_company', 'company', jsonb_build_object('from_org', c.org_id, 'to_org', p_target_org)
    from unnest(array[c.org_id, p_target_org]) o;
end $$;
revoke execute on function public.transfer_company(uuid, uuid) from public, anon;
grant execute on function public.transfer_company(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- signed-out rate limits
-- A published link's PDF allowance (pdf_render_token), counted only for a real, live link.
create or replace function public.rate_limit_link(p_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.reports;
  s private.rate_scopes;
  k text;
  n integer;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return false; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found then return false; end if;
  select * into s from private.rate_scopes where scope = 'pdf_render_token';
  k := 'pdf_render_token:' || r.id;
  delete from private.rate_events where key = k and at < now() - make_interval(secs => s.window_s);
  select count(*) into n from private.rate_events where key = k;
  if n >= s.max_hits then return false; end if;
  insert into private.rate_events (key) values (k);
  return true;
end $$;
revoke execute on function public.rate_limit_link(text) from public;

-- Signed-out renders of the demo report: one shared allowance for all visitors (60 an hour), on top of the server's
-- per-address limit, so the cost of rendering is bounded whatever the number of server instances.
insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('pdf_render_demo', 'anon', 3600, 60)
  on conflict (scope) do update set window_s = excluded.window_s, max_hits = excluded.max_hits;
create or replace function public.rate_limit_demo()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s private.rate_scopes;
  n integer;
begin
  select * into s from private.rate_scopes where scope = 'pdf_render_demo';
  perform pg_advisory_xact_lock(hashtext('pdf_render_demo'));
  delete from private.rate_events where key = 'pdf_render_demo:all' and at < now() - make_interval(secs => s.window_s);
  select count(*) into n from private.rate_events where key = 'pdf_render_demo:all';
  if n >= s.max_hits then return false; end if;
  insert into private.rate_events (key) values ('pdf_render_demo:all');
  return true;
end $$;
revoke execute on function public.rate_limit_demo() from public;
grant execute on function public.rate_limit_demo() to anon, authenticated;
grant execute on function public.rate_limit_link(text) to anon, authenticated;
revoke execute on function public.rate_limit_hit(text, text) from public, anon;
grant execute on function public.rate_limit_hit(text, text) to authenticated;

-- ---------------------------------------------------------------- public links carry only the pages they show
-- Mirrors normaliseSections (src/lib/report/types.ts): a page the report never saved follows its default, which is on
-- except the cash-flow statement and the bank and real-profit pages.
create or replace function private.report_shows(p_sections jsonb, p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select not (x -> 'enabled' is null or x -> 'enabled' in ('false'::jsonb, '0'::jsonb, '""'::jsonb, 'null'::jsonb))
       from jsonb_array_elements(case when jsonb_typeof(p_sections) = 'array' then p_sections else '[]'::jsonb end) x
      where x ->> 'key' = p_key limit 1),
    p_key not in ('cf', 'bank', 'bank_outlook', 'realprofit'))
  -- Only the report's pages: anything else (a commentary under another name) is never shown.
  and p_key in ('cover', 'summary', 'kpis', 'explorer', 'profitability', 'cashflow', 'pl', 'bs', 'cf', 'trend', 'growth', 'goalseek',
                'forecast', 'sales', 'expenses', 'bank', 'bank_outlook', 'realprofit', 'basis')
$$;

-- Any page beyond the cover reads the accounts (statements, KPIs, and the revenue the Sales and Expenses pages compare with).
create or replace function private.report_shows_figures(p_sections jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select bool_or(private.report_shows(p_sections, k))
    from unnest(array['summary', 'kpis', 'explorer', 'profitability', 'cashflow', 'pl', 'bs', 'cf', 'trend', 'growth', 'goalseek',
                      'forecast', 'sales', 'expenses', 'bank', 'bank_outlook', 'realprofit', 'basis']) k
$$;

create or replace function public.get_published_report(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  c public.companies;
  o public.organizations;
  v_from text;
  v_fig boolean;
  v_basis boolean;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  select * into c from public.companies where id = r.company_id;
  select * into o from public.organizations where id = c.org_id;
  v_from := to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM');
  v_fig := private.report_shows_figures(r.sections);
  v_basis := private.report_shows(r.sections, 'basis');
  return jsonb_build_object(
    'report', to_jsonb(r) - 'created_by' - 'share_token',
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'currency', c.currency, 'fy_start_month', c.fy_start_month,
                                  'tax_rate', c.tax_rate, 'kpi_config', case when v_fig then coalesce(c.kpi_config, '{}'::jsonb) - 'profile' else '{}'::jsonb end,
                                  'notes', case when v_basis then c.notes else '[]'::jsonb end, 'source', c.source),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url, 'brand_colour', o.brand_colour, 'disclaimer', o.disclaimer, 'report_footer', o.report_footer),
    'accounts', case when not v_fig then '[]'::jsonb else coalesce((
      select jsonb_agg(x.a order by x.sort_order) from (
        select s.sort_order, jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statement', s.statement, 'class', s.class,
               'amounts', jsonb_object_agg(b.period, b.amount)) as a
          from public.source_accounts s
          join public.account_balances b on b.account_id = s.id and b.company_id = c.id and b.period between v_from and r.period_end
         where s.company_id = c.id and s.version = c.data_version
         group by s.id
      ) x), '[]'::jsonb) end,
    'commentary', coalesce((select jsonb_object_agg(cm.section, cm.body) from public.commentary cm
                            where cm.company_id = c.id and cm.period_key = r.period_type || ':' || r.period_end
                              and private.report_shows(r.sections, cm.section)), '{}'::jsonb),
    'accepted', case when not v_basis then '[]'::jsonb else coalesce((
                  select (select jsonb_agg(jsonb_build_object('title', x ->> 'title', 'period', x ->> 'period', 'reason', x ->> 'reason'))
                            from jsonb_array_elements(coalesce(i.report -> 'accepted', '[]'::jsonb)) x)
                    from public.imports i where i.company_id = c.id and i.data_version = c.data_version and i.action = 'import'
                   order by i.created_at desc limit 1), '[]'::jsonb) end
  );
end $$;
revoke execute on function public.get_published_report(text) from public;
grant execute on function public.get_published_report(text) to anon, authenticated;

-- Sales and Expenses lines go out only with their page.
create or replace function public.get_published_sales(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.reports;
  v_from text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found or not private.report_shows(r.sections, 'sales') then return null; end if;
  v_from := to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM');
  return (
    with chosen as (
      select l.* from public.sales_lines l
       where l.company_id = r.company_id and l.period between v_from and r.period_end
         and (l.source = 'file' or not exists (select 1 from public.sales_lines f where f.company_id = r.company_id and f.source = 'file' and f.period = l.period))
    )
    select jsonb_build_object(
      'customers', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'c', customer, 's', series, 'sp', salesperson, 'a', amount, 'k', cost, 'ka', costed, 'q', qty, 'd', docs, 'n', lines)) from (
        select period, customer, series, salesperson, sum(amount) amount, sum(cost) cost, sum(amount) filter (where cost is not null) costed,
               sum(qty) qty, count(distinct nullif(doc, '')) docs, count(*) lines
          from chosen group by period, customer, series, salesperson) x), '[]'::jsonb),
      'products', coalesce((select jsonb_agg(jsonb_build_object('p', period, 'r', product, 'g', category, 's', series, 'a', amount, 'k', cost, 'ka', costed, 'q', qty, 'n', lines)) from (
        select period, product, category, series, sum(amount) amount, sum(cost) cost, sum(amount) filter (where cost is not null) costed,
               sum(qty) qty, count(*) lines
          from chosen group by period, product, category, series) y), '[]'::jsonb),
      'sources', coalesce((select jsonb_object_agg(period, src) from (select period, min(source) src from chosen group by period) z), '{}'::jsonb)
    )
  );
end $$;
revoke execute on function public.get_published_sales(text) from public;
grant execute on function public.get_published_sales(text) to anon, authenticated;

create or replace function public.get_published_expenses(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.reports;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found or not private.report_shows(r.sections, 'expenses') then return null; end if;
  return private.expense_summary_of(r.company_id, to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM'), r.period_end);
end $$;
revoke execute on function public.get_published_expenses(text) from public;
grant execute on function public.get_published_expenses(text) to anon, authenticated;
reset client_min_messages;
reset lock_timeout;
