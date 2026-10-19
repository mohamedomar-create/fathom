-- Times each summary function as the signed-in user would call it, under the live 8 s limit (local stack only).
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b16b","role":"authenticated"}', false);
set statement_timeout = '8s';
\timing on
select length(public.expense_summary('00000000-0000-0000-0000-0000000000c1')::text) as expense_bytes;
select length(public.sales_summary('00000000-0000-0000-0000-0000000000c1')::text) as sales_bytes;
select length(public.payments_summary('00000000-0000-0000-0000-0000000000c1')::text) as payments_bytes;
