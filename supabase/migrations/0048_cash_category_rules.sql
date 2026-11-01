-- 0048: the cash book learns categories. Saving an entry with a category (added or changed in the app) remembers that
-- category, and the entry's kind, for its customer/supplier and for its description, per direction. The next entry with
-- the same name or description is offered the same category; the person's latest choice always wins. Members read the
-- rules; nobody writes them directly; an editor can delete one. Only adds objects and replaces two functions, so the
-- app before this release keeps working with it. Safe to run again.

create table if not exists public.cash_category_rules (
  id bigserial primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  -- party: the customer or supplier, exactly (after tidying); note: the description, found within a later one.
  match_on text not null check (match_on in ('party', 'note')),
  match text not null check (length(match) between 1 and 200),
  category text not null check (length(category) between 1 and 200),
  kind text not null,
  uses integer not null default 1 check (uses >= 1),
  last_used timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (company_id, direction, match_on, match)
);
create index if not exists cash_category_rules_recent on public.cash_category_rules (company_id, last_used desc);

alter table public.cash_category_rules enable row level security;
drop policy if exists cash_category_rules_read on public.cash_category_rules;
create policy cash_category_rules_read on public.cash_category_rules for select to authenticated using (private.is_member(private.company_org(company_id)));
revoke all on public.cash_category_rules from anon;
revoke insert, update, delete, truncate on public.cash_category_rules from authenticated;
grant select on public.cash_category_rules to authenticated;

-- How a name or description is compared: Arabic spelled one way (as the app's normAr), lower case, single spaces.
create or replace function private.cash_match(p text) returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(lower(translate(regexp_replace(coalesce(p, ''), '[ؐ-ًؚ-ٰٟـ]', '', 'g'),
    'أإآٱىةؤئکی', 'اااايهويكي')), '\s+', ' ', 'g')), 200)
$$;

-- Remembers an entry's category for its name and its description. At most 5,000 rules per company: the least recently
-- used go first.
create or replace function private.cash_learn(r public.cash_entries) returns void language plpgsql security definer set search_path = '' as $$
declare m text; w text;
begin
  if btrim(coalesce(r.category, '')) = '' then return; end if;
  foreach w in array array['party', 'note'] loop
    m := private.cash_match(case when w = 'party' then r.party else r.note end);
    continue when m = '';
    insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind)
    values (r.company_id, r.direction, w, m, btrim(r.category), r.kind)
    on conflict (company_id, direction, match_on, match) do update
      set category = excluded.category, kind = excluded.kind, uses = public.cash_category_rules.uses + 1, last_used = now();
  end loop;
  delete from public.cash_category_rules where id in (
    select id from public.cash_category_rules where company_id = r.company_id order by last_used desc, id desc offset 5000);
end $$;

create or replace function public.cash_entry_add(p_company uuid, p_entry jsonb) returns bigint language plpgsql security definer set search_path = '' as $$
declare r public.cash_entries; v_id bigint;
begin
  perform private.cash_editor(p_company);
  r := private.cash_row(p_company, null, 'app', p_entry);
  insert into public.cash_entries (company_id, upload_id, day, direction, amount, category, party, note, paid, paid_on, source, kind)
  values (r.company_id, null, r.day, r.direction, r.amount, r.category, r.party, r.note, r.paid, r.paid_on, 'app', r.kind) returning id into v_id;
  perform private.cash_learn(r);
  return v_id;
end $$;

create or replace function public.cash_entry_update(p_id bigint, p_entry jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid; r public.cash_entries;
begin
  select company_id into v_company from public.cash_entries where id = p_id and deleted_at is null;
  perform private.cash_editor(v_company);
  r := private.cash_row(v_company, null, 'app', p_entry);
  -- The old row goes to the history (trigger); the entry is marked as edited.
  update public.cash_entries set day = r.day, direction = r.direction, amount = r.amount, category = r.category, party = r.party, note = r.note,
    paid = r.paid, paid_on = r.paid_on, kind = r.kind, edited_at = now() where id = p_id;
  perform private.cash_learn(r);
end $$;

-- An editor forgets one learned category.
create or replace function public.cash_rule_delete(p_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.cash_category_rules where id = p_id;
  perform private.cash_editor(v_company);
  delete from public.cash_category_rules where id = p_id;
end $$;

revoke execute on function private.cash_match(text), private.cash_learn(public.cash_entries) from public, anon, authenticated;
revoke execute on function public.cash_rule_delete(bigint) from public, anon;
grant execute on function public.cash_rule_delete(bigint) to authenticated;
revoke execute on function public.cash_entry_add(uuid, jsonb), public.cash_entry_update(bigint, jsonb) from public, anon;
grant execute on function public.cash_entry_add(uuid, jsonb), public.cash_entry_update(bigint, jsonb) to authenticated;

-- The tenant guards (0038) on the new table.
do $$ begin perform private.install_tenant_guards(); end $$;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 48 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
