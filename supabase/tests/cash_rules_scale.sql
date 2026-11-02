-- Learned categories at the size of a real business (migration 0049): every rule is kept (no 5,000 cap), the
-- suggestion is found on the server through an index, and Settings pages and searches all the rules.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('crs-a@x.test', '{"full_name":"Big Owner"}', now()), ('crs-v@x.test', '{"full_name":"Big Viewer"}', now()), ('crs-o@x.test', '{"full_name":"Outsider"}', now());
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

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('crs-a@x.test'), 'Big Distributor', '{"profile":{"mode":"simple"}}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('crs-a@x.test'), pg_temp.uid('crs-v@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Big Distributor') co;
grant select on ids to authenticated;

select pg_temp.check('the database is at version 49', public.schema_version()::text, '49');

-- 5,999 rules already learned, all older than today; one more entry must keep every one of them.
insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind, uses, last_used)
select (select co from ids), 'in', 'party', 'customer ' || g, 'Wholesale', 'sale', 1, now() - make_interval(days => 1 + g % 900)
  from generate_series(1, 5999) g;
select pg_temp.login('crs-a@x.test');
select public.cash_entry_add((select co from ids), '{"day":"2026-03-01","direction":"in","amount":100,"category":"Pharmacies","party":"Al Ezaby Pharmacy"}'::jsonb);
reset role;
select pg_temp.check('a business with 6,000 learned names keeps every one', (select count(*)::text from public.cash_category_rules where company_id = (select co from ids)), '6000');

-- Descriptions and the oldest customer, then the suggestions.
insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind, uses) values
  ((select co from ids), 'out', 'note', 'electricity', 'Utilities', 'expense', 3),
  ((select co from ids), 'out', 'note', 'electricity bill', 'Power', 'expense', 1),
  ((select co from ids), 'out', 'note', 'tea', 'Staff', 'expense', 9),
  ((select co from ids), 'out', 'party', 'شركه النور', 'Supplies', 'purchase', 2);
select pg_temp.login('crs-v@x.test');
select pg_temp.check('the oldest customer still gets their category', (public.cash_suggest((select co from ids), 'in', '  CUSTOMER   7 ', '') ->> 'category'), 'Wholesale');
select pg_temp.check('a name typed in other Arabic spellings is found', (select r ->> 'category' || '/' || (r ->> 'kind') || '/' || (r ->> 'from') from (select public.cash_suggest((select co from ids), 'out', 'شركة النور', '') r) x), 'Supplies/purchase/party');
select pg_temp.check('the longest description found as whole words wins', (public.cash_suggest((select co from ids), 'out', '', 'March Electricity  Bill paid') ->> 'category'), 'Power');
select pg_temp.check('a shorter one when the longer is not there', (select r ->> 'category' || '/' || (r ->> 'from') from (select public.cash_suggest((select co from ids), 'out', '', 'electricity for the shop') r) x), 'Utilities/note');
select pg_temp.check('never part of a word', coalesce(public.cash_suggest((select co from ids), 'out', '', 'steak dinner')::text, 'none'), 'none');
select pg_temp.check('money in never takes a money-out rule', coalesce(public.cash_suggest((select co from ids), 'in', 'شركة النور', '')::text, 'none'), 'none');
select pg_temp.check('the name comes before the description', (public.cash_suggest((select co from ids), 'out', 'شركة النور', 'tea') ->> 'category'), 'Supplies');
select pg_temp.check('nothing known: nothing suggested', coalesce(public.cash_suggest((select co from ids), 'in', 'Somebody New', 'first visit')::text, 'none'), 'none');

-- Settings: every rule, paged and searched, with the total.
select pg_temp.check('the page says how many there are and shows 50', (select (p ->> 'total') || ' ' || jsonb_array_length(p -> 'rules') from (select public.cash_rules_page((select co from ids), '', 0, 50) p) x), '6004 50');
select pg_temp.check('most recently used first', (select ((p -> 'rules' -> 0 ->> 'lastUsed')::timestamptz >= (p -> 'rules' -> 49 ->> 'lastUsed')::timestamptz
  and (p -> 'rules' -> 49 ->> 'lastUsed')::timestamptz >= (q -> 'rules' -> 0 ->> 'lastUsed')::timestamptz)::text
  from (select public.cash_rules_page((select co from ids), '', 0, 50) p, public.cash_rules_page((select co from ids), '', 50, 1) q) x), 'true');
select pg_temp.check('a far page is reachable', (select jsonb_array_length(p -> 'rules')::text from (select public.cash_rules_page((select co from ids), '', 6000, 50) p) x), '4');
select pg_temp.check('a page is at most 100 rules', (select jsonb_array_length(p -> 'rules')::text from (select public.cash_rules_page((select co from ids), '', 0, 5000) p) x), '100');
select pg_temp.check('search by name finds an old one', (select (p ->> 'total') || ' ' || (p -> 'rules' -> 0 ->> 'match') from (select public.cash_rules_page((select co from ids), 'customer 4321', 0, 50) p) x), '1 customer 4321');
select pg_temp.check('search in Arabic, spelled either way', (select (p ->> 'total') || ' ' || (p -> 'rules' -> 0 ->> 'category') from (select public.cash_rules_page((select co from ids), 'شركة', 0, 50) p) x), '1 Supplies');
select pg_temp.check('search by category', (select p ->> 'total' from (select public.cash_rules_page((select co from ids), 'utilities', 0, 50) p) x), '1');
select pg_temp.check('a rule carries what Settings needs', (select string_agg(k, ',' order by k) from (select jsonb_object_keys(public.cash_rules_page((select co from ids), 'tea', 0, 1) -> 'rules' -> 0) k) x), 'category,direction,id,kind,lastUsed,match,matchOn,uses');

-- Outsiders and visitors get nothing.
select pg_temp.login('crs-o@x.test');
select pg_temp.check('an outsider cannot ask for a suggestion', pg_temp.err($$select public.cash_suggest((select co from ids), 'in', 'customer 7', '')$$), '42501');
select pg_temp.check('an outsider cannot list the rules', pg_temp.err($$select public.cash_rules_page((select co from ids), '', 0, 50)$$), '42501');
reset role;
select pg_temp.check('signed-out visitors cannot ask for suggestions', has_function_privilege('anon', 'public.cash_suggest(uuid, text, text, text)', 'execute')::text, 'false');
select pg_temp.check('signed-out visitors cannot list rules', has_function_privilege('anon', 'public.cash_rules_page(uuid, text, integer, integer)', 'execute')::text, 'false');

-- Speed at the size of a large business: 50,000 rules; a suggestion stays well under 50 ms.
insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind)
select (select co from ids), 'out', 'note', 'service ' || g || ' contract', 'Services', 'expense' from generate_series(1, 44000) g;
analyze public.cash_category_rules;
select pg_temp.check('the description index is there', (select count(*)::text from pg_indexes where tablename = 'cash_category_rules' and indexdef like '%first_word%'), '1');
select pg_temp.login('crs-a@x.test');
create temp table t0 (t timestamptz);
grant all on t0 to authenticated;
insert into t0 values (clock_timestamp());
select count(public.cash_suggest((select co from ids), 'out', 'Nobody ' || g, 'payment for service ' || g || ' contract this month')) from generate_series(1, 40) g;
select pg_temp.check('forty suggestions over 50,000 rules take under two seconds', (extract(epoch from clock_timestamp() - (select t from t0)) < 2)::text, 'true');
select pg_temp.check('and they find the right rule', (public.cash_suggest((select co from ids), 'out', '', 'payment for service 31337 contract') ->> 'match'), 'service 31337 contract');
reset role;

delete from public.companies where id = (select co from ids);
select pg_temp.check('a deleted company leaves no rules', (select count(*)::text from public.cash_category_rules where company_id = (select co from ids)), '0');
