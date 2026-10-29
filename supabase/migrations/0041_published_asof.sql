-- 0041: a shared report says how far the books go, so a part month is shown as one (labelled "to 15 Oct" and compared
-- on the same days) on the public link, as it is in the app. Replaces get_published_report only; safe to run again.
-- Needs 0040.
set client_min_messages = warning;

create or replace function public.get_published_report(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  c public.companies;
  o public.organizations;
  v_from text;
  v_fig boolean;
  v_basis boolean;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now())
    -- A deleted company's or organisation's links stop at once (they come back if it is brought back).
    and exists (select 1 from public.companies lc join public.organizations lg on lg.id = lc.org_id where lc.id = reports.company_id and lc.deleted_at is null and lg.deleted_at is null);
  if not found then return null; end if;
  select * into c from public.companies where id = r.company_id;
  select * into o from public.organizations where id = c.org_id;
  v_from := to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM');
  v_fig := private.report_shows_figures(r.sections);
  v_basis := private.report_shows(r.sections, 'basis');
  return jsonb_build_object(
    'report', to_jsonb(r) - 'created_by' - 'share_token',
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'currency', c.currency, 'fy_start_month', c.fy_start_month,
                                  'tax_rate', c.tax_rate, 'kpi_config', case when v_fig then coalesce(c.kpi_config, '{}'::jsonb) - 'profile' else '{}'::jsonb end,
                                  'notes', case when v_basis then c.notes else '[]'::jsonb end, 'source', c.source),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url, 'brand_colour', o.brand_colour, 'disclaimer', o.disclaimer, 'report_footer', o.report_footer),
    'accounts', case when not v_fig then '[]'::jsonb else coalesce((
      select jsonb_agg(x.a order by x.sort_order) from (
        select s.sort_order, jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statement', s.statement, 'class', s.class,
               'amounts', jsonb_object_agg(b.period, b.amount)) as a
          from public.source_accounts s
          join public.account_balances b on b.account_id = s.id and b.company_id = c.id and b.period between v_from and r.period_end
         where s.company_id = c.id and s.version = c.data_version
         group by s.id
      ) x), '[]'::jsonb) end,
    'commentary', coalesce((select jsonb_object_agg(cm.section, cm.body) from public.commentary cm
                            where cm.company_id = c.id and cm.period_key = r.period_type || ':' || r.period_end
                              and private.report_shows(r.sections, cm.section)), '{}'::jsonb),
    -- How far the books go (the import of the current version), so a part month reads as one on the link too.
    'as_of', (select i.report ->> 'asOf' from public.imports i where i.company_id = c.id and i.data_version = c.data_version and i.action = 'import'
               order by i.created_at desc limit 1),
    'accepted', case when not v_basis then '[]'::jsonb else coalesce((
                  select (select jsonb_agg(jsonb_build_object('title', x ->> 'title', 'period', x ->> 'period', 'reason', x ->> 'reason'))
                            from jsonb_array_elements(coalesce(i.report -> 'accepted', '[]'::jsonb)) x)
                    from public.imports i where i.company_id = c.id and i.data_version = c.data_version and i.action = 'import'
                   order by i.created_at desc limit 1), '[]'::jsonb) end
  );
end $$;
revoke execute on function public.get_published_report(text) from public;
grant execute on function public.get_published_report(text) to anon, authenticated;

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 41 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;

reset client_min_messages;
