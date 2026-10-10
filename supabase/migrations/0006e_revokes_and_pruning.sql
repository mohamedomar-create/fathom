-- 0006e: run in the Supabase SQL editor (these statements need an owner's confirmation).
-- Prune old rate-limit hits as they are counted, and close access nobody needs.

create or replace function public.hit_rate_limit(p_key text, p_window_s integer, p_max integer)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 120 or p_window_s not between 1 and 604800 or p_max not between 1 and 100000 then
    raise exception 'invalid rate limit';
  end if;
  delete from private.rate_events where key = p_key and at < now() - make_interval(secs => p_window_s);
  if random() < 0.01 then delete from private.rate_events where at < now() - interval '8 days'; end if;
  select count(*) into n from private.rate_events where key = p_key;
  if n >= p_max then return false; end if;
  insert into private.rate_events (key) values (p_key);
  return true;
end $$;

revoke all on private.rate_events from public, anon, authenticated;
revoke execute on function public.hit_rate_limit(text, integer, integer) from public;
grant execute on function public.hit_rate_limit(text, integer, integer) to anon, authenticated;
revoke execute on function private.keep_an_admin() from public, anon, authenticated;

-- Replaced by save_company_version (0005); nothing calls it any more.
revoke execute on function public.replace_company_data(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- Visitors who are not signed in only call get_published_report and hit_rate_limit; they need no table access (RLS already denies it).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
