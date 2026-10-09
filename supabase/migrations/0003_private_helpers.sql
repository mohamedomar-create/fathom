-- Membership helpers live in a non-exposed schema (RLS policies reference them by OID).
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.is_member(uuid, public.member_role) set schema private;
alter function public.company_org(uuid) set schema private;
revoke execute on function private.is_member(uuid, public.member_role) from public, anon;
revoke execute on function private.company_org(uuid) from public, anon;
grant execute on function private.is_member(uuid, public.member_role) to authenticated;
grant execute on function private.company_org(uuid) to authenticated;
revoke execute on function public.get_published_report(text) from public;
grant execute on function public.get_published_report(text) to anon, authenticated;
-- replace_company_data and reclassify_accounts were re-created to call private.is_member / private.company_org
-- (same bodies as 0002 with the schema changed).
