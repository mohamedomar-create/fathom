-- 0039: access.
--  * Invites wait for the person to accept or decline them, and expire after 14 days (nobody joins by signing in).
--  * Each organisation has one owner: never removed or demoted, hands over only to an admin, alone deletes it.
--  * Every people change (members, roles, invites, owner, deletes) is recorded in org_audit; admins read it.
--  * Admins need two-step sign-in (an authenticator code) for admin actions once their 7-day grace period has ended.
--  * A deleted company or organisation is hidden at once and can be brought back for 14 days, then removed for good.
-- Adds columns, functions and triggers; safe to run again. Needs 0038.
set client_min_messages = warning;
set lock_timeout = '5s';

-- ---------------------------------------------------------------- columns
alter table public.invites add column if not exists expires_at timestamptz;
alter table public.invites add column if not exists declined_at timestamptz;
update public.invites set expires_at = created_at + interval '14 days' where expires_at is null;
alter table public.invites alter column expires_at set default now() + interval '14 days';
alter table public.invites alter column expires_at set not null;
alter table public.organizations add column if not exists owner_id uuid references auth.users (id) on delete set null;
alter table public.organizations add column if not exists deleted_at timestamptz;
alter table public.companies add column if not exists deleted_at timestamptz;
-- Everyone already here has 7 days from today to turn on two-step sign-in; new people 7 days from joining.
alter table public.profiles add column if not exists mfa_required_from timestamptz not null default now() + interval '7 days';
update public.organizations o set owner_id = (select m.user_id from public.memberships m where m.org_id = o.id and m.role = 'admin' order by m.created_at, m.user_id limit 1)
  where owner_id is null;

-- ---------------------------------------------------------------- the audit log
create table if not exists public.org_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  actor uuid default auth.uid(),
  action text not null,
  target text not null default '',
  target_user uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists org_audit_org on public.org_audit (org_id, at desc);
alter table public.org_audit enable row level security;
drop policy if exists org_audit_read on public.org_audit;
create policy org_audit_read on public.org_audit for select to authenticated using (private.is_member(org_id, 'admin'));
revoke all on public.org_audit from anon, authenticated;
grant select on public.org_audit to authenticated;

create or replace function private.audit_org(p_org uuid, p_action text, p_target text, p_user uuid, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.org_audit (org_id, action, target, target_user, detail) values (p_org, p_action, coalesce(p_target, ''), p_user, coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------- two-step sign-in
-- Raises for a signed-in caller without a two-step sign-in in this session once their grace period has ended. Work the
-- database does by itself (no caller) is never stopped.
create or replace function private.require_aal2()
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz;
begin
  if (select auth.uid()) is null or coalesce(auth.jwt() ->> 'aal', '') = 'aal2' then return; end if;
  select mfa_required_from into v_from from public.profiles where id = (select auth.uid());
  if v_from is null or now() < v_from then return; end if;
  raise exception 'Turn on two-step sign-in (Account, Security) to do this.' using errcode = '42501', hint = 'mfa_required';
end $$;

-- Admin actions are those that leave a record: the record's own trigger asks for two-step sign-in, so no path around it.
create or replace function private.org_audit_mfa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action in ('role_changed', 'member_removed', 'invite_sent', 'invite_resent', 'invite_cancelled', 'owner_changed', 'org_deleted', 'org_restored', 'mfa_reset')
     or (new.action = 'member_added' and new.target_user is distinct from new.actor) then
    perform private.require_aal2();
  end if;
  return new;
end $$;
drop trigger if exists org_audit_mfa on public.org_audit;
create trigger org_audit_mfa after insert on public.org_audit for each row execute function private.org_audit_mfa();

create or replace function private.company_audit_mfa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action in ('clear_all', 'delete_company', 'transfer_company', 'restore_company') then perform private.require_aal2(); end if;
  return new;
end $$;
alter table public.company_data_audit drop constraint if exists company_data_audit_action_check;
alter table public.company_data_audit add constraint company_data_audit_action_check
  check (action in ('clear_module', 'clear_all', 'delete_company', 'transfer_company', 'restore_company'));
drop trigger if exists company_audit_mfa on public.company_data_audit;
create trigger company_audit_mfa after insert on public.company_data_audit for each row execute function private.company_audit_mfa();

create or replace function private.cash_clear_mfa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.action = 'clear' then perform private.require_aal2(); end if;
  return new;
end $$;
drop trigger if exists cash_clear_mfa on public.cash_entry_history;
create trigger cash_clear_mfa after insert on public.cash_entry_history for each row execute function private.cash_clear_mfa();

create or replace function private.odoo_key_mfa() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.api_key_enc, '') <> '' and (tg_op = 'INSERT' or new.api_key_enc is distinct from old.api_key_enc) then perform private.require_aal2(); end if;
  return new;
end $$;
drop trigger if exists odoo_key_mfa on public.odoo_connections;
create trigger odoo_key_mfa before insert or update of api_key_enc on public.odoo_connections for each row execute function private.odoo_key_mfa();

-- ---------------------------------------------------------------- membership: deleted organisations, owners
create or replace function private.is_member(o uuid, min_role public.member_role default 'viewer')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.organizations g on g.id = m.org_id and g.deleted_at is null
    where m.org_id = o and m.user_id = (select auth.uid())
      and case min_role when 'viewer' then true
                        when 'editor' then m.role in ('editor', 'admin')
                        else m.role = 'admin' end
  );
$$;

create or replace function private.company_org(c uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.companies where id = c and deleted_at is null;
$$;

drop policy if exists co_select on public.companies;
create policy co_select on public.companies for select to authenticated using (deleted_at is null and private.is_member(org_id));
drop policy if exists co_update on public.companies;
create policy co_update on public.companies for update to authenticated
  using (deleted_at is null and private.is_member(org_id, 'editor')) with check (deleted_at is null and private.is_member(org_id, 'editor'));

-- Owner and deleted marks change only through the functions below.
create or replace function private.org_marks_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and (new.owner_id is distinct from old.owner_id or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists org_marks_guard on public.organizations;
create trigger org_marks_guard before update on public.organizations for each row execute function private.org_marks_guard();
create or replace function private.company_marks_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.deleted_at is distinct from old.deleted_at then raise exception 'not allowed' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists company_marks_guard on public.companies;
create trigger company_marks_guard before update on public.companies for each row execute function private.company_marks_guard();

-- The first admin of an organisation without an owner becomes its owner (sign-up, a new organisation).
create or replace function private.first_admin_owns() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'admin' then update public.organizations set owner_id = new.user_id where id = new.org_id and owner_id is null; end if;
  return new;
end $$;
drop trigger if exists memberships_first_owner on public.memberships;
create trigger memberships_first_owner after insert on public.memberships for each row execute function private.first_admin_owns();

-- An organisation keeps an admin, and its owner stays an admin member until ownership is handed over.
create or replace function private.keep_an_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'admin' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.role = 'admin' then return new; end if;
  if not exists (select 1 from public.organizations where id = old.org_id) then return coalesce(new, old); end if;
  if not exists (select 1 from auth.users where id = old.user_id) then return coalesce(new, old); end if;
  if exists (select 1 from public.organizations where id = old.org_id and owner_id = old.user_id) then
    raise exception 'Hand the organisation to another admin first.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.memberships where org_id = old.org_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'an organisation needs at least one admin';
  end if;
  return coalesce(new, old);
end $$;

-- People changes go to the record.
create or replace function private.memberships_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(new.org_id, old.org_id); v_user uuid := coalesce(new.user_id, old.user_id); v_email text;
begin
  if not exists (select 1 from public.organizations where id = v_org) then return null; end if;
  select email into v_email from public.profiles where id = v_user;
  if tg_op = 'INSERT' then perform private.audit_org(v_org, 'member_added', v_email, v_user, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role then perform private.audit_org(v_org, 'role_changed', v_email, v_user, jsonb_build_object('from', old.role, 'to', new.role)); end if;
  elsif v_user = (select auth.uid()) then perform private.audit_org(v_org, 'member_left', v_email, v_user, '{}');
  elsif exists (select 1 from auth.users where id = v_user) then perform private.audit_org(v_org, 'member_removed', v_email, v_user, jsonb_build_object('role', old.role));
  end if;
  return null;
end $$;
drop trigger if exists memberships_audit on public.memberships;
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function private.memberships_audit();

create or replace function private.invites_audit() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid := coalesce(new.org_id, old.org_id);
begin
  if not exists (select 1 from public.organizations where id = v_org) then return null; end if;
  if tg_op = 'INSERT' then perform private.audit_org(v_org, 'invite_sent', new.email, null, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' then
    if new.accepted_at is not null and old.accepted_at is null then perform private.audit_org(v_org, 'invite_accepted', new.email, null, '{}');
    elsif new.declined_at is not null and old.declined_at is null then perform private.audit_org(v_org, 'invite_declined', new.email, null, '{}');
    elsif new.expires_at is distinct from old.expires_at or new.role is distinct from old.role then
      perform private.audit_org(v_org, 'invite_resent', new.email, null, jsonb_build_object('role', new.role));
    end if;
  elsif old.accepted_at is null and old.declined_at is null then perform private.audit_org(v_org, 'invite_cancelled', old.email, null, '{}');
  end if;
  return null;
end $$;
drop trigger if exists invites_audit on public.invites;
create trigger invites_audit after insert or update or delete on public.invites for each row execute function private.invites_audit();

-- ---------------------------------------------------------------- invites: asked, never automatic
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_org_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''),
                              coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)) || '''s organisation');
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;
  -- Everyone starts with an organisation of their own; invitations wait on the Companies page to be accepted.
  insert into public.organizations (name, created_by) values (left(v_org_name, 120), new.id) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, new.id, 'admin');
  return new;
end $$;

create or replace function public.handle_user_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  return new;
end $$;

-- Kept for older pages; nobody joins without answering.
create or replace function public.accept_pending_invites()
returns integer language sql security definer set search_path = '' as $$ select 0 $$;

create or replace function public.my_invites()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'org_name', g.name, 'role', i.role, 'expires_at', i.expires_at,
           'invited_by', coalesce(nullif(p.full_name, ''), p.email, '')) order by i.created_at), '[]'::jsonb)
  from public.invites i
  join public.organizations g on g.id = i.org_id and g.deleted_at is null
  join auth.users u on u.id = (select auth.uid()) and u.email_confirmed_at is not null and lower(u.email) = i.email
  left join public.profiles p on p.id = i.invited_by
  where i.accepted_at is null and i.declined_at is null and i.expires_at > now();
$$;

create or replace function private.my_invite(p_id uuid) returns public.invites language plpgsql security definer set search_path = '' as $$
declare r public.invites;
begin
  select i.* into r from public.invites i join auth.users u on u.id = (select auth.uid()) and u.email_confirmed_at is not null and lower(u.email) = i.email
   where i.id = p_id for update of i;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if r.accepted_at is not null or r.declined_at is not null or r.expires_at <= now()
     or not exists (select 1 from public.organizations where id = r.org_id and deleted_at is null) then
    raise exception 'This invitation is no longer open. Ask for a new one.' using errcode = '22023';
  end if;
  return r;
end $$;

create or replace function public.accept_invite(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.invites := private.my_invite(p_id);
begin
  insert into public.memberships (org_id, user_id, role) values (r.org_id, (select auth.uid()), r.role) on conflict do nothing;
  update public.invites set accepted_at = now() where id = p_id;
  return r.org_id;
end $$;

create or replace function public.decline_invite(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.invites := private.my_invite(p_id);
begin
  update public.invites set declined_at = now() where id = r.id;
end $$;

-- ---------------------------------------------------------------- the owner
create or replace function public.transfer_ownership(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations where id = p_org and deleted_at is null and owner_id = (select auth.uid())) then
    raise exception 'Only the owner can hand the organisation over.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user and role = 'admin') then
    raise exception 'Make them an admin first.' using errcode = '22023';
  end if;
  update public.organizations set owner_id = p_user where id = p_org;
  perform private.audit_org(p_org, 'owner_changed', (select email from public.profiles where id = p_user), p_user, '{}');
end $$;

-- The owner can remove a member's two-step sign-in (a lost phone); they set it up again at their next sign-in.
create or replace function public.reset_member_mfa(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations where id = p_org and deleted_at is null and owner_id = (select auth.uid())) then
    raise exception 'Only the owner can do this.' using errcode = '42501';
  end if;
  if p_user = (select auth.uid()) or not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.audit_org(p_org, 'mfa_reset', (select email from public.profiles where id = p_user), p_user, '{}');
  if to_regclass('auth.mfa_factors') is not null then execute 'delete from auth.mfa_factors where user_id = $1' using p_user; end if;
end $$;

-- ---------------------------------------------------------------- deleting, bringing back, removing for good
create or replace function private.ensure_home_org(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_name text;
begin
  select m.org_id into v_org from public.memberships m join public.organizations g on g.id = m.org_id and g.deleted_at is null
   where m.user_id = p_user order by m.created_at limit 1;
  if found then return v_org; end if;
  select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) || '''s organisation' into v_name from public.profiles p where p.id = p_user;
  insert into public.organizations (name, created_by) values (left(coalesce(v_name, 'My organisation'), 120), p_user) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, p_user, 'admin');
  return v_org;
end $$;

create or replace function public.delete_company(p_company uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.company_org(p_company); v_name text; v_preview jsonb;
begin
  if v_org is null or not private.is_member(v_org, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  select name into v_name from public.companies where id = p_company for update;
  if v_name is distinct from p_name then raise exception 'the name typed does not match the company' using errcode = '22023'; end if;
  v_preview := public.data_reset_preview(p_company);
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope, counts)
  values (v_org, p_company, v_name, 'delete_company', 'company',
          (select coalesce(jsonb_object_agg(key, value -> 'tables'), '{}'::jsonb) from jsonb_each(v_preview -> 'modules')) || jsonb_build_object('files', jsonb_array_length(v_preview -> 'files')));
  -- Hidden at once; removed for good after 14 days unless brought back. Its background work stops (nothing can change
  -- while it is deleted, so its summaries stay as they are for a restore).
  update public.companies set deleted_at = now() where id = p_company;
  delete from private.inventory_marks where company_id = p_company;
  delete from private.summary_marks where company_id = p_company;
  return v_preview -> 'modules';
end $$;

-- A deleted company's stored files: its editors while it is live; once deleted, the admins who can see the record.
create or replace function private.import_file_removable(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_seg text := split_part(p_name, '/', 1); v_company uuid;
begin
  if v_seg !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_company := v_seg::uuid;
  if exists (select 1 from public.companies where id = v_company and deleted_at is null) then
    return private.is_member(private.company_org(v_company), 'editor');
  end if;
  return exists (select 1 from public.company_data_audit a where a.company_id = v_company and a.action = 'delete_company' and private.is_member(a.org_id, 'admin'));
end $$;

create or replace function public.delete_organisation(p_org uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_name text;
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select name into v_name from public.organizations where id = p_org and deleted_at is null and owner_id = v_user for update;
  if not found then raise exception 'Only the owner can delete this organisation.' using errcode = '42501'; end if;
  if p_name is null or trim(p_name) <> v_name then
    raise exception 'The name you typed does not match the organisation name.' using errcode = 'P0001';
  end if;
  perform private.audit_org(p_org, 'org_deleted', v_name, null, '{}');
  update public.organizations set deleted_at = now() where id = p_org;
  perform private.ensure_home_org(v_user);
end $$;

-- Companies deleted in the caller's organisations (admins), and organisations the caller owns, from the last 14 days.
create or replace function public.deleted_items()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'org_name', g.name, 'deleted_at', c.deleted_at) order by c.deleted_at desc)
       from public.companies c join public.organizations g on g.id = c.org_id
      where c.deleted_at > now() - interval '14 days' and private.is_member(c.org_id, 'admin')), '[]'::jsonb),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'deleted_at', g.deleted_at) order by g.deleted_at desc)
       from public.organizations g where g.owner_id = (select auth.uid()) and g.deleted_at > now() - interval '14 days'), '[]'::jsonb));
$$;

create or replace function public.restore_company(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.companies;
begin
  select * into r from public.companies where id = p_company and deleted_at > now() - interval '14 days' for update;
  if not found or not private.is_member(r.org_id, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.companies set deleted_at = null where id = p_company;
  insert into public.company_data_audit (org_id, company_id, company_name, action, scope) values (r.org_id, p_company, r.name, 'restore_company', 'company');
end $$;

create or replace function public.restore_organisation(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select name into v_name from public.organizations where id = p_org and owner_id = (select auth.uid()) and deleted_at > now() - interval '14 days' for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.organizations set deleted_at = null where id = p_org;
  perform private.audit_org(p_org, 'org_restored', v_name, null, '{}');
end $$;

create or replace function private.purge_deleted()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_c integer; v_o integer;
begin
  delete from public.companies where deleted_at < now() - interval '14 days';
  get diagnostics v_c = row_count;
  delete from public.organizations where deleted_at < now() - interval '14 days';
  get diagnostics v_o = row_count;
  return v_c + v_o;
end $$;

-- Deleting your account stays immediate. The owner of a shared organisation hands it over first.
create or replace function public.delete_my_account(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_email text; v_blocking text;
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_user;
  if p_email is null or lower(trim(p_email)) <> v_email then
    raise exception 'The email you typed does not match your account.' using errcode = 'P0001';
  end if;
  select string_agg(o.name, ', ' order by o.name) into v_blocking
    from public.memberships m join public.organizations o on o.id = m.org_id
   where m.user_id = v_user and m.role = 'admin'
     and exists (select 1 from public.memberships x where x.org_id = m.org_id and x.user_id <> v_user)
     and (o.owner_id = v_user or not exists (select 1 from public.memberships x where x.org_id = m.org_id and x.user_id <> v_user and x.role = 'admin'));
  if v_blocking is not null then
    raise exception 'Hand % to another admin first, or delete it.', v_blocking using errcode = 'P0001';
  end if;
  delete from public.organizations o
   where exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id = v_user)
     and not exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id <> v_user);
  delete from public.invites where email = v_email and accepted_at is null;
  delete from auth.users where id = v_user;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ireport-purge-deleted';
    perform cron.schedule('ireport-purge-deleted', '17 3 * * *', 'select private.purge_deleted()');
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function private.audit_org(uuid, text, text, uuid, jsonb), private.require_aal2(), private.purge_deleted(),
  private.my_invite(uuid), private.org_audit_mfa(), private.company_audit_mfa(), private.cash_clear_mfa(), private.odoo_key_mfa(),
  private.org_marks_guard(), private.company_marks_guard(), private.first_admin_owns(), private.memberships_audit(), private.invites_audit()
  from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['public.my_invites()', 'public.accept_invite(uuid)', 'public.decline_invite(uuid)', 'public.transfer_ownership(uuid, uuid)',
    'public.reset_member_mfa(uuid, uuid)', 'public.deleted_items()', 'public.restore_company(uuid)', 'public.restore_organisation(uuid)',
    'public.accept_pending_invites()', 'public.delete_company(uuid, text)', 'public.delete_organisation(uuid, text)', 'public.delete_my_account(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$ begin if to_regprocedure('private.install_tenant_guards()') is not null then perform private.install_tenant_guards(); end if; end $$;
