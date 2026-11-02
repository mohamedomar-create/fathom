-- Budgets (migration 0052): versions per financial year (one original, any number of revisions), lines by account and
-- month, products by units × price. Members read; editors write through the functions; an approved version is locked;
-- only an admin approves; closing a month never locks a budget; 20,000 lines save inside the 8-second limit.
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('bua@x.test', '{"full_name":"Ada"}', now()), ('bue@x.test', '{"full_name":"Eve"}', now()),
  ('buv@x.test', '{"full_name":"Vic"}', now()), ('buo@x.test', '{"full_name":"Out"}', now());

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

insert into public.companies (org_id, name) values (pg_temp.home('bua@x.test'), 'Budget Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('bua@x.test'), pg_temp.uid('bue@x.test'), 'editor'),
  (pg_temp.home('bua@x.test'), pg_temp.uid('buv@x.test'), 'viewer');
create temp table ids (co uuid, v1 uuid, v2 uuid, v3 uuid);
insert into ids (co) select id from public.companies where name = 'Budget Co';
grant select, update on ids to authenticated;

select pg_temp.check('the budget functions are there',
  (to_regprocedure('public.budget_create(uuid, text, text, text, uuid)') is not null
   and to_regprocedure('public.budget_save_lines(uuid, jsonb, boolean)') is not null
   and to_regprocedure('public.budget_save_products(uuid, jsonb, boolean)') is not null
   and to_regprocedure('public.budget_approve(uuid)') is not null
   and to_regprocedure('public.budget_delete(uuid)') is not null)::text, 'true');
select pg_temp.check('schema version 52', public.schema_version()::text, '52');

-- Who may create.
select pg_temp.login('buv@x.test');
select pg_temp.check('a viewer cannot create a budget', pg_temp.fails($$select public.budget_create((select co from ids), '2026', 'original', 'B', null)$$), 'refused');
select pg_temp.login('buo@x.test');
select pg_temp.check('an outsider cannot create a budget', pg_temp.fails($$select public.budget_create((select co from ids), '2026', 'original', 'B', null)$$), 'refused');

select pg_temp.login('bue@x.test');
update ids set v1 = public.budget_create(co, '2026', 'original', 'Budget 2026', null);
select pg_temp.check('an editor creates the original', (select status || '/' || kind || '/' || fy from public.budget_versions where id = (select v1 from ids)), 'draft/original/2026');
select pg_temp.check('one original per year', pg_temp.fails($$select public.budget_create((select co from ids), '2026', 'original', 'Again', null)$$), 'refused');
select pg_temp.check('another year has its own original', pg_temp.fails($$select public.budget_create((select co from ids), '2027', 'original', 'Budget 2027', null)$$), 'ran');
select pg_temp.check('a bad year is refused', pg_temp.fails($$select public.budget_create((select co from ids), '26', 'original', 'x', null)$$), 'refused');
select pg_temp.check('a revision needs an original', pg_temp.fails($$select public.budget_create((select co from ids), '2030', 'revision', 'x', null)$$), 'refused');

-- Lines and products.
select pg_temp.check('lines saved', public.budget_save_lines((select v1 from ids), '[
  {"key":"#410000","cls":"revenue","label":"Revenue","month":"2026-01","amount":1000},
  {"key":"#410000","cls":"revenue","label":"Revenue","month":"2026-02","amount":1100},
  {"key":"cls:exp_fixed","cls":"exp_fixed","label":"Fixed costs","month":"2026-01","amount":300}]'::jsonb, false)::text, '3');
select pg_temp.check('a line is changed in place', public.budget_save_lines((select v1 from ids),
  '[{"key":"#410000","cls":"revenue","label":"Revenue","month":"2026-01","amount":1200}]'::jsonb, false)::text, '1');
select pg_temp.check('three lines, the changed one updated', (select count(*) || '/' || sum(amount) from public.budget_lines where version_id = (select v1 from ids)), '3/2600');
select pg_temp.check('a bad month is refused', pg_temp.fails($$select public.budget_save_lines((select v1 from ids), '[{"key":"#1","cls":"revenue","month":"2026-13","amount":1}]'::jsonb, false)$$), 'refused');
select pg_temp.check('a line with no amount is refused', pg_temp.fails($$select public.budget_save_lines((select v1 from ids), '[{"key":"#1","cls":"revenue","month":"2026-03"}]'::jsonb, false)$$), 'refused');
select pg_temp.check('products saved', public.budget_save_products((select v1 from ids), '[
  {"product":"Mask","category":"Care","month":"2026-01","units":10,"price":50,"unit_cost":20},
  {"product":"Mask","category":"Care","month":"2026-02","units":12,"price":50,"unit_cost":null}]'::jsonb, false)::text, '2');
select pg_temp.check('replace keeps only the new rows', public.budget_save_products((select v1 from ids),
  '[{"product":"Bed","category":"","month":"2026-01","units":2,"price":900,"unit_cost":400}]'::jsonb, true)::text, '1');
select pg_temp.check('one product row left', (select string_agg(product, ',') from public.budget_products where version_id = (select v1 from ids)), 'Bed');

-- Nobody writes the tables directly.
select pg_temp.check('no direct insert', pg_temp.fails($$insert into public.budget_lines (version_id, company_id, key, cls, month, amount) values ((select v1 from ids), (select co from ids), '#9', 'revenue', '2026-05', 1)$$), 'refused');
select pg_temp.check('no direct update', pg_temp.fails($$update public.budget_versions set status = 'approved' where id = (select v1 from ids)$$), 'refused');

-- Reading.
select pg_temp.login('buv@x.test');
select pg_temp.check('a viewer reads the lines', (select count(*) from public.budget_lines where version_id = (select v1 from ids))::text, '3');
select pg_temp.check('a viewer cannot save lines', pg_temp.fails($$select public.budget_save_lines((select v1 from ids), '[{"key":"#1","cls":"revenue","month":"2026-03","amount":1}]'::jsonb, false)$$), 'refused');
select pg_temp.login('buo@x.test');
select pg_temp.check('an outsider sees no versions', (select count(*) from public.budget_versions where company_id = (select co from ids))::text, '0');
select pg_temp.check('an outsider sees no lines', (select count(*) from public.budget_lines where company_id = (select co from ids))::text, '0');
select pg_temp.check('an outsider cannot save lines', pg_temp.fails($$select public.budget_save_lines((select v1 from ids), '[{"key":"#1","cls":"revenue","month":"2026-03","amount":1}]'::jsonb, false)$$), 'refused');

-- A closed month never locks a budget.
reset role;
update public.companies set closed_through = '2026-06' where id = (select co from ids);
select pg_temp.login('bue@x.test');
select pg_temp.check('a closed month can still be budgeted', public.budget_save_lines((select v1 from ids),
  '[{"key":"#410000","cls":"revenue","label":"Revenue","month":"2026-03","amount":900}]'::jsonb, false)::text, '1');

-- Approval: admins only; afterwards the version is locked.
select pg_temp.check('an editor cannot approve', pg_temp.fails($$select public.budget_approve((select v1 from ids))$$), 'refused');
select pg_temp.login('bua@x.test');
select public.budget_approve((select v1 from ids));
reset role;
select pg_temp.check('approved, with who and when', (select status || '/' || (approved_by = pg_temp.uid('bua@x.test'))::text || '/' || (approved_at is not null)::text from public.budget_versions where id = (select v1 from ids)), 'approved/true/true');
select pg_temp.login('bua@x.test');
select pg_temp.check('an approved version cannot be changed', pg_temp.fails($$select public.budget_save_lines((select v1 from ids), '[{"key":"#410000","cls":"revenue","month":"2026-04","amount":1}]'::jsonb, false)$$), 'refused');
select pg_temp.check('nor its products', pg_temp.fails($$select public.budget_save_products((select v1 from ids), '[]'::jsonb, true)$$), 'refused');
select pg_temp.check('nor deleted', pg_temp.fails($$select public.budget_delete((select v1 from ids))$$), 'refused');
select pg_temp.check('nor approved twice', pg_temp.fails($$select public.budget_approve((select v1 from ids))$$), 'refused');

-- A revision copies the version it is based on and stays a draft.
select pg_temp.login('bue@x.test');
update ids set v2 = public.budget_create(co, '2026', 'revision', 'Revision 1', v1);
select pg_temp.check('the revision copies lines and products',
  (select (select count(*) from public.budget_lines where version_id = v2) || '/' || (select count(*) from public.budget_products where version_id = v2)
     || '/' || (select based_on = v1 from public.budget_versions where id = v2)::text from ids), '4/1/true');
select pg_temp.check('the revision is a draft', (select status from public.budget_versions where id = (select v2 from ids)), 'draft');
select pg_temp.check('the original is unchanged by editing the revision', (public.budget_save_lines((select v2 from ids),
  '[{"key":"#410000","cls":"revenue","label":"Revenue","month":"2026-01","amount":5}]'::jsonb, false) = 1
  and (select amount from public.budget_lines where version_id = (select v1 from ids) and key = '#410000' and month = '2026-01') = 1200)::text, 'true');

-- Another company's version can't be copied.
reset role;
insert into public.companies (org_id, name) values (pg_temp.home('buo@x.test'), 'Budget Outsider Co');
select pg_temp.login('buo@x.test');
select pg_temp.check('another company''s version cannot be copied', pg_temp.fails($$select public.budget_create((select id from public.companies where name = 'Budget Outsider Co'), '2026', 'original', 'x', (select v1 from ids))$$), 'refused');

-- Deleting a draft.
select pg_temp.login('bue@x.test');
select public.budget_delete((select v2 from ids));
select pg_temp.check('a draft is deleted with its lines', (select count(*) from public.budget_lines where version_id = (select v2 from ids))::text, '0');

-- 20,000 lines in one call, inside 8 seconds; 20,001 are refused.
update ids set v3 = (select id from public.budget_versions where company_id = (select co from ids) and fy = '2027');
create temp table big as select jsonb_agg(jsonb_build_object('key', '#' || a, 'cls', 'exp_fixed', 'label', 'Account ' || a,
  'month', '2027-' || lpad(m::text, 2, '0'), 'amount', a * m)) as j
from generate_series(1, 1667) a, generate_series(1, 12) m where (a - 1) * 12 + m <= 20000;
grant select on big to authenticated;
set statement_timeout = '8s';
select pg_temp.check('20,000 lines saved inside 8 seconds', public.budget_save_lines((select v3 from ids), (select j from big), true)::text, '20000');
reset statement_timeout;
select pg_temp.check('20,001 lines are refused', pg_temp.fails($$select public.budget_save_lines((select v3 from ids), (select j || '[{"key":"#x","cls":"revenue","month":"2027-01","amount":1}]'::jsonb from big), true)$$), 'refused');
reset role;
