-- 0016: closes four holes found in an independent security review. Needs 0015. Nothing is removed from the data.
--  1. Rate limits are counted per named scope whose window and limit live in the database: a caller can no longer reset
--     their own counter (by passing a 1-second window) or fill someone else's (a user's or company's counter can only be
--     counted by that user or a member of that company).
--  2. A stored Odoo API key follows the Odoo it was saved for: changing the address, database or login clears it, so it can
--     never be sent to another server.
--  3. Memberships are added only through invitations; a membership's person or organisation cannot be changed.
--  4. Stock records are written only through the upload functions (which check the company and the upload together).

-- ---------------------------------------------------------------- 1. rate limits by scope
create table if not exists private.rate_scopes (
  scope text primary key,
  -- who the subject is: 'user' (must be the caller), 'company' or 'org' (the caller must be a member), 'anon' (an address or link)
  subject_kind text not null check (subject_kind in ('user', 'company', 'org', 'anon')),
  window_s integer not null check (window_s between 1 and 604800),
  max_hits integer not null check (max_hits between 1 and 100000)
);
insert into private.rate_scopes (scope, subject_kind, window_s, max_hits) values
  ('invite', 'org', 86400, 30),
  ('pdf_read_company', 'company', 86400, 200),
  ('pdf_read_user', 'user', 86400, 400),
  ('ai_company', 'company', 86400, 20),
  ('ai_user', 'user', 86400, 60),
  ('pdf_render_user', 'user', 3600, 30),
  ('pdf_render_ip', 'anon', 600, 5),
  ('pdf_render_token', 'anon', 3600, 20),
  ('export', 'user', 3600, 20),
  ('odoo', 'user', 3600, 20),
  ('import', 'user', 3600, 60),
  ('inventory', 'user', 3600, 60),
  ('expenses', 'user', 3600, 60),
  ('sales', 'user', 3600, 60)
on conflict (scope) do update set subject_kind = excluded.subject_kind, window_s = excluded.window_s, max_hits = excluded.max_hits;
revoke all on private.rate_scopes from public, anon, authenticated;

-- True when the call is allowed (and counted), false when the limit for this scope and subject is reached.
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
  if s.subject_kind = 'company' and not private.is_member(private.company_org(p_subject::uuid)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.subject_kind = 'org' and not private.is_member(p_subject::uuid) then raise exception 'not allowed' using errcode = '42501'; end if;
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
-- The old form let the caller choose the window and limit.
revoke execute on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. the Odoo key follows its Odoo
create or replace function private.odoo_key_follows_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A new address, database or login without a new key: the old key is dropped (it must be typed again).
  if (new.url, new.db, new.login) is distinct from (old.url, old.db, old.login) and new.api_key_enc = old.api_key_enc then
    new.api_key_enc := '';
  end if;
  return new;
end $$;
drop trigger if exists odoo_key_follows_target on public.odoo_connections;
create trigger odoo_key_follows_target before update on public.odoo_connections
  for each row execute function private.odoo_key_follows_target();
revoke execute on function private.odoo_key_follows_target() from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. memberships only through invitations
revoke insert on public.memberships from authenticated;
create or replace function private.membership_fixed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id or new.org_id is distinct from old.org_id then
    raise exception 'a membership''s person and organisation cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists membership_fixed on public.memberships;
create trigger membership_fixed before update on public.memberships
  for each row execute function private.membership_fixed();
revoke execute on function private.membership_fixed() from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. stock records only through the upload functions
revoke insert, update, delete on public.inventory_batches, public.stock_layers, public.stock_moves, public.stock_onhand,
  public.inventory_products from authenticated;
-- The ledger's stock postings are still cleared by month when the accounts change (an editor of the company only, by RLS);
-- they are only added through the upload functions.
revoke insert on public.stock_ledger_batches, public.stock_ledger_lines from authenticated;
revoke update on public.stock_ledger_lines from authenticated;
