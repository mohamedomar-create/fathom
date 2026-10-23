-- Simple mode (migration 0036): sales lines keep channel, paid and payment day; expense lines keep paid and payment day;
-- one call reads a company's file lines for the Simple pages; editors edit or delete one file line, never a ledger line.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('sma@x.test', '{"full_name":"Sama"}', now()), ('smv@x.test', '{"full_name":"Samir"}', now()), ('smo@x.test', '{"full_name":"Soha"}', now());
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

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('sma@x.test'), 'Simple Co', '{"profile":{"mode":"simple"}}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('sma@x.test'), pg_temp.uid('smv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Simple Co') co;
grant select on ids to authenticated;
create temp table st (k text primary key, id uuid);
grant all on st to authenticated;

select pg_temp.login('sma@x.test');
insert into st values ('s', public.stage_lines_begin((select co from ids), 'sales', 'file', array['2026-01'], 'sales.xlsx', '{}'::jsonb, false));
select public.stage_lines_add((select id from st where k = 's'), '[
  {"day":"2026-01-05","period":"2026-01","doc":"","series":"","customer":"Nile","product":"Kit","category":"","salesperson":"","qty":null,"amount":1000,"cost":600,"channel":"Online","paid":true,"paidOn":"2026-01-20"},
  {"day":"2026-01-06","period":"2026-01","doc":"","series":"","customer":"Delta","product":"Kit","category":"","salesperson":"","qty":null,"amount":500,"cost":null,"channel":"Shop","paid":false,"paidOn":null}]'::jsonb);
select public.stage_lines_finish((select id from st where k = 's'));
insert into st values ('e', public.stage_lines_begin((select co from ids), 'expenses', 'file', array['2026-01'], 'exp.xlsx', '{}'::jsonb, false));
select public.stage_lines_add((select id from st where k = 'e'), '[{"day":"2026-01-03","period":"2026-01","doc":"","series":"","supplier":"","account":"Rent","cls":"exp_fixed","category":"Rent","label":"","amount":800,"paid":false,"paidOn":null}]'::jsonb);
select public.stage_lines_finish((select id from st where k = 'e'));

select pg_temp.check('sales lines keep channel, paid and payment day',
  (select string_agg(customer || ':' || channel || ':' || coalesce(paid::text, '-') || ':' || coalesce(paid_on::text, '-'), ',' order by amount desc) from public.sales_lines where company_id = (select co from ids)),
  'Nile:Online:true:2026-01-20,Delta:Shop:false:-');
select pg_temp.check('expense lines keep paid', (select paid::text from public.expense_lines where company_id = (select co from ids)), 'false');

create temp table j (v jsonb);
grant all on j to authenticated;
insert into j select public.simple_lines((select co from ids));
select pg_temp.check('one call reads both sheets with ids', (select jsonb_array_length(v -> 'sales') || ' ' || jsonb_array_length(v -> 'expenses') || ' ' || ((v #> '{sales,0}') ? 'id')::text from j), '2 1 true');
select pg_temp.check('the lines carry what the Simple pages need', (select (v #>> '{expenses,0,cls}') || ' ' || (v #>> '{expenses,0,category}') from j), 'exp_fixed Rent');

create temp table pr (v text);
grant all on pr to authenticated;
insert into pr select public.line_months((select co from ids), 'sales', 'file') #>> '{2026-01,print}';
-- Editing one line
select public.update_line('sales', (select id from public.sales_lines where customer = 'Delta'), '{"day":"2026-01-06","customer":"Delta","product":"Kit","amount":550,"channel":"Shop","paid":true,"paidOn":"2026-01-30"}'::jsonb);
select pg_temp.check('an editor edits a line', (select amount || ' ' || paid::text || ' ' || paid_on::text from public.sales_lines where customer = 'Delta'), '550.00 true 2026-01-30');
select pg_temp.check('a sale marked paid changes its month''s fingerprint', ((public.line_months((select co from ids), 'sales', 'file') #>> '{2026-01,print}') <> (select v from pr))::text, 'true');
select pg_temp.check('a line cannot move out of its month', pg_temp.err($$select public.update_line('sales', (select id from public.sales_lines where customer = 'Delta'), '{"day":"2026-03-01","amount":1}'::jsonb)$$), '22023');
select public.delete_line('expenses', (select id from public.expense_lines where category = 'Rent'));
select pg_temp.check('an editor deletes a line', (select count(*)::text from public.expense_lines where company_id = (select co from ids)), '0');
select pg_temp.check('a line can be added to an existing month', public.add_line((select co from ids), 'sales', '{"day":"2026-01-25","customer":"Giza","product":"Kit","amount":200}'::jsonb)::text ~ '^\d+$'::text || '', 'true');

-- Ledger lines are the General Ledger's: never edited one by one
reset role;
insert into public.sales_batches (company_id, source, filename, periods) values ((select co from ids), 'ledger', 'GL', array['2026-01']);
insert into public.sales_lines (company_id, batch_id, source, period, amount) values ((select co from ids), (select id from public.sales_batches where filename = 'GL'), 'ledger', '2026-01', 9);
select pg_temp.login('sma@x.test');
select pg_temp.check('a ledger line cannot be edited', pg_temp.err($$select public.update_line('sales', (select id from public.sales_lines where source = 'ledger'), '{"amount":1}'::jsonb)$$), '42501');

select pg_temp.login('smv@x.test');
select pg_temp.check('a viewer can read the lines', (select jsonb_array_length(public.simple_lines((select co from ids)) -> 'sales')::text), '4');
select pg_temp.check('a viewer cannot edit', pg_temp.err($$select public.delete_line('sales', (select id from public.sales_lines where customer = 'Nile'))$$), '42501');
select pg_temp.login('smo@x.test');
select pg_temp.check('an outsider reads nothing', pg_temp.err($$select public.simple_lines((select co from ids))$$), '42501');
reset role;
