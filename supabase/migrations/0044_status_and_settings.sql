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
--  * O12: a stock summary that fails to build keeps its last good copy; the error is recorded beside it (error,
--    error_seq, error_at) and the build is tried again after 10 minutes. inventory_state returns both, so the page shows
--    the last good figures with their time and says the latest couldn't be prepared. Before, the error replaced them.
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

-- ---------------------------------------------------------------- O12: inventory summary keeps its last good copy
alter table public.inventory_rollups alter column summary drop not null;
alter table public.inventory_rollups add column if not exists error text;
alter table public.inventory_rollups add column if not exists error_seq bigint;
alter table public.inventory_rollups add column if not exists error_at timestamptz;
-- A summary that is an error today becomes an error beside no summary (there is no good copy to keep).
update public.inventory_rollups set error = summary ->> 'error', error_seq = built_seq, error_at = built_at, summary = null, built_seq = 0
 where summary ? 'error';

create or replace function private.refresh_inventory_rollups(p_limit integer default 5)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_summary jsonb;
  v_error text;
  v_done integer := 0;
begin
  for r in
    select k.company_id, k.seq from private.inventory_marks k
      left join public.inventory_rollups x on x.company_id = k.company_id
     where x.company_id is null
        or (x.built_seq <> k.seq and (x.error_seq is distinct from k.seq or x.error_at < now() - interval '10 minutes'))
     order by k.seq limit p_limit
  loop
    v_error := null;
    begin
      v_summary := private.inventory_wire(r.company_id);
    exception when others then
      v_error := left(sqlerrm, 300);
    end;
    if v_error is null then
      insert into public.inventory_rollups (company_id, summary, built_seq, built_at, error, error_seq, error_at)
      values (r.company_id, v_summary, r.seq, now(), null, null, null)
      on conflict (company_id) do update set summary = excluded.summary, built_seq = excluded.built_seq, built_at = excluded.built_at,
        error = null, error_seq = null, error_at = null;
    else
      -- The last good copy stays; the error is kept beside it.
      insert into public.inventory_rollups (company_id, summary, built_seq, built_at, error, error_seq, error_at)
      values (r.company_id, null, 0, now(), v_error, r.seq, now())
      on conflict (company_id) do update set error = excluded.error, error_seq = excluded.error_seq, error_at = excluded.error_at;
    end if;
    v_done := v_done + 1;
  end loop;
  return v_done;
end $$;
revoke execute on function private.refresh_inventory_rollups(integer) from public, anon, authenticated;

create or replace function public.inventory_state(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_seq bigint;
  x public.inventory_rollups;
begin
  if not private.is_member(private.company_org(p_company)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select seq into v_seq from private.inventory_marks where company_id = p_company;
  select * into x from public.inventory_rollups where company_id = p_company;
  return jsonb_build_object(
    'summary', x.summary,
    'built_at', case when x.summary is not null then x.built_at end,
    -- A build that failed for the latest records isn't pending: it waits 10 minutes, and says why.
    'pending', v_seq is not null and (x.company_id is null or (x.built_seq <> v_seq and x.error_seq is distinct from v_seq)),
    'error', x.error,
    'error_at', x.error_at);
end $$;
revoke execute on function public.inventory_state(uuid) from public, anon;
grant execute on function public.inventory_state(uuid) to authenticated;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 44 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
reset client_min_messages;
