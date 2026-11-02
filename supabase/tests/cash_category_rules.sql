-- Learned categories (migration 0048): saving an entry with a category remembers it for its customer/supplier and its
-- description; the person's latest choice wins. Members read; nobody writes the rules directly; editors delete one.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ccr-a@x.test', '{"full_name":"Shop Owner"}', now()), ('ccr-v@x.test', '{"full_name":"Shop Viewer"}', now()), ('ccr-o@x.test', '{"full_name":"Other Shop"}', now());
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
begin execute q; return ''; exception when others then return sqlstate; end $f$;

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('ccr-a@x.test'), 'Rules Shop', '{"profile":{"mode":"simple"}}');
insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('ccr-o@x.test'), 'Other Shop', '{"profile":{"mode":"simple"}}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('ccr-a@x.test'), pg_temp.uid('ccr-v@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Rules Shop') co, (select id from public.companies where name = 'Other Shop') other;
grant select on ids to authenticated;
create temp table e (n text primary key, id bigint);
grant all on e to authenticated;

select pg_temp.check('the database is at version 48 or later', (public.schema_version() >= 48)::text, 'true');

-- Names are tidied exactly as the app's matchKey does (tests/unit/cash-categorise.test.ts holds the same samples).
select pg_temp.check('Arabic is spelled one way, as the app spells it',
  private.cash_match('شركة النور') || '|' || private.cash_match('مؤسسة') || '|' || private.cash_match('الأصول الثابتـة') || '|' || private.cash_match('شيئ إى آک ی') || '|' || private.cash_match('  NILE   Cafe '),
  'شركه النور|موسسه|الاصول الثابته|شيي اي اك ي|nile cafe');

select pg_temp.login('ccr-a@x.test');
select pg_temp.check('no direct writes to the rules', pg_temp.err($$insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind) values ((select co from ids), 'in', 'party', 'x', 'y', 'sale')$$), '42501');

insert into e select 'nile', public.cash_entry_add((select co from ids), '{"day":"2026-03-01","direction":"in","amount":100,"category":"Drinks","party":"Nile Cafe","kind":"sale"}'::jsonb);
select pg_temp.check('saving an entry learns its customer', (select string_agg(direction || ':' || match_on || ':' || match || '=' || category || '/' || kind || ' x' || uses, ',') from public.cash_category_rules where company_id = (select co from ids)), 'in:party:nile cafe=Drinks/sale x1');

select public.cash_entry_add((select co from ids), '{"day":"2026-03-02","direction":"out","amount":300,"category":"Utilities","note":"Electricity  bill"}'::jsonb);
select pg_temp.check('and its description', (select match || '=' || category || '/' || kind from public.cash_category_rules where company_id = (select co from ids) and match_on = 'note'), 'electricity bill=Utilities/expense');

select public.cash_entry_add((select co from ids), '{"day":"2026-03-03","direction":"in","amount":50,"party":"Walk-in"}'::jsonb);
select pg_temp.check('an entry with no category teaches nothing', (select count(*)::text from public.cash_category_rules where company_id = (select co from ids) and match = 'walk-in'), '0');

select public.cash_entry_add((select co from ids), '{"day":"2026-03-04","direction":"in","amount":70,"category":"Snacks","party":"  NILE   cafe "}'::jsonb);
select pg_temp.check('the same customer, typed differently, is one rule: the latest choice wins and uses count', (select category || ' x' || uses from public.cash_category_rules where company_id = (select co from ids) and match_on = 'party' and direction = 'in'), 'Snacks x2');

select public.cash_entry_add((select co from ids), '{"day":"2026-03-05","direction":"out","amount":20,"category":"Refunds","party":"Nile Cafe"}'::jsonb);
select pg_temp.check('money out from the same name is its own rule', (select count(*)::text from public.cash_category_rules where company_id = (select co from ids) and match = 'nile cafe'), '2');

select public.cash_entry_update((select id from e where n = 'nile'), '{"day":"2026-03-01","direction":"in","amount":100,"category":"Coffee","party":"Nile Cafe"}'::jsonb);
select pg_temp.check('changing an entry''s category is remembered', (select category || ' x' || uses from public.cash_category_rules where company_id = (select co from ids) and match_on = 'party' and direction = 'in'), 'Coffee x3');

select pg_temp.check('an editor can update a rule only through an entry', pg_temp.err($$update public.cash_category_rules set category = 'x'$$), '42501');

-- The viewer reads, never deletes; an outsider sees nothing and deletes nothing.
select pg_temp.login('ccr-v@x.test');
select pg_temp.check('a viewer reads the rules', (select count(*)::text from public.cash_category_rules), '3');
select pg_temp.check('a viewer cannot delete a rule', pg_temp.err(format('select public.cash_rule_delete(%s)', (select min(id) from public.cash_category_rules))), '42501');
select pg_temp.login('ccr-o@x.test');
select public.cash_entry_add((select other from ids), '{"day":"2026-03-01","direction":"in","amount":5,"category":"Bread","party":"Baker"}'::jsonb);
select pg_temp.check('another company sees only its own rules', (select string_agg(match, ',') from public.cash_category_rules), 'baker');
reset role;
create temp table r1 as select min(id) id from public.cash_category_rules where company_id = (select co from ids);
grant select on r1 to authenticated;
select pg_temp.login('ccr-o@x.test');
select pg_temp.check('an outsider cannot delete another company''s rule', pg_temp.err('select public.cash_rule_delete((select id from r1))'), '42501');

select pg_temp.login('ccr-a@x.test');
select public.cash_rule_delete((select id from r1));
select pg_temp.check('an editor deletes a rule', (select count(*)::text from public.cash_category_rules where company_id = (select co from ids)), '2');
select pg_temp.check('a company''s rules don''t reach another', (select count(*)::text from public.cash_category_rules where company_id = (select other from ids)), '0');

reset role;
select pg_temp.check('the rules have the tenant guard', (select count(*)::text from pg_trigger where tgrelid = 'public.cash_category_rules'::regclass and tgname = 'tenant_guard'), '1');
select pg_temp.check('signed-out visitors cannot delete rules', has_function_privilege('anon', 'public.cash_rule_delete(bigint)', 'execute')::text, 'false');
select pg_temp.check('signed-out visitors cannot read rules', has_table_privilege('anon', 'public.cash_category_rules', 'select')::text, 'false');

-- Deleting a company takes its rules with it (and leaves nothing for the other cash book tests).
delete from public.companies where id in ((select co from ids), (select other from ids));
select pg_temp.check('a deleted company leaves no rules or entries', (select count(*) from public.cash_category_rules)::text || (select count(*) from public.cash_entries where company_id in ((select co from ids), (select other from ids)))::text, '00');
