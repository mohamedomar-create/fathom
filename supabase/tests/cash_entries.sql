-- The cash book (migration 0037): its own entries and uploads, members read, editors write through the functions only,
-- an upload shows only once finished, "replace these months" touches only those months, switching copies both ways.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('cba@x.test', '{"full_name":"Kiosk Owner"}', now()), ('cbv@x.test', '{"full_name":"Kiosk Viewer"}', now()), ('cbo@x.test', '{"full_name":"Outsider"}', now());
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

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('cba@x.test'), 'Kiosk Co', '{"profile":{"mode":"simple"}}');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('cba@x.test'), pg_temp.uid('cbv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Kiosk Co') co;
grant select on ids to authenticated;
create temp table st (k text primary key, id uuid);
grant all on st to authenticated;

select pg_temp.login('cba@x.test');
select pg_temp.check('no direct writes to the table', pg_temp.err($$insert into public.cash_entries (company_id, day, direction, amount) values ((select co from ids), '2026-01-01', 'in', 1)$$), '42501');

insert into st values ('u1', public.cash_upload_begin((select co from ids), 'book.xlsx', array['2026-01', '2026-02'], 'add', 2));
select public.cash_upload_add((select id from st where k = 'u1'), '[
  {"day":"2026-01-05","direction":"in","amount":1000,"category":"Sales","party":"","paid":true},
  {"day":"2026-01-07","direction":"out","amount":300,"category":"Rent"},
  {"day":"2026-02-03","direction":"in","amount":800,"category":"Sales","paid":false}]'::jsonb);
select pg_temp.check('an open upload is not shown yet', (select jsonb_array_length(public.cash_entries_list((select co from ids))))::text, '0');
select pg_temp.check('finish makes it live', (public.cash_upload_finish((select id from st where k = 'u1')) ->> 'rows'), '3');
select pg_temp.check('the list reads every entry', (select string_agg((e ->> 'direction') || ':' || (e ->> 'amount'), ',') from jsonb_array_elements(public.cash_entries_list((select co from ids))) e), 'in:1000,out:300,in:800');
select pg_temp.check('the upload keeps its counts', (select rows || ' ' || skipped from public.cash_uploads where id = (select id from st where k = 'u1')), '3 2');
select pg_temp.check('a bad entry is refused, naming why', pg_temp.err($$select public.cash_entry_add((select co from ids), '{"day":"2026-03-01","direction":"sideways","amount":5}'::jsonb)$$), '22023');

-- One entry by hand, changed, then removed.
create temp table e1 (id bigint);
grant all on e1 to authenticated;
insert into e1 select public.cash_entry_add((select co from ids), '{"day":"2026-02-10","direction":"out","amount":50,"category":"Tea","note":"for staff"}'::jsonb);
select public.cash_entry_update((select id from e1), '{"day":"2026-02-11","direction":"out","amount":60,"category":"Tea"}'::jsonb);
select pg_temp.check('an editor changes an entry', (select day || ' ' || amount || ' ' || source from public.cash_entries where id = (select id from e1)), '2026-02-11 60 app');

-- Replace February only: January stays, February's old entries go (the hand-added one too).
insert into st values ('u2', public.cash_upload_begin((select co from ids), 'feb.xlsx', array['2026-02'], 'replace_months', 0));
select public.cash_upload_add((select id from st where k = 'u2'), '[{"day":"2026-02-15","direction":"in","amount":900,"category":"Sales"}]'::jsonb);
select pg_temp.check('replacing a month says how many went', (public.cash_upload_finish((select id from st where k = 'u2')) ->> 'removed'), '2');
select pg_temp.check('only that month was replaced', (select string_agg(to_char(day, 'YYYY-MM') || ':' || amount, ',' order by day) from public.cash_entries where company_id = (select co from ids)), '2026-01:1000,2026-01:300,2026-02:900');

-- The viewer reads, never writes; an outsider sees nothing.
select pg_temp.login('cbv@x.test');
select pg_temp.check('a viewer reads the entries', (select jsonb_array_length(public.cash_entries_list((select co from ids))))::text, '3');
select pg_temp.check('a viewer cannot add', pg_temp.err($$select public.cash_entry_add((select co from ids), '{"day":"2026-03-01","direction":"in","amount":5}'::jsonb)$$), '42501');
select pg_temp.check('a viewer cannot upload', pg_temp.err($$select public.cash_upload_begin((select co from ids), 'x', array['2026-03'], 'add', 0)$$), '42501');
select pg_temp.login('cbo@x.test');
select pg_temp.check('an outsider cannot read', pg_temp.err($$select public.cash_entries_list((select co from ids))$$), '42501');
select pg_temp.check('an outsider sees no rows', (select count(*) from public.cash_entries)::text, '0');

-- Switching to the full system copies the entries into sales and expense lines; the cash book stays.
select pg_temp.login('cba@x.test');
select pg_temp.check('switching to Full copies both kinds', (public.cash_to_full((select co from ids)))::text, '{"sales": 2, "expenses": 1}');
select pg_temp.check('a second switch adds nothing', (public.cash_to_full((select co from ids)))::text, '{"sales": 0, "expenses": 0}');
select pg_temp.check('the copied lines', (select string_agg(period || ':' || amount, ',' order by period, amount) from public.sales_lines where company_id = (select co from ids)), '2026-01:1000.00,2026-02:900.00');
select pg_temp.check('the cash book is kept', (select count(*) from public.cash_entries where company_id = (select co from ids))::text, '3');
select pg_temp.check('copying back is skipped while the cash book has entries', public.cash_from_full((select co from ids))::text, '0');

-- Undo one upload; clear needs an admin; deleting the company removes everything.
select pg_temp.check('an upload can be taken back', public.cash_upload_remove((select id from st where k = 'u2'))::text, '1');
select pg_temp.check('clearing everything', public.cash_entries_clear((select co from ids))::text, '2');
select pg_temp.check('switching back fills an empty cash book from the lines', public.cash_from_full((select co from ids))::text, '3');
reset role;
delete from public.companies where id = (select co from ids);
select pg_temp.check('a deleted company leaves no entries', (select count(*) from public.cash_entries)::text || (select count(*) from public.cash_uploads)::text, '00');
select pg_temp.check('visitors cannot run the cash book', (select bool_or(has_function_privilege('anon', p.oid, 'execute'))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'cash\_%'), 'false');
