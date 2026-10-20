-- 0034: a viewer could count against an editor's or admin's shared allowance (rate_limit_hit checked membership only for
-- company and organisation scopes), e.g. 20 calls to "reset" and the company's editors could not clear data for an
-- hour. Company scopes now need an editor, the organisation scope (invites) an admin. User and visitor scopes are
-- unchanged. Replaces one function; independent of 0032 and 0033.
create or replace function public.rate_limit_hit(p_scope text, p_subject text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s private.rate_scopes;
  k text;
  n integer;
begin
  select * into s from private.rate_scopes where scope = p_scope;
  if not found or p_subject is null or length(p_subject) = 0 or length(p_subject) > 80 then raise exception 'invalid rate limit'; end if;
  if s.subject_kind = 'user' and p_subject is distinct from (select auth.uid())::text then raise exception 'not allowed' using errcode = '42501'; end if;
  -- Every company allowance belongs to an editor's action (clearing data, AI commentary, reading a PDF, Odoo), and the
  -- organisation one to an admin's (invites): only they may count against it, so a viewer cannot use it up.
  if s.subject_kind = 'company' and not private.is_member(private.company_org(p_subject::uuid), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.subject_kind = 'org' and not private.is_member(p_subject::uuid, 'admin') then raise exception 'not allowed' using errcode = '42501'; end if;
  k := p_scope || ':' || p_subject;
  delete from private.rate_events where key = k and at < now() - make_interval(secs => s.window_s);
  if random() < 0.01 then delete from private.rate_events where at < now() - interval '8 days'; end if;
  select count(*) into n from private.rate_events where key = k;
  if n >= s.max_hits then return false; end if;
  insert into private.rate_events (key) values (k);
  return true;
end $$;

revoke execute on function public.rate_limit_hit(text, text) from public;
grant execute on function public.rate_limit_hit(text, text) to anon, authenticated;
