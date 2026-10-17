-- 0018: each company's export layouts. The first upload of each export (General Ledger, sales list, bills…) is remembered
-- with its column headings; a later upload whose columns differ is stopped until a person confirms how it was read.
-- Earlier layouts are kept (last 10). Needs 0017.
create table if not exists public.input_profiles (
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (length(kind) between 1 and 120),
  headings text[] not null check (cardinality(headings) <= 300),
  read text[] not null default '{}' check (cardinality(read) <= 300),
  ignored text[] not null default '{}' check (cardinality(ignored) <= 300),
  sheet text not null default '' check (length(sheet) <= 300),
  history jsonb not null default '[]'::jsonb,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);
alter table public.input_profiles enable row level security;

drop policy if exists input_profiles_select on public.input_profiles;
drop policy if exists input_profiles_insert on public.input_profiles;
drop policy if exists input_profiles_update on public.input_profiles;
drop policy if exists input_profiles_delete on public.input_profiles;
create policy input_profiles_select on public.input_profiles for select to authenticated using (private.is_member(private.company_org(company_id)));
create policy input_profiles_insert on public.input_profiles for insert to authenticated with check (private.is_member(private.company_org(company_id), 'editor'));
create policy input_profiles_update on public.input_profiles for update to authenticated
  using (private.is_member(private.company_org(company_id), 'editor')) with check (private.is_member(private.company_org(company_id), 'editor'));
create policy input_profiles_delete on public.input_profiles for delete to authenticated using (private.is_member(private.company_org(company_id), 'editor'));
revoke all on public.input_profiles from anon;

-- Who and when; a changed layout keeps the one it replaces in the history (the last 10).
create or replace function private.input_profiles_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if tg_op = 'UPDATE' then
    new.history := old.history;
    if new.headings is distinct from old.headings then
      new.history := (jsonb_build_array(jsonb_build_object('headings', to_jsonb(old.headings), 'until', now(), 'by', old.updated_by)) || old.history);
      new.history := (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(new.history) with ordinality as t(e, n) where n <= 10) x);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists input_profiles_touch on public.input_profiles;
create trigger input_profiles_touch before insert or update on public.input_profiles for each row execute function private.input_profiles_touch();
