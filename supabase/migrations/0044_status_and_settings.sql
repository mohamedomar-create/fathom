-- 0044: company settings without lost updates.
--  * update_company_settings(company, patch, replace_kpis): every settings save sends only what it changes, and the
--    database merges it into kpi_config under a row lock, so two saves at the same moment both stick (before, each save
--    read the whole column, changed its part and wrote the whole column back, and the later write dropped the earlier
--    one's change).
--      - profile and inventory merge one level deep (a profile save never drops another profile setting);
--      - every other key is replaced whole; a null removes it;
--      - replace_kpis (the KPI settings page, which sends the whole KPI set) also removes KPI keys it didn't send, and
--        never touches the reserved settings (economy, forecast, inventory, profile).
--    An editor of the company may save; viewers and outsiders are refused.
set client_min_messages = warning;

create or replace function public.update_company_settings(p_company uuid, p_patch jsonb, p_replace_kpis boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_cfg jsonb;
  v_key text;
  v_val jsonb;
  reserved constant text[] := array['economy', 'forecast', 'inventory', 'profile'];
  nested constant text[] := array['inventory', 'profile'];
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'settings must be an object' using errcode = '22023';
  end if;
  select org_id, coalesce(kpi_config, '{}'::jsonb) into v_org, v_cfg from public.companies where id = p_company for update;
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

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 44 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
reset client_min_messages;
