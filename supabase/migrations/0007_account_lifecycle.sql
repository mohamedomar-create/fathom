-- 0007: people control their own data
-- * leave an organisation, delete an organisation, delete your account
-- * nobody is ever left without an organisation to work in, and no shared organisation is left without an admin

-- A user with no organisation gets a fresh one (the same shape sign-up creates).
create or replace function private.ensure_home_org(p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_name text;
begin
  select org_id into v_org from public.memberships where user_id = p_user order by created_at limit 1;
  if found then return v_org; end if;
  select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) || '''s organisation' into v_name
    from public.profiles p where p.id = p_user;
  insert into public.organizations (name, created_by) values (left(coalesce(v_name, 'My organisation'), 120), p_user) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, p_user, 'admin');
  return v_org;
end $$;
revoke execute on function private.ensure_home_org(uuid) from public, anon, authenticated;

-- Leave an organisation you belong to. The last admin of a shared organisation is refused by the keep_an_admin trigger.
create or replace function public.leave_organisation(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not exists (select 1 from public.memberships where org_id = p_org and user_id = v_user) then
    raise exception 'You are not a member of this organisation.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.memberships where org_id = p_org and user_id <> v_user) then
    raise exception 'You are the only member. Delete the organisation instead.' using errcode = 'P0001';
  end if;
  delete from public.memberships where org_id = p_org and user_id = v_user;
  perform private.ensure_home_org(v_user);
end $$;

-- Delete an organisation and everything in it (companies, data, reports, invites). Admins only; the name must match.
create or replace function public.delete_organisation(p_org uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_name text;
begin
  if v_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select name into v_name from public.organizations where id = p_org;
  if not found or not exists (select 1 from public.memberships where org_id = p_org and user_id = v_user and role = 'admin') then
    raise exception 'Only admins can delete this organisation.' using errcode = '42501';
  end if;
  if p_name is null or trim(p_name) <> v_name then
    raise exception 'The name you typed does not match the organisation name.' using errcode = 'P0001';
  end if;
  delete from public.organizations where id = p_org;
  perform private.ensure_home_org(v_user);
end $$;

-- Delete your own account. Organisations where you are the only member go with it;
-- a shared organisation where you are the last admin must be handed over (or deleted) first.
create or replace function public.delete_my_account(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_blocking text;
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
     and not exists (select 1 from public.memberships x where x.org_id = m.org_id and x.user_id <> v_user and x.role = 'admin');
  if v_blocking is not null then
    raise exception 'Make someone else an admin of % first, or delete it.', v_blocking using errcode = 'P0001';
  end if;
  delete from public.organizations o
   where exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id = v_user)
     and not exists (select 1 from public.memberships m where m.org_id = o.id and m.user_id <> v_user);
  delete from public.invites where email = v_email and accepted_at is null;
  delete from auth.users where id = v_user;
end $$;

revoke execute on function public.leave_organisation(uuid) from public, anon;
revoke execute on function public.delete_organisation(uuid, text) from public, anon;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.leave_organisation(uuid) to authenticated;
grant execute on function public.delete_organisation(uuid, text) to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
