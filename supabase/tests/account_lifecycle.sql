-- Leave / delete organisation / delete account (migration 0007). Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('a@x.test', '{"full_name":"Alice"}', now()), ('b@x.test', '{"full_name":"Bob"}', now()), ('c@x.test', '{"full_name":"Cara"}', now());
grant select on all tables in schema public to authenticated;

-- Runs `sql` as the signed-in user `uid`; returns 'OK' or the error message.
create function pg_temp.as_user(sql text, uid uuid) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
  set local role authenticated;
  execute sql;
  reset role;
  return 'OK';
exception when others then
  reset role;
  return sqlerrm;
end $f$;

create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;

create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.home(e text) returns uuid language sql as $f$ select org_id from public.memberships where user_id = pg_temp.uid(e) order by created_at limit 1 $f$;

-- Alice's organisation has Bob as an editor; Cara works alone.
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('a@x.test'), pg_temp.uid('b@x.test'), 'editor');
insert into public.companies (org_id, name) values (pg_temp.home('a@x.test'), 'Alpha Co'), (pg_temp.home('c@x.test'), 'Cara Co');
create temp table ids as select pg_temp.home('a@x.test') as oa, pg_temp.home('c@x.test') as oc, (select name from public.organizations where id = pg_temp.home('a@x.test')) as oa_name;
grant select on ids to authenticated;

-- leave_organisation
begin;
select pg_temp.check('member can leave', pg_temp.as_user(format('select public.leave_organisation(%L)', oa), pg_temp.uid('b@x.test')), 'OK') from ids;
select pg_temp.check('member keeps own organisation', (select count(*)::text from public.memberships where user_id = pg_temp.uid('b@x.test')), '1');
rollback;
select pg_temp.check('last admin cannot leave', pg_temp.as_user(format('select public.leave_organisation(%L)', oa), pg_temp.uid('a@x.test')), 'an organisation needs at least one admin') from ids;
select pg_temp.check('only member cannot leave', pg_temp.as_user(format('select public.leave_organisation(%L)', oc), pg_temp.uid('c@x.test')), 'You are the only member. Delete the organisation instead.') from ids;
select pg_temp.check('outsider cannot leave', pg_temp.as_user(format('select public.leave_organisation(%L)', oc), pg_temp.uid('a@x.test')), 'You are not a member of this organisation.') from ids;

-- delete_organisation
select pg_temp.check('editor cannot delete organisation', pg_temp.as_user(format('select public.delete_organisation(%L, %L)', oa, oa_name), pg_temp.uid('b@x.test')), 'Only admins can delete this organisation.') from ids;
select pg_temp.check('wrong name refused', pg_temp.as_user(format('select public.delete_organisation(%L, %L)', oa, 'nope'), pg_temp.uid('a@x.test')), 'The name you typed does not match the organisation name.') from ids;
begin;
select pg_temp.check('admin deletes organisation', pg_temp.as_user(format('select public.delete_organisation(%L, %L)', oa, oa_name), pg_temp.uid('a@x.test')), 'OK') from ids;
select pg_temp.check('organisation gone', (select count(*)::text from public.organizations where id = (select oa from ids)), '0');
select pg_temp.check('its companies gone', (select count(*)::text from public.companies where name = 'Alpha Co'), '0');
select pg_temp.check('admin gets a new home organisation', (select count(*)::text from public.memberships where user_id = pg_temp.uid('a@x.test') and role = 'admin'), '1');
select pg_temp.check('other member keeps own organisation', (select count(*)::text from public.memberships where user_id = pg_temp.uid('b@x.test')), '1');
rollback;

-- delete_my_account
select pg_temp.check('wrong email refused', pg_temp.as_user('select public.delete_my_account(''z@x.test'')', pg_temp.uid('a@x.test')), 'The email you typed does not match your account.');
select pg_temp.check('last admin of shared organisation refused', pg_temp.as_user('select public.delete_my_account(''A@X.test'')', pg_temp.uid('a@x.test')), 'Make someone else an admin of Alice''s organisation first, or delete it.');
begin;
select pg_temp.check('sole member deletes account', pg_temp.as_user('select public.delete_my_account('' C@x.test '')', pg_temp.uid('c@x.test')), 'OK');
select pg_temp.check('user gone', (select count(*)::text from auth.users where email = 'c@x.test'), '0');
select pg_temp.check('sole organisation gone', (select count(*)::text from public.organizations where id = (select oc from ids)), '0');
select pg_temp.check('its companies gone', (select count(*)::text from public.companies where name = 'Cara Co'), '0');
rollback;
begin;
update public.memberships set role = 'admin' where org_id = (select oa from ids) and user_id = pg_temp.uid('b@x.test');
select pg_temp.check('deletes account after handing over admin', pg_temp.as_user('select public.delete_my_account(''a@x.test'')', pg_temp.uid('a@x.test')), 'OK');
select pg_temp.check('shared organisation stays', (select count(*)::text from public.organizations where id = (select oa from ids)), '1');
select pg_temp.check('its companies stay', (select count(*)::text from public.companies where name = 'Alpha Co'), '1');
rollback;

-- Anonymous callers cannot reach any of it.
set role anon;
do $$ begin perform public.delete_my_account('a@x.test'); raise exception 'FAIL anon could call delete_my_account';
exception when insufficient_privilege then raise notice 'ok  anon cannot call delete_my_account'; end $$;
reset role;
