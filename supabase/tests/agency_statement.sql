-- A buying agency's statement (migration 0030): editors replace it in one call, members read it through the end-user
-- summary, outsiders see nothing, and saving it never touches sales lines or balances. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('sa@x.test', '{"full_name":"Salma"}', now()), ('sv@x.test', '{"full_name":"Sherif"}', now()), ('so2@x.test', '{"full_name":"Soha"}', now());

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

insert into public.companies (org_id, name) values (pg_temp.home('sa@x.test'), 'Statement Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('sa@x.test'), pg_temp.uid('sv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Statement Co') as co;
grant select on ids to authenticated;
create temp table bs (b uuid);
grant all on bs to authenticated;

select pg_temp.login('sa@x.test');
insert into bs select public.begin_sales_batch((select co from ids), 'file', array['2026-09'], 'sync');
select public.add_sales_lines((select b from bs), $$[
  {"day": "2026-09-10", "period": "2026-09", "doc": "INV2/2026/0901", "customer": "Agency", "product": "Cannula", "category": "Disposable", "qty": 1, "amount": 26450, "note": "Disposable"},
  {"day": "2026-09-12", "period": "2026-09", "doc": "INV2/2026/0902", "customer": "Agency", "product": "Cannula", "category": "Disposable", "qty": 1, "amount": 5000, "endUser": "Ordered Hospital", "mapMethod": "order"}
]$$::jsonb);
create temp table before as select (select count(*) from public.sales_lines where company_id = (select co from ids)) n, (select coalesce(sum(amount), 0) from public.sales_lines where company_id = (select co from ids)) a;
grant select on before to authenticated;

select pg_temp.check('an editor saves a statement', public.save_agency_statement((select co from ids), 'UPA.xlsx', array['UPA SOA'], '{}'::jsonb, $$[
  {"day": "2026-09-01", "dn": "202609001", "ref": "", "hospital": "Shifa Hospital", "funding": "free", "region": "cairo", "value": 26450, "sheet": "UPA SOA"},
  {"day": "2026-09-20", "dn": "202609002", "ref": "", "hospital": "Nour Hospital", "funding": "", "region": "delta", "value": 99999, "sheet": "UPA SOA"}
]$$::jsonb)::text, '2');
select public.save_agency_statement((select co from ids), 'UPA2.xlsx', array['UPA SOA'], '{}'::jsonb, $$[
  {"day": "2026-09-01", "dn": "202609001", "ref": "", "hospital": "Shifa Hospital", "funding": "free", "region": "cairo", "value": 26450, "sheet": "UPA SOA"}
]$$::jsonb);
select pg_temp.check('a new statement replaces the old one',
  (select count(*) from public.agency_statement_lines)::text || ' ' || (select count(*) from public.agency_statement_batches)::text || ' ' || (select filename from public.agency_statement_batches), '1 1 UPA2.xlsx');
select pg_temp.check('sales lines are untouched by the statement',
  (select count(*) || ' ' || sum(amount) from public.sales_lines where company_id = (select co from ids)), (select n || ' ' || a from before));

create temp table s as select public.end_user_summary((select co from ids)) j;
grant select on s to authenticated;
select pg_temp.check('the summary keeps agency invoices apart, with their day',
  (select string_agg((r ->> 'd') || '@' || (r ->> 'day'), ',' order by r ->> 'd') from s, jsonb_array_elements(j -> 'rows') r), 'INV2/2026/0901@2026-09-10,INV2/2026/0902@2026-09-12');
select pg_temp.check('the statement comes with it', (select (j -> 'statement' -> 0 ->> 'h') || ' ' || (j -> 'statementFile' ->> 'filename') from s), 'Shifa Hospital UPA2.xlsx');

select pg_temp.login('sv@x.test');
select pg_temp.check('a viewer reads the statement', (select count(*)::text from public.agency_statement_lines), '1');
select pg_temp.check('a viewer cannot save one', pg_temp.err($q$select public.save_agency_statement((select co from ids), 'x', null, '{}'::jsonb, '[]'::jsonb)$q$), '42501');
select pg_temp.check('a viewer cannot remove it', pg_temp.err($q$select public.remove_agency_statement((select co from ids))$q$), '42501');
select pg_temp.check('nobody writes the lines directly', pg_temp.err($q$insert into public.agency_statement_lines (company_id, batch_id, day, hospital, value) select (select co from ids), id, current_date, 'x', 1 from public.agency_statement_batches$q$), '42501');

select pg_temp.login('so2@x.test');
select pg_temp.check('an outsider sees no statement', (select count(*)::text from public.agency_statement_lines), '0');
select pg_temp.check('an outsider''s summary is empty', (select jsonb_array_length(public.end_user_summary((select co from ids)) -> 'statement')::text), '0');

select pg_temp.login('sa@x.test');
select public.remove_agency_statement((select co from ids));
select pg_temp.check('an editor removes it', (select count(*)::text from public.agency_statement_lines), '0');
reset role;
set role anon;
select pg_temp.check('signed-out visitors cannot save', pg_temp.err($q$select public.save_agency_statement(gen_random_uuid(), 'x', null, '{}'::jsonb, '[]'::jsonb)$q$), '42501');
reset role;
