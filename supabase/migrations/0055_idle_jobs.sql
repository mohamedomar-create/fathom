-- 0055: background jobs that do nothing when there is nothing to do.
--  * private.run_import_jobs (every 5 s): returns at once when no upload is in progress and the clean-up of old
--    uploads ran in the last minute. While uploads are in progress every tick works as before; otherwise the clean-up
--    of old uploads' rows runs once a minute.
--  * private.refresh_inventory_rollups: one refresh at a time (a second caller returns 0).
-- Only replaces the two functions and adds one small table; safe to run again.

create table if not exists private.job_housekeeping (one boolean primary key default true check (one), last_at timestamptz not null default 'epoch');
insert into private.job_housekeeping (one) values (true) on conflict do nothing;
revoke all on private.job_housekeeping from public, anon, authenticated;

create or replace procedure private.run_import_jobs()
language plpgsql
as $$
declare
  v_id uuid;
  v_status text;
  k integer := 0;
  v_busy boolean;
begin
  v_busy := exists (select 1 from public.import_jobs where status in ('preparing', 'queued', 'checking', 'saving'));
  -- Nothing in progress and the clean-up done in the last minute: nothing to do this tick.
  if not v_busy and exists (select 1 from private.job_housekeeping where last_at > now() - interval '1 minute') then
    return;
  end if;
  perform set_config('statement_timeout', '600000', false);
  if v_busy then
    -- An upload no page has sent to for 30 minutes stopped: closed, and its rows cleared (a row being sent is skipped).
    update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
           message = 'The upload stopped before every row was sent. Choose the files again.'
     where id in (select id from public.import_jobs where status = 'preparing' and updated_at < now() - interval '30 minutes' for update skip locked);
    -- A check the database cut off (longer than its 10-minute limit) is failed with its rows kept, so it can be tried again.
    update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
           message = 'The check took too long for the database. Press “Try again”, or upload fewer months at a time.'
     where id in (select id from public.import_jobs where status = 'checking' and updated_at < now() - interval '15 minutes' for update skip locked);
    -- The same for a save (it would otherwise be picked up again on every run, for ever).
    update public.import_jobs set status = 'failed', finished_at = now(), updated_at = now(),
           message = 'The save took too long for the database. Press “Try again”, or upload fewer months at a time.'
     where id in (select id from public.import_jobs where status = 'saving' and updated_at < now() - interval '15 minutes' for update skip locked);
  end if;
  -- Rows of cancelled, stopped and old uploads: cleared on every tick while uploads are in progress (as before), else once a minute.
  if v_busy or not exists (select 1 from private.job_housekeeping where last_at > now() - interval '1 minute') then
    delete from public.import_rows r using public.import_jobs j
     where r.job_id = j.id and (j.status = 'cancelled'
        or (j.status = 'failed' and j.queued_at is null)
        or (j.status in ('done', 'failed', 'needs_review') and j.updated_at < now() - interval '30 days'));
    update private.job_housekeeping set last_at = now();
  end if;
  commit;
  loop
    exit when k >= 5;
    select id, status into v_id, v_status from public.import_jobs where status in ('queued', 'saving') order by queued_at nulls last limit 1 for update skip locked;
    exit when v_id is null;
    k := k + 1;
    if v_status = 'queued' then
      update public.import_jobs set status = 'checking', started_at = coalesce(started_at, now()), updated_at = now() where id = v_id;
      commit;
      perform private.check_import_job(v_id);
      commit;
      select status into v_status from public.import_jobs where id = v_id;
    end if;
    if v_status = 'saving' then
      perform private.apply_import_job(v_id);
      commit;
    end if;
    v_id := null;
  end loop;
end $$;
revoke execute on procedure private.run_import_jobs() from public, anon, authenticated;

create or replace function private.refresh_inventory_rollups(p_limit integer default 5)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_summary jsonb;
  v_error text;
  v_done integer := 0;
begin
  -- One refresh at a time: a tick that finds another one running leaves the work to it.
  if not pg_try_advisory_xact_lock(hashtext('ireport.inventory_rollups')) then return 0; end if;
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

create or replace function public.schema_version() returns integer language sql immutable set search_path = '' as $$ select 55 $$;
revoke execute on function public.schema_version() from public;
grant execute on function public.schema_version() to anon, authenticated;
