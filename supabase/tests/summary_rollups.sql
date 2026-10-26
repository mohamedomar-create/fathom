-- Kept summaries (migration 0032): the same figures as the live summary functions, rebuilt after every kind of change,
-- members only, and a build still settling or failed is never reported as ready. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('sra@x.test', '{"full_name":"Ria"}', now()), ('srb@x.test', '{"full_name":"Rob"}', now()), ('srv@x.test', '{"full_name":"Ved"}', now());

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
exception when others then return 'refused: ' || sqlstate;
end $f$;
-- The summaries build their lists with jsonb_agg and no order, so two builds are compared list by list as sets of rows.
create function pg_temp.same(a jsonb, b jsonb) returns boolean language sql as $f$
  select a is not null and b is not null and not exists (
    select 1 from (select key from jsonb_object_keys(a) key union select key from jsonb_object_keys(b) key) k
     where case when jsonb_typeof(a -> k.key) = 'array' and jsonb_typeof(b -> k.key) = 'array'
                then (select coalesce(array_agg(e::text order by e::text), '{}') from jsonb_array_elements(a -> k.key) e)
                  is distinct from (select coalesce(array_agg(e::text order by e::text), '{}') from jsonb_array_elements(b -> k.key) e)
                else (a -> k.key) is distinct from (b -> k.key) end)
$f$;
-- The background worker's turn: changes count as settled, then one rebuild run.
create function pg_temp.worker() returns integer language plpgsql as $f$
begin
  reset role;
  update private.summary_marks set marked_at = now() - interval '1 minute';
  return private.refresh_summary_rollups(1000);
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('sra@x.test'), 'Roll Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('sra@x.test'), pg_temp.uid('srv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Roll Co') as co;
grant select on ids to authenticated;

select pg_temp.login('sra@x.test');
select pg_temp.check('nothing recorded yet reads as empty', (public.summary_state((select co from ids), 'sales') ->> 'status'), 'empty');

reset role;
do $$
declare c uuid := (select co from ids); b uuid;
begin
  insert into public.sales_batches (company_id, source, filename) values (c, 'ledger', 'GL.xlsx') returning id into b;
  insert into public.sales_lines (company_id, batch_id, source, period, day, doc, customer, product, amount, cost, qty)
  values (c, b, 'ledger', '2026-08', '2026-08-03', 'INV/1', 'North', 'Pump', 100, 40, 1), (c, b, 'ledger', '2026-09', '2026-09-03', 'INV/2', 'North', 'Pump', 70, null, 1);
  insert into public.sales_batches (company_id, source, filename) values (c, 'file', 'Invoices.xlsx') returning id into b;
  insert into public.sales_lines (company_id, batch_id, source, period, day, doc, customer, product, amount, cost, qty)
  values (c, b, 'file', '2026-09', '2026-09-04', 'INV/2', 'North', 'Pump', 60, 20, 1), (c, b, 'file', '2026-09', '2026-09-05', 'INV/3', 'South', 'Mask', 40, 10, 2);
  insert into public.expense_batches (company_id, source, filename) values (c, 'file', 'Bills.xlsx') returning id into b;
  insert into public.expense_lines (company_id, batch_id, source, period, day, doc, supplier, account, cls, amount)
  values (c, b, 'file', '2026-09', '2026-09-02', 'BILL/1', 'Power Co', 'Electricity', 'exp_fixed', 30), (c, b, 'file', '2026-09', '2026-09-02', 'BILL/2', 'Power Co', 'Electricity', 'exp_fixed', 30);
  insert into public.payment_batches (company_id, filename, source) values (c, 'GL.xlsx', 'ledger') returning id into b;
  insert into public.payment_lines (company_id, batch_id, day, period, direction, amount, state) values (c, b, '2026-09-01', '2026-09', 'in', 10, 'paid');
end $$;

select pg_temp.login('sra@x.test');
select pg_temp.check('a change waits for the worker: pending, no figures yet', (select (s ->> 'status') || '/' || coalesce(s ->> 'summary', 'none') from (select public.summary_state((select co from ids), 'sales') s) x), 'pending/none');
select pg_temp.worker();
select pg_temp.check('the worker rebuilds the three kinds', (select count(*) from public.summary_rollups where company_id = (select co from ids) and built_seq is not null)::text, '3');
reset role;
update public.sales_lines set qty = qty where company_id = (select co from ids) and doc = 'INV/3';
select pg_temp.check('a change still being saved is not rebuilt yet', (select private.refresh_summary_rollups(1000) || '/' || (public.summary_state((select co from ids), 'sales') ->> 'status')), '0/pending');
select pg_temp.worker();

select pg_temp.login('sra@x.test');
select pg_temp.check('sales: ready, identical to sales_summary', (select (s ->> 'status') || '/' || pg_temp.same(s -> 'summary', public.sales_summary((select co from ids)))::text from (select public.summary_state((select co from ids), 'sales') s) x), 'ready/true');
select pg_temp.check('expenses: ready, identical to expense_summary', (select (s ->> 'status') || '/' || pg_temp.same(s -> 'summary', public.expense_summary((select co from ids)))::text from (select public.summary_state((select co from ids), 'expenses') s) x), 'ready/true');
select pg_temp.check('payments: ready, identical to payments_summary', (select (s ->> 'status') || '/' || pg_temp.same(s -> 'summary', public.payments_summary((select co from ids)))::text from (select public.summary_state((select co from ids), 'payments') s) x), 'ready/true');
select pg_temp.check('the file wins its month (September from the invoices file only)', (select sum((r ->> 'a')::numeric)::text from jsonb_array_elements(public.summary_state((select co from ids), 'sales') -> 'summary' -> 'customers') r where r ->> 'p' = '2026-09'), '100.00');

-- A class restamp (an update), an undo (a batch deleted) and clearing a module (lines deleted) each mark and rebuild.
reset role;
update public.expense_lines set cls = 'exp_variable' where company_id = (select co from ids) and doc = 'BILL/2';
select pg_temp.login('sra@x.test');
select pg_temp.check('after a restamp: pending with the previous figures kept', (select (s ->> 'status') || '/' || (s -> 'summary' is not null)::text from (select public.summary_state((select co from ids), 'expenses') s) x), 'pending/true');
select pg_temp.worker();
select pg_temp.login('sra@x.test');
select pg_temp.check('after a restamp: rebuilt and identical', (select (s ->> 'status') || '/' || pg_temp.same(s -> 'summary', public.expense_summary((select co from ids)))::text from (select public.summary_state((select co from ids), 'expenses') s) x), 'ready/true');
reset role;
delete from public.sales_batches where company_id = (select co from ids) and source = 'file';
select pg_temp.worker();
select pg_temp.login('sra@x.test');
select pg_temp.check('after an undo: the ledger month is back (70)', (select sum((r ->> 'a')::numeric)::text from jsonb_array_elements(public.summary_state((select co from ids), 'sales') -> 'summary' -> 'customers') r where r ->> 'p' = '2026-09'), '70.00');
reset role;
delete from public.payment_lines where company_id = (select co from ids);
select pg_temp.worker();
select pg_temp.login('sra@x.test');
select pg_temp.check('after clearing payments: ready with no payments, identical', (select (s ->> 'status') || '/' || jsonb_array_length(s -> 'summary' -> 'payments')::text || '/' || pg_temp.same(s -> 'summary', public.payments_summary((select co from ids)))::text from (select public.summary_state((select co from ids), 'payments') s) x), 'ready/0/true');

-- A build that fails keeps the last good figures and says it failed; it is not retried on every run.
reset role;
update public.summary_rollups set error = '57014 canceling statement due to statement timeout', error_seq = (select seq from private.summary_marks k where k.company_id = (select co from ids) and k.kind = 'sales'), error_at = now(), built_seq = built_seq - 1
 where company_id = (select co from ids) and kind = 'sales';
select pg_temp.login('sra@x.test');
select pg_temp.check('a failed build reads as failed, with the last good figures and the reason', (select (s ->> 'status') || '/' || (s -> 'summary' is not null)::text || '/' || left(s ->> 'error', 5) from (select public.summary_state((select co from ids), 'sales') s) x), 'failed/true/57014');
select pg_temp.worker();
select pg_temp.check('a failed build is not retried straight away', (select left(error, 5) from public.summary_rollups where company_id = (select co from ids) and kind = 'sales'), '57014');

select pg_temp.check('a caller holding the latest build is not sent it again', (select (s ->> 'same') || '/' || coalesce(s ->> 'summary', 'none') from (select public.summary_state((select co from ids), 'expenses', (select built_seq from public.summary_rollups where company_id = (select co from ids) and kind = 'expenses')) s) x), 'true/none');
select pg_temp.check('a caller holding an older build gets the new one', (select (s ->> 'same') || '/' || (s -> 'summary' is not null)::text from (select public.summary_state((select co from ids), 'expenses', 1) s) x), 'false/true');

-- Who may read.
select pg_temp.login('srv@x.test');
select pg_temp.check('a viewer reads the kept summary', (public.summary_state((select co from ids), 'expenses') ->> 'status'), 'ready');
select pg_temp.login('srb@x.test');
select pg_temp.check('an outsider is refused, not given an empty summary', pg_temp.fails($$select public.summary_state((select co from ids), 'sales')$$), 'refused: 42501');
select pg_temp.check('an outsider sees no kept rows', (select count(*) from public.summary_rollups where company_id = (select co from ids))::text, '0');
select pg_temp.check('an unknown kind is refused', pg_temp.fails($$select public.summary_state((select co from ids), 'stock')$$), 'refused: 22023');
select pg_temp.check('a signed-in user cannot run the worker', pg_temp.fails($$select private.refresh_summary_rollups(1)$$), 'refused: 42501');
select pg_temp.check('a signed-in user cannot write kept summaries', pg_temp.fails($$update public.summary_rollups set summary = '{}' where true$$), 'refused: 42501');
reset role;
set role anon;
select pg_temp.check('a visitor cannot read summaries', pg_temp.fails($$select public.summary_state((select co from ids), 'sales')$$), 'refused: 42501');
reset role;

-- Deleting the company takes its kept summaries and marks with it.
delete from public.companies where id = (select co from ids);
select pg_temp.check('a deleted company leaves nothing kept', ((select count(*) from public.summary_rollups where company_id = (select co from ids)) + (select count(*) from private.summary_marks where company_id = (select co from ids)))::text, '0');
