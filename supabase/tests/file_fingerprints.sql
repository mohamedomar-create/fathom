-- Duplicate files (0059, acceptance test 2): an upload records the SHA-256 of the file it came from, and adding the same
-- file again is refused instead of counting every entry twice. Replacing months with it is still allowed.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ffa@x.test', '{"full_name":"Shop Owner"}', now()), ('ffb@x.test', '{"full_name":"Other Owner"}', now());
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
begin execute q; return ''; exception when others then return sqlstate || ' ' || sqlerrm; end $f$;

insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('ffa@x.test'), 'FF Shop', '{"profile":{"mode":"simple"}}');
insert into public.companies (org_id, name, kpi_config) values (pg_temp.home('ffb@x.test'), 'FF Other', '{"profile":{"mode":"simple"}}');
create temp table ids as select (select id from public.companies where name = 'FF Shop') co, (select id from public.companies where name = 'FF Other') other,
  repeat('ab', 32) h1, repeat('cd', 32) h2;
grant select on ids to authenticated;
create temp table st (k text primary key, id uuid);
grant all on st to authenticated;

select pg_temp.login('ffa@x.test');
insert into st values ('u1', public.cash_upload_begin((select co from ids), 'book.xlsx', array['2026-01'], 'add', 0, '{in,out}', (select h1 from ids)));
select public.cash_upload_add((select id from st where k = 'u1'), '[{"day":"2026-01-05","direction":"in","amount":1000,"category":"Sales"}]'::jsonb);
select public.cash_upload_finish((select id from st where k = 'u1'));
select pg_temp.check('the upload keeps the file''s fingerprint', (select file_hash from public.cash_uploads where id = (select id from st where k = 'u1')), repeat('ab', 32));

select pg_temp.check('adding the same file again is refused',
  split_part(pg_temp.err($$select public.cash_upload_begin((select co from ids), 'book (copy).xlsx', array['2026-01'], 'add', 0, '{in,out}', (select h1 from ids))$$), ' ', 1), '23505');
select pg_temp.check('the refusal names the earlier upload',
  (pg_temp.err($$select public.cash_upload_begin((select co from ids), 'book (copy).xlsx', array['2026-01'], 'add', 0, '{in,out}', (select h1 from ids))$$) like '%book.xlsx%')::text, 'true');
select pg_temp.check('the money was not doubled', (select sum(amount)::text from public.cash_entries where company_id = (select co from ids)), '1000');

insert into st values ('u2', public.cash_upload_begin((select co from ids), 'book.xlsx', array['2026-01'], 'replace_months', 0, '{in,out}', (select h1 from ids)));
select pg_temp.check('replacing the months with the same file is allowed', ((select id from st where k = 'u2') is not null)::text, 'true');
select public.cash_upload_add((select id from st where k = 'u2'), '[{"day":"2026-01-05","direction":"in","amount":1000,"category":"Sales"}]'::jsonb);
select public.cash_upload_finish((select id from st where k = 'u2'));
select pg_temp.check('and still counts the money once', (select sum(amount)::text from public.cash_entries where company_id = (select co from ids)), '1000');

insert into st values ('u3', public.cash_upload_begin((select co from ids), 'feb.xlsx', array['2026-02'], 'add', 0, '{in,out}', (select h2 from ids)));
select pg_temp.check('a different file is added', ((select id from st where k = 'u3') is not null)::text, 'true');
select pg_temp.check('an upload without a fingerprint still works', (public.cash_upload_begin((select co from ids), 'old app', array['2026-03'], 'add', 0) is not null)::text, 'true');
select pg_temp.check('a malformed fingerprint is refused',
  split_part(pg_temp.err($$select public.cash_upload_begin((select co from ids), 'x', array['2026-03'], 'add', 0, '{in,out}', 'not-a-hash')$$), ' ', 1), '22023');
-- An open (unfinished) upload of the file does not block a retry.
insert into st values ('u4', public.cash_upload_begin((select co from ids), 'mar.xlsx', array['2026-03'], 'add', 0, '{in,out}', repeat('ef', 32)));
select pg_temp.check('an unfinished upload of the file does not block a retry',
  (public.cash_upload_begin((select co from ids), 'mar.xlsx', array['2026-03'], 'add', 0, '{in,out}', repeat('ef', 32)) is not null)::text, 'true');

-- Another company may upload the same file.
select pg_temp.login('ffb@x.test');
select pg_temp.check('another company is not blocked by this one''s files',
  (public.cash_upload_begin((select other from ids), 'book.xlsx', array['2026-01'], 'add', 0, '{in,out}', (select h1 from ids)) is not null)::text, 'true');
reset role;
