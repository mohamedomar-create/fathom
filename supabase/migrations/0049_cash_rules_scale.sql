-- 0049: learned categories at the size of a real business. Every learned rule is kept (0048's cap of 5,000 goes; a
-- safety cap of 200,000 per company remains, least recently used first, only beyond it). The suggestion is found on
-- the server through an index instead of in the page, and Settings pages and searches all the rules. Only adds or
-- replaces objects: the app before this release keeps working with it. Safe to run again.

-- The first word of a learned description, indexed, so a description is matched without reading every rule.
alter table public.cash_category_rules add column if not exists first_word text generated always as (split_part(match, ' ', 1)) stored;
create index if not exists cash_category_rules_words on public.cash_category_rules (company_id, direction, match_on, first_word);

-- Remembers an entry's category for its name and its description (as 0048), keeping every rule up to 200,000.
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
  -- Counted only up to the cap, so the usual case costs little.
  if (select count(*) from (select 1 from public.cash_category_rules where company_id = r.company_id limit 200001) c) > 200000 then
    delete from public.cash_category_rules where id in (
      select id from public.cash_category_rules where company_id = r.company_id order by last_used desc, id desc offset 200000);
  end if;
end $$;

-- The category to offer for an entry: the customer/supplier's own rule first, then the longest learned description
-- found in this one as whole words (then the most used). Null when nothing is known. Any member may ask.
create or replace function public.cash_suggest(p_company uuid, p_direction text, p_party text, p_note text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_party text := private.cash_match(p_party); v_note text := private.cash_match(p_note); r public.cash_category_rules;
begin
  if p_company is null or not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_direction is null or p_direction not in ('in', 'out') then return null; end if;
  if v_party <> '' then
    select * into r from public.cash_category_rules where company_id = p_company and direction = p_direction and match_on = 'party' and match = v_party;
    if found then return jsonb_build_object('category', r.category, 'kind', r.kind, 'from', 'party', 'match', r.match); end if;
  end if;
  if v_note <> '' then
    select * into r from public.cash_category_rules
     where company_id = p_company and direction = p_direction and match_on = 'note'
       and first_word = any (string_to_array(v_note, ' '))
       and strpos(' ' || v_note || ' ', ' ' || match || ' ') > 0
     order by length(match) desc, uses desc, last_used desc limit 1;
    if found then return jsonb_build_object('category', r.category, 'kind', r.kind, 'from', 'note', 'match', r.match); end if;
  end if;
  return null;
end $$;

-- Every learned rule for Settings: searched by name, description or category, most recently used first, at most
-- 100 per page, with the total.
create or replace function public.cash_rules_page(p_company uuid, p_search text default '', p_offset integer default 0, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s text := private.cash_match(p_search); lim integer := greatest(1, least(coalesce(p_limit, 50), 100)); off integer := greatest(0, coalesce(p_offset, 0));
begin
  if p_company is null or not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.cash_category_rules c
               where c.company_id = p_company and (s = '' or strpos(c.match, s) > 0 or strpos(private.cash_match(c.category), s) > 0)),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'direction', x.direction, 'matchOn', x.match_on, 'match', x.match,
        'category', x.category, 'kind', x.kind, 'uses', x.uses, 'lastUsed', x.last_used) order by x.last_used desc, x.id desc)
      from (select * from public.cash_category_rules c
             where c.company_id = p_company and (s = '' or strpos(c.match, s) > 0 or strpos(private.cash_match(c.category), s) > 0)
             order by c.last_used desc, c.id desc offset off limit lim) x), '[]'::jsonb));
end $$;

revoke execute on function private.cash_learn(public.cash_entries) from public, anon, authenticated;
revoke execute on function public.cash_suggest(uuid, text, text, text), public.cash_rules_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.cash_suggest(uuid, text, text, text), public.cash_rules_page(uuid, text, integer, integer) to authenticated;

-- Suggestions are asked for while typing: their own generous limit.
insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('cash_suggest', 'user', 3600, 3000)
  on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 49 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
