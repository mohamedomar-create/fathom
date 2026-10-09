-- Core schema: organisations (advisory firms) → companies (clients) → mapped GL accounts with monthly balances.
-- Every table has RLS; membership is checked through security-definer helpers.

create type public.member_role as enum ('admin', 'editor', 'viewer');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  logo_url text,
  brand_colour text check (brand_colour is null or brand_colour ~ '^#[0-9A-Fa-f]{6}$'),
  disclaimer text not null default 'This report has been prepared from unaudited financial information provided by management. No opinion is expressed on its accuracy.',
  report_footer text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (email = lower(email)),
  role public.member_role not null default 'editor',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  currency text not null default 'EGP' check (char_length(currency) between 1 and 6),
  fy_start_month smallint not null default 1 check (fy_start_month between 1 and 12),
  tax_rate numeric(6, 4) not null default 0.225 check (tax_rate >= 0 and tax_rate < 1),
  source text not null default 'upload' check (source in ('upload', 'odoo', 'demo')),
  industry text,
  ai_context jsonb not null default '{}'::jsonb,
  -- {kpi_key: {active, importance, target, alert_active, alert_threshold}}
  kpi_config jsonb not null default '{}'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  data_version integer not null default 0,
  last_synced_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index companies_org_idx on public.companies (org_id);

-- One row per GL account. class is one of the 30 standard classes.
create table public.source_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null default '',
  name text not null,
  statement text not null check (statement in ('PL', 'BS')),
  class text not null,
  odoo_id integer,
  odoo_type text,
  confidence real,
  mapped_by text not null default 'auto' check (mapped_by in ('auto', 'user', 'system')),
  sort_order integer not null default 0
);
create index source_accounts_company_idx on public.source_accounts (company_id);

-- Raw debit-positive amounts. P&L accounts: movement for the month. BS accounts: closing balance at month end.
create table public.account_balances (
  account_id uuid not null references public.source_accounts (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount numeric(18, 2) not null,
  primary key (account_id, period)
);
create index account_balances_company_idx on public.account_balances (company_id);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('upload', 'odoo', 'demo')),
  filename text,
  status text not null default 'committed',
  report jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index imports_company_idx on public.imports (company_id, created_at desc);

create table public.odoo_connections (
  company_id uuid primary key references public.companies (id) on delete cascade,
  url text not null,
  db text not null,
  login text not null,
  api_key_enc text not null,
  odoo_company_id integer,
  odoo_company_name text,
  include_branches boolean not null default false,
  months_history smallint not null default 25 check (months_history between 2 and 60),
  version text,
  status text not null default 'new',
  last_error text,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.commentary (
  company_id uuid not null references public.companies (id) on delete cascade,
  period_key text not null,
  section text not null,
  body text not null,
  source text not null default 'user' check (source in ('user', 'ai')),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, period_key, section)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null default 'Monthly Performance Report',
  period_type text not null default 'month' check (period_type in ('month', 'quarter', 'year')),
  period_end text not null check (period_end ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  sections jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  share_token text unique,
  published_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reports_company_idx on public.reports (company_id, updated_at desc);

-- ------------------------------------------------------------------ helpers
create or replace function public.is_member(o uuid, min_role public.member_role default 'viewer')
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = o and m.user_id = (select auth.uid())
      and case min_role when 'viewer' then true
                        when 'editor' then m.role in ('editor', 'admin')
                        else m.role = 'admin' end
  );
$$;

create or replace function public.company_org(c uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select org_id from public.companies where id = c;
$$;

revoke execute on function public.is_member(uuid, public.member_role) from anon;
revoke execute on function public.company_org(uuid) from anon;

-- ------------------------------------------------------------------ RLS
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.companies enable row level security;
alter table public.source_accounts enable row level security;
alter table public.account_balances enable row level security;
alter table public.imports enable row level security;
alter table public.odoo_connections enable row level security;
alter table public.commentary enable row level security;
alter table public.reports enable row level security;

create policy org_select on public.organizations for select to authenticated using (public.is_member(id));
create policy org_update on public.organizations for update to authenticated using (public.is_member(id, 'admin')) with check (public.is_member(id, 'admin'));

create policy mem_select on public.memberships for select to authenticated using (public.is_member(org_id));
create policy mem_insert on public.memberships for insert to authenticated with check (public.is_member(org_id, 'admin'));
create policy mem_update on public.memberships for update to authenticated using (public.is_member(org_id, 'admin')) with check (public.is_member(org_id, 'admin'));
create policy mem_delete on public.memberships for delete to authenticated using (public.is_member(org_id, 'admin') and user_id <> (select auth.uid()));

create policy prof_select on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or exists (select 1 from public.memberships a join public.memberships b on a.org_id = b.org_id
             where a.user_id = (select auth.uid()) and b.user_id = profiles.id)
);
create policy prof_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy inv_select on public.invites for select to authenticated using (public.is_member(org_id, 'admin'));
create policy inv_insert on public.invites for insert to authenticated with check (public.is_member(org_id, 'admin'));
create policy inv_delete on public.invites for delete to authenticated using (public.is_member(org_id, 'admin'));

create policy co_select on public.companies for select to authenticated using (public.is_member(org_id));
create policy co_insert on public.companies for insert to authenticated with check (public.is_member(org_id, 'editor'));
create policy co_update on public.companies for update to authenticated using (public.is_member(org_id, 'editor')) with check (public.is_member(org_id, 'editor'));
create policy co_delete on public.companies for delete to authenticated using (public.is_member(org_id, 'admin'));

-- company-scoped tables: read = any member, write = editor+
do $$
declare t text;
begin
  foreach t in array array['source_accounts', 'account_balances', 'imports', 'commentary', 'reports'] loop
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_member(public.company_org(company_id)))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_member(public.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_member(public.company_org(company_id), ''editor'')) with check (public.is_member(public.company_org(company_id), ''editor''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_member(public.company_org(company_id), ''editor''))', t);
  end loop;
end $$;

-- Odoo credentials: editors only (viewers never see the encrypted key)
create policy odoo_select on public.odoo_connections for select to authenticated using (public.is_member(public.company_org(company_id), 'editor'));
create policy odoo_insert on public.odoo_connections for insert to authenticated with check (public.is_member(public.company_org(company_id), 'editor'));
create policy odoo_update on public.odoo_connections for update to authenticated using (public.is_member(public.company_org(company_id), 'editor')) with check (public.is_member(public.company_org(company_id), 'editor'));
create policy odoo_delete on public.odoo_connections for delete to authenticated using (public.is_member(public.company_org(company_id), 'editor'));
