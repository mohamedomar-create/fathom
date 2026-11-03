-- Budget builder storage (migration 0053): the company's budget setup, the builder rows per version (revenue, customer
-- and expense views), and one save for rows, lines and setup. Members read; editors write through the functions; an
-- approved version is locked; budget_create copies setup and rows. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('bba@x.test', '{"full_name":"Ada"}', now()), ('bbe@x.test', '{"full_name":"Eve"}', now()),
  ('bbv@x.test', '{"full_name":"Vic"}', now()), ('bbo@x.test', '{"full_name":"Out"}', now());

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
-- n rows of one view with distinct keys, each a valid 12-month row.
create function pg_temp.rows(v text, n integer, prefix text default 'k') returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('view', v, 'key', prefix || i, 'label', 'Row ' || i, 'mode', 'months',
    'basis', '{"x":1}'::jsonb, 'cost', '{"y":2}'::jsonb, 'months', jsonb_build_array(1,2,3,4,5,6,7,8,9,10,11,12))), '[]'::jsonb)
  from generate_series(1, n) i $f$;

insert into public.companies (org_id, name) values (pg_temp.home('bba@x.test'), 'Builder Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('bba@x.test'), pg_temp.uid('bbe@x.test'), 'editor'),
  (pg_temp.home('bba@x.test'), pg_temp.uid('bbv@x.test'), 'viewer');
create temp table ids (co uuid, v1 uuid, v2 uuid, v3 uuid);
insert into ids (co) select id from public.companies where name = 'Builder Co';
grant select, update on ids to authenticated;

select pg_temp.check('the builder functions are there',
  (to_regprocedure('public.budget_setup_save(uuid, jsonb)') is not null
   and to_regprocedure('public.budget_rows_save(uuid, jsonb, text[], jsonb, jsonb)') is not null)::text, 'true');
select pg_temp.check('schema version 53', public.schema_version()::text, '53');

select pg_temp.login('bbe@x.test');
update ids set v1 = public.budget_create(co, '2026', 'original', 'Budget 2026', null);

-- Company setup.
select pg_temp.login('bbv@x.test');
select pg_temp.check('a viewer cannot save the setup', pg_temp.fails($$select public.budget_setup_save((select co from ids), '{"a":1}'::jsonb)$$), 'refused');
select pg_temp.login('bbo@x.test');
select pg_temp.check('an outsider cannot save the setup', pg_temp.fails($$select public.budget_setup_save((select co from ids), '{"a":1}'::jsonb)$$), 'refused');
select pg_temp.check('an outsider reads no setup', (select count(*) from public.budget_setups)::text, '0');
select pg_temp.login('bbe@x.test');
select pg_temp.check('a non-object setup is refused', pg_temp.fails($$select public.budget_setup_save((select co from ids), '[1]'::jsonb)$$), 'refused');
select pg_temp.check('a setup over 1 MB is refused', pg_temp.fails($$select public.budget_setup_save((select co from ids), jsonb_build_object('big', repeat('x', 1100000)))$$), 'refused');
select public.budget_setup_save((select co from ids), '{"a":1}'::jsonb);
select pg_temp.check('an editor saves the setup', (select setup::text from public.budget_setups where company_id = (select co from ids)), '{"a": 1}');
select public.budget_setup_save((select co from ids), '{"b":2}'::jsonb);
select pg_temp.check('a re-save replaces it', (select setup::text from public.budget_setups where company_id = (select co from ids)), '{"b": 2}');
select pg_temp.login('bbv@x.test');
select pg_temp.check('a viewer reads the setup', (select count(*) from public.budget_setups)::text, '1');

-- Rows.
select pg_temp.login('bbv@x.test');
select pg_temp.check('a viewer cannot save rows', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), pg_temp.rows('revenue', 1), array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.login('bbo@x.test');
select pg_temp.check('an outsider cannot save rows', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), pg_temp.rows('revenue', 1), array['revenue'], '[]'::jsonb, null)$$), 'refused');

select pg_temp.login('bbe@x.test');
select public.budget_rows_save((select v1 from ids), pg_temp.rows('revenue', 3) || pg_temp.rows('customer', 2, 'c'), array['revenue', 'customer'],
  '[{"key":"#410000","cls":"revenue","label":"Revenue","month":"2026-01","amount":1000}]'::jsonb, '{"s":1}'::jsonb);
select pg_temp.check('rows saved for two views', (select string_agg(view || count, ',' order by view) from (select view, count(*) from public.budget_rows where version_id = (select v1 from ids) group by view) t), 'customer2,revenue3');
select pg_temp.check('the row keeps its fields', (select label || '/' || mode || '/' || basis::text || '/' || cost::text || '/' || cardinality(months) || '/' || months[12] from public.budget_rows where version_id = (select v1 from ids) and view = 'revenue' and key = 'k1'), 'Row 1/months/{"x": 1}/{"y": 2}/12/12');
select pg_temp.check('the version setup was set', (select setup::text from public.budget_versions where id = (select v1 from ids)), '{"s": 1}');
select pg_temp.check('the lines were saved', (select count(*) || '/' || sum(amount) from public.budget_lines where version_id = (select v1 from ids)), '1/1000');

select public.budget_rows_save((select v1 from ids), pg_temp.rows('revenue', 1, 'n'), array['revenue'], '[]'::jsonb, null);
select pg_temp.check('saving the revenue view leaves customer rows alone and replaces revenue rows',
  (select string_agg(view || ':' || string_agg_keys, ',' order by view) from (select view, string_agg(key, '+' order by key) as string_agg_keys from public.budget_rows where version_id = (select v1 from ids) group by view) t),
  'customer:c1+c2,revenue:n1');
select pg_temp.check('p_lines replaces all lines', (select count(*) from public.budget_lines where version_id = (select v1 from ids))::text, '0');
select pg_temp.check('a null setup leaves the version setup', (select setup::text from public.budget_versions where id = (select v1 from ids)), '{"s": 1}');
select pg_temp.check('a row of a view not being saved is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), pg_temp.rows('customer', 1), array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('a bad line class is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), '[]'::jsonb, array['revenue'], '[{"key":"#1","cls":"cash","month":"2026-01","amount":1}]'::jsonb, null)$$), 'refused');
select pg_temp.check('a refused save changes nothing', (select count(*) from public.budget_rows where version_id = (select v1 from ids) and view = 'revenue')::text, '1');

select pg_temp.check('a row with 11 months is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  '[{"view":"revenue","key":"a","label":"A","mode":"year","months":[1,2,3,4,5,6,7,8,9,10,11]}]'::jsonb, array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('a non-numeric month is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  '[{"view":"revenue","key":"a","label":"A","mode":"year","months":[1,2,3,4,5,6,7,8,9,10,11,"x"]}]'::jsonb, array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('an enormous month is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  '[{"view":"revenue","key":"a","label":"A","mode":"year","months":[1e15,2,3,4,5,6,7,8,9,10,11,12]}]'::jsonb, array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('a bad mode is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  '[{"view":"revenue","key":"a","label":"A","mode":"week","months":[1,2,3,4,5,6,7,8,9,10,11,12]}]'::jsonb, array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('a bad view is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  '[{"view":"other","key":"a","label":"A","mode":"year","months":[1,2,3,4,5,6,7,8,9,10,11,12]}]'::jsonb, array['other'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('a duplicate key in one view is refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  pg_temp.rows('revenue', 1, 'd') || pg_temp.rows('revenue', 1, 'd'), array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('the same key in two views is fine', pg_temp.fails($$select public.budget_rows_save((select v1 from ids),
  pg_temp.rows('revenue', 1, 'd') || pg_temp.rows('customer', 1, 'd'), array['revenue', 'customer'], '[]'::jsonb, null)$$), 'ran');

-- Size: 20,001 refused, 20,000 saved inside 8 seconds.
create temp table bigrows as select pg_temp.rows('expense', 20000) as j, pg_temp.rows('expense', 20001) as j1;
grant select on bigrows to authenticated;
select pg_temp.check('20,001 rows are refused', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), (select j1 from bigrows), array['expense'], '[]'::jsonb, null)$$), 'refused');
set statement_timeout = '8s';
select public.budget_rows_save((select v1 from ids), (select j from bigrows), array['expense'], '[]'::jsonb, null);
reset statement_timeout;
select pg_temp.check('20,000 rows saved inside 8 seconds', (select count(*) from public.budget_rows where version_id = (select v1 from ids) and view = 'expense')::text, '20000');
select public.budget_rows_save((select v1 from ids), '[]'::jsonb, array['expense'], '[]'::jsonb, null);

-- budget_create with p_from copies setup and rows.
select pg_temp.login('bbe@x.test');
update ids set v2 = public.budget_create(co, '2026', 'revision', 'Revision 1', v1);
select pg_temp.check('the revision copies setup and rows',
  (select (select setup::text from public.budget_versions where id = v2) || '/' || (select count(*) from public.budget_rows where version_id = v2)
     || '/' || (select count(*) from public.budget_rows where version_id = v1) from ids), '{"s": 1}/2/2');
select pg_temp.check('copied rows keep their fields', (select label || '/' || cardinality(months) from public.budget_rows where version_id = (select v2 from ids) and view = 'customer' and key = 'd1'), 'Row 1/12');
select pg_temp.check('copied rows belong to the new version and company', (select count(*) from public.budget_rows where version_id = (select v2 from ids) and company_id = (select co from ids))::text, '2');

-- Approved versions are locked.
select pg_temp.login('bba@x.test');
select public.budget_approve((select v1 from ids));
select pg_temp.check('an approved version refuses rows', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), pg_temp.rows('revenue', 1), array['revenue'], '[]'::jsonb, null)$$), 'refused');
select pg_temp.check('an approved version refuses a setup', pg_temp.fails($$select public.budget_rows_save((select v1 from ids), '[]'::jsonb, array[]::text[], '[]'::jsonb, '{"z":1}'::jsonb)$$), 'refused');

-- No direct writes.
select pg_temp.login('bbe@x.test');
select pg_temp.check('no direct insert on rows', pg_temp.fails($$insert into public.budget_rows (version_id, company_id, view, key, label, mode, months) values ((select v2 from ids), (select co from ids), 'revenue', 'z', 'Z', 'year', array[1,2,3,4,5,6,7,8,9,10,11,12])$$), 'refused');
select pg_temp.check('no direct update on rows', pg_temp.fails($$update public.budget_rows set label = 'x'$$), 'refused');
select pg_temp.check('no direct delete on rows', pg_temp.fails($$delete from public.budget_rows$$), 'refused');
select pg_temp.check('no direct insert on setups', pg_temp.fails($$insert into public.budget_setups (company_id, setup) values ((select co from ids), '{}')$$), 'refused');
select pg_temp.check('no direct update on setups', pg_temp.fails($$update public.budget_setups set setup = '{}'$$), 'refused');
select pg_temp.check('no direct delete on setups', pg_temp.fails($$delete from public.budget_setups$$), 'refused');
reset role;
