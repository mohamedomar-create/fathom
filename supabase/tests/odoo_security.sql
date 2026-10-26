-- Odoo connection protection (migration 0025): the key is unreadable through the API, admins change the connection,
-- an append-only audit log, one sync at a time, limits per company. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

-- Supabase grants every table to signed-in users by default; 0025 must take the key back from that, so grant first and
-- run the migration again (it is safe to repeat).
grant select, insert, update, delete on public.odoo_connections to authenticated;
\i supabase/migrations/0025_odoo_security.sql

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('oa@x.test', '{"full_name":"Admin"}', now()), ('oe@x.test', '{"full_name":"Editor"}', now()),
  ('ov@x.test', '{"full_name":"Viewer"}', now()), ('oo@x.test', '{"full_name":"Outsider"}', now());

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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(q text) returns text language plpgsql as $f$
begin
  execute q;
  return '';
exception when others then return sqlstate;
end $f$;
create function pg_temp.val(q text) returns text language plpgsql as $f$
declare r text;
begin
  execute q into r;
  return r;
exception when others then return 'ERR ' || sqlstate;
end $f$;

insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('oa@x.test'), pg_temp.uid('oe@x.test'), 'editor'), (pg_temp.home('oa@x.test'), pg_temp.uid('ov@x.test'), 'viewer');
insert into public.companies (org_id, name) values (pg_temp.home('oa@x.test'), 'Odoo Secure Co');
create temp table oids as select (select id from public.companies where name = 'Odoo Secure Co') as co;
grant select on oids to authenticated;

-- ---------------------------------------------------------------- admin saves; others cannot
select pg_temp.login('oe@x.test');
select pg_temp.check('editor cannot save a connection', pg_temp.err($q$select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', 'v2.K.t.c', 1, 'A Co', false, 30, '18.0', null)$q$), '42501');
select pg_temp.login('oa@x.test');
select pg_temp.check('nobody inserts a connection directly, not even an admin', pg_temp.err($q$insert into public.odoo_connections (company_id, url, db, login, api_key_enc) values ((select co from oids), 'https://a.odoo.com', 'a', 'me@a', 'v2.a.b.c')$q$), '42501');
select pg_temp.check('a key the app did not encrypt and bind is refused', pg_temp.err($q$select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', 'v1.K.t.c', 1, 'A Co', false, 30, '18.0', null)$q$), '22023');
select pg_temp.check('the first save needs a key', pg_temp.err($q$select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', null, 1, 'A Co', false, 30, '18.0', null)$q$), 'P0001');
select pg_temp.check('admin saves a connection', pg_temp.err($q$select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', 'v2.K.t.c', 1, 'A Co', false, 30, '18.0', null)$q$), '');
select pg_temp.check('admin saves again keeping the key', pg_temp.err($q$select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', null, 1, 'A Co', false, 30, '18.0', null)$q$), '');
reset role;
select pg_temp.check('the key is kept', (select api_key_enc from public.odoo_connections where company_id = (select co from oids)), 'v2.K.t.c');
select pg_temp.login('oa@x.test');

-- ---------------------------------------------------------------- the key is not readable through the API
select pg_temp.check('admin cannot select the key column', pg_temp.err($q$select api_key_enc from public.odoo_connections$q$), '42501');
select pg_temp.check('select * is refused (it includes the key)', pg_temp.err($q$select * from public.odoo_connections$q$), '42501');
select pg_temp.check('the other columns are readable', pg_temp.val($q$select has_key::text || ' ' || url from public.odoo_connections$q$), 'true https://a.odoo.com');
select pg_temp.login('oe@x.test');
select pg_temp.check('editor cannot select the key column', pg_temp.err($q$select api_key_enc from public.odoo_connections$q$), '42501');
select pg_temp.check('editor reads the key through odoo_secret', pg_temp.val($q$select public.odoo_secret((select co from oids))$q$), 'v2.K.t.c');
select pg_temp.login('ov@x.test');
select pg_temp.check('viewer cannot run odoo_secret', pg_temp.err($q$select public.odoo_secret((select co from oids))$q$), '42501');
select pg_temp.check('viewer sees no connection row', pg_temp.val($q$select count(*)::text from public.odoo_connections$q$), '0');
select pg_temp.login('oo@x.test');
select pg_temp.check('outsider cannot run odoo_secret', pg_temp.err($q$select public.odoo_secret((select co from oids))$q$), '42501');
reset role;
select pg_temp.check('anon cannot run odoo_secret', (select has_function_privilege('anon', 'public.odoo_secret(uuid)', 'execute')::text), 'false');

-- ---------------------------------------------------------------- editors sync, admins change
select pg_temp.login('oe@x.test');
select pg_temp.check('editor cannot change the key', pg_temp.err($q$update public.odoo_connections set api_key_enc = 'v1.X' where company_id = (select co from oids)$q$), '42501');
select pg_temp.check('editor cannot change the address', pg_temp.err($q$update public.odoo_connections set url = 'https://evil.example' where company_id = (select co from oids)$q$), '42501');
select pg_temp.check('editor cannot remove the connection', pg_temp.val($q$with d as (delete from public.odoo_connections where company_id = (select co from oids) returning 1) select count(*)::text from d$q$), '0');
select pg_temp.check('editor cannot rename the synced company', pg_temp.err($q$update public.odoo_connections set odoo_company_name = 'Fake' where company_id = (select co from oids)$q$), '42501');
select pg_temp.check('editor updates the sync status', pg_temp.err($q$update public.odoo_connections set status = 'ok', last_error = null where company_id = (select co from oids)$q$), '');
reset role;
select pg_temp.check('a connection never moves to another company', pg_temp.err($q$update public.odoo_connections set company_id = (select id from public.companies where name <> 'Odoo Secure Co' limit 1) where company_id = (select co from oids)$q$), '42501');
select pg_temp.login('oe@x.test');

-- ---------------------------------------------------------------- one sync at a time
select pg_temp.check('first claim succeeds', pg_temp.val($q$select public.odoo_claim_sync((select co from oids))::text$q$), 'true');
select pg_temp.check('second claim is refused', pg_temp.val($q$select public.odoo_claim_sync((select co from oids))::text$q$), 'false');
reset role;
update public.odoo_connections set sync_started_at = now() - interval '20 minutes' where company_id = (select co from oids);
select pg_temp.login('oe@x.test');
select pg_temp.check('an abandoned claim is taken over', pg_temp.val($q$select public.odoo_claim_sync((select co from oids))::text$q$), 'true');
select pg_temp.login('ov@x.test');
select pg_temp.check('viewer cannot claim a sync', pg_temp.err($q$select public.odoo_claim_sync((select co from oids))$q$), '42501');

-- ---------------------------------------------------------------- audit log
select pg_temp.login('oa@x.test');
select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', 'v2.N.E.W', 1, 'A Co', false, 30, '18.0', null);
select public.odoo_save((select co from oids), 'https://b.odoo.com', 'a', 'me@a', null, 1, 'A Co', false, 30, '18.0', null);
select pg_temp.check('the old key is cleared when the address changes', pg_temp.val($q$select has_key::text from public.odoo_connections$q$), 'false');
select pg_temp.login('oe@x.test');
select pg_temp.check('editor logs a test', pg_temp.err($q$select public.odoo_audit_log((select co from oids), 'test', true, 'Odoo 18', null)$q$), '');
select pg_temp.login('ov@x.test');
select pg_temp.check('viewer cannot write to the log', pg_temp.err($q$select public.odoo_audit_log((select co from oids), 'sync', true, 'fake')$q$), '42501');
select pg_temp.check('viewer cannot use up the company sync limit', pg_temp.err($q$select public.rate_limit_hit('odoo_sync_company', (select co from oids)::text)$q$), '42501');
select pg_temp.login('oe@x.test');
select pg_temp.check('the app cannot log a save itself', pg_temp.err($q$select public.odoo_audit_log((select co from oids), 'save', true)$q$), '22023');
select pg_temp.login('ov@x.test');
select pg_temp.check('viewer reads the log', pg_temp.val($q$select string_agg(action, ',' order by id) from public.odoo_audit where company_id = (select co from oids)$q$), 'save,key_changed,key_cleared,save,test');
select pg_temp.check('nobody inserts into the log directly', pg_temp.err($q$insert into public.odoo_audit (company_id, action, ok) values ((select co from oids), 'sync', true)$q$), '42501');
select pg_temp.login('oa@x.test');
select pg_temp.check('admin cannot edit the log', pg_temp.err($q$update public.odoo_audit set ok = false$q$), '42501');
select pg_temp.check('admin cannot delete from the log', pg_temp.err($q$delete from public.odoo_audit$q$), '42501');
reset role;
select pg_temp.check('even the owner cannot edit the log', pg_temp.err($q$update public.odoo_audit set ok = false$q$), '42501');
select pg_temp.login('oo@x.test');
select pg_temp.check('outsider sees no log', pg_temp.val($q$select count(*)::text from public.odoo_audit where company_id = (select co from oids)$q$), '0');
select pg_temp.check('outsider cannot log', pg_temp.err($q$select public.odoo_audit_log((select co from oids), 'test', true)$q$), '42501');
select pg_temp.login('oa@x.test');
select pg_temp.check('admin removes the connection', pg_temp.err($q$delete from public.odoo_connections where company_id = (select co from oids)$q$), '');
select pg_temp.check('the removal is logged', pg_temp.val($q$select action from public.odoo_audit where company_id = (select co from oids) order by id desc limit 1$q$), 'disconnect');

reset role;
select pg_temp.check('setting a live user to null is still refused', pg_temp.err($q$update public.odoo_audit set user_id = null where user_id is not null$q$), '42501');
select pg_temp.check('deleting a user keeps their log rows', pg_temp.err($q$delete from auth.users where email = 'oe@x.test'$q$), '');
select pg_temp.check('their rows remain without the user', pg_temp.val($q$select count(*)::text from public.odoo_audit where company_id = (select co from oids) and action = 'test' and user_id is null$q$), '1');

-- ---------------------------------------------------------------- limits per company
select pg_temp.check('company test limit stops at 10', pg_temp.val($q$select count(*) filter (where public.rate_limit_hit('odoo_test_company', (select co from oids)::text))::text from generate_series(1, 12)$q$), '10');
select pg_temp.login('oo@x.test');
select pg_temp.check('outsider cannot count a company limit', pg_temp.err($q$select public.rate_limit_hit('odoo_sync_company', (select co from oids)::text)$q$), '42501');
reset role;
select pg_temp.login('oa@x.test');
select public.odoo_save((select co from oids), 'https://a.odoo.com', 'a', 'me@a', 'v2.K.t.c', 1, 'A Co', false, 30, '18.0', null);
reset role;
select pg_temp.check('a company still connected to Odoo can be deleted', pg_temp.err($q$delete from public.companies where id = (select co from oids)$q$), '');
select pg_temp.check('no log rows left for it', (select count(*)::text from public.odoo_audit where company_id = (select co from oids)), '0');
