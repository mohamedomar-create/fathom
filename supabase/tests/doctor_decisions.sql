-- The AI system doctor's decisions (migration 0056): a finding accepted with a reason, undone within 30 days.
-- Members read; editors accept and undo through the functions; nobody writes the table directly. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on
\i supabase/migrations/0056_doctor.sql
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('dra@x.test', '{"full_name":"Ada"}', now()), ('dre@x.test', '{"full_name":"Eve"}', now()),
  ('drv@x.test', '{"full_name":"Vic"}', now()), ('dro@x.test', '{"full_name":"Out"}', now());
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
create function pg_temp.fails(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  return 'ran';
exception when others then return 'refused';
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('dra@x.test'), 'Doctor Co'), (pg_temp.home('dro@x.test'), 'Doctor Outsider Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('dra@x.test'), pg_temp.uid('dre@x.test'), 'editor'),
  (pg_temp.home('dra@x.test'), pg_temp.uid('drv@x.test'), 'viewer');
create temp table ids (co uuid, other uuid, eve uuid, ada uuid);
insert into ids select (select id from public.companies where name = 'Doctor Co'), (select id from public.companies where name = 'Doctor Outsider Co'), pg_temp.uid('dre@x.test'), pg_temp.uid('dra@x.test');
grant select on ids to authenticated;
create temp table got (id uuid);
grant all on got to authenticated;

select pg_temp.check('schema version 56', public.schema_version()::text, '56');
select pg_temp.check('row security is on', (select relrowsecurity from pg_class where oid = 'public.doctor_decisions'::regclass)::text, 'true');

-- An editor accepts a finding with a reason; members can read it.
select pg_temp.login('dre@x.test');
insert into got select public.doctor_accept((select co from ids), 'review||Customer days of 90 look too high', 'Customer days of 90 look too high', 'A government customer pays late by contract', 120000);
select pg_temp.check('the decision is kept with its reason', (select reason from public.doctor_decisions where id = (select id from got)), 'A government customer pays late by contract');
select pg_temp.check('and who made it', (select (created_by = (select eve from ids))::text from public.doctor_decisions where id = (select id from got)), 'true');
select pg_temp.check('the money at stake when it was accepted is kept', (select amount::text from public.doctor_decisions where id = (select id from got)), '120000');
select pg_temp.check('accepting again keeps the earlier decision as history and opens a new one',
  (select public.doctor_accept((select co from ids), 'review||Customer days of 90 look too high', 'Customer days of 90 look too high', 'Updated reason', 130000) <> (select id from got))::text, 'true');
select pg_temp.check('the earlier decision is closed, with its reason', (select (undone_at is not null)::text || ':' || reason from public.doctor_decisions where id = (select id from got)), 'true:A government customer pays late by contract');
select pg_temp.check('one open decision per finding', (select count(*)::text from public.doctor_decisions where company_id = (select co from ids) and undone_at is null), '1');
delete from got; insert into got select id from public.doctor_decisions where company_id = (select co from ids) and undone_at is null;
select pg_temp.check('a reason is required', pg_temp.fails($$select public.doctor_accept((select co from ids), 'k2', 'T', ' ', null)$$), 'refused');

select pg_temp.login('drv@x.test');
select pg_temp.check('a viewer reads the decisions, the history included', (select count(*)::text from public.doctor_decisions where company_id = (select co from ids)), '2');
select pg_temp.check('a viewer cannot accept', pg_temp.fails($$select public.doctor_accept((select co from ids), 'k3', 'T', 'reason', null)$$), 'refused');
select pg_temp.check('a viewer cannot undo', pg_temp.fails($$select public.doctor_undo((select co from ids), (select id from got))$$), 'refused');
select pg_temp.check('nobody writes the table directly', pg_temp.fails($$insert into public.doctor_decisions (company_id, finding_key, title, reason) values ((select co from ids), 'x', 'x', 'xxx')$$), 'refused');

select pg_temp.login('dro@x.test');
select pg_temp.check('an outsider sees nothing', (select count(*)::text from public.doctor_decisions where company_id = (select co from ids)), '0');
select pg_temp.check('an outsider cannot accept for another company', pg_temp.fails($$select public.doctor_accept((select co from ids), 'k4', 'T', 'reason', null)$$), 'refused');

-- Undo within 30 days; then the finding can be accepted afresh.
select pg_temp.login('dra@x.test');
select public.doctor_undo((select co from ids), (select id from got));
select pg_temp.check('undone: kept for the record, marked undone', (select (undone_at is not null and undone_by = (select ada from ids))::text from public.doctor_decisions where id = (select id from got)), 'true');
select pg_temp.check('undoing twice is refused', pg_temp.fails($$select public.doctor_undo((select co from ids), (select id from got))$$), 'refused');
select pg_temp.check('accepted again after the undo', (public.doctor_accept((select co from ids), 'review||Customer days of 90 look too high', 'T', 'Accepted again', null) is not null)::text, 'true');
reset role;
update public.doctor_decisions set created_at = now() - interval '31 days' where reason = 'Accepted again';
select pg_temp.login('dra@x.test');
select pg_temp.check('an undo after 30 days is refused',
  pg_temp.fails($$select public.doctor_undo((select co from ids), (select id from public.doctor_decisions where reason = 'Accepted again'))$$), 'refused');

reset role;
select pg_temp.check('anon cannot run the functions', (has_function_privilege('anon', 'public.doctor_accept(uuid, text, text, text, numeric)', 'execute') or has_function_privilege('anon', 'public.doctor_undo(uuid, uuid)', 'execute'))::text, 'false');
select pg_temp.check('the doctor rate limits exist', (select count(*)::text from private.rate_scopes where scope in ('doctor', 'ask')), '2');
select pg_temp.check('tenant guard on the table', (select count(*) > 0 from pg_trigger where tgrelid = 'public.doctor_decisions'::regclass and tgname like 'tenant%')::text, 'true');
delete from public.companies where name in ('Doctor Co', 'Doctor Outsider Co');
