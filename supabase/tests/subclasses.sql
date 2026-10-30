-- Account sub-classes (migration 0042): kept in the company's account map, checked, editors only, and carried by a
-- shared report that shows figures.
\set ON_ERROR_STOP on
\set QUIET on
-- ops.sql re-applies 0040 (schema version 40), so this file applies 0042 again first.
\i supabase/migrations/0042_subclasses.sql
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('sub-ed@x.test', '{"full_name":"Sara"}', now()), ('sub-vw@x.test', '{"full_name":"Vic"}', now());
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
insert into public.companies (org_id, name, data_version) values (pg_temp.home('sub-ed@x.test'), 'Sub Co', 1);
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('sub-ed@x.test'), pg_temp.uid('sub-vw@x.test'), 'viewer');
create temp table ids as select id co from public.companies where name = 'Sub Co';
grant select on ids to authenticated, anon;

select pg_temp.check('the account map has a sub-class column', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'account_map' and column_name = 'sub_class'), '1');

-- An editor (the org's admin) sets one; an unknown sub-class is refused.
select pg_temp.login('sub-ed@x.test');
insert into public.account_map (company_id, key, cls, name, sub_class) select co, '#2160', 'other_cl', 'Interest payable', 'interest_payable' from ids;
select pg_temp.check('an editor saves a sub-class', (select sub_class from public.account_map where key = '#2160'), 'interest_payable');
-- A sub-class chosen on its own does not record a class choice (the class stays the chart's or Odoo's).
insert into public.account_map (company_id, key, cls, name, sub_class) select co, '#2170', null, 'Lease liability', 'lease_liability' from ids;
select pg_temp.check('a sub-class can be kept without a class choice', (select coalesce(cls, 'none') from public.account_map where key = '#2170'), 'none');
do $$ begin
  begin
    update public.account_map set sub_class = 'made_up' where key = '#2160';
    raise exception 'FAIL an unknown sub-class was accepted';
  exception when check_violation then raise notice 'ok  an unknown sub-class is refused';
  end;
end $$;
update public.account_map set sub_class = '' where key = '#2160';
select pg_temp.check('"" means the person chose none', (select sub_class from public.account_map where key = '#2160'), '');
update public.account_map set sub_class = 'interest_payable' where key = '#2160';
reset role;

-- A viewer can read it but not change it.
select pg_temp.login('sub-vw@x.test');
update public.account_map set sub_class = 'provisions' where key = '#2160';
select pg_temp.check('a viewer cannot change a sub-class', (select sub_class from public.account_map where key = '#2160'), 'interest_payable');
reset role;

-- A shared report that shows figures carries the sub-classes; a cover-only one does not.
update public.companies set kpi_config = '{"profile":{"vatRate":0}}' where name = 'Sub Co';
insert into public.reports (company_id, period_end, status, share_token, sections)
  select co, '2026-10', 'published', 'tok-sub-0000000000000000000000', '["cover","kpis"]'::jsonb from ids;
set role anon;
select pg_temp.check('a figures link carries the sub-classes', public.get_published_report('tok-sub-0000000000000000000000') -> 'sub_classes' ->> '#2160', 'interest_payable');
select pg_temp.check('a figures link carries the VAT rate', public.get_published_report('tok-sub-0000000000000000000000') ->> 'vat_rate', '0');
reset role;
update public.reports set sections = (select jsonb_agg(jsonb_build_object('key', k, 'enabled', k = 'cover'))
  from unnest(array['cover', 'summary', 'kpis', 'explorer', 'profitability', 'cashflow', 'pl', 'bs', 'cf', 'trend', 'growth', 'goalseek',
                    'forecast', 'sales', 'expenses', 'bank', 'bank_outlook', 'realprofit', 'basis']) k)
 where share_token = 'tok-sub-0000000000000000000000';
set role anon;
select pg_temp.check('a cover-only link carries none', (public.get_published_report('tok-sub-0000000000000000000000') -> 'sub_classes')::text, '{}');
select pg_temp.check('nor the VAT rate', coalesce(public.get_published_report('tok-sub-0000000000000000000000') ->> 'vat_rate', 'none'), 'none');
reset role;
select pg_temp.check('schema version 42', public.schema_version()::text, '42');
delete from public.companies where name = 'Sub Co';
