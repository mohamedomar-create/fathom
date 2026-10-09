-- 0004: make a fresh rebuild match production, harden the import RPC and fix invites.

-- Import: SECURITY DEFINER so per-row RLS checks don't eat the statement timeout on big imports.
-- Access is enforced explicitly by the editor check on the first line.
create or replace function public.replace_company_data(p_company uuid, p_accounts jsonb, p_import jsonb default '{}'::jsonb, p_notes jsonb default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version int;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_accounts) <> 'array' or jsonb_array_length(p_accounts) = 0 then
    raise exception 'no accounts supplied';
  end if;
  if jsonb_array_length(p_accounts) > 5000 then
    raise exception 'too many accounts';
  end if;

  update public.companies
     set data_version = data_version + 1, last_synced_at = now(), notes = coalesce(p_notes, notes)
   where id = p_company
  returning data_version into v_version;

  with src as (
    select a, ord from jsonb_array_elements(p_accounts) with ordinality as t(a, ord)
  ), ins as (
    insert into public.source_accounts (company_id, version, code, name, statement, class, odoo_id, odoo_type, confidence, mapped_by, sort_order)
    select p_company, v_version, coalesce(a ->> 'code', ''), a ->> 'name', a ->> 'statement', a ->> 'class',
           nullif(a ->> 'odoo_id', '')::int, a ->> 'odoo_type', nullif(a ->> 'confidence', '')::real,
           coalesce(a ->> 'mapped_by', 'auto'), ord::int
    from src
    returning id, sort_order
  )
  insert into public.account_balances (account_id, company_id, period, amount)
  select ins.id, p_company, kv.key, (kv.value)::numeric
  from ins join src on src.ord = ins.sort_order
  cross join lateral jsonb_each_text(src.a -> 'amounts') kv
  where kv.value is not null and (kv.value)::numeric <> 0;

  insert into public.imports (company_id, kind, filename, report, created_by)
  values (p_company, coalesce(p_import ->> 'kind', 'upload'), p_import ->> 'filename', coalesce(p_import -> 'report', '{}'::jsonb), (select auth.uid()));

  return v_version;
end $$;

create or replace function public.reclassify_accounts(p_company uuid, p_changes jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare v int;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.source_accounts s
     set class = c.value ->> 'class', mapped_by = 'user',
         statement = case when c.value ->> 'class' in ('revenue','cos_variable','cos_fixed','cos_depreciation','exp_variable','exp_fixed','exp_depreciation','other_income','other_expenses','interest_income','interest_expenses','tax_expenses','adjustments','dividends') then 'PL' else 'BS' end
    from jsonb_each(p_changes) c
   where s.company_id = p_company and s.id = (c.key)::uuid;
  get diagnostics v = row_count;
  return v;
end $$;

revoke execute on function public.replace_company_data(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.reclassify_accounts(uuid, jsonb) from public, anon;
grant execute on function public.replace_company_data(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.reclassify_accounts(uuid, jsonb) to authenticated;

-- Re-inviting an address upserts the existing row, which needs an UPDATE policy.
create policy inv_update on public.invites for update to authenticated
  using (private.is_member(org_id, 'admin')) with check (private.is_member(org_id, 'admin'));

-- Invites are claimed only once the email address is confirmed.
create or replace function private.claim_invites(p_user uuid, p_email text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v int;
begin
  insert into public.memberships (org_id, user_id, role)
  select i.org_id, p_user, i.role from public.invites i where i.email = lower(p_email) and i.accepted_at is null
  on conflict do nothing;
  get diagnostics v = row_count;
  update public.invites set accepted_at = now() where email = lower(p_email) and accepted_at is null;
  return v;
end $$;
revoke execute on function private.claim_invites(uuid, text) from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_invited boolean;
  v_org_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''),
                              coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)) || '''s organisation');
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;

  v_invited := exists (select 1 from public.invites i where i.email = lower(new.email) and i.accepted_at is null);
  if v_invited and new.email_confirmed_at is not null then
    perform private.claim_invites(new.id, new.email);
  elsif not v_invited then
    insert into public.organizations (name, created_by) values (left(v_org_name, 120), new.id) returning id into v_org;
    insert into public.memberships (org_id, user_id, role) values (v_org, new.id, 'admin');
  end if;
  return new;
end $$;

create or replace function public.handle_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.claim_invites(new.id, new.email);
  return new;
end $$;
revoke execute on function public.handle_user_confirmed() from public, anon, authenticated;

create or replace trigger on_auth_user_confirmed after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- Existing (already confirmed) users accept invites sent after they signed up.
create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_email text;
begin
  select u.email into v_email from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  return private.claim_invites((select auth.uid()), v_email);
end $$;
revoke execute on function public.accept_pending_invites() from public, anon;
grant execute on function public.accept_pending_invites() to authenticated;
