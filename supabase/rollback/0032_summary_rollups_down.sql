-- Undoes 0032 (kept summaries for Sales, Expenses and Payments). Safe with either app version: the app falls back to the
-- summary functions, which 0032 never changed. Paste into the SQL editor only if 0032 has to be withdrawn.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ireport-summary-rollups';
  end if;
end $$;
do $$
declare t text;
begin
  foreach t in array array['sales_lines', 'expense_lines', 'payment_lines', 'payment_batches', 'aged_reports', 'aged_items'] loop
    execute format('drop trigger if exists %1$s_summary_ins on public.%1$s', t);
    execute format('drop trigger if exists %1$s_summary_upd on public.%1$s', t);
    execute format('drop trigger if exists %1$s_summary_del on public.%1$s', t);
  end loop;
end $$;
drop function if exists public.summary_state(uuid, text, bigint);
drop function if exists private.refresh_summary_rollups(integer);
drop function if exists private.build_summary(uuid, text);
drop function if exists private.sales_summary_calc(uuid);
drop function if exists private.expense_summary_calc(uuid, text, text);
drop function if exists private.payments_summary_calc(uuid);
drop function if exists private.mark_summary_rows();
drop function if exists private.mark_summary(uuid, text);
drop table if exists private.summary_marks;
drop table if exists public.summary_rollups;
drop sequence if exists private.summary_mark_seq;
