-- Security hardening (migration 0016): rate limits by scope, the Odoo key follows its Odoo, memberships only through
-- invitations, stock written only through the upload functions. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('sa@x.test', '{"full_name":"Salma"}', now()), ('sb@x.test', '{"full_name":"Sherif"}', now());
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
-- The error a statement raises as the signed-in caller ('' when it runs).
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('sa@x.test'), 'Secure Co');
create temp table ids as select (select id from public.companies where name = 'Secure Co') as co,
  pg_temp.home('sa@x.test') as org_a, pg_temp.home('sb@x.test') as org_b, pg_temp.uid('sa@x.test') as ua, pg_temp.uid('sb@x.test') as ub;
grant select on ids to authenticated;
insert into public.odoo_connections (company_id, url, db, login, api_key_enc)
  values ((select co from ids), 'https://a.odoo.com', 'a', 'me@a', 'ENC1');

-- ---------------------------------------------------------------- 1. rate limits
select pg_temp.login('sa@x.test');
select pg_temp.check('old form closed to signed-in users', pg_temp.err($q$select public.hit_rate_limit('x', 1, 1)$q$), '42501');
select pg_temp.check('unknown scope refused', pg_temp.err($q$select public.rate_limit_hit('nope', 'x')$q$), 'P0001');
select pg_temp.check('own user counter allowed', public.rate_limit_hit('odoo', (select ua::text from ids))::text, 'true');
select pg_temp.check('someone else''s user counter refused', pg_temp.err($q$select public.rate_limit_hit('odoo', (select ub::text from ids))$q$), '42501');
select pg_temp.check('own company counter allowed', public.rate_limit_hit('ai_company', (select co::text from ids))::text, 'true');
select pg_temp.check('own organisation counter allowed', public.rate_limit_hit('invite', (select org_a::text from ids))::text, 'true');
select pg_temp.check('another organisation counter refused', pg_temp.err($q$select public.rate_limit_hit('invite', (select org_b::text from ids))$q$), '42501');
select pg_temp.login('sb@x.test');
select pg_temp.check('another company counter refused', pg_temp.err($q$select public.rate_limit_hit('ai_company', (select co::text from ids))$q$), '42501');
-- The limit comes from the database: pdf_render_ip allows 5 in 10 minutes, the 6th is refused.
select pg_temp.check('five renders allowed', (select bool_and(public.rate_limit_hit('pdf_render_ip', '10.0.0.9')) from generate_series(1, 5))::text, 'true');
select pg_temp.check('sixth render refused', public.rate_limit_hit('pdf_render_ip', '10.0.0.9')::text, 'false');
reset role;
set role anon;
select pg_temp.check('signed-out caller may count an address', public.rate_limit_hit('pdf_render_ip', '10.0.0.10')::text, 'true');
select pg_temp.check('signed-out caller may not count a user', pg_temp.err($q$select public.rate_limit_hit('pdf_render_user', 'someone')$q$), '42501');
reset role;

-- ---------------------------------------------------------------- 2. the Odoo key follows its Odoo
select pg_temp.login('sa@x.test');
update public.odoo_connections set status = 'saved' where company_id = (select co from ids);
select pg_temp.check('other changes keep the key', (select api_key_enc from public.odoo_connections where company_id = (select co from ids)), 'ENC1');
update public.odoo_connections set url = 'https://evil.example' where company_id = (select co from ids);
select pg_temp.check('a new address clears the key', (select api_key_enc from public.odoo_connections where company_id = (select co from ids)), '');
update public.odoo_connections set url = 'https://b.odoo.com', api_key_enc = 'ENC2' where company_id = (select co from ids);
select pg_temp.check('a new address with a new key keeps the new key', (select api_key_enc from public.odoo_connections where company_id = (select co from ids)), 'ENC2');
update public.odoo_connections set login = 'other@b' where company_id = (select co from ids);
select pg_temp.check('a new login clears the key', (select api_key_enc from public.odoo_connections where company_id = (select co from ids)), '');
-- Everything since the books start: a sync may keep up to 20 years of months (migration 0024).
update public.odoo_connections set months_history = 240 where company_id = (select co from ids);
select pg_temp.check('a sync may keep 240 months', (select months_history::text from public.odoo_connections where company_id = (select co from ids)), '240');

-- ---------------------------------------------------------------- 3. memberships
select pg_temp.check('a member cannot add a membership directly',
  pg_temp.err($q$insert into public.memberships (org_id, user_id, role) values ((select org_a from ids), (select ub from ids), 'viewer')$q$), '42501');
select pg_temp.check('a membership cannot move to another person',
  pg_temp.err($q$update public.memberships set user_id = (select ub from ids) where org_id = (select org_a from ids)$q$), '42501');
select pg_temp.check('a role change still works',
  pg_temp.err($q$update public.memberships set role = 'admin' where org_id = (select org_a from ids) and user_id = (select ua from ids)$q$), '');

-- ---------------------------------------------------------------- 4. stock rows
select pg_temp.check('no direct stock layer insert',
  pg_temp.err($q$insert into public.stock_layers (company_id) values ((select co from ids))$q$), '42501');
select pg_temp.check('no direct stock move delete', pg_temp.err($q$delete from public.stock_moves$q$), '42501');
select pg_temp.check('no direct ledger line update', pg_temp.err($q$update public.stock_ledger_lines set amount = 0$q$), '42501');
select pg_temp.check('no direct ledger stock posting insert',
  pg_temp.err($q$insert into public.stock_ledger_lines (company_id, period, ref, account, amount) values ((select co from ids), '2026-01', 'x', '1', 1)$q$), '42501');
select pg_temp.check('ledger stock postings can still be cleared by an editor',
  pg_temp.err($q$delete from public.stock_ledger_lines where company_id = (select co from ids)$q$), '');
select pg_temp.check('no direct batch insert',
  pg_temp.err($q$insert into public.inventory_batches (company_id) values ((select co from ids))$q$), '42501');
reset role;
