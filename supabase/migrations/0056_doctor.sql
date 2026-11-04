-- 0056: the AI system doctor.
--  * doctor_decisions: a finding accepted with a reason (who, when, why), undone within 30 days. One open decision per
--    finding; an undone one is kept for the record.
--  * doctor_accept / doctor_undo: editors only. Members read. Nobody writes the table directly.
--  * Rate limits: doctor (explain a finding with AI) and ask ("Ask your numbers").
-- Only adds objects: safe to run again.
set client_min_messages = warning;

create table if not exists public.doctor_decisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  finding_key text not null check (length(finding_key) between 1 and 400),
  title text not null default '' check (length(title) <= 300),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references auth.users (id) on delete set null
);
create unique index if not exists doctor_decisions_open on public.doctor_decisions (company_id, finding_key) where undone_at is null;
create index if not exists doctor_decisions_company on public.doctor_decisions (company_id, created_at desc);

alter table public.doctor_decisions enable row level security;
drop policy if exists doctor_decisions_read on public.doctor_decisions;
create policy doctor_decisions_read on public.doctor_decisions for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.doctor_decisions from anon;
revoke insert, update, delete, truncate on public.doctor_decisions from authenticated;
grant select on public.doctor_decisions to authenticated;

create or replace function public.doctor_accept(p_company uuid, p_key text, p_title text, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null or length(p_key) not between 1 and 400 then raise exception 'That finding is not valid.'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'Give a reason (3 to 500 characters).'; end if;
  update public.doctor_decisions set reason = btrim(p_reason), title = left(coalesce(p_title, ''), 300), created_by = (select auth.uid()), created_at = now()
   where company_id = p_company and finding_key = p_key and undone_at is null
  returning id into v_id;
  if v_id is null then
    insert into public.doctor_decisions (company_id, finding_key, title, reason)
    values (p_company, p_key, left(coalesce(p_title, ''), 300), btrim(p_reason)) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.doctor_undo(p_company uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_company is null or not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.doctor_decisions set undone_at = now(), undone_by = (select auth.uid())
   where id = p_id and company_id = p_company and undone_at is null and created_at > now() - interval '30 days';
  if not found then raise exception 'That decision can no longer be undone.'; end if;
end $$;

revoke execute on function public.doctor_accept(uuid, text, text, text), public.doctor_undo(uuid, uuid) from public, anon;
grant execute on function public.doctor_accept(uuid, text, text, text), public.doctor_undo(uuid, uuid) to authenticated;

insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('doctor', 'user', 3600, 60), ('ask', 'user', 3600, 60)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

do $$ begin perform private.install_tenant_guards(); end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 56 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
