-- Tenant guards (migration 0038): no row moves between companies or organisations, authorship cannot be typed by the
-- caller, the import history is append-only, a company moves only through transfer_company, a public report link
-- carries only the sections it shows, and signed-out callers cannot count rate limits. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ta@x.test', '{"full_name":"Tamer"}', now()), ('tb@x.test', '{"full_name":"Tarek"}', now()), ('tv@x.test', '{"full_name":"Tala"}', now()),
  ('tx@x.test', '{"full_name":"Taha"}', now());
grant select on all tables in schema public to authenticated;

create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.home(e text) returns uuid language sql as $f$ select org_id from public.memberships where user_id = pg_temp.uid(e) order by created_at limit 1 $f$;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;

-- Tamer is admin of org A and also an editor in org B; Tarek is admin of org B; Tala is a viewer in org B.
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('tb@x.test'), pg_temp.uid('ta@x.test'), 'editor'),
  (pg_temp.home('tb@x.test'), pg_temp.uid('tv@x.test'), 'viewer');
insert into public.companies (org_id, name) values (pg_temp.home('ta@x.test'), 'Guard A'), (pg_temp.home('tb@x.test'), 'Guard B'), (pg_temp.home('tx@x.test'), 'Stranger Co');
create temp table ids as select
  (select id from public.companies where name = 'Guard A') as co_a, (select id from public.companies where name = 'Guard B') as co_b,
  pg_temp.home('ta@x.test') as org_a, pg_temp.home('tb@x.test') as org_b,
  pg_temp.uid('ta@x.test') as ua, pg_temp.uid('tb@x.test') as ub, pg_temp.uid('tv@x.test') as uv,
  (select id from public.companies where name = 'Stranger Co') as co_x;
grant select on ids to authenticated;

-- Rows of company B in the tables an editor can write directly.
insert into public.source_accounts (company_id, code, name, statement, class, version)
  values ((select co_b from ids), '4000', 'Sales of goods', 'PL', 'revenue', 0), ((select co_b from ids), '1100', 'Bank Misr', 'BS', 'cash', 0);
insert into public.account_balances (account_id, company_id, period, amount)
  select s.id, s.company_id, p, 1000 from public.source_accounts s, (values ('2026-08'), ('2026-09')) v(p) where s.company_id = (select co_b from ids);
insert into public.reports (company_id, title, period_end, sections, created_by) values ((select co_b from ids), 'Board pack', '2026-09', '[]', (select ub from ids));
insert into public.commentary (company_id, period_key, section, body, updated_by) values ((select co_b from ids), 'month:2026-09', 'pl', 'Margin held', (select ub from ids)),
  ((select co_b from ids), 'month:2026-09', 'zzz', 'Internal only', (select ub from ids));
update public.companies set kpi_config = '{"gpm":{"target":40},"profile":{"compareWith":"00000000-0000-0000-0000-000000000000"}}' where name = 'Guard B';
insert into public.account_map (company_id, key, cls, name) values ((select co_b from ids), '#4000', 'revenue', 'Sales of goods');
insert into public.sales_batches (company_id, source, filename, periods, created_by) values ((select co_b from ids), 'file', 'b.xlsx', '{2026-09}', (select ub from ids));
insert into public.sales_lines (company_id, batch_id, source, period, day, customer, amount)
  select (select co_b from ids), id, 'file', '2026-09', '2026-09-03', 'Customer 122', 500 from public.sales_batches where company_id = (select co_b from ids);
insert into public.imports (company_id, action, kind, filename, status, data_version, created_by, report)
  values ((select co_b from ids), 'import', 'upload', 'tb.xlsx', 'committed', 0, (select ub from ids), '{"accepted":[{"title":"Debits differ","reason":"Rounding"}]}');

-- ---------------------------------------------------------------- 1. C01: nothing moves between companies or organisations
select pg_temp.login('ta@x.test');
select pg_temp.check('an editor in both organisations cannot move a company',
  pg_temp.err($q$update public.companies set org_id = (select org_a from ids) where id = (select co_b from ids)$q$), '42501');
select pg_temp.check('the company stayed in its organisation', (select (org_id = (select org_b from ids))::text from public.companies where id = (select co_b from ids)), 'true');
select pg_temp.check('the data version cannot be typed', pg_temp.err($q$update public.companies set data_version = 99 where id = (select co_b from ids)$q$), '42501');
select pg_temp.check('a company''s author cannot be changed', pg_temp.err($q$update public.companies set created_by = (select ub from ids) where id = (select co_b from ids)$q$), '42501');
select pg_temp.check('renaming a company still works', pg_temp.err($q$update public.companies set name = 'Guard B Ltd' where id = (select co_b from ids)$q$), '');
select pg_temp.check('accounts cannot move company', pg_temp.err($q$update public.source_accounts set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('balances cannot move company', pg_temp.err($q$update public.account_balances set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('a balance cannot move to another account',
  pg_temp.err($q$update public.account_balances set account_id = (select id from public.source_accounts where code = '1100' and company_id = (select co_b from ids)) where company_id = (select co_b from ids) and account_id = (select id from public.source_accounts where code = '4000' and company_id = (select co_b from ids))$q$), '42501');
select pg_temp.check('reports cannot move company', pg_temp.err($q$update public.reports set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('commentary cannot move company', pg_temp.err($q$update public.commentary set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('the account map cannot move company', pg_temp.err($q$update public.account_map set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('sales lines cannot move company', pg_temp.err($q$update public.sales_lines set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('sales batches cannot move company', pg_temp.err($q$update public.sales_batches set company_id = (select co_a from ids) where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('a sales line cannot move to another batch', pg_temp.err($q$update public.sales_lines set batch_id = null where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('ordinary edits still work', pg_temp.err($q$update public.account_map set cls = 'other_income' where company_id = (select co_b from ids)$q$), '');
reset role;
select pg_temp.check('every company row stayed in company B',
  (select count(*)::text from (select company_id from public.source_accounts union all select company_id from public.account_balances union all select company_id from public.reports
     union all select company_id from public.commentary union all select company_id from public.sales_lines union all select company_id from public.account_map) x where company_id = (select co_a from ids)), '0');

-- (The ids are what a share link or a guess gives a stranger; read here as the owner.)
alter table ids add column acct_b uuid, add column batch_b uuid;
update ids set acct_b = (select id from public.source_accounts where company_id = co_b and code = '4000'), batch_b = (select id from public.sales_batches where company_id = co_b);
-- A new row cannot hang off another company's parent (an account, a batch, a report): a stranger with their own company
-- cannot add figures to a company they only know an account id of.
select pg_temp.login('tx@x.test');
select pg_temp.check('a balance cannot be added to another company''s account',
  pg_temp.err(format($q$insert into public.account_balances (account_id, company_id, period, amount) values (%L, (select co_x from ids), '2026-07', 99999999)$q$, (select acct_b from ids))), '42501');
select pg_temp.check('a sales line cannot be added to another company''s batch',
  pg_temp.err(format($q$insert into public.sales_lines (company_id, batch_id, source, period, amount) values ((select co_x from ids), %L, 'file', '2026-07', 1)$q$, (select batch_b from ids))), '42501');
reset role;
select pg_temp.check('no stranger figures reached company B''s accounts', (select count(*)::text from public.account_balances where period = '2026-07'), '0');
select pg_temp.check('every child table checks its parent''s company', coalesce((
  select string_agg(distinct c.conrelid::regclass::text, ', ')
    from pg_constraint c
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
     and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'company_id' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'company_id' and not a.attisdropped)
     and c.confrelid <> 'public.companies'::regclass
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.conrelid and t.tgname = 'tenant_parent_' || (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]))), ''), '');

-- Every table that holds a company, organisation, author or parent link carries the guard, so a new table cannot miss it.
select pg_temp.check('every guarded column is covered by the guard trigger', coalesce((
  select string_agg(distinct c.relname, ', ' order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind = 'r'
     and a.attname in ('org_id', 'company_id', 'created_by', 'invited_by', 'updated_by', 'data_version', 'batch_id', 'report_id', 'account_id', 'import_id', 'job_id', 'user_id')
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'tenant_guard' and not t.tgisinternal)), ''), '');
select pg_temp.check('every author column is filled by the author trigger', coalesce((
  select string_agg(distinct c.relname, ', ' order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where n.nspname = 'public' and c.relkind = 'r' and a.attname in ('created_by', 'invited_by', 'updated_by')
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'tenant_author' and not t.tgisinternal)), ''), '');
select pg_temp.check('no signed-in or signed-out grant of TRUNCATE, TRIGGER or REFERENCES', (
  select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['anon', 'authenticated']) r, unnest(array['TRUNCATE', 'TRIGGER', 'REFERENCES']) p
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)), '0');

-- ---------------------------------------------------------------- 2. H02: authorship is the caller, the import history is append-only
select pg_temp.login('ta@x.test');
insert into public.reports (company_id, title, period_end, created_by) values ((select co_b from ids), 'Typed author', '2026-09', (select ub from ids));
select pg_temp.check('a new report''s author is the caller, whatever was typed', (select (created_by = (select ua from ids))::text from public.reports where title = 'Typed author'), 'true');
select pg_temp.check('a report''s author cannot be changed later', pg_temp.err($q$update public.reports set created_by = (select ua from ids) where title = 'Board pack'$q$), '42501');
insert into public.commentary (company_id, period_key, section, body, updated_by) values ((select co_b from ids), 'month:2026-09', 'kpis', 'Owner approved', (select ub from ids));
select pg_temp.check('commentary is signed by the caller', (select (updated_by = (select ua from ids))::text from public.commentary where section = 'kpis' and company_id = (select co_b from ids)), 'true');
update public.commentary set body = 'Margin held well', updated_by = (select ub from ids) where section = 'pl' and company_id = (select co_b from ids);
select pg_temp.check('an edit is signed by the caller', (select (updated_by = (select ua from ids))::text from public.commentary where section = 'pl' and company_id = (select co_b from ids)), 'true');
select pg_temp.check('the import history cannot be rewritten', pg_temp.err($q$update public.imports set created_by = (select ub from ids), report = '{"accepted":[{"title":"x","reason":"Reviewed and approved by the owner"}]}' where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('the import history cannot be deleted', pg_temp.err($q$delete from public.imports where company_id = (select co_b from ids)$q$), '42501');
select pg_temp.check('the import history cannot be written directly', pg_temp.err($q$insert into public.imports (company_id, action, kind, filename, status, data_version) values ((select co_b from ids), 'import', 'upload', 'f.xlsx', 'committed', 0)$q$), '42501');
select pg_temp.check('a profile''s email cannot be changed by its owner', pg_temp.err($q$update public.profiles set email = 'owner@x.test' where id = (select ua from ids)$q$), '42501');
select pg_temp.check('a profile''s name can', pg_temp.err($q$update public.profiles set full_name = 'Tamer A' where id = (select ua from ids)$q$), '');

-- ---------------------------------------------------------------- 3. moving a company: admin of both organisations, audited
select pg_temp.check('an editor of the company''s organisation cannot transfer it', pg_temp.err($q$select public.transfer_company((select co_b from ids), (select org_a from ids))$q$), '42501');
select pg_temp.login('tb@x.test');
select pg_temp.check('an admin who is not in the target organisation cannot', pg_temp.err($q$select public.transfer_company((select co_b from ids), (select org_a from ids))$q$), '42501');
reset role;
insert into public.memberships (org_id, user_id, role) values ((select org_a from ids), (select ub from ids), 'admin');
select pg_temp.login('tv@x.test');
select pg_temp.check('a viewer cannot', pg_temp.err($q$select public.transfer_company((select co_b from ids), (select org_a from ids))$q$), '42501');
select pg_temp.login('tb@x.test');
select pg_temp.check('the admin of both organisations can', pg_temp.err($q$select public.transfer_company((select co_b from ids), (select org_a from ids))$q$), '');
reset role;
select pg_temp.check('the company moved with its data', (select (org_id = (select org_a from ids))::text from public.companies where id = (select co_b from ids)), 'true');
select pg_temp.check('the move is audited in both organisations', (select string_agg(case when org_id = (select org_a from ids) then 'to' else 'from' end, ',' order by org_id = (select org_a from ids)) from public.company_data_audit
  where company_id = (select co_b from ids) and action = 'transfer_company' and actor = (select ub from ids)
    and counts ->> 'from_org' = (select org_b::text from ids) and counts ->> 'to_org' = (select org_a::text from ids)), 'from,to');
select pg_temp.check('signed-out callers cannot transfer', has_function_privilege('anon', 'public.transfer_company(uuid, uuid)', 'execute')::text, 'false');

-- ---------------------------------------------------------------- 4. M01: signed-out rate limits only for a real link
select pg_temp.check('signed-out callers cannot count any rate limit', has_function_privilege('anon', 'public.rate_limit_hit(text, text)', 'execute')::text, 'false');
update public.reports set status = 'published', share_token = 'tok-guard-0000000000000000000000', sections = (select jsonb_agg(jsonb_build_object('key', k, 'enabled', k = 'cover')) from unnest(array['cover', 'summary', 'kpis', 'explorer',
     'profitability', 'cashflow', 'pl', 'bs', 'cf', 'trend', 'growth', 'goalseek', 'forecast', 'sales', 'expenses', 'bank', 'bank_outlook', 'realprofit', 'basis']) k)
 where title = 'Board pack';
set role anon;
select pg_temp.check('an unknown link counts nothing', public.rate_limit_link('tok-unknown-00000000000000000000')::text, 'false');
reset role;
select pg_temp.check('and leaves no row', (select count(*)::text from private.rate_events where key like 'pdf_render_token:%'), '0');
set role anon;
select pg_temp.check('a real link is allowed 20 renders an hour', (select bool_and(public.rate_limit_link('tok-guard-0000000000000000000000')) from generate_series(1, 20))::text, 'true');
select pg_temp.check('the 21st is refused', public.rate_limit_link('tok-guard-0000000000000000000000')::text, 'false');
reset role;

set role anon;
select pg_temp.check('demo renders are limited across all signed-out visitors', (select bool_and(public.rate_limit_demo()) from generate_series(1, 60))::text, 'true');
select pg_temp.check('the 61st demo render in the hour is refused', public.rate_limit_demo()::text, 'false');
reset role;

-- ---------------------------------------------------------------- 5. H01: a public link carries only the sections it shows
set role anon;
select pg_temp.check('cover only: no accounts', (public.get_published_report('tok-guard-0000000000000000000000') -> 'accounts')::text, '[]');
select pg_temp.check('cover only: no internal notes', (public.get_published_report('tok-guard-0000000000000000000000') -> 'company' -> 'notes')::text, '[]');
select pg_temp.check('cover only: no KPI settings', (public.get_published_report('tok-guard-0000000000000000000000') -> 'company' -> 'kpi_config')::text, '{}');
select pg_temp.check('cover only: no commentary', (public.get_published_report('tok-guard-0000000000000000000000') -> 'commentary')::text, '{}');
select pg_temp.check('cover only: no accepted issues', (public.get_published_report('tok-guard-0000000000000000000000') -> 'accepted')::text, '[]');
select pg_temp.check('cover only: no sales', coalesce(public.get_published_sales('tok-guard-0000000000000000000000')::text, 'null'), 'null');
select pg_temp.check('cover only: no expenses', coalesce(public.get_published_expenses('tok-guard-0000000000000000000000')::text, 'null'), 'null');
select pg_temp.check('cover only: a commentary under an unknown page name stays out', (public.get_published_report('tok-guard-0000000000000000000000') -> 'commentary' ? 'zzz')::text, 'false');
select pg_temp.check('cover only: no customer name anywhere', (public.get_published_report('tok-guard-0000000000000000000000')::text like '%Customer 122%')::text, 'false');
reset role;
update public.reports set sections = (select jsonb_agg(jsonb_build_object('key', k, 'enabled', k in ('cover', 'pl'))) from unnest(array['cover', 'summary', 'kpis', 'explorer',
     'profitability', 'cashflow', 'pl', 'bs', 'cf', 'trend', 'growth', 'goalseek', 'forecast', 'sales', 'expenses', 'bank', 'bank_outlook', 'realprofit', 'basis']) k) where title = 'Board pack';
set role anon;
select pg_temp.check('with the P&L: its accounts', jsonb_array_length(public.get_published_report('tok-guard-0000000000000000000000') -> 'accounts')::text, '2');
select pg_temp.check('with the P&L: KPI targets but not the company profile', (public.get_published_report('tok-guard-0000000000000000000000') -> 'company' -> 'kpi_config')::text, '{"gpm": {"target": 40}}');
select pg_temp.check('with the P&L: only the P&L commentary', (select string_agg(k, ',') from jsonb_object_keys(public.get_published_report('tok-guard-0000000000000000000000') -> 'commentary') k), 'pl');
select pg_temp.check('basis off: still no accepted issues', (public.get_published_report('tok-guard-0000000000000000000000') -> 'accepted')::text, '[]');
reset role;
-- A section the report never saved follows the default: Sales is on unless switched off.
update public.reports set sections = (select jsonb_agg(x) from jsonb_array_elements('[{"key":"cover","enabled":true},{"key":"summary","enabled":false},{"key":"kpis","enabled":false},{"key":"explorer","enabled":false},{"key":"profitability","enabled":false},{"key":"cashflow","enabled":false},{"key":"pl","enabled":false},{"key":"bs","enabled":false},{"key":"trend","enabled":false},{"key":"growth","enabled":false},{"key":"goalseek","enabled":false},{"key":"forecast","enabled":false},{"key":"expenses","enabled":false},{"key":"basis","enabled":true}]'::jsonb) x) where title = 'Board pack';
set role anon;
select pg_temp.check('a section not saved follows its default (Sales on)', (public.get_published_sales('tok-guard-0000000000000000000000') is not null)::text, 'true');
select pg_temp.check('basis on: the accepted issues', jsonb_array_length(public.get_published_report('tok-guard-0000000000000000000000') -> 'accepted')::text, '1');
reset role;
