-- Payments from the General Ledger (migration 0028): ledger and file payments kept apart by source, each replacing only its
-- own months, with the kind of each payment and its other side in the summary. Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('plg@x.test', '{"full_name":"Lia"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from auth.users where email = e $f$;
create function pg_temp.home(e text) returns uuid language sql as $f$ select org_id from public.memberships where user_id = pg_temp.uid(e) order by created_at limit 1 $f$;
create function pg_temp.fails(sql text) returns text language plpgsql as $f$
begin
  execute sql;
  return 'ran';
exception when others then return 'refused';
end $f$;
create function pg_temp.login(e text) returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e))::text, false);
  set role authenticated;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('plg@x.test'), 'Ledger Pay Co');
create temp table ids as select (select id from public.companies where name = 'Ledger Pay Co') as co;
grant select on ids to authenticated;
select pg_temp.login('plg@x.test');

-- A payments file for September, then the ledger's payments for September: both stay, each under its source.
select public.add_payment_lines(public.begin_payment_batch((select co from ids), array['2026-09'], 'pay.xlsx', '{}'::jsonb), '[
  {"day":"2026-09-30","period":"2026-09","number":"CIB/1","journal":"CIB","method":"Manual","partner":"Northside","direction":"in","amount":3500,"currency":"EGP","amount_currency":3500,"state":"in_process"}]'::jsonb);
select pg_temp.check('ledger payments with their kind', public.add_payment_lines(public.begin_payment_batch((select co from ids), array['2026-09'], 'gl.xlsx', '{}'::jsonb, 'ledger'), '[
  {"day":"2026-09-05","period":"2026-09","number":"CIB/2026/0001","journal":"121221 CIB Bank EGP","method":"","partner":"Northside","direction":"in","amount":3000,"currency":"","amount_currency":3000,"state":"paid","kind":"customers","counter":"ar"},
  {"day":"2026-09-07","period":"2026-09","number":"TRF/1","journal":"121221 CIB Bank EGP","method":"","partner":"","direction":"out","amount":-2000,"currency":"","amount_currency":-2000,"state":"paid","kind":"transfer","counter":""}]'::jsonb)::text, '2');
select pg_temp.check('the file''s payments stay', (select count(*) from public.payment_lines l join public.payment_batches b on b.id = l.batch_id where b.company_id = (select co from ids) and b.source = 'file')::text, '1');
select pg_temp.check('a new ledger upload replaces only the ledger''s months', public.add_payment_lines(public.begin_payment_batch((select co from ids), array['2026-09'], 'gl2.xlsx', '{}'::jsonb, 'ledger'), '[
  {"day":"2026-09-05","period":"2026-09","number":"CIB/2026/0001","journal":"121221 CIB Bank EGP","method":"","partner":"Northside","direction":"in","amount":3000,"currency":"","amount_currency":3000,"state":"paid","kind":"customers","counter":"ar"}]'::jsonb)::text, '1');
select pg_temp.check('one file payment and one ledger payment', (select string_agg(b.source || ':' || l.kind, ',' order by b.source) from public.payment_lines l join public.payment_batches b on b.id = l.batch_id where b.company_id = (select co from ids))::text, 'file:,ledger:customers');
select pg_temp.check('the summary carries kind, other side and source', (select (s -> 'payments' -> 0 ->> 9) || '/' || (s -> 'payments' -> 0 ->> 10) || '/' || (s -> 'payments' -> 0 ->> 11)
  from (select public.payments_summary((select co from ids)) s) x)::text, 'customers/ar/ledger');
select pg_temp.check('an unknown source is refused', pg_temp.fails($$select public.begin_payment_batch((select co from ids), array['2026-09'], 'x', '{}'::jsonb, 'guess')$$), 'refused');
reset role;
