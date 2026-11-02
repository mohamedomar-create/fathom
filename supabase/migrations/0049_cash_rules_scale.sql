-- 0049: learned categories at the size of a real business. Every learned rule is kept (0048's cap of 5,000 goes; a
-- safety cap of 200,000 per company remains). A suggestion is found on the server by exact lookups on the existing
-- unique index (the name, then every run of whole words in the description), and Settings searches all the rules
-- through trigram indexes. Only adds or replaces objects: the app before this release keeps working with it. Safe to
-- run again.

create extension if not exists pg_trgm with schema extensions;

-- Names and descriptions are compared as the app's matchKey: Arabic spelled one way, lower case, and any kind of
-- space (including the non-breaking spaces ERP exports carry) as one space.
create or replace function private.cash_match(p text) returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(lower(translate(regexp_replace(coalesce(p, ''), '[ؐ-ًؚ-ٰٟـ]', '', 'g'),
    'أإآٱىةؤئکی', 'اااايهويكي')), '[\s   -     　﻿]+', ' ', 'g')), 200)
$$;

-- The category as searched, and trigram indexes so Settings finds a rule among hundreds of thousands at once.
alter table public.cash_category_rules add column if not exists category_key text generated always as (private.cash_match(category)) stored;
create index if not exists cash_category_rules_match_trgm on public.cash_category_rules using gin (match extensions.gin_trgm_ops);
create index if not exists cash_category_rules_category_trgm on public.cash_category_rules using gin (category_key extensions.gin_trgm_ops);

-- Remembers an entry's category for its name and its description (as 0048), keeping every rule up to 200,000. The
-- cap is looked at only when a new rule was added, and then about once in fifty times: it guards against a runaway
-- import, so a few rules over the line for a moment do no harm.
create or replace function private.cash_learn(r public.cash_entries) returns void language plpgsql security definer set search_path = '' as $$
declare m text; w text; v_new boolean; v_added boolean := false;
begin
  if btrim(coalesce(r.category, '')) = '' then return; end if;
  foreach w in array array['party', 'note'] loop
    m := private.cash_match(case when w = 'party' then r.party else r.note end);
    continue when m = '';
    insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind)
    values (r.company_id, r.direction, w, m, btrim(r.category), r.kind)
    on conflict (company_id, direction, match_on, match) do update
      set category = excluded.category, kind = excluded.kind, uses = public.cash_category_rules.uses + 1, last_used = now()
    returning (xmax = 0) into v_new;
    v_added := v_added or coalesce(v_new, false);
  end loop;
  if v_added and random() < 0.02
     and (select count(*) from (select 1 from public.cash_category_rules where company_id = r.company_id limit 200001) c) > 200000 then
    delete from public.cash_category_rules where id in (
      select id from public.cash_category_rules where company_id = r.company_id order by last_used desc, id desc offset 200000);
  end if;
end $$;

-- The category to offer for an entry: the customer/supplier's own rule first, then the longest learned description
-- found in this one as whole words (then the most used). Both are exact lookups on the unique index: the description
-- is broken into every run of up to 20 whole words. Null when nothing is known. Any member may ask.
create or replace function public.cash_suggest(p_company uuid, p_direction text, p_party text, p_note text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_party text := private.cash_match(p_party); v_note text := private.cash_match(p_note); w text[]; runs text[] := '{}'; r public.cash_category_rules; n integer;
begin
  if p_company is null or not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_direction is null or p_direction not in ('in', 'out') then return null; end if;
  if v_party <> '' then
    select * into r from public.cash_category_rules where company_id = p_company and direction = p_direction and match_on = 'party' and match = v_party;
    if found then return jsonb_build_object('category', r.category, 'kind', r.kind, 'from', 'party', 'match', r.match); end if;
  end if;
  if v_note <> '' then
    w := string_to_array(v_note, ' ');
    n := coalesce(array_length(w, 1), 0);
    for i in 1 .. n loop
      for j in i .. least(n, i + 19) loop
        runs := runs || array_to_string(w[i:j], ' ');
      end loop;
    end loop;
    select * into r from public.cash_category_rules
     where company_id = p_company and direction = p_direction and match_on = 'note' and match = any (runs)
     order by length(match) desc, uses desc, last_used desc limit 1;
    if found then return jsonb_build_object('category', r.category, 'kind', r.kind, 'from', 'note', 'match', r.match); end if;
  end if;
  return null;
end $$;

-- Every learned rule for Settings: searched by name, description or category (the words as typed, % and _ included),
-- most recently used first, at most 100 per page. The total is counted up to 10,000 ("more" says there are others).
create or replace function public.cash_rules_page(p_company uuid, p_search text default '', p_offset integer default 0, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s text := private.cash_match(p_search); pat text; lim integer := greatest(1, least(coalesce(p_limit, 50), 100)); off integer := greatest(0, coalesce(p_offset, 0)); v_total bigint;
begin
  if p_company is null or not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  pat := '%' || replace(replace(replace(s, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select count(*) into v_total from (select 1 from public.cash_category_rules c
    where c.company_id = p_company and (s = '' or c.match like pat or c.category_key like pat) limit 10001) x;
  return jsonb_build_object(
    'total', least(v_total, 10000), 'more', v_total > 10000,
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'direction', x.direction, 'matchOn', x.match_on, 'match', x.match,
        'category', x.category, 'kind', x.kind, 'uses', x.uses, 'lastUsed', x.last_used) order by x.last_used desc, x.id desc)
      from (select * from public.cash_category_rules c
             where c.company_id = p_company and (s = '' or c.match like pat or c.category_key like pat)
             order by c.last_used desc, c.id desc offset off limit lim) x), '[]'::jsonb));
end $$;

revoke execute on function private.cash_learn(public.cash_entries), private.cash_match(text) from public, anon, authenticated;
revoke execute on function public.cash_suggest(uuid, text, text, text), public.cash_rules_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.cash_suggest(uuid, text, text, text), public.cash_rules_page(uuid, text, integer, integer) to authenticated;

-- Suggestions are asked for while typing (only when the words change), and Settings searches as people type: their
-- own generous limits.
insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values ('cash_suggest', 'user', 3600, 20000), ('cash_rules', 'user', 3600, 3000)
  on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 49 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
