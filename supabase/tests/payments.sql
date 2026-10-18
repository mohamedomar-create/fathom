-- Payments (migration 0027): ageing reports replaced by side and date, payments replaced by month, who can save and read,
-- and the one-call summary. Run by scripts/test-db.sh; any failed check raises.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('pya@x.test', '{"full_name":"Pia"}', now()), ('pyb@x.test', '{"full_name":"Pat"}', now()), ('pyv@x.test', '{"full_name":"Val"}', now());

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

insert into public.companies (org_id, name) values (pg_temp.home('pya@x.test'), 'Pay Co');
-- Val is a viewer in Pia's organisation.
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('pya@x.test'), pg_temp.uid('pyv@x.test'), 'viewer');
create temp table ids as select (select id from public.companies where name = 'Pay Co') as co;
grant select on ids to authenticated;

select pg_temp.login('pya@x.test');
select pg_temp.check('save a receivable ageing', public.save_aged_report((select co from ids), 'receivable', '2026-09-30', array['At Date','1-30','31-60','61-90','91-120','Older'],
  '{"amounts":[1000,200,0,0,0,290],"total":1490}'::jsonb, '[]'::jsonb, 'aged.xlsx',
  '[{"partner":"Northside","ref":"INV/1","memo":"","day":"2026-09-12","amounts":[1000,0,0,0,0,0],"total":1000},
    {"partner":"Northside","ref":"INV/2","memo":"","day":"2026-08-20","amounts":[0,200,0,0,0,0],"total":200},
    {"partner":"Unknown","ref":"CIB/9","memo":"","day":null,"amounts":[0,0,0,0,0,290],"total":290}]'::jsonb)::text, '3');
select pg_temp.check('the same side and date replaces', public.save_aged_report((select co from ids), 'receivable', '2026-09-30', array['At Date','1-30','31-60','61-90','91-120','Older'],
  '{"amounts":[1000,0,0,0,0,0],"total":1000}'::jsonb, '[]'::jsonb, 'aged-2.xlsx',
  '[{"partner":"Northside","ref":"INV/1","memo":"","day":"2026-09-12","amounts":[1000,0,0,0,0,0],"total":1000}]'::jsonb)::text, '1');
select pg_temp.check('one receivable report, one item', (select count(*) || '/' || (select count(*) from public.aged_items where company_id = (select co from ids)) from public.aged_reports where company_id = (select co from ids))::text, '1/1');

create temp table b as select public.begin_payment_batch((select co from ids), array['2026-09'], 'payments.xlsx', '{}'::jsonb) as id;
grant select on b to authenticated;
select pg_temp.check('add payments', public.add_payment_lines((select id from b), '[
  {"day":"2026-09-30","period":"2026-09","number":"CIB/1","journal":"CIB","method":"Manual","partner":"Northside","direction":"in","amount":3500,"currency":"EGP","amount_currency":3500,"state":"paid"},
  {"day":"2026-09-29","period":"2026-09","number":"PM/1","journal":"Cash","method":"Manual","partner":"Medline","direction":"out","amount":-1000,"currency":"EGP","amount_currency":-1000,"state":"paid"},
  {"day":"2026-08-29","period":"2026-08","number":"PM/0","journal":"Cash","method":"Manual","partner":"Medline","direction":"out","amount":-5,"currency":"EGP","amount_currency":-5,"state":"paid"}]'::jsonb)::text, '2');
select pg_temp.check('a new batch for September replaces it', (select public.add_payment_lines(public.begin_payment_batch((select co from ids), array['2026-09'], 'p2.xlsx', '{}'::jsonb), '[
  {"day":"2026-09-30","period":"2026-09","number":"CIB/1","journal":"CIB","method":"Manual","partner":"Northside","direction":"in","amount":3500,"currency":"EGP","amount_currency":3500,"state":"paid"}]'::jsonb))::text, '1');
select pg_temp.check('summary in one call', (select jsonb_build_object('ar', s -> 'aged' -> 'receivable' -> 'total' -> 'total', 'items', jsonb_array_length(s -> 'aged' -> 'receivable' -> 'items'), 'pay', jsonb_array_length(s -> 'payments'))
  from (select public.payments_summary((select co from ids)) s) x)::text, '{"ar": 1000, "pay": 1, "items": 1}');

select pg_temp.login('pyv@x.test');
select pg_temp.check('a viewer reads the summary', (select jsonb_array_length(public.payments_summary((select co from ids)) -> 'payments'))::text, '1');
select pg_temp.check('a viewer cannot save an ageing', pg_temp.fails($$select public.save_aged_report((select co from ids), 'payable', '2026-09-30', array['1-30','31-60','Older'], '{"amounts":[0,0,0],"total":0}'::jsonb, '[]'::jsonb, 'x', '[]'::jsonb)$$), 'refused');
select pg_temp.check('a viewer cannot start a payments batch', pg_temp.fails($$select public.begin_payment_batch((select co from ids), array['2026-09'], 'x', '{}'::jsonb)$$), 'refused');

select pg_temp.login('pyb@x.test');
select pg_temp.check('an outsider sees nothing', pg_temp.fails($$select public.payments_summary((select co from ids))$$), 'refused');
select pg_temp.check('an outsider sees no rows', (select count(*) from public.aged_items)::text, '0');
select pg_temp.check('an outsider cannot add to someone else''s batch', pg_temp.fails($$select public.add_payment_lines((select id from b), '[]'::jsonb)$$), 'refused');
reset role;
