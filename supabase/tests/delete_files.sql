-- Deleting a company removes its database rows first, then its stored files (D17), and clearing stock never races a
-- saving import (D18). Run by scripts/test-db.sh.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('da@x.test', '{"full_name":"Dina"}', now()), ('de@x.test', '{"full_name":"Diaa"}', now()), ('do@x.test', '{"full_name":"Doaa"}', now());

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
begin
  execute q;
  return '';
exception when others then return sqlstate || ' ' || sqlerrm;
end $f$;

insert into public.companies (org_id, name) values (pg_temp.home('da@x.test'), 'Deleted Files Co'), (pg_temp.home('da@x.test'), 'Clear Stock Co');
insert into public.memberships (org_id, user_id, role) values (pg_temp.home('da@x.test'), pg_temp.uid('de@x.test'), 'editor');
create temp table ids as select (select id from public.companies where name = 'Deleted Files Co') co, (select id from public.companies where name = 'Clear Stock Co') st;
grant select on ids to authenticated;

-- ---------------------------------------------------------------- D17: files of a deleted company
select pg_temp.login('de@x.test');
select pg_temp.check('an editor may remove a live company''s files', private.import_file_removable((select co from ids) || '/job/a.xlsx')::text, 'true');
select pg_temp.login('do@x.test');
select pg_temp.check('an outsider may not', private.import_file_removable((select co from ids) || '/job/a.xlsx')::text, 'false');
select pg_temp.check('a path that is not a company''s is never removable', private.import_file_removable('not-a-company/a.xlsx')::text, 'false');

select pg_temp.login('da@x.test');
select public.delete_company((select co from ids), 'Deleted Files Co');
select pg_temp.check('after the delete, the admin who can see the record may still remove its files', private.import_file_removable((select co from ids) || '/job/a.xlsx')::text, 'true');
select pg_temp.login('de@x.test');
select pg_temp.check('an editor may not remove a deleted company''s files', private.import_file_removable((select co from ids) || '/job/a.xlsx')::text, 'false');
select pg_temp.check('an editor cannot note files left behind', split_part(pg_temp.err('select public.note_files_left((select co from ids), 2)'), ' ', 1), '42501');
select pg_temp.login('da@x.test');
select public.note_files_left((select co from ids), 2);
select pg_temp.check('files that could not be removed are kept on the record', (select counts ->> 'files_left' from public.company_data_audit where company_id = (select co from ids) and action = 'delete_company'), '2');

-- ---------------------------------------------------------------- D18: clearing stock while an import saves
reset role;
insert into public.import_jobs (company_id, kind, mode, status) values ((select st from ids), 'inventory', 'replace', 'saving');
select pg_temp.login('de@x.test');
select pg_temp.check('clearing stock is refused while an import is saving',
  pg_temp.err('select public.clear_company_data((select st from ids), ''stock'', (public.data_reset_preview((select st from ids)) #>> ''{modules,stock,records}'')::bigint)'),
  'P0001 A stock import is being saved right now; clear stock again once it has finished');
reset role;
update public.import_jobs set status = 'queued' where company_id = (select st from ids);
select pg_temp.login('de@x.test');
select public.clear_company_data((select st from ids), 'stock', (public.data_reset_preview((select st from ids)) #>> '{modules,stock,records}')::bigint);
select pg_temp.check('a waiting import is stopped and removed by the clear', (select count(*)::text from public.import_jobs where company_id = (select st from ids)), '0');
reset role;
