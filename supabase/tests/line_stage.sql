-- Staged line saves (migration 0035): lines sent in chunks are held apart until the save finishes, then the months they
-- cover are replaced in one step. Nothing is half-saved, a resent chunk is not doubled, and only the editor who opened the
-- save can add to it or finish it. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('lsa@x.test', '{"full_name":"Lia"}', now()), ('lsb@x.test', '{"full_name":"Lou"}', now()),
  ('lsv@x.test', '{"full_name":"Vic"}', now()), ('lso@x.test', '{"full_name":"Oz"}', now());

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
create function pg_temp.fails(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  return 'ran';
exception when others then return 'refused';
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('lsa@x.test'), 'Stage Co');
insert into public.memberships (org_id, user_id, role) values
  (pg_temp.home('lsa@x.test'), pg_temp.uid('lsb@x.test'), 'editor'),
  (pg_temp.home('lsa@x.test'), pg_temp.uid('lsv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Stage Co') as co;
grant select on ids to authenticated;
create temp table st (k text primary key, id uuid);
grant select, insert, update on st to authenticated;

create function pg_temp.sales(co uuid) returns text language sql as $f$
  select coalesce(string_agg(period || '=' || total, ' ' order by period), '') from (
    select period, sum(amount)::int as total from public.sales_lines where company_id = co group by period) x $f$;
create function pg_temp.line(p text, amt int) returns jsonb language sql as $f$
  select jsonb_build_object('day', p || '-15', 'period', p, 'doc', 'INV/' || p, 'series', 'INV', 'customer', 'Nile', 'product', 'Kit',
    'category', '', 'salesperson', '', 'qty', 1, 'amount', amt, 'cost', null) $f$;

-- What is live before: January 100 and February 200 from the ledger.
select pg_temp.login('lsa@x.test');
select public.add_sales_lines(public.begin_sales_batch((select co from ids), 'ledger', array['2026-01','2026-02'], 'gl.xlsx', '{}'::jsonb),
  jsonb_build_array(pg_temp.line('2026-01', 100), pg_temp.line('2026-02', 200)));
select pg_temp.check('live before', pg_temp.sales((select co from ids)), '2026-01=100 2026-02=200');

insert into st values ('s1', public.stage_lines_begin((select co from ids), 'sales', 'ledger', array['2026-02','2026-03'], 'gl2.xlsx', '{}'::jsonb, false));
select pg_temp.check('add a chunk', public.stage_lines_add((select id from st where k = 's1'),
  jsonb_build_array(pg_temp.line('2026-02', 250), pg_temp.line('2026-03', 300)))::text, '2');
select pg_temp.check('the same chunk sent again adds nothing', public.stage_lines_add((select id from st where k = 's1'),
  jsonb_build_array(pg_temp.line('2026-02', 250), pg_temp.line('2026-03', 300)))::text, '0');
select pg_temp.check('a line outside the months is refused', pg_temp.fails($$select public.stage_lines_add((select id from st where k = 's1'), jsonb_build_array(pg_temp.line('2026-05', 1)))$$), 'refused');
select pg_temp.check('nothing changes before the finish', pg_temp.sales((select co from ids)), '2026-01=100 2026-02=200');

select pg_temp.login('lsb@x.test');
select pg_temp.check('another editor cannot add to it', pg_temp.fails($$select public.stage_lines_add((select id from st where k = 's1'), jsonb_build_array(pg_temp.line('2026-02', 1)))$$), 'refused');
select pg_temp.check('another editor cannot finish it', pg_temp.fails($$select public.stage_lines_finish((select id from st where k = 's1'))$$), 'refused');

select pg_temp.login('lsa@x.test');
select pg_temp.check('finish replaces only the staged months', (public.stage_lines_finish((select id from st where k = 's1')) ->> 'saved'), '2');
select pg_temp.check('after the finish', pg_temp.sales((select co from ids)), '2026-01=100 2026-02=250 2026-03=300');
select pg_temp.check('a finished save cannot be finished again', pg_temp.fails($$select public.stage_lines_finish((select id from st where k = 's1'))$$), 'refused');
select pg_temp.check('the batch lists its months', (select periods::text from public.sales_batches where company_id = (select co from ids) and filename = 'gl2.xlsx'), '{2026-02,2026-03}');

-- Replace all: every month of the source goes, even ones the save does not hold.
insert into st values ('s2', public.stage_lines_begin((select co from ids), 'sales', 'ledger', array['2026-04'], 'gl3.xlsx', '{}'::jsonb, true));
select public.stage_lines_add((select id from st where k = 's2'), jsonb_build_array(pg_temp.line('2026-04', 10)));
select public.stage_lines_finish((select id from st where k = 's2'));
select pg_temp.check('replace all leaves only the new months', pg_temp.sales((select co from ids)), '2026-04=10');
select pg_temp.check('emptied batches are gone', (select count(*)::text from public.sales_batches where company_id = (select co from ids)), '1');

-- Replace all with nothing new: every line of the source goes (a new ledger with no sales lines at all).
insert into st values ('s4', public.stage_lines_begin((select co from ids), 'sales', 'ledger', array[]::text[], 'gl4.xlsx', '{}'::jsonb, true));
select pg_temp.check('replace all with no lines saves nothing', (public.stage_lines_finish((select id from st where k = 's4')) ->> 'saved'), '0');
select pg_temp.check('and leaves no ledger sales lines', pg_temp.sales((select co from ids)), '');
select pg_temp.check('no months without replace all is still refused', pg_temp.fails($$select public.stage_lines_begin((select co from ids), 'sales', 'ledger', array[]::text[], 'x', '{}'::jsonb, false)$$), 'refused');

-- More than 240 months in one save (a long ledger).
insert into st values ('s3', public.stage_lines_begin((select co from ids), 'sales', 'file',
  (select array_agg(to_char(date '2000-01-01' + make_interval(months => g), 'YYYY-MM')) from generate_series(0, 299) g), 'long.xlsx', '{}'::jsonb, false));
select public.stage_lines_add((select id from st where k = 's3'), jsonb_build_array(pg_temp.line('2000-01', 5), pg_temp.line('2024-12', 7)));
select pg_temp.check('300 months in one save', (public.stage_lines_finish((select id from st where k = 's3')) ->> 'saved'), '2');

-- Expenses and payments go the same way.
insert into st values ('e1', public.stage_lines_begin((select co from ids), 'expenses', 'ledger', array['2026-04'], 'gl.xlsx', '{}'::jsonb, false));
select public.stage_lines_add((select id from st where k = 'e1'), '[{"day":"2026-04-02","period":"2026-04","doc":"BILL/1","series":"BILL","supplier":"Cairo Power","account":"Electricity","cls":"exp_fixed","category":"","label":"April","amount":40}]'::jsonb);
select pg_temp.check('expenses finish', (public.stage_lines_finish((select id from st where k = 'e1')) ->> 'saved'), '1');
insert into st values ('p1', public.stage_lines_begin((select co from ids), 'payments', 'ledger', array['2026-04'], 'gl.xlsx', '{}'::jsonb, false));
select public.stage_lines_add((select id from st where k = 'p1'), '[{"day":"2026-04-03","period":"2026-04","number":"CIB/1","journal":"CIB","method":"","partner":"Nile","direction":"in","amount":90,"currency":"EGP","amount_currency":90,"state":"paid","kind":"customers","counter":"AR"}]'::jsonb);
select pg_temp.check('payments finish', (public.stage_lines_finish((select id from st where k = 'p1')) ->> 'saved'), '1');
select pg_temp.check('payment batch is the ledger one', (select source from public.payment_batches where company_id = (select co from ids)), 'ledger');

-- Who may stage at all.
select pg_temp.login('lsv@x.test');
select pg_temp.check('a viewer cannot open a save', pg_temp.fails($$select public.stage_lines_begin((select co from ids), 'sales', 'file', array['2026-01'], 'x', '{}'::jsonb, false)$$), 'refused');
select pg_temp.login('lso@x.test');
select pg_temp.check('an outsider cannot open a save', pg_temp.fails($$select public.stage_lines_begin((select co from ids), 'sales', 'file', array['2026-01'], 'x', '{}'::jsonb, false)$$), 'refused');
select pg_temp.check('an outsider sees no staged rows', pg_temp.fails($$select count(*) from private.line_stage_chunks$$), 'refused');
reset role;

-- D23: previewing an upload has its own allowance (300 an hour), apart from saving (60 an hour).
select pg_temp.check('previews have their own allowance', (select window_s || ' ' || max_hits || ' ' || subject_kind from private.rate_scopes where scope = 'import_preview'), '3600 300 user');
select pg_temp.check('saving keeps 60 an hour', (select window_s || ' ' || max_hits from private.rate_scopes where scope = 'import'), '3600 60');
