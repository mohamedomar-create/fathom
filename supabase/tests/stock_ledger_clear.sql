-- Clearing the ledger's stock postings on the server (migration 0051): one call, editors only, closed months kept, and
-- 60,000 lines go well inside the 8-second limit a signed-in call has (the browser's row-by-row delete timed out live).
-- Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('sca@x.test', '{"full_name":"Sam"}', now()), ('scv@x.test', '{"full_name":"Val"}', now()), ('sco@x.test', '{"full_name":"Out"}', now());

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

insert into public.companies (org_id, name) values (pg_temp.home('sca@x.test'), 'Stock Clear Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('sca@x.test'), pg_temp.uid('scv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Stock Clear Co') as co;
grant select on ids to authenticated;

-- 24 months (2025-01 .. 2026-12) of postings, 2,500 a month = 60,000 lines, in one batch per quarter.
insert into public.stock_ledger_batches (company_id, filename, periods)
select (select co from ids), 'gl-q' || q, array(select to_char(date '2025-01-01' + make_interval(months => m), 'YYYY-MM') from generate_series(q * 3, q * 3 + 2) m)
from generate_series(0, 7) q;
insert into public.stock_ledger_lines (company_id, batch_id, day, period, ref, account, amount)
select (select co from ids), b.id, (p || '-10')::date, p, 'WH/OUT/' || i, '123000 Stock', 10
from public.stock_ledger_batches b, unnest(b.periods) p, generate_series(1, 2500) i
where b.company_id = (select co from ids);
select pg_temp.check('schema version 51', public.schema_version()::text, '51');
select pg_temp.check('60,000 lines loaded', (select count(*) from public.stock_ledger_lines where company_id = (select co from ids))::text, '60000');
analyze public.stock_ledger_lines;

create function pg_temp.months() returns text language sql as $f$
  select coalesce(string_agg(distinct period, ' ' order by period), '') from public.stock_ledger_lines where company_id = (select co from ids) $f$;

select pg_temp.login('scv@x.test');
select pg_temp.check('a viewer cannot clear', pg_temp.fails($$select public.clear_stock_ledger((select co from ids), array['2025-01'])$$), 'refused');
select pg_temp.login('sco@x.test');
select pg_temp.check('an outsider cannot clear', pg_temp.fails($$select public.clear_stock_ledger((select co from ids), null)$$), 'refused');
reset role;
select pg_temp.check('nothing went', (select count(*) from public.stock_ledger_lines where company_id = (select co from ids))::text, '60000');

-- Some months: their lines go, the batch keeps its other months, a batch left with none goes.
select pg_temp.login('sca@x.test');
select pg_temp.check('three months cleared', public.clear_stock_ledger((select co from ids), array['2025-01', '2025-02', '2025-03'])::text, '7500');
reset role;
select pg_temp.check('the quarter batch is gone', (select count(*) from public.stock_ledger_batches where company_id = (select co from ids) and filename = 'gl-q0')::text, '0');
select pg_temp.check('other months kept', split_part(pg_temp.months(), ' ', 1), '2025-04');

-- A closed month keeps its lines, even when everything is cleared.
update public.companies set closed_through = '2025-06' where id = (select co from ids);
select pg_temp.login('sca@x.test');
set statement_timeout = '8s';
create temp table t0 as select clock_timestamp() as at;
select pg_temp.check('everything open cleared, within 8 seconds', public.clear_stock_ledger((select co from ids), null)::text, '45000');
select pg_temp.check('quick', ((extract(epoch from clock_timestamp() - (select at from t0)) < 8))::text, 'true');
reset statement_timeout;
reset role;
select pg_temp.check('closed months kept', pg_temp.months(), '2025-04 2025-05 2025-06');
select pg_temp.check('the batch holding them keeps only them', (select array_to_string(periods, ' ') from public.stock_ledger_batches where company_id = (select co from ids)), '2025-04 2025-05 2025-06');
select pg_temp.check('no stray batches', (select count(*) from public.stock_ledger_batches where company_id = (select co from ids))::text, '1');
