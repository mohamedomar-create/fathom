-- 0017: the company's account map. Every class a person chooses for an account is kept here, by the account's code
-- ("#123000") or, for an account without a code, by its normalised name. Uploads, Odoo syncs and the chart editor all read
-- it, so a correction is never lost on the next upload or sync, and a renamed account keeps its class. Needs 0016.
create table if not exists public.account_map (
  company_id uuid not null references public.companies (id) on delete cascade,
  key text not null check (length(key) between 1 and 200),
  cls text not null check (length(cls) <= 40),  -- '' = the person left the account out
  name text not null default '' check (length(name) <= 300),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);
alter table public.account_map enable row level security;

drop policy if exists account_map_select on public.account_map;
drop policy if exists account_map_insert on public.account_map;
drop policy if exists account_map_update on public.account_map;
drop policy if exists account_map_delete on public.account_map;
create policy account_map_select on public.account_map for select to authenticated using (private.is_member(private.company_org(company_id)));
create policy account_map_insert on public.account_map for insert to authenticated with check (private.is_member(private.company_org(company_id), 'editor'));
create policy account_map_update on public.account_map for update to authenticated
  using (private.is_member(private.company_org(company_id), 'editor')) with check (private.is_member(private.company_org(company_id), 'editor'));
create policy account_map_delete on public.account_map for delete to authenticated using (private.is_member(private.company_org(company_id), 'editor'));
revoke all on public.account_map from anon;

create or replace function private.account_map_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  return new;
end $$;
drop trigger if exists account_map_touch on public.account_map;
create trigger account_map_touch before insert or update on public.account_map for each row execute function private.account_map_touch();

-- Start from what is already known: classes a person set on the current accounts (by code), then the mapping remembered by
-- each company's latest upload (by name). Nothing existing is overwritten.
insert into public.account_map (company_id, key, cls, name, updated_by)
select distinct on (s.company_id, '#' || btrim(s.code)) s.company_id, '#' || btrim(s.code), s.class, left(s.name, 300), null
from public.source_accounts s
join public.companies c on c.id = s.company_id and s.version = c.data_version
where s.mapped_by = 'user' and btrim(s.code) <> ''
on conflict do nothing;

insert into public.account_map (company_id, key, cls, name, updated_by)
select i.company_id, m.key, m.value, left(m.key, 300), null
from (
  select distinct on (company_id) company_id, report
  from public.imports
  where kind = 'upload' and action = 'import' and jsonb_typeof(report -> 'mapping') = 'object'
  order by company_id, created_at desc
) i
cross join lateral jsonb_each_text(i.report -> 'mapping') m
where position('|' in m.key) = 0 and length(m.key) between 1 and 200 and length(m.value) <= 40
on conflict do nothing;
