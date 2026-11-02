-- 0050: highlighted financial statements.
--  * kpi_config.highlights holds the company's highlight settings: pct and amount (a line is flagged when it moves by
--    at least both against its comparison) and lines (an editor's colour marks, by statement line key or by account
--    "#code"). update_company_settings keeps it through a KPI save and merges it one level deep, like profile.
--  * set_statement_mark(company, key, mark) sets or clears one mark under the row lock, so two editors marking
--    different lines at once both stick. Editors only; five colours; a note of at most 120 characters.
-- Only replaces functions and adds one: safe to run again.
set client_min_messages = warning;

create or replace function public.update_company_settings(p_company uuid, p_patch jsonb, p_replace_kpis boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_cfg jsonb;
  v_key text;
  v_val jsonb;
  reserved constant text[] := array['economy', 'forecast', 'highlights', 'inventory', 'profile'];
  nested constant text[] := array['highlights', 'inventory', 'profile'];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'settings must be an object' using errcode = '22023';
  end if;
  select org_id, coalesce(kpi_config, '{}'::jsonb) into v_org, v_cfg from public.companies where id = p_company and deleted_at is null for update;
  if v_org is null or not private.is_member(v_org, 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_replace_kpis then
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_cfg from jsonb_each(v_cfg) as e(k, v) where k = any (reserved);
  end if;
  for v_key, v_val in select * from jsonb_each(p_patch) loop
    if p_replace_kpis and v_key = any (reserved) then
      continue;
    elsif jsonb_typeof(v_val) = 'null' then
      v_cfg := v_cfg - v_key;
    elsif v_key = any (nested) and jsonb_typeof(v_val) = 'object' and jsonb_typeof(v_cfg -> v_key) = 'object' then
      v_cfg := jsonb_set(v_cfg, array[v_key], (v_cfg -> v_key) || v_val);
    else
      v_cfg := jsonb_set(v_cfg, array[v_key], v_val);
    end if;
  end loop;
  update public.companies set kpi_config = v_cfg where id = p_company;
  return v_cfg;
end $$;
revoke execute on function public.update_company_settings(uuid, jsonb, boolean) from public, anon;
grant execute on function public.update_company_settings(uuid, jsonb, boolean) to authenticated;

create or replace function public.set_statement_mark(p_company uuid, p_key text, p_mark jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_cfg jsonb;
  v_lines jsonb;
begin
  if p_key is null or length(p_key) not between 1 and 200 then
    raise exception 'mark key must be 1 to 200 characters' using errcode = '22023';
  end if;
  if p_mark is not null and jsonb_typeof(p_mark) <> 'null' then
    if jsonb_typeof(p_mark) <> 'object'
       or not (p_mark ->> 'color') = any (array['yellow', 'green', 'blue', 'pink', 'grey'])
       or exists (select 1 from jsonb_object_keys(p_mark) k where k not in ('color', 'note'))
       or (p_mark ? 'note' and (jsonb_typeof(p_mark -> 'note') <> 'string' or length(p_mark ->> 'note') > 120)) then
      raise exception 'a mark is a colour (yellow, green, blue, pink or grey) and a note of at most 120 characters' using errcode = '22023';
    end if;
  end if;
  select org_id, coalesce(kpi_config, '{}'::jsonb) into v_org, v_cfg from public.companies where id = p_company and deleted_at is null for update;
  if v_org is null or not private.is_member(v_org, 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_lines := coalesce(v_cfg #> '{highlights,lines}', '{}'::jsonb);
  if jsonb_typeof(v_lines) <> 'object' then v_lines := '{}'::jsonb; end if;
  if p_mark is null or jsonb_typeof(p_mark) = 'null' then
    v_lines := v_lines - p_key;
  else
    if not v_lines ? p_key and (select count(*) from jsonb_object_keys(v_lines)) >= 2000 then
      raise exception 'at most 2,000 marks per company' using errcode = '22023';
    end if;
    v_lines := jsonb_set(v_lines, array[p_key], p_mark);
  end if;
  if jsonb_typeof(v_cfg -> 'highlights') <> 'object' or v_cfg -> 'highlights' is null then
    v_cfg := jsonb_set(v_cfg, '{highlights}', '{}'::jsonb);
  end if;
  v_cfg := jsonb_set(v_cfg, '{highlights,lines}', v_lines);
  update public.companies set kpi_config = v_cfg where id = p_company;
  return v_lines;
end $$;
revoke execute on function public.set_statement_mark(uuid, text, jsonb) from public, anon;
grant execute on function public.set_statement_mark(uuid, text, jsonb) to authenticated;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 50 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
