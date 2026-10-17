-- Each company's export layouts (migration 0018): members read, editors write, a changed layout keeps the old one.
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('pa@x.test', '{"full_name":"Pakinam"}', now()), ('pv@x.test', '{"full_name":"Passant"}', now()), ('po@x.test', '{"full_name":"Pierre"}', now());

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

insert into public.companies (org_id, name) values (pg_temp.home('pa@x.test'), 'Layout Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('pa@x.test'), pg_temp.uid('pv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Layout Co') as co;
grant select on ids to authenticated;

select pg_temp.login('pa@x.test');
insert into public.input_profiles (company_id, kind, headings, read, ignored, sheet) values ((select co from ids), 'sales:list', '{date,partner,untaxed total,margin}', '{Date,Partner,Untaxed Total}', '{Margin}', 'Invoices');
select pg_temp.check('editor saves a layout', (select array_to_string(headings, ',') from public.input_profiles), 'date,partner,untaxed total,margin');
insert into public.input_profiles (company_id, kind, headings, sheet) values ((select co from ids), 'sales:list', '{date,partner,untaxed total}', 'Invoices')
  on conflict (company_id, kind) do update set headings = excluded.headings;
select pg_temp.check('a changed layout replaces it', (select array_to_string(headings, ',') from public.input_profiles), 'date,partner,untaxed total');
select pg_temp.check('the old layout is kept in the history', (select history -> 0 -> 'headings' ->> 3 from public.input_profiles), 'margin');
insert into public.input_profiles (company_id, kind, headings, sheet) values ((select co from ids), 'sales:list', '{date,partner,untaxed total}', 'Invoices')
  on conflict (company_id, kind) do update set headings = excluded.headings;
select pg_temp.check('the same layout adds no history', (select jsonb_array_length(history)::text from public.input_profiles), '1');

select pg_temp.login('pv@x.test');
select pg_temp.check('a viewer reads it', (select count(*)::text from public.input_profiles), '1');
select pg_temp.check('a viewer cannot change it', pg_temp.err($q$update public.input_profiles set headings = '{x}'$q$) || (select array_length(headings, 1)::text from public.input_profiles), '3');
select pg_temp.login('po@x.test');
select pg_temp.check('an outsider sees nothing', (select count(*)::text from public.input_profiles), '0');
reset role;
set role anon;
select pg_temp.check('signed-out visitors cannot read', pg_temp.err($q$select count(*) from public.input_profiles$q$), '42501');
reset role;
