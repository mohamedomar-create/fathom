-- Access (migration 0039): invites are accepted or declined and expire, each organisation has one owner, people changes
-- are recorded, admins need two-step sign-in after their grace period, and deleted companies and organisations can be
-- brought back for 14 days.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values
  ('ao@x.test', '{"full_name":"Owner","org_name":"Acc Org"}', now()), ('aa@x.test', '{"full_name":"Admin"}', now()),
  ('ae@x.test', '{"full_name":"Editor"}', now()), ('ai@x.test', '{"full_name":"Invitee"}', now());
create function pg_temp.check(label text, got text, want text) returns void language plpgsql as $f$
begin
  if got is distinct from want then raise exception 'FAIL %: got "%", want "%"', label, got, want; end if;
  raise notice 'ok  %', label;
end $f$;
-- User ids as the database sees them (signed-in users cannot read auth.users).
create temp table uids as select email, id from auth.users where email like 'a_@x.test';
grant select on uids to authenticated;
create function pg_temp.uid(e text) returns uuid language sql as $f$ select id from uids where email = e $f$;
-- A sign-in by password `age` seconds ago (a fresh one by default); `method` 'totp' alone is a code without a password.
create function pg_temp.login(e text, aal text default 'aal1', age int default 0, method text default 'password') returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.uid(e), 'aal', aal, 'amr', json_build_array(json_build_object('method', method, 'timestamp', extract(epoch from now())::int - age)))::text, false);
  set role authenticated;
end $f$;
create function pg_temp.err(sql text) returns text language plpgsql as $f$
begin execute sql; return 'none'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(sql text) returns text language plpgsql as $f$
begin execute sql; return 'none'; exception when others then return sqlerrm; end $f$;
create temp table o as select id from public.organizations where name = 'Acc Org';
grant select on o to authenticated;
-- Invite ids as the database sees them (an invitee cannot read the invites table, only my_invites).
create temp view inv as select id, email from public.invites;
grant select on inv to authenticated;

select pg_temp.check('sign-up makes you the owner of your organisation', (select (owner_id = pg_temp.uid('ao@x.test'))::text from public.organizations where id = (select id from o)), 'true');
insert into public.memberships (org_id, user_id, role) values ((select id from o), pg_temp.uid('aa@x.test'), 'admin'), ((select id from o), pg_temp.uid('ae@x.test'), 'editor');

-- Invites wait for an answer and expire after 14 days.
select pg_temp.login('aa@x.test');
insert into public.invites (org_id, email, role) values ((select id from o), 'ai@x.test', 'viewer');
select pg_temp.check('an invite expires after 14 days', (select (expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour')::text from public.invites where email = 'ai@x.test'), 'true');
select pg_temp.login('ai@x.test');
select pg_temp.check('signing in no longer joins by itself', public.accept_pending_invites()::text || ' ' || private.is_member((select id from o))::text, '0 false');
select pg_temp.check('the invitee sees the invite with who sent it', (select (i ->> 'org_name') || ' ' || (i ->> 'role') || ' ' || (i ->> 'invited_by') from jsonb_array_elements(public.my_invites()) i), 'Acc Org viewer Admin');
select pg_temp.login('ae@x.test');
select pg_temp.check('nobody else can take the invite', pg_temp.err(format('select public.accept_invite(%L)', (select id from inv where email = 'ai@x.test'))), '42501');
select pg_temp.login('ai@x.test');
select public.accept_invite((select id from inv where email = 'ai@x.test'));
select pg_temp.check('accepting joins with the role offered', (select role::text from public.memberships where org_id = (select id from o) and user_id = pg_temp.uid('ai@x.test')), 'viewer');
select pg_temp.check('an accepted invite leaves the list', jsonb_array_length(public.my_invites())::text, '0');

-- Declined and expired invites cannot be used.
select pg_temp.login('aa@x.test');
insert into public.invites (org_id, email, role) values ((select id from o), 'late@x.test', 'editor'), ((select id from o), 'no@x.test', 'editor');
reset role;
update public.invites set expires_at = now() - interval '1 day' where email = 'late@x.test';
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('late@x.test', '{}', now()), ('no@x.test', '{}', now());
insert into uids select email, id from auth.users where email in ('late@x.test', 'no@x.test');
select pg_temp.login('late@x.test');
select pg_temp.check('an expired invite is not shown', jsonb_array_length(public.my_invites())::text, '0');
select pg_temp.check('an expired invite cannot be accepted', pg_temp.err(format('select public.accept_invite(%L)', (select id from inv where email = 'late@x.test'))), '22023');
select pg_temp.login('no@x.test');
select public.decline_invite((select id from inv where email = 'no@x.test'));
select pg_temp.check('a declined invite cannot be accepted', pg_temp.err(format('select public.accept_invite(%L)', (select id from inv where email = 'no@x.test'))), '22023');
select pg_temp.check('a new user still has an organisation of their own', (select count(*)::text from public.memberships where user_id = pg_temp.uid('no@x.test')), '1');

-- One owner: never removed or demoted, hands over only to an admin.
select pg_temp.login('aa@x.test');
select pg_temp.check('the owner cannot be removed', pg_temp.msg(format('delete from public.memberships where org_id = %L and user_id = %L', (select id from o), pg_temp.uid('ao@x.test'))), 'Hand the organisation to another admin first.');
select pg_temp.check('the owner cannot be demoted', pg_temp.msg(format('update public.memberships set role = %L where org_id = %L and user_id = %L', 'editor', (select id from o), pg_temp.uid('ao@x.test'))), 'Hand the organisation to another admin first.');
select pg_temp.check('an admin cannot make themselves owner', pg_temp.err(format('update public.organizations set owner_id = %L where id = %L', pg_temp.uid('aa@x.test'), (select id from o))), '42501');
select pg_temp.check('only the owner hands over', pg_temp.err(format('select public.transfer_ownership(%L, %L)', (select id from o), pg_temp.uid('aa@x.test'))), '42501');
select pg_temp.check('only the owner deletes the organisation', pg_temp.err(format('select public.delete_organisation(%L, %L)', (select id from o), 'Acc Org')), '42501');
select pg_temp.login('ao@x.test');
select pg_temp.check('ownership goes only to an admin', pg_temp.err(format('select public.transfer_ownership(%L, %L)', (select id from o), pg_temp.uid('ae@x.test'))), '22023');

-- Every people change is recorded; only admins read it; nobody writes it.
select pg_temp.login('aa@x.test');
update public.memberships set role = 'admin' where org_id = (select id from o) and user_id = pg_temp.uid('ae@x.test');
update public.memberships set role = 'editor' where org_id = (select id from o) and user_id = pg_temp.uid('ae@x.test');
select pg_temp.check('people changes are recorded', (select string_agg(distinct action, ',' order by action) from public.org_audit where org_id = (select id from o)),
  'invite_accepted,invite_declined,invite_resent,invite_sent,member_added,role_changed');
select pg_temp.check('the record names who did it', (select (actor = pg_temp.uid('aa@x.test'))::text || ' ' || (detail ->> 'to') from public.org_audit where org_id = (select id from o) and action = 'role_changed' order by id desc limit 1), 'true editor');
select pg_temp.check('the record cannot be written directly', pg_temp.err(format('insert into public.org_audit (org_id, action) values (%L, %L)', (select id from o), 'x')), '42501');
select pg_temp.login('ae@x.test');
select pg_temp.check('an editor does not read it', (select count(*)::text from public.org_audit where org_id = (select id from o)), '0');

-- Two-step sign-in: required for admin actions once the grace period has ended.
reset role;
insert into public.companies (org_id, name) values ((select id from o), 'Gone Co'), ((select id from o), 'Old Co'), ((select id from o), 'Older Co');
update public.profiles set mfa_required_from = now() - interval '1 day' where id = pg_temp.uid('aa@x.test');
select pg_temp.login('aa@x.test');
select pg_temp.check('after the grace period an admin needs two-step sign-in', pg_temp.msg(format('select public.delete_company(%L, %L)', (select id from public.companies where name = 'Gone Co'), 'Gone Co')), 'Turn on two-step sign-in (Account, Security) to do this.');
select pg_temp.check('people changes need it too', pg_temp.err(format('update public.memberships set role = %L where org_id = %L and user_id = %L', 'viewer', (select id from o), pg_temp.uid('ae@x.test'))), '42501');
select pg_temp.login('ao@x.test');
select pg_temp.check('within the grace period it is not needed yet', pg_temp.err(format('update public.memberships set role = %L where org_id = %L and user_id = %L', 'viewer', (select id from o), pg_temp.uid('ae@x.test'))), 'none');

-- A deleted company is hidden and comes back within 14 days.
select pg_temp.login('aa@x.test', 'aal2');
select public.delete_company((select id from public.companies where name = 'Gone Co'), 'Gone Co');
select pg_temp.check('a deleted company is hidden', (select count(*)::text from public.companies where name = 'Gone Co'), '0');
select pg_temp.check('and listed as recently deleted', (select string_agg(c ->> 'name', ',') from jsonb_array_elements(public.deleted_items() -> 'companies') c), 'Gone Co');
select public.restore_company((select (c ->> 'id')::uuid from jsonb_array_elements(public.deleted_items() -> 'companies') c));
select pg_temp.check('restored, it is back', (select count(*)::text from public.companies where name = 'Gone Co'), '1');
select pg_temp.check('deleting and restoring are recorded', (select string_agg(action, ',' order by id) from public.company_data_audit where company_name = 'Gone Co'), 'delete_company,restore_company');

-- A deleted organisation disappears for everyone, the owner gets a home, and the owner can bring it back.
select pg_temp.login('ao@x.test', 'aal2');
select public.delete_organisation((select id from o), 'Acc Org');
select pg_temp.check('the organisation is gone for its members', (select private.is_member((select id from o))::text), 'false');
select pg_temp.check('the owner has an organisation to work in', (select count(*)::text from public.memberships m join public.organizations g on g.id = m.org_id where m.user_id = pg_temp.uid('ao@x.test') and g.deleted_at is null), '1');
select pg_temp.check('the owner sees it in recently deleted', (select string_agg(g ->> 'name', ',') from jsonb_array_elements(public.deleted_items() -> 'orgs') g), 'Acc Org');
select pg_temp.login('aa@x.test', 'aal2');
select pg_temp.check('an admin cannot bring it back', pg_temp.err(format('select public.restore_organisation(%L)', (select id from o))), '42501');
select pg_temp.login('ao@x.test', 'aal2');
select public.restore_organisation((select id from o));
select pg_temp.check('the owner brings it back', (select private.is_member((select id from o))::text), 'true');

-- After 14 days deleted rows are removed for good.
reset role;
update public.companies set deleted_at = now() - interval '15 days' where name = 'Old Co';
update public.companies set deleted_at = now() - interval '13 days' where name = 'Older Co';
select private.purge_deleted();
select pg_temp.check('older than 14 days is removed, newer is kept', (select string_agg(name, ',' order by name) from public.companies where name in ('Old Co', 'Older Co')), 'Older Co');

select pg_temp.check('visitors cannot run the access functions', (select bool_or(has_function_privilege('anon', p.oid, 'execute'))::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('my_invites', 'accept_invite', 'decline_invite', 'transfer_ownership', 'deleted_items', 'restore_company', 'restore_organisation', 'reset_member_mfa')), 'false');

-- Review fixes.
reset role;
insert into public.companies (org_id, name) values ((select id from o), 'Kept Co'), ((select id from o), 'Linked Co');
select pg_temp.login('aa@x.test', 'aal2');
select pg_temp.check('a company cannot be deleted straight from the table', pg_temp.err(format('delete from public.companies where name = %L', 'Kept Co')) || ' ' || (select count(*)::text from public.companies where name = 'Kept Co'), '42501 1');
select pg_temp.check('nobody is added without an invitation', pg_temp.err(format('insert into public.memberships (org_id, user_id, role) values (%L, %L, %L)', (select id from o), pg_temp.uid('late@x.test'), 'admin')), '42501');
insert into public.invites (org_id, email, role) values ((select id from o), 'swap@x.test', 'viewer');
select pg_temp.check('an invitation keeps its email address', pg_temp.err(format('update public.invites set email = %L where email = %L', 'other@x.test', 'swap@x.test')), '42501');
update public.invites set expires_at = now() + interval '1 year' where email = 'swap@x.test';
select pg_temp.check('an invitation stays open at most 14 days', (select (expires_at <= now() + interval '14 days 1 minute')::text from public.invites where email = 'swap@x.test'), 'true');

-- Deleting needs a password sign-in from the last 10 minutes; a two-step code alone is not one.
select pg_temp.login('aa@x.test', 'aal2', 1200);
select pg_temp.check('an old sign-in cannot delete a company', pg_temp.msg(format('select public.delete_company(%L, %L)', (select id from public.companies where name = 'Kept Co'), 'Kept Co')), 'Please confirm your password and try again.');
select pg_temp.login('aa@x.test', 'aal2', 0, 'totp');
select pg_temp.check('a code alone is not a fresh sign-in', pg_temp.err(format('select public.delete_company(%L, %L)', (select id from public.companies where name = 'Kept Co'), 'Kept Co')), '42501');
select pg_temp.login('ao@x.test', 'aal2', 1200);
select pg_temp.check('removing a person needs a fresh sign-in', pg_temp.err(format('delete from public.memberships where org_id = %L and user_id = %L', (select id from o), pg_temp.uid('ai@x.test'))), '42501');

-- Once two-step sign-in is on, a password-only session opens nothing.
reset role;
insert into auth.mfa_factors (user_id, status) values (pg_temp.uid('ae@x.test'), 'verified');
select pg_temp.login('ae@x.test', 'aal1');
select pg_temp.check('with two-step on, a password-only session sees no companies', (select count(*)::text from public.companies where org_id = (select id from o)), '0');
select pg_temp.check('nor can it delete the account', pg_temp.err(format('select public.delete_my_account(%L)', 'ae@x.test')), '42501');
select pg_temp.login('ae@x.test', 'aal2');
select pg_temp.check('after the code it sees them', ((select count(*) from public.companies where org_id = (select id from o)) > 0)::text, 'true');
reset role;
delete from auth.mfa_factors where user_id = pg_temp.uid('ae@x.test');

-- A deleted company's share link stops, and its background imports stop.
insert into public.reports (company_id, period_end, status, share_token) values ((select id from public.companies where name = 'Linked Co'), '2026-09', 'published', 'tok-linked-co-0000000000000');
insert into public.import_jobs (company_id, kind, mode, status) values ((select id from public.companies where name = 'Linked Co'), 'inventory', 'replace', 'queued');
select pg_temp.check('the link works before', (public.get_published_report('tok-linked-co-0000000000000') is not null)::text, 'true');
select pg_temp.login('aa@x.test', 'aal2');
select public.delete_company((select id from public.companies where name = 'Linked Co'), 'Linked Co');
reset role;
select pg_temp.check('a deleted company''s link stops', (public.get_published_report('tok-linked-co-0000000000000') is null)::text || ' ' || public.rate_limit_link('tok-linked-co-0000000000000')::text, 'true false');
select pg_temp.check('its background imports stop', (select status from public.import_jobs where company_id = (select id from public.companies where name = 'Linked Co')), 'cancelled');

-- The owner resets two-step sign-in only for people who belong to the owner's organisations alone.
insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('elsewhere@x.test', '{"org_name":"Other Org"}', now());
insert into uids select email, id from auth.users where email = 'elsewhere@x.test';
insert into public.memberships (org_id, user_id, role) values ((select id from o), pg_temp.uid('elsewhere@x.test'), 'editor');
insert into public.memberships (org_id, user_id, role) select org_id, pg_temp.uid('ae@x.test'), 'viewer' from public.memberships where user_id = pg_temp.uid('elsewhere@x.test') and org_id <> (select id from o);
select pg_temp.login('ao@x.test', 'aal2');
select pg_temp.check('the owner cannot reset someone who belongs to another organisation', pg_temp.err(format('select public.reset_member_mfa(%L, %L)', (select id from o), pg_temp.uid('ae@x.test'))), '42501');

-- A person with an open invitation can still delete their account; the invitation is marked declined.
select pg_temp.login('aa@x.test', 'aal2');
insert into public.invites (org_id, email, role) values ((select id from o), 'elsewhere@x.test', 'viewer');
reset role;
delete from public.memberships where user_id = pg_temp.uid('ae@x.test') and org_id in (select org_id from public.memberships where user_id = pg_temp.uid('elsewhere@x.test') and org_id <> (select id from o));
delete from public.memberships where user_id = pg_temp.uid('elsewhere@x.test') and org_id = (select id from o);
select pg_temp.login('elsewhere@x.test');
select pg_temp.check('an open invitation does not stop account deletion', pg_temp.msg(format('select public.delete_my_account(%L)', 'elsewhere@x.test')), 'none');
reset role;
select pg_temp.check('and it is marked declined', (select (declined_at is not null)::text from public.invites where email = 'elsewhere@x.test'), 'true');

-- A deleted organisation's stored files can be removed by its owner (the app removes them right after deleting).
reset role;
create temp table kept as select id from public.companies where name = 'Kept Co';
grant select on kept to authenticated;
select pg_temp.login('ao@x.test', 'aal2');
select public.delete_organisation((select id from o), 'Acc Org');
select pg_temp.check('the owner can remove a deleted organisation''s files', private.import_file_removable((select id from kept)::text || '/job/file.xlsx')::text, 'true');
select pg_temp.login('aa@x.test', 'aal2');
select pg_temp.check('an admin cannot', private.import_file_removable((select id from kept)::text || '/job/file.xlsx')::text, 'false');
delete from public.organizations where id = (select id from o);
