-- RLS isolation check. Runs entirely inside a transaction and rolls back.
-- Expected: A sees "Org A"; replace returns 1; A balances 2; B sees "Org B", 0 companies, 0 balances;
-- company name stays "A Co" after B's update attempt; anon sees 0 companies.
begin;
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-a@example.test', '{"full_name":"User A","org_name":"Org A"}', now(), now()),
       ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-b@example.test', '{"full_name":"User B","org_name":"Org B"}', now(), now());
create temp table t_result(step text, val text) on commit drop;
grant all on t_result to authenticated, anon;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
insert into t_result select 'A sees orgs', string_agg(name, ',') from public.organizations;
insert into public.companies (org_id, name) select id, 'A Co' from public.organizations limit 1;
insert into t_result select 'A replace v', public.replace_company_data((select id from public.companies limit 1),
  '[{"code":"4000","name":"Sales","statement":"PL","class":"revenue","amounts":{"2026-01":-1000,"2026-02":-1200}}]'::jsonb)::text;
insert into t_result select 'A balances', count(*)::text from public.account_balances;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
insert into t_result select 'B sees orgs', string_agg(name, ',') from public.organizations;
insert into t_result select 'B sees companies', count(*)::text from public.companies;
insert into t_result select 'B sees balances', count(*)::text from public.account_balances;
update public.companies set name = 'hacked' where name = 'A Co';
reset role;
insert into t_result select 'company name after B update', name from public.companies where name in ('A Co','hacked');
set local role anon;
insert into t_result select 'anon companies', count(*)::text from public.companies;
reset role;
select * from t_result;
rollback;
