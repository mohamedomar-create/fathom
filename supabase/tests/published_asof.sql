-- A shared report says how far the books go (migration 0041): a part month is shown as one on the public link too.
\set ON_ERROR_STOP on
\set QUIET on
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('pao@x.test', '{"org_name":"Asof Org"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
insert into public.companies (org_id, name, data_version) select id, 'Asof Co', 3 from public.organizations where name = 'Asof Org';
insert into public.reports (company_id, period_end, status, share_token, sections)
  select id, '2026-10', 'published', 'tok-asof-00000000000000000000', '["cover","kpis"]'::jsonb from public.companies where name = 'Asof Co';
insert into public.imports (company_id, kind, filename, status, report, data_version, action)
  select id, 'upload', 'old.xlsx', 'done', '{"asOf":"2026-09-30"}', 2, 'import' from public.companies where name = 'Asof Co';
insert into public.imports (company_id, kind, filename, status, report, data_version, action)
  select id, 'upload', 'gl.xlsx', 'done', '{"asOf":"2026-10-15"}', 3, 'import' from public.companies where name = 'Asof Co';
set role anon;
select pg_temp.check('the link says the books run to 15 October (the current version''s import)', public.get_published_report('tok-asof-00000000000000000000') ->> 'as_of', '2026-10-15');
reset role;
-- A report without figures still carries no more than before.
update public.reports set sections = '["cover"]'::jsonb where share_token = 'tok-asof-00000000000000000000';
set role anon;
select pg_temp.check('a cover-only link still has no accounts', (public.get_published_report('tok-asof-00000000000000000000') -> 'accounts')::text, '[]');
reset role;
delete from public.organizations where name = 'Asof Org';
