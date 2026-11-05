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
-- 0037 replaced the entry functions with its own versions: the later migrations that change them run again, so the
-- tests after this one see the database as it really is (an owner re-running them in order gets the same).
\ir ../migrations/0048_cash_category_rules.sql
\ir ../migrations/0049_cash_rules_scale.sql
-- 0059 replaced 0037's upload start with one that takes the file's fingerprint; the old one 0037 brought back goes.
drop function if exists public.cash_upload_begin(uuid, text, text[], text, integer, text[]);
select pg_temp.check('saving an entry learns again after the re-run', (select (prosrc like '%cash_learn%')::text from pg_proc where oid = 'public.cash_entry_add(uuid, jsonb)'::regprocedure), 'true');
delete from public.organizations where name = 'Upgrade Org';
