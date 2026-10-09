-- 0005: imports merge by period, keep previous versions for undo, and record where every number came from.

-- Which import supplied each monthly balance, and the file location of each account per import.
alter table public.account_balances add column if not exists import_id uuid references public.imports (id) on delete set null;
create index if not exists account_balances_import_idx on public.account_balances (import_id);
alter table public.source_accounts add column if not exists refs jsonb not null default '{}'::jsonb;

-- Each import row points at the data version it produced; restores are recorded as their own rows.
alter table public.imports add column if not exists data_version integer;
alter table public.imports add column if not exists action text not null default 'import' check (action in ('import', 'restore'));
create index if not exists imports_company_version_idx on public.imports (company_id, data_version);

-- Write a complete new data version. Unlike replace_company_data, the caller sends the merged snapshot:
-- balances carried over from earlier imports keep their import id (amount "sources"), new ones get this import's id.
create or replace function public.save_company_version(p_company uuid, p_accounts jsonb, p_import jsonb default '{}'::jsonb, p_notes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version int;
  v_import uuid;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_accounts) <> 'array' or jsonb_array_length(p_accounts) = 0 then
    raise exception 'no accounts supplied';
  end if;
  if jsonb_array_length(p_accounts) > 8000 then
    raise exception 'too many accounts';
  end if;

  -- Versions only grow, even after restoring an older one.
  select greatest(c.data_version, coalesce((select max(s.version) from public.source_accounts s where s.company_id = p_company), 0)) + 1
    into v_version from public.companies c where c.id = p_company for update;

  insert into public.imports (company_id, kind, filename, report, created_by, data_version, action)
  values (p_company, coalesce(p_import ->> 'kind', 'upload'), p_import ->> 'filename', coalesce(p_import -> 'report', '{}'::jsonb), (select auth.uid()), v_version, 'import')
  returning id into v_import;

  update public.companies
     set data_version = v_version, last_synced_at = now(), notes = coalesce(p_notes, notes)
   where id = p_company;

  with src as (
    select a, ord from jsonb_array_elements(p_accounts) with ordinality as t(a, ord)
  ), ins as (
    insert into public.source_accounts (company_id, version, code, name, statement, class, odoo_id, odoo_type, confidence, mapped_by, sort_order, refs)
    select p_company, v_version, coalesce(a ->> 'code', ''), a ->> 'name', a ->> 'statement', a ->> 'class',
           nullif(a ->> 'odoo_id', '')::int, a ->> 'odoo_type', nullif(a ->> 'confidence', '')::real,
           coalesce(a ->> 'mapped_by', 'auto'), ord::int,
           (coalesce(a -> 'refs', '{}'::jsonb) - 'new')
             || case when a -> 'refs' ? 'new' then jsonb_build_object(v_import::text, a -> 'refs' -> 'new') else '{}'::jsonb end
    from src
    returning id, sort_order
  )
  insert into public.account_balances (account_id, company_id, period, amount, import_id)
  select ins.id, p_company, kv.key, (kv.value)::numeric,
         case when src.a -> 'sources' ? kv.key then i.id else v_import end
  from ins join src on src.ord = ins.sort_order
  cross join lateral jsonb_each_text(src.a -> 'amounts') kv
  left join public.imports i on i.company_id = p_company and i.id::text = src.a -> 'sources' ->> kv.key
  where kv.value is not null and (kv.value)::numeric <> 0;

  return jsonb_build_object('version', v_version, 'import_id', v_import);
end $$;

-- Undo: point the company back at an earlier version that is still kept.
create or replace function public.restore_company_version(p_company uuid, p_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import uuid;
  v_from int;
  v_src record;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.source_accounts s where s.company_id = p_company and s.version = p_version) then
    raise exception 'that version is no longer kept';
  end if;
  select data_version into v_from from public.companies where id = p_company for update;
  if v_from = p_version then
    raise exception 'that version is already current';
  end if;
  select kind, filename, report into v_src from public.imports
   where company_id = p_company and data_version = p_version and action = 'import'
   order by created_at desc limit 1;

  update public.companies set data_version = p_version, last_synced_at = now() where id = p_company;
  insert into public.imports (company_id, kind, filename, report, created_by, data_version, action)
  values (p_company, coalesce(v_src.kind, 'upload'), v_src.filename,
          jsonb_build_object('restored_from', v_from, 'restored_to', p_version), (select auth.uid()), p_version, 'restore')
  returning id into v_import;
  return v_import;
end $$;

revoke execute on function public.save_company_version(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.restore_company_version(uuid, integer) from public, anon;
grant execute on function public.save_company_version(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.restore_company_version(uuid, integer) to authenticated;

-- Existing imports: link each company's latest import to its current version.
update public.imports i set data_version = c.data_version
  from public.companies c
 where i.company_id = c.id and i.data_version is null
   and i.id = (select i2.id from public.imports i2 where i2.company_id = c.id order by i2.created_at desc limit 1);

-- Published reports disclose issues accepted at import (Basis of Preparation).
create or replace function public.get_published_report(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  c public.companies;
  o public.organizations;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published';
  if not found then return null; end if;
  select * into c from public.companies where id = r.company_id;
  select * into o from public.organizations where id = c.org_id;
  return jsonb_build_object(
    'report', to_jsonb(r) - 'created_by',
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'currency', c.currency, 'fy_start_month', c.fy_start_month,
                                  'tax_rate', c.tax_rate, 'kpi_config', c.kpi_config, 'notes', c.notes, 'source', c.source),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url, 'brand_colour', o.brand_colour, 'disclaimer', o.disclaimer, 'report_footer', o.report_footer),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statement', s.statement, 'class', s.class,
                          'amounts', coalesce((select jsonb_object_agg(b.period, b.amount) from public.account_balances b where b.account_id = s.id), '{}'::jsonb)) order by s.sort_order)
                          from public.source_accounts s where s.company_id = c.id and s.version = c.data_version), '[]'::jsonb),
    'commentary', coalesce((select jsonb_object_agg(cm.section, cm.body) from public.commentary cm
                            where cm.company_id = c.id and cm.period_key = r.period_type || ':' || r.period_end), '{}'::jsonb),
    'accepted', coalesce((select (select jsonb_agg(jsonb_build_object('title', x ->> 'title', 'period', x ->> 'period', 'reason', x ->> 'reason'))
                                    from jsonb_array_elements(coalesce(i.report -> 'accepted', '[]'::jsonb)) x)
                          from public.imports i where i.company_id = c.id and i.data_version = c.data_version and i.action = 'import'
                          order by i.created_at desc limit 1), '[]'::jsonb)
  );
end $$;
grant execute on function public.get_published_report(text) to anon, authenticated;
