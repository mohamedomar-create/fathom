-- 0006: security hardening (applied live as 0006a–0006d; the REVOKEs and pruning are in 0006e)
-- * shared rate limits (work across server instances)
-- * public report links: only the months a report needs, optional expiry
-- * an organisation always keeps an admin
-- * (0006e, run by hand: pruning, REVOKEs, legacy write function closed)

-- ---------------------------------------------------------------- rate limits
create table if not exists private.rate_events (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_events_key_at on private.rate_events (key, at);

-- Counts one hit for `p_key` and says whether it is still within `p_max` hits per `p_window_s` seconds.
-- Only hits inside the window count; 0006e prunes old rows.
create or replace function public.hit_rate_limit(p_key text, p_window_s integer, p_max integer)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 120 or p_window_s not between 1 and 604800 or p_max not between 1 and 100000 then
    raise exception 'invalid rate limit';
  end if;
  select count(*) into n from private.rate_events where key = p_key and at > now() - make_interval(secs => p_window_s);
  if n >= p_max then return false; end if;
  insert into private.rate_events (key) values (p_key);
  return true;
end $$;
grant execute on function public.hit_rate_limit(text, integer, integer) to anon, authenticated;

-- ---------------------------------------------------------------- public report links
alter table public.reports add column if not exists expires_at timestamptz;

-- A published link shows the report's period and the three years before it (comparisons, trends, opening balances),
-- never the company's whole history; expired links show nothing.
create or replace function public.get_published_report(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.reports;
  c public.companies;
  o public.organizations;
  v_from text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 100 then return null; end if;
  select * into r from public.reports where share_token = p_token and status = 'published' and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  select * into c from public.companies where id = r.company_id;
  select * into o from public.organizations where id = c.org_id;
  v_from := to_char(to_date(r.period_end || '-01', 'YYYY-MM-DD') - interval '35 months', 'YYYY-MM');
  return jsonb_build_object(
    'report', to_jsonb(r) - 'created_by' - 'share_token',
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'currency', c.currency, 'fy_start_month', c.fy_start_month,
                                  'tax_rate', c.tax_rate, 'kpi_config', c.kpi_config, 'notes', c.notes, 'source', c.source),
    'org', jsonb_build_object('name', o.name, 'logo_url', o.logo_url, 'brand_colour', o.brand_colour, 'disclaimer', o.disclaimer, 'report_footer', o.report_footer),
    'accounts', coalesce((
      select jsonb_agg(x.a order by x.sort_order) from (
        select s.sort_order, jsonb_build_object('id', s.id, 'code', s.code, 'name', s.name, 'statement', s.statement, 'class', s.class,
               'amounts', jsonb_object_agg(b.period, b.amount)) as a
          from public.source_accounts s
          join public.account_balances b on b.account_id = s.id and b.period between v_from and r.period_end
         where s.company_id = c.id and s.version = c.data_version
         group by s.id
      ) x), '[]'::jsonb),
    'commentary', coalesce((select jsonb_object_agg(cm.section, cm.body) from public.commentary cm
                            where cm.company_id = c.id and cm.period_key = r.period_type || ':' || r.period_end), '{}'::jsonb),
    'accepted', coalesce((select (select jsonb_agg(jsonb_build_object('title', x ->> 'title', 'period', x ->> 'period', 'reason', x ->> 'reason'))
                                    from jsonb_array_elements(coalesce(i.report -> 'accepted', '[]'::jsonb)) x)
                          from public.imports i where i.company_id = c.id and i.data_version = c.data_version and i.action = 'import'
                          order by i.created_at desc limit 1), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- last admin
-- Demoting or removing the only admin would lock everyone out of the organisation's settings.
-- Deleting the organisation itself (its memberships cascade) or the user's account is still allowed.
create or replace function private.keep_an_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role <> 'admin' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.role = 'admin' then return new; end if;
  if not exists (select 1 from public.organizations where id = old.org_id) then return coalesce(new, old); end if;
  if not exists (select 1 from auth.users where id = old.user_id) then return coalesce(new, old); end if;
  if not exists (select 1 from public.memberships where org_id = old.org_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'an organisation needs at least one admin';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_keep_admin before update of role or delete on public.memberships
  for each row execute function private.keep_an_admin();
