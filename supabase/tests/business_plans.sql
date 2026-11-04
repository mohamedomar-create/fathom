-- Business plans (migration 0054): one jsonb document per plan. Members read; editors create, save and delete through
-- the functions; at most 20 plans a company; creating and deleting are recorded. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('bpa@x.test', '{"full_name":"Ada"}', now()), ('bpe@x.test', '{"full_name":"Eve"}', now()),
  ('bpv@x.test', '{"full_name":"Vic"}', now()), ('bpo@x.test', '{"full_name":"Out"}', now());

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

insert into public.companies (org_id, name) values (pg_temp.home('bpa@x.test'), 'Plan Co'), (pg_temp.home('bpo@x.test'), 'Plan Outsider Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('bpa@x.test'), pg_temp.uid('bpe@x.test'), 'editor'),
  (pg_temp.home('bpa@x.test'), pg_temp.uid('bpv@x.test'), 'viewer');
create temp table ids (co uuid, other uuid);
insert into ids select (select id from public.companies where name = 'Plan Co'), (select id from public.companies where name = 'Plan Outsider Co');
grant select on ids to authenticated;

select pg_temp.check('the plan functions are there',
  (to_regprocedure('public.plan_create(uuid, text, jsonb)') is not null and to_regprocedure('public.plan_save(uuid, text, jsonb)') is not null
   and to_regprocedure('public.plan_delete(uuid, text)') is not null)::text, 'true');
select pg_temp.check('schema version 54 or later', (public.schema_version() >= 54)::text, 'true');
select pg_temp.check('row security is on', (select relrowsecurity from pg_class where oid = 'public.business_plans'::regclass)::text, 'true');

select pg_temp.login('bpe@x.test');
select public.plan_create((select co from ids), 'plan_a', '{"name":"Plan A","startYear":2027,"years":5}'::jsonb);
select pg_temp.check('an editor creates a plan', (select data->>'name' from public.business_plans where id = 'plan_a'), 'Plan A');
select pg_temp.check('creating is recorded', (select count(*) from public.company_data_audit where company_id = (select co from ids) and action = 'plan_create')::text, '1');
select public.plan_save((select co from ids), 'plan_a', '{"name":"Plan A2","startYear":2027,"years":3}'::jsonb);
select pg_temp.check('an editor saves it', (select data->>'name' || '/' || (data->>'years') from public.business_plans where id = 'plan_a'), 'Plan A2/3');
select pg_temp.check('no direct insert', pg_temp.fails($$insert into public.business_plans (id, company_id, data) values ('x', (select co from ids), '{}')$$), 'refused');
select pg_temp.check('no direct update', pg_temp.fails($$update public.business_plans set data = '{}' where id = 'plan_a'$$) || (select data->>'name' from public.business_plans where id = 'plan_a'), 'refusedPlan A2');
select pg_temp.check('a non-object plan is refused', pg_temp.fails($$select public.plan_save((select co from ids), 'plan_a', '[1]'::jsonb)$$), 'refused');
select pg_temp.check('a bad id is refused', pg_temp.fails($$select public.plan_create((select co from ids), 'bad id!', '{}'::jsonb)$$), 'refused');
select pg_temp.check('saving a plan that is not there is refused', pg_temp.fails($$select public.plan_save((select co from ids), 'nope', '{}'::jsonb)$$), 'refused');
select pg_temp.check('a plan over 2 MB is refused',
  pg_temp.fails($$select public.plan_save((select co from ids), 'plan_a', jsonb_build_object('summary', repeat(md5(random()::text), 70000)))$$), 'refused');
select pg_temp.check('an editor cannot write into another company', pg_temp.fails($$select public.plan_create((select other from ids), 'plan_x', '{}'::jsonb)$$), 'refused');

select pg_temp.login('bpv@x.test');
select pg_temp.check('a viewer reads the plan', (select count(*) from public.business_plans)::text, '1');
select pg_temp.check('a viewer cannot create', pg_temp.fails($$select public.plan_create((select co from ids), 'plan_v', '{}'::jsonb)$$), 'refused');
select pg_temp.check('a viewer cannot save', pg_temp.fails($$select public.plan_save((select co from ids), 'plan_a', '{}'::jsonb)$$), 'refused');
select pg_temp.check('a viewer cannot delete', pg_temp.fails($$select public.plan_delete((select co from ids), 'plan_a')$$), 'refused');

select pg_temp.login('bpo@x.test');
select pg_temp.check('an outsider reads no plan', (select count(*) from public.business_plans)::text, '0');
select pg_temp.check('an outsider cannot save', pg_temp.fails($$select public.plan_save((select co from ids), 'plan_a', '{}'::jsonb)$$), 'refused');

select pg_temp.login('bpe@x.test');
select public.plan_create((select co from ids), 'p' || i, '{}'::jsonb) from generate_series(2, 20) i;
select pg_temp.check('20 plans are allowed', (select count(*) from public.business_plans)::text, '20');
select pg_temp.check('the 21st is refused', pg_temp.fails($$select public.plan_create((select co from ids), 'p21', '{}'::jsonb)$$), 'refused');
select public.plan_delete((select co from ids), 'plan_a');
select pg_temp.check('an editor deletes a plan', (select count(*) from public.business_plans where id = 'plan_a')::text, '0');
select pg_temp.check('deleting is recorded', (select count(*) from public.company_data_audit where company_id = (select co from ids) and action = 'plan_delete')::text, '1');
select pg_temp.check('the same id can be used again in another company', (select count(*) from public.business_plans where company_id = (select other from ids))::text, '0');

reset role;
select pg_temp.check('anon cannot run the functions', (has_function_privilege('anon', 'public.plan_save(uuid, text, jsonb)', 'execute'))::text, 'false');
select pg_temp.check('the tenant guard is on the table', (select count(*) from pg_trigger where tgrelid = 'public.business_plans'::regclass and tgname = 'tenant_guard')::text, '1');
-- Leave no plan audit rows behind: later test files re-apply 0043, whose action list predates plans.
delete from public.company_data_audit where action in ('plan_create', 'plan_delete');
