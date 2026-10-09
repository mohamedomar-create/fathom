-- Applied as 0002a..0002d. Versioned accounts: imports write a new version; the app removes older versions afterwards.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger companies_touch before update on public.companies for each row execute function public.touch_updated_at();
create trigger reports_touch before update on public.reports for each row execute function public.touch_updated_at();
create trigger odoo_touch before update on public.odoo_connections for each row execute function public.touch_updated_at();

alter table public.source_accounts add column version integer not null default 0;
create index source_accounts_company_version_idx on public.source_accounts (company_id, version);
alter table public.invites add column accepted_at timestamptz;

-- Imports write a new version of the chart of accounts; the app removes older versions after commit.
create or replace function public.replace_company_data(
  p_company uuid, p_accounts jsonb, p_import jsonb default '{}'::jsonb, p_notes jsonb default null
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_version int;
begin
  if not public.is_member(public.company_org(p_company), 'editor') then
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
returns integer language plpgsql security invoker set search_path = '' as $$
declare v int;
begin
  if not public.is_member(public.company_org(p_company), 'editor') then
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

create or replace function public.get_published_report(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  c public.companies;
  o public.organizations;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published';
  if not found then return null; end if;
  select * into c from public.companies where id = r.company_id;
  select * into o from public.organizations where id = c.org_id;
  return jsonb_build_object(
    'report', to_jsonb(r) - 'created_by',
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'currency', c.currency, 'fy_start_month', c.fy_start_month,
                                  'tax_rate', c.tax_rate, 'kpi_config', c.kpi_config, 'notes', c.notes, 'source', c.source),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url, 'brand_colour', o.brand_colour, 'disclaimer', o.disclaimer, 'report_footer', o.report_footer),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statement', s.statement, 'class', s.class,
                          'amounts', coalesce((select jsonb_object_agg(b.period, b.amount) from public.account_balances b where b.account_id = s.id), '{}'::jsonb)) order by s.sort_order)
                          from public.source_accounts s where s.company_id = c.id and s.version = c.data_version), '[]'::jsonb),
    'commentary', coalesce((select jsonb_object_agg(cm.section, cm.body) from public.commentary cm
                            where cm.company_id = c.id and cm.period_key = r.period_type || ':' || r.period_end), '{}'::jsonb)
  );
end $$;
grant execute on function public.get_published_report(text) to anon, authenticated;

-- New user: profile, claim pending invites, otherwise create a personal organisation.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_claimed int;
  v_org_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'org_name'), ''),
                              coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)) || '''s organisation');
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
  on conflict (id) do nothing;

  insert into public.memberships (org_id, user_id, role)
  select i.org_id, new.id, i.role from public.invites i where i.email = lower(new.email) and i.accepted_at is null
  on conflict do nothing;
  get diagnostics v_claimed = row_count;
  update public.invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;

  if v_claimed = 0 then
    insert into public.organizations (name, created_by) values (left(v_org_name, 120), new.id) returning id into v_org;
    insert into public.memberships (org_id, user_id, role) values (v_org, new.id, 'admin');
  end if;
  return new;
end $$;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
