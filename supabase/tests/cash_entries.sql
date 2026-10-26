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
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'amr', json_build_array(json_build_object('method','password','timestamp', extract(epoch from now())::int)))::text, false);
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
select pg_temp.check('the replaced upload''s count follows what is left of it', (select rows::text from public.cash_uploads where id = (select id from st where k = 'u1')), '2');
select pg_temp.check('replaced entries are recorded in the history', (select string_agg(old ->> 'amount', ',' order by (old ->> 'amount')::numeric) from public.cash_entry_history where company_id = (select co from ids) and action = 'replaced'), '60,800');

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
select pg_temp.check('switching to Full copies sales and costs', (select (r ->> 'sales') || ' ' || (r ->> 'expenses') from (select public.cash_to_full((select co from ids)) r) x), '2 1');
select pg_temp.check('a second switch refreshes the copied months, never doubles them', (select (r ->> 'sales') || ' ' || (r ->> 'expenses') from (select public.cash_to_full((select co from ids)) r) x)
  || ' ' || (select count(*) from public.sales_lines where company_id = (select co from ids)), '2 1 2');
select pg_temp.check('the copied lines', (select string_agg(period || ':' || amount, ',' order by period, amount) from public.sales_lines where company_id = (select co from ids)), '2026-01:1000.00,2026-02:900.00');
select pg_temp.check('the cash book is kept', (select count(*) from public.cash_entries where company_id = (select co from ids))::text, '3');
select pg_temp.check('copying back is skipped while the cash book has entries', public.cash_from_full((select co from ids))::text, '0');

-- Undo one upload; clear needs an admin; deleting the company removes everything.
select pg_temp.check('an upload can be taken back', public.cash_upload_remove((select id from st where k = 'u2'))::text, '1');
select pg_temp.check('a taken-back upload is recorded in the history', (select string_agg(old ->> 'amount', ',') from public.cash_entry_history where company_id = (select co from ids) and action = 'upload_removed'), '900');
select pg_temp.check('clearing everything', public.cash_entries_clear((select co from ids))::text, '2');
select pg_temp.check('switching back fills an empty cash book from the lines', public.cash_from_full((select co from ids))::text, '3');

-- An expenses file replacing January takes only January's money out; its money in stays.
insert into st values ('u3', public.cash_upload_begin((select co from ids), 'exp.xlsx', array['2026-01'], 'replace_months', 0, array['out']));
select public.cash_upload_add((select id from st where k = 'u3'), '[{"day":"2026-01-09","direction":"out","amount":350,"category":"Rent"}]'::jsonb);
select pg_temp.check('a money-out file replaces only money out', (public.cash_upload_finish((select id from st where k = 'u3')) ->> 'removed'), '1');
select pg_temp.check('January''s money in is kept', (select string_agg(direction || ':' || amount, ',' order by direction, amount) from public.cash_entries where company_id = (select co from ids) and day < '2026-02-01'), 'in:1000.00,out:350');
select pg_temp.check('directions are only in and out', pg_temp.err($$select public.cash_upload_begin((select co from ids), 'x', array['2026-01'], 'add', 0, array['sideways'])$$), '22023');

-- Two uploads open at once (a double press): finishing one never deletes the other's rows.
insert into st values ('u4', public.cash_upload_begin((select co from ids), 'a.xlsx', array['2026-01'], 'add', 0, array['in']));
select public.cash_upload_add((select id from st where k = 'u4'), '[{"day":"2026-01-20","direction":"in","amount":5}]'::jsonb);
insert into st values ('u5', public.cash_upload_begin((select co from ids), 'b.xlsx', array['2026-01'], 'replace_months', 0, array['in']));
select public.cash_upload_add((select id from st where k = 'u5'), '[{"day":"2026-01-21","direction":"in","amount":7}]'::jsonb);
select pg_temp.check('finishing one upload leaves the other open upload alone', (public.cash_upload_finish((select id from st where k = 'u5')) ->> 'removed'), '1');
select pg_temp.check('the other upload still finishes with its rows', (public.cash_upload_finish((select id from st where k = 'u4')) ->> 'rows'), '1');
select pg_temp.check('January money in is both uploads', (select string_agg(amount::text, ',' order by amount) from public.cash_entries where company_id = (select co from ids) and day < '2026-02-01' and direction = 'in'), '5,7');

-- ---------------------------------------------------------------- kinds, history and the switch by kind (panel H08, H09, H10, M28)
reset role;
insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('cba@x.test'), 'Kinds Co', '{"profile":{"mode":"simple"}}');
create temp table k as select (select id from public.companies where name = 'Kinds Co') co;
grant select on k to authenticated;
create temp table ke (n text primary key, id bigint);
grant all on ke to authenticated;
select pg_temp.login('cba@x.test');
insert into ke select 'sale', public.cash_entry_add((select co from k), '{"day":"2026-03-02","direction":"in","amount":1000,"category":"Sales","kind":"sale"}'::jsonb);
insert into ke select 'capital', public.cash_entry_add((select co from k), '{"day":"2026-03-01","direction":"in","amount":20000,"category":"Owner capital","kind":"capital"}'::jsonb);
insert into ke select 'rent', public.cash_entry_add((select co from k), '{"day":"2026-03-03","direction":"out","amount":300,"category":"Rent"}'::jsonb);
insert into ke select 'stock', public.cash_entry_add((select co from k), '{"day":"2026-03-04","direction":"out","amount":700,"category":"Goods","kind":"purchase"}'::jsonb);
insert into ke select 'fridge', public.cash_entry_add((select co from k), '{"day":"2026-03-05","direction":"out","amount":5000,"category":"Fridge","kind":"asset"}'::jsonb);
select pg_temp.check('an entry without a kind is a sale or an expense', (select string_agg(e ->> 'kind', ',' order by (e ->> 'day')) from jsonb_array_elements(public.cash_entries_list((select co from k))) e), 'capital,sale,expense,purchase,asset');
select pg_temp.check('a kind must fit the direction', pg_temp.err($$select public.cash_entry_add((select co from k), '{"day":"2026-03-06","direction":"in","amount":5,"kind":"drawings"}'::jsonb)$$), '22023');

-- An edit is kept in the history and the entry marked; a delete is soft and recorded.
select public.cash_entry_update((select id from ke where n = 'rent'), '{"day":"2026-03-03","direction":"out","amount":30,"category":"Rent"}'::jsonb);
select pg_temp.check('the old amount is in the history', (select (old ->> 'amount') || ' ' || action || ' ' || (actor is not null)::text from public.cash_entry_history where entry_id = (select id from ke where n = 'rent')), '300 update true');
select pg_temp.check('the entry shows as edited', (select (e ->> 'edited') from jsonb_array_elements(public.cash_entries_list((select co from k))) e where (e ->> 'id')::bigint = (select id from ke where n = 'rent')), 'true');
select public.cash_entry_delete((select id from ke where n = 'rent'));
select pg_temp.check('a deleted entry leaves the list', (select count(*) from jsonb_array_elements(public.cash_entries_list((select co from k))) e where (e ->> 'id')::bigint = (select id from ke where n = 'rent'))::text, '0');
select pg_temp.check('members no longer read a deleted entry', (select count(*)::text from public.cash_entries where id = (select id from ke where n = 'rent')), '0');
reset role;
select pg_temp.check('but it is kept and recorded', (select (deleted_at is not null)::text from public.cash_entries where id = (select id from ke where n = 'rent'))
  || ' ' || (select string_agg(action, ',' order by id) from public.cash_entry_history where entry_id = (select id from ke where n = 'rent')), 'true update,delete');
select pg_temp.login('cba@x.test');
select pg_temp.check('the history cannot be written directly', pg_temp.err($$delete from public.cash_entry_history$$), '42501');
select pg_temp.check('a deleted entry cannot be edited', pg_temp.err(format($$select public.cash_entry_update(%s, '{"day":"2026-03-03","direction":"out","amount":1}'::jsonb)$$, (select id from ke where n = 'rent'))), '42501');

-- Switching copies trading only: the sale, and the stock purchase as cost of sales. Capital and the fridge are listed.
select pg_temp.check('the preview names what goes and what is held back',
  (select (p -> 'sales' ->> 'copy') || ' ' || (p -> 'expenses' ->> 'copy') || ' ' || (select string_agg((h ->> 'kind') || ':' || (h ->> 'amount'), ',') from jsonb_array_elements(p -> 'held') h)
     from (select public.cash_to_full_preview((select co from k)) p) x), '["2026-03"] ["2026-03"] asset:5000,capital:20000');
select pg_temp.check('only trading is copied', (select (r ->> 'sales') || ' ' || (r ->> 'expenses') from (select public.cash_to_full((select co from k)) r) x), '1 1');
select pg_temp.check('owner capital is never revenue', (select string_agg(amount::text, ',') from public.sales_lines where company_id = (select co from k)), '1000.00');
select pg_temp.check('a stock purchase is cost of sales, the fridge is not a cost', (select string_agg(amount || ':' || coalesce(cls, '-'), ',') from public.expense_lines where company_id = (select co from k)), '700.00:cos_variable');
-- A correction reaches the copied month on the next switch.
select public.cash_entry_update((select id from ke where n = 'sale'), '{"day":"2026-03-02","direction":"in","amount":1200,"category":"Sales"}'::jsonb);
select public.cash_to_full((select co from k));
select pg_temp.check('the correction carried over', (select string_agg(amount::text, ',') from public.sales_lines where company_id = (select co from k)), '1200.00');
-- A month that holds another file's lines is skipped and named.
reset role;
insert into public.sales_batches (company_id, source, filename, periods) values ((select co from k), 'file', 'april.xlsx', '{2026-04}');
insert into public.sales_lines (company_id, batch_id, source, period, amount) select (select co from k), id, 'file', '2026-04', 50 from public.sales_batches where filename = 'april.xlsx';
select pg_temp.login('cba@x.test');
select public.cash_entry_add((select co from k), '{"day":"2026-04-02","direction":"in","amount":80,"category":"Sales"}'::jsonb);
select pg_temp.check('a month with another file is skipped and named', (select (r -> 'skipped' ->> 'sales') from (select public.cash_to_full((select co from k)) r) x), '["2026-04"]');
select pg_temp.check('its lines are left as they were', (select string_agg(period || ':' || amount, ',' order by period) from public.sales_lines where company_id = (select co from k)), '2026-03:1200.00,2026-04:50.00');
-- A month emptied in the cash book loses its copied lines on the next switch; the other file's month is untouched.
select public.cash_entry_delete((select id from ke where n = 'sale'));
select public.cash_to_full((select co from k));
select pg_temp.check('an emptied month is not left with stale copies', (select string_agg(period || ':' || amount, ',' order by period) from public.sales_lines where company_id = (select co from k)), '2026-04:50.00');
select pg_temp.check('no copied batch keeps an old month', (select count(*)::text from public.sales_batches where company_id = (select co from k) and report ->> 'from' = 'cash_book'), '0');
-- Only the cash book's own copies are replaced: a file the person happened to name like it is theirs.
reset role;
insert into public.sales_batches (company_id, source, filename, periods) values ((select co from k), 'file', 'From the cash book', '{2026-05}');
insert into public.sales_lines (company_id, batch_id, source, period, amount) select (select co from k), id, 'file', '2026-05', 70 from public.sales_batches where company_id = (select co from k) and filename = 'From the cash book';
select pg_temp.login('cba@x.test');
select public.cash_entry_add((select co from k), '{"day":"2026-05-02","direction":"in","amount":90,"category":"Sales"}'::jsonb);
select pg_temp.check('a file named like the copies is the person''s own', (select (r -> 'skipped' ->> 'sales') from (select public.cash_to_full((select co from k)) r) x)
  || ' ' || (select string_agg(period || ':' || amount, ',' order by period) from public.sales_lines where company_id = (select co from k)), '["2026-04", "2026-05"] 2026-04:50.00,2026-05:70.00');
select pg_temp.check('two switches at once take turns', (select (prosrc like '%pg_advisory_xact_lock%')::text from pg_proc where oid = 'public.cash_to_full(uuid)'::regprocedure), 'true');
-- Clearing is recorded.
select public.cash_entries_clear((select co from k));
select pg_temp.check('a clear is recorded with its count', (select action || ':' || (old ->> 'entries') from public.cash_entry_history where company_id = (select co from k) and action = 'clear'), 'clear:7');
reset role;
delete from public.companies where id = (select co from ids);
select pg_temp.check('a deleted company leaves no entries', (select count(*) from public.cash_entries)::text || (select count(*) from public.cash_uploads)::text, '00');
select pg_temp.check('visitors cannot run the cash book', (select bool_or(has_function_privilege('anon', p.oid, 'execute'))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'cash\_%'), 'false');
