-- Month close and report snapshots (migration 0043): a closed month can't change by any path, only the owner or an admin
-- closes or reopens one (recorded), and a published report keeps the figures it was published with.
\set ON_ERROR_STOP on
\set QUIET on
-- Earlier test files re-apply older migrations, so this file applies 0043 again first.
\i supabase/migrations/0043_close_and_snapshots.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('mc-ad@x.test', '{"full_name":"Ada"}', now()), ('mc-ed@x.test', '{"full_name":"Eli"}', now()), ('mc-vw@x.test', '{"full_name":"Vic"}', now());
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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'aal', 'aal2', 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
  set role authenticated;
end $f$;
-- Runs a statement and reports whether it was refused.
create function pg_temp.refused(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  set constraints all immediate;  -- checks that wait for the end of the transaction run now
  return 'allowed';
exception when others then return 'refused';
end $f$;
grant execute on function pg_temp.refused(text) to authenticated, anon;

insert into public.companies (org_id, name, data_version) values (pg_temp.home('mc-ad@x.test'), 'Close Co', 1);
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('mc-ad@x.test'), pg_temp.uid('mc-ed@x.test'), 'editor'), (pg_temp.home('mc-ad@x.test'), pg_temp.uid('mc-vw@x.test'), 'viewer');
create temp table ids as select id co from public.companies where name = 'Close Co';
grant select on ids to authenticated, anon;
-- Books: one account, Jul–Oct 2026 (version 1), plus sales, expense and cash lines in Aug and Sep.
insert into public.source_accounts (company_id, version, code, name, statement, class) select co, 1, '4000', 'Sales', 'PL', 'revenue' from ids;
insert into public.source_accounts (company_id, version, code, name, statement, class) select co, 1, '6200', 'Fees', 'PL', 'exp_fixed' from ids;
insert into public.account_balances (account_id, company_id, period, amount)
  select s.id, s.company_id, p, -100 from public.source_accounts s cross join unnest(array['2026-07', '2026-08', '2026-09', '2026-10']) p where s.name = 'Sales';
insert into public.sales_batches (company_id, source) select co, 'file' from ids;
insert into public.sales_lines (company_id, batch_id, source, period, amount)
  select co, (select id from public.sales_batches where company_id = co), 'file', p, 10 from ids, unnest(array['2026-08', '2026-09']) p;
insert into public.expense_batches (company_id, source) select co, 'file' from ids;
insert into public.expense_lines (company_id, batch_id, source, period, account, cls, amount)
  select co, (select id from public.expense_batches where company_id = co), 'file', p, '6100 Rent', 'exp_variable', 5 from ids, unnest(array['2026-08', '2026-09']) p;
insert into public.account_map (company_id, key, cls, name) select co, '#6100', 'exp_fixed', 'Rent' from ids;
insert into public.cash_entries (company_id, day, direction, amount) select co, d, 'in', 7 from ids, unnest(array['2026-08-15'::date, '2026-09-15'::date]) d;

select pg_temp.check('schema version 43', public.schema_version()::text, '43');

-- ---------------------------------------------------------------- closing
select pg_temp.login('mc-ed@x.test');
select pg_temp.check('an editor cannot close a month', pg_temp.refused('select public.close_month((select co from ids), ''2026-08'')'), 'refused');
select pg_temp.check('nobody sets the closed month directly', pg_temp.refused('update public.companies set closed_through = ''2026-08'' where id = (select co from ids)'), 'refused');
select pg_temp.login('mc-ad@x.test');
select pg_temp.check('an admin closes through Aug', public.close_month((select co from ids), '2026-08'), '2026-08');
select pg_temp.check('the close is recorded', (select scope from public.company_data_audit where action = 'close_month' and company_id = (select co from ids)), '2026-08');
select pg_temp.check('closing a month already closed is refused', pg_temp.refused('select public.close_month((select co from ids), ''2026-07'')'), 'refused');
reset role;
-- Two-step sign-in and a fresh sign-in are both needed.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('mc-ad@x.test'), 'aal', 'aal1', 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
update public.profiles set mfa_required_from = now() - interval '1 day' where id = pg_temp.uid('mc-ad@x.test');
set role authenticated;
select pg_temp.check('closing needs two-step sign-in', pg_temp.refused('select public.close_month((select co from ids), ''2026-09'')'), 'refused');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid('mc-ad@x.test'), 'aal', 'aal2', 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int - 3600)))::text, false);
set role authenticated;
select pg_temp.check('closing needs a fresh sign-in', pg_temp.refused('select public.close_month((select co from ids), ''2026-09'')'), 'refused');
reset role;

-- ---------------------------------------------------------------- nothing in a closed month changes
select pg_temp.login('mc-ed@x.test');
select pg_temp.check('a sales line in a closed month is refused', pg_temp.refused('insert into public.sales_lines (company_id, batch_id, source, period, amount) select co, (select id from public.sales_batches where company_id = co), ''file'', ''2026-08'', 1 from ids'), 'refused');
select pg_temp.check('a sales line in an open month is allowed', pg_temp.refused('insert into public.sales_lines (company_id, batch_id, source, period, amount) select co, (select id from public.sales_batches where company_id = co), ''file'', ''2026-09'', 1 from ids'), 'allowed');
select pg_temp.check('deleting a closed month''s line is refused', pg_temp.refused('delete from public.sales_lines where period = ''2026-08'''), 'refused');
select pg_temp.check('moving an open line into a closed month is refused', pg_temp.refused('update public.sales_lines set period = ''2026-08'' where period = ''2026-09'''), 'refused');
select pg_temp.check('the closed balances cannot be deleted', pg_temp.refused('delete from public.account_balances where period = ''2026-08'''), 'refused');
select pg_temp.check('a balance cannot be added to a closed month directly', pg_temp.refused($q$insert into public.account_balances (account_id, company_id, period, amount) select s.id, s.company_id, '2026-06', 5 from public.source_accounts s where s.name = 'Sales'$q$), 'refused');
select pg_temp.check('a balance cannot be moved into a closed month', pg_temp.refused($q$update public.account_balances set period = '2026-06' where period = '2026-09'$q$), 'refused');
select pg_temp.check('an account with closed balances cannot be deleted', pg_temp.refused($q$delete from public.source_accounts where name = 'Sales'$q$), 'refused');
select pg_temp.check('an editor can still reclassify an account without closed months', public.reclassify_accounts((select co from ids), jsonb_build_object((select id from public.source_accounts where code = '6200')::text, jsonb_build_object('class', 'exp_variable')))::text, '1');
select pg_temp.check('an account cannot be moved to another version', pg_temp.refused($q$update public.source_accounts set version = 99 where name = 'Sales'$q$), 'refused');
select pg_temp.check('a company cannot be created already closed', pg_temp.refused(format('insert into public.companies (org_id, name, closed_through) values (%L, %L, %L)', (select org_id from public.companies where name = 'Close Co'), 'Pre-closed', '2026-01')), 'refused');
reset role;
-- Even the database's own functions (security definer, as the save functions are) cannot change a closed month.
select pg_temp.check('the closed month holds for definer functions too', pg_temp.refused('delete from public.sales_lines where period = ''2026-08'''), 'refused');
-- The cash book is written only through its functions (which run as the database).
select pg_temp.check('a cash entry dated in a closed month is refused', pg_temp.refused('insert into public.cash_entries (company_id, day, direction, amount, kind) select co, ''2026-08-20'', ''out'', 3, ''expense'' from ids'), 'refused');
select pg_temp.check('a cash entry dated in an open month is allowed', pg_temp.refused('insert into public.cash_entries (company_id, day, direction, amount, kind) select co, ''2026-09-20'', ''out'', 3, ''expense'' from ids'), 'allowed');

-- A new version of the books must carry the closed months unchanged.
select pg_temp.login('mc-ed@x.test');
select pg_temp.check('a new version that changes a closed month is refused', pg_temp.refused($q$select public.save_company_version((select co from ids), '[{"code":"4000","name":"Sales","statement":"PL","class":"revenue","amounts":{"2026-07":-100,"2026-08":-999,"2026-09":-100}}]'::jsonb)$q$), 'refused');
select pg_temp.check('a new version that keeps the closed months is saved', pg_temp.refused($q$select public.save_company_version((select co from ids), '[{"code":"4000","name":"Sales","statement":"PL","class":"revenue","amounts":{"2026-07":-100,"2026-08":-100,"2026-09":-150,"2026-10":-100}}]'::jsonb)$q$), 'allowed');
select pg_temp.check('a new version that only re-spells an account is saved', pg_temp.refused($q$select public.save_company_version((select co from ids), '[{"code":" 4000 ","name":"SALES","statement":"PL","class":"revenue","amounts":{"2026-07":-100,"2026-08":-100,"2026-09":-150,"2026-10":-100}}]'::jsonb)$q$), 'allowed');
select pg_temp.check('going back to the older version is allowed while the closed months agree', pg_temp.refused('select public.restore_company_version((select co from ids), 1)'), 'allowed');
select pg_temp.check('reclassifying an account with closed balances is refused', pg_temp.refused('update public.source_accounts set class = ''other_income'' where name = ''Sales'' and version = 1'), 'refused');
-- Re-applying expense classes leaves closed months as they are.
select public.restamp_expense_classes((select co from ids));
select pg_temp.check('restamp leaves a closed month', (select cls from public.expense_lines where period = '2026-08'), 'exp_variable');
select pg_temp.check('restamp updates an open month', (select cls from public.expense_lines where period = '2026-09'), 'exp_fixed');
select pg_temp.check('clearing the books is refused while a month is closed', pg_temp.refused('select public.clear_company_data((select co from ids), ''sales'', 999)'), 'refused');
reset role;

-- Every company table with a month carries the lock (so a table added later is caught here).
select pg_temp.check('every company table with a month is locked', (
  select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'account_balances'
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'period' and not a.attisdropped)
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'period_lock')), '');
select pg_temp.check('the cash book is locked', (select count(*)::text from pg_trigger t where t.tgrelid = 'public.cash_entries'::regclass and t.tgname = 'period_lock'), '1');

-- ---------------------------------------------------------------- reopening
select pg_temp.login('mc-ed@x.test');
select pg_temp.check('an editor cannot reopen', pg_temp.refused('select public.reopen_month((select co from ids), ''2026-08'')'), 'refused');
select pg_temp.login('mc-ad@x.test');
select pg_temp.check('an admin reopens Aug (closed through Jul)', coalesce(public.reopen_month((select co from ids), '2026-08'), 'none'), '2026-07');
select pg_temp.check('the reopen is recorded', (select scope from public.company_data_audit where action = 'reopen_month' and company_id = (select co from ids)), '2026-08');
select pg_temp.check('Aug can change again', pg_temp.refused('delete from public.sales_lines where period = ''2026-08'''), 'allowed');
select pg_temp.check('a viewer sees the closed month', (select closed_through from public.companies where id = (select co from ids)), '2026-07');
reset role;

-- ---------------------------------------------------------------- report snapshots
insert into public.reports (company_id, period_end, status, share_token, sections)
  select co, '2026-10', 'published', 'tok-mc-00000000000000000000000', '["cover","pl"]'::jsonb from ids;
select pg_temp.login('mc-vw@x.test');
select pg_temp.check('a viewer cannot freeze a report', pg_temp.refused('select public.freeze_report((select id from public.reports where share_token = ''tok-mc-00000000000000000000000''))'), 'refused');
select pg_temp.login('mc-ed@x.test');
select public.freeze_report((select id from public.reports where share_token = 'tok-mc-00000000000000000000000'));
reset role;
create temp table frozen as
  select (select a -> 'amounts' ->> '2026-10' from jsonb_array_elements(public.get_published_report('tok-mc-00000000000000000000000') -> 'accounts') a where a ->> 'name' = 'Sales') v;
grant select on frozen to anon;
-- The books change after publishing (an open month).
update public.account_balances set amount = -250 where period = '2026-10' and account_id in (select id from public.source_accounts s where s.name = 'Sales' and s.version = (select data_version from public.companies where name = 'Close Co'));
set role anon;
select pg_temp.check('the link shows the figures it was published with', (select a -> 'amounts' ->> '2026-10' from jsonb_array_elements(public.get_published_report('tok-mc-00000000000000000000000') -> 'accounts') a where a ->> 'name' = 'Sales'), (select v from frozen));
select pg_temp.check('the link says when its figures were frozen', (public.get_published_report('tok-mc-00000000000000000000000') ? 'frozen_at')::text, 'true');
select pg_temp.check('the link sales are frozen too', (public.get_published_sales('tok-mc-00000000000000000000000') is not null)::text, 'true');
select pg_temp.check('a visitor cannot read the snapshots table', pg_temp.refused('select 1 from public.report_snapshots'), 'refused');
reset role;
select pg_temp.login('mc-ed@x.test');
select public.freeze_report((select id from public.reports where share_token = 'tok-mc-00000000000000000000000'));
select pg_temp.check('updating the published figures is recorded', (select count(*)::text from public.company_data_audit where action = 'freeze_report' and company_id = (select co from ids)), '2');
reset role;
set role anon;
select pg_temp.check('updated figures show on the link', (select a -> 'amounts' ->> '2026-10' from jsonb_array_elements(public.get_published_report('tok-mc-00000000000000000000000') -> 'accounts') a where a ->> 'name' = 'Sales'), '-250.00');
reset role;
update public.companies set deleted_at = now() where name = 'Close Co';
set role anon;
select pg_temp.check('a deleted company''s frozen link stops at once', coalesce(public.get_published_report('tok-mc-00000000000000000000000')::text, 'none'), 'none');
reset role;
update public.companies set deleted_at = null where name = 'Close Co';
update public.reports set status = 'draft', share_token = null where share_token = 'tok-mc-00000000000000000000000';
select pg_temp.check('stopping sharing drops the snapshot', (select count(*)::text from public.report_snapshots where company_id = (select co from ids)), '0');

-- ---------------------------------------------------------------- the company itself can still be deleted
select pg_temp.login('mc-ad@x.test');
select public.close_month((select co from ids), '2026-09');
reset role;
delete from public.companies where name = 'Close Co';
select pg_temp.check('a company with closed months can be removed for good', (select count(*)::text from public.companies where name = 'Close Co'), '0');
-- Later test files re-apply older migrations, whose list of audit actions predates these ones.
delete from public.company_data_audit where action in ('close_month', 'reopen_month', 'freeze_report');
