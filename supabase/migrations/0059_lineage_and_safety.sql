-- 0059: the universal reference's acceptance tests (duplicates, rollback, lineage, currency). Safe to run again.
--
-- Duplicate files (acceptance test 2). An upload records the SHA-256 of the file it came from. Adding the same file
-- again to the cash book is refused, naming the earlier upload, instead of counting every entry twice. Replacing months
-- with it stays allowed (it replaces, so nothing doubles). An unfinished upload never blocks a retry.

alter table public.cash_uploads add column if not exists file_hash text check (file_hash is null or file_hash ~ '^[0-9a-f]{64}$');
create index if not exists cash_uploads_hash on public.cash_uploads (company_id, file_hash) where file_hash is not null;

drop function if exists public.cash_upload_begin(uuid, text, text[], text, integer, text[]);
create or replace function public.cash_upload_begin(p_company uuid, p_filename text, p_months text[], p_mode text, p_skipped integer default 0,
  p_directions text[] default '{in,out}', p_file_hash text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_seen record;
begin
  perform private.cash_editor(p_company);
  if p_mode not in ('add', 'replace_months') then raise exception 'unknown mode' using errcode = '22023'; end if;
  if coalesce(array_length(p_months, 1), 0) > 600 or exists (select 1 from unnest(p_months) m where m !~ '^\d{4}-(0[1-9]|1[0-2])$') then
    raise exception 'months must be YYYY-MM (at most 600)' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_directions), 0) = 0 or not (p_directions <@ array['in', 'out']) then raise exception 'directions are in and out' using errcode = '22023'; end if;
  if p_file_hash is not null and p_file_hash !~ '^[0-9a-f]{64}$' then raise exception 'the file fingerprint is not a SHA-256' using errcode = '22023'; end if;
  if p_mode = 'add' and p_file_hash is not null then
    select filename, created_at into v_seen from public.cash_uploads
      where company_id = p_company and file_hash = p_file_hash and status = 'done' order by created_at desc limit 1;
    if found then
      raise exception 'This file was already saved (% on %). Adding it again would count every entry twice; choose "Replace these months" instead.',
        v_seen.filename, to_char(v_seen.created_at, 'DD Mon YYYY') using errcode = '23505';
    end if;
  end if;
  -- Parts of an upload left open for a day were abandoned.
  delete from public.cash_uploads where company_id = p_company and status = 'open' and created_at < now() - interval '1 day';
  insert into public.cash_uploads (company_id, filename, months, mode, skipped, directions, file_hash)
  values (p_company, left(coalesce(p_filename, ''), 300), coalesce(p_months, '{}'), p_mode, greatest(0, coalesce(p_skipped, 0)), p_directions, p_file_hash)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.cash_upload_begin(uuid, text, text[], text, integer, text[], text) from public, anon;
grant execute on function public.cash_upload_begin(uuid, text, text[], text, integer, text[], text) to authenticated;

do $$ begin
  if to_regprocedure('private.install_tenant_guards()') is not null then perform private.install_tenant_guards(); end if;
end $$;

select private.adopt_company_roles();

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 59 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
