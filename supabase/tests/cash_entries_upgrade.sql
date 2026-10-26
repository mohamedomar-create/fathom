-- 0037 again on a database holding entries from its first version, before kinds existed: money out read as a sale
-- would break the kind rule, so it becomes an expense and the migration runs through.
\set ON_ERROR_STOP on
\set QUIET on
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
insert into public.organizations (name) values ('Upgrade Org');
insert into public.companies (org_id, name) select id, 'Upgrade Co' from public.organizations where name = 'Upgrade Org';
alter table public.cash_entries drop constraint cash_entries_kind;
insert into public.cash_entries (company_id, day, direction, amount, category, kind)
select id, '2026-01-05', 'out', 120, 'Rent', 'sale' from public.companies where name = 'Upgrade Co';
\ir ../migrations/0037_cash_entries.sql
select pg_temp.check('old money out becomes an expense', (select kind from public.cash_entries e join public.companies c on c.id = e.company_id where c.name = 'Upgrade Co'), 'expense');
select pg_temp.check('the kind rule is back', (select count(*)::text from pg_constraint where conname = 'cash_entries_kind'), '1');
delete from public.organizations where name = 'Upgrade Org';
