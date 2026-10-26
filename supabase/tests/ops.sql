-- Operations (migration 0040): the database says its version; AI use is counted against a monthly allowance per
-- organisation and a daily cap for the whole site; only the owner raises the allowance, within a ceiling.
\set ON_ERROR_STOP on
\set QUIET on
-- odoo_security.sql re-applies 0025 (an older odoo_save that refuses v3 keys), so this file applies 0040 again first.
\i supabase/migrations/0040_ops.sql
reset client_min_messages;
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('opo@x.test', '{"org_name":"Ops Org"}', now()), ('opa@x.test', '{}', now()), ('opx@x.test', '{"org_name":"Other Org"}', now()), ('opv@x.test', '{}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create temp table uids as select email, id from auth.users where email like 'op_@x.test';
grant select on uids to authenticated;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from uids where email = e))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(sql text) returns text language plpgsql as $f$ begin execute sql; return 'none'; exception when others then return sqlstate; end $f$;
create temp table o as select id from public.organizations where name = 'Ops Org';
grant select on o to authenticated;
insert into public.memberships (org_id, user_id, role) values ((select id from o), (select id from uids where email = 'opa@x.test'), 'admin'), ((select id from o), (select id from uids where email = 'opv@x.test'), 'viewer');

set role anon;
select pg_temp.check('anyone can read the database version', public.schema_version()::text, '40');
reset role;

select pg_temp.login('opa@x.test');
select pg_temp.check('a fresh organisation is within its allowance', public.ai_budget_ok((select id from o))::text, 'true');
select public.record_ai_usage((select id from o), 'commentary', 1000, 500, 4750000) from generate_series(1, 4);
select pg_temp.check('use under the 20-dollar default is fine', public.ai_budget_ok((select id from o))::text, 'true');
select public.record_ai_usage((select id from o), 'commentary', 1000, 500, 2000000);
select pg_temp.check('over the monthly allowance is refused', public.ai_budget_ok((select id from o))::text, 'false');
select pg_temp.check('an admin cannot raise the allowance', pg_temp.err(format('update public.organizations set ai_monthly_usd = 50 where id = %L', (select id from o))), '42501');
select pg_temp.login('opo@x.test');
update public.organizations set ai_monthly_usd = 50 where id = (select id from o);
select pg_temp.check('the owner can raise it', public.ai_budget_ok((select id from o))::text, 'true');
select pg_temp.check('within a ceiling', pg_temp.err(format('update public.organizations set ai_monthly_usd = 5000 where id = %L', (select id from o))), '23514');
select pg_temp.check('admins read the use', (select count(*)::text from public.ai_usage where org_id = (select id from o)), '5');
select pg_temp.check('nobody writes it directly', pg_temp.err(format('insert into public.ai_usage (org_id, kind, micros) values (%L, %L, 1)', (select id from o), 'x')), '42501');
select pg_temp.login('opx@x.test');
select pg_temp.check('an outsider cannot count against it', pg_temp.err(format('select public.record_ai_usage(%L, %L, 1, 1, 1)', (select id from o), 'commentary')), '42501');
select pg_temp.check('nor read it', pg_temp.err(format('select public.ai_budget_ok(%L)', (select id from o))), '42501');
-- What is recorded comes from the app after a real reply: a viewer records nothing, one call cannot claim more than one
-- reply could cost, and one organisation's use never stops another's.
select pg_temp.login('opv@x.test');
select pg_temp.check('a viewer cannot record use', pg_temp.err(format('select public.record_ai_usage(%L, %L, 1, 1, 1)', (select id from o), 'commentary')), '42501');
select pg_temp.login('opa@x.test');
select pg_temp.check('one call cannot claim more than one reply could cost', pg_temp.err(format('select public.record_ai_usage(%L, %L, 0, 0, %s)', (select id from o), 'commentary', 1000000000000000)), '22023');
select pg_temp.check('the month''s use is added up for admins', public.ai_usage_month((select id from o))::text, '21000000');
select pg_temp.login('opx@x.test');
select pg_temp.check('another organisation is unaffected by this one''s use', public.ai_budget_ok((select id from public.organizations where name = 'Other Org'))::text, 'true');
select pg_temp.check('an outsider cannot add up this organisation''s use', pg_temp.err(format('select public.ai_usage_month(%L)', (select id from o))), '42501');
-- Saved Odoo keys can name the server key they use, so the key can be rotated.
reset role;
insert into public.companies (org_id, name) values ((select id from o), 'Ops Co'), ((select id from o), 'Ops Co 2');
select pg_temp.login('opo@x.test');
select public.odoo_save((select id from public.companies where name = 'Ops Co'), 'https://a.odoo.com', 'a', 'me@a', 'v3.k2.aa.bb.cc', 1, 'A Co', false, 30, '18.0', null);
reset role;
select pg_temp.check('a key under a named server key is saved', (select api_key_enc from public.odoo_connections where company_id = (select id from public.companies where name = 'Ops Co')), 'v3.k2.aa.bb.cc');
select pg_temp.login('opo@x.test');
select pg_temp.check('a key changed meanwhile is not overwritten', pg_temp.err(format('select public.odoo_rekey(%L, %L, %L)', (select id from public.companies where name = 'Ops Co'), 'v3.k1.old.old.old', 'v3.k3.dd.ee.ff')), '40001');
select public.odoo_rekey((select id from public.companies where name = 'Ops Co'), 'v3.k2.aa.bb.cc', 'v3.k3.dd.ee.ff');
reset role;
select pg_temp.check('re-encrypting replaces only the key', (select api_key_enc || ' ' || url from public.odoo_connections where company_id = (select id from public.companies where name = 'Ops Co')), 'v3.k3.dd.ee.ff https://a.odoo.com');
select pg_temp.login('opo@x.test');
select pg_temp.check('nothing to re-encrypt without a saved key', pg_temp.err(format('select public.odoo_rekey(%L, %L, %L)', (select id from public.companies where name = 'Ops Co 2'), 'v3.k2.aa.bb.cc', 'v3.k3.dd.ee.ff')), '22023');
select pg_temp.check('only values the app encrypted are accepted', pg_temp.err(format('select public.odoo_rekey(%L, %L, %L)', (select id from public.companies where name = 'Ops Co'), 'v3.k3.dd.ee.ff', 'plain-key')), '22023');
select pg_temp.login('opx@x.test');
select pg_temp.check('an outsider cannot re-encrypt', pg_temp.err(format('select public.odoo_rekey(%L, %L, %L)', (select id from public.companies where name = 'Ops Co'), 'v3.k3.dd.ee.ff', 'v3.k4.dd.ee.ff')), '42501');
reset role;
select pg_temp.check('nothing is left of a site-wide cap that self-reported use could fill', (to_regclass('private.ops_settings') is null or not exists (select 1 from pg_proc where proname = 'ai_budget_ok' and prosrc like '%ops_settings%'))::text, 'true');
delete from public.organizations where id = (select id from o);
delete from public.organizations where name = 'Other Org';
