-- 0036: Simple mode (a Sales and an Expenses sheet, no ERP). Sales lines keep how they were sold (channel), whether
-- they were paid and when; expense lines keep whether they were paid and when. One call reads a company's lines for the
-- Simple pages. Editors can add, edit or delete one line of an uploaded sheet; lines taken from a General Ledger are
-- never edited one by one. Safe to run again; Full mode is unchanged (the new columns are empty for its lines).

alter table public.sales_lines add column if not exists channel text not null default '' check (length(channel) <= 120);
alter table public.sales_lines add column if not exists paid boolean;
alter table public.sales_lines add column if not exists paid_on date;
alter table public.expense_lines add column if not exists paid boolean;
alter table public.expense_lines add column if not exists paid_on date;

-- The line savers take the new keys (absent keys leave them empty, as before).
create or replace function public.add_sales_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.sales_batches;
  v_count integer;
begin
  select * into b from public.sales_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  insert into public.sales_lines (company_id, batch_id, source, day, period, doc, series, customer, product, category, salesperson, qty, amount, cost,
                                  sale_order, end_user, map_method, note, channel, paid, paid_on)
  select b.company_id, b.id, b.source, nullif(l ->> 'day', '')::date, l ->> 'period',
         left(coalesce(l ->> 'doc', ''), 80), left(coalesce(l ->> 'series', ''), 40), left(coalesce(l ->> 'customer', ''), 200),
         left(coalesce(l ->> 'product', ''), 300), left(coalesce(l ->> 'category', ''), 200), left(coalesce(l ->> 'salesperson', ''), 120),
         nullif(l ->> 'qty', '')::numeric, (l ->> 'amount')::numeric, nullif(l ->> 'cost', '')::numeric,
         nullif(left(l ->> 'saleOrder', 80), ''), nullif(left(l ->> 'endUser', 200), ''),
         case when l ->> 'mapMethod' in ('order', 'contact', 'shipping') and nullif(l ->> 'endUser', '') is not null then l ->> 'mapMethod' end,
         nullif(left(l ->> 'note', 200), ''),
         left(coalesce(l ->> 'channel', ''), 120), (l ->> 'paid')::boolean, nullif(l ->> 'paidOn', '')::date
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.add_sales_lines(uuid, jsonb) from public, anon;
grant execute on function public.add_sales_lines(uuid, jsonb) to authenticated;

create or replace function public.add_expense_lines(p_batch uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.expense_batches;
  v_count integer;
begin
  select * into b from public.expense_batches where id = p_batch;
  if not found or not private.is_member(private.company_org(b.company_id), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 5000 then raise exception 'send 1 to 5000 lines'; end if;
  insert into public.expense_lines (company_id, batch_id, source, day, period, doc, series, supplier, account, cls, category, label, amount, paid, paid_on)
  select b.company_id, b.id, b.source, nullif(l ->> 'day', '')::date, l ->> 'period',
         left(coalesce(l ->> 'doc', ''), 80), left(coalesce(l ->> 'series', ''), 40), left(coalesce(l ->> 'supplier', ''), 200),
         left(coalesce(l ->> 'account', ''), 200), nullif(left(coalesce(l ->> 'cls', ''), 40), ''), left(coalesce(l ->> 'category', ''), 200),
         left(coalesce(l ->> 'label', ''), 200), (l ->> 'amount')::numeric, (l ->> 'paid')::boolean, nullif(l ->> 'paidOn', '')::date
  from jsonb_array_elements(p_lines) l
  where l ->> 'period' = any (b.periods) and l ->> 'amount' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke execute on function public.add_expense_lines(uuid, jsonb) from public, anon;
grant execute on function public.add_expense_lines(uuid, jsonb) to authenticated;

-- Everything the Simple pages read, in one call (members). Capped at 100,000 lines a kind.
create or replace function public.simple_lines(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(private.company_org(p_company)) then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'sales', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'day', day, 'period', period, 'doc', doc, 'customer', customer,
        'product', product, 'category', category, 'qty', qty, 'amount', amount, 'cost', cost, 'channel', channel, 'paid', paid, 'paidOn', paid_on) order by period, day, id)
      from (select * from public.sales_lines where company_id = p_company order by period, day, id limit 100000) s), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'day', day, 'period', period, 'doc', doc, 'supplier', supplier,
        'account', account, 'cls', cls, 'category', category, 'label', label, 'amount', amount, 'paid', paid, 'paidOn', paid_on) order by period, day, id)
      from (select * from public.expense_lines where company_id = p_company order by period, day, id limit 100000) e), '[]'::jsonb));
end $$;
revoke execute on function public.simple_lines(uuid) from public, anon;
grant execute on function public.simple_lines(uuid) to authenticated;

-- One line of an uploaded sheet, changed in place (editors). It stays in its month: a different month is a new line.
create or replace function public.update_line(p_kind text, p_id bigint, p_line jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid; v_source text; v_period text; v_day date;
begin
  if p_kind = 'sales' then select company_id, source, period into v_company, v_source, v_period from public.sales_lines where id = p_id;
  elsif p_kind = 'expenses' then select company_id, source, period into v_company, v_source, v_period from public.expense_lines where id = p_id;
  else raise exception 'unknown kind' using errcode = '22023'; end if;
  if v_company is null or v_source <> 'file' or not private.is_member(private.company_org(v_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_day := nullif(p_line ->> 'day', '')::date;
  if v_day is not null and to_char(v_day, 'YYYY-MM') <> v_period then
    raise exception 'a line stays in its month; delete it and add it to the other month' using errcode = '22023';
  end if;
  if p_line ? 'amount' and (p_line ->> 'amount') is null then raise exception 'an amount is needed' using errcode = '22023'; end if;
  if p_kind = 'sales' then
    update public.sales_lines set
      day = coalesce(v_day, day),
      customer = case when p_line ? 'customer' then left(coalesce(p_line ->> 'customer', ''), 200) else customer end,
      product = case when p_line ? 'product' then left(coalesce(p_line ->> 'product', ''), 300) else product end,
      category = case when p_line ? 'category' then left(coalesce(p_line ->> 'category', ''), 200) else category end,
      qty = case when p_line ? 'qty' then nullif(p_line ->> 'qty', '')::numeric else qty end,
      amount = coalesce((p_line ->> 'amount')::numeric, amount),
      cost = case when p_line ? 'cost' then nullif(p_line ->> 'cost', '')::numeric else cost end,
      channel = case when p_line ? 'channel' then left(coalesce(p_line ->> 'channel', ''), 120) else channel end,
      paid = case when p_line ? 'paid' then (p_line ->> 'paid')::boolean else paid end,
      paid_on = case when p_line ? 'paidOn' then nullif(p_line ->> 'paidOn', '')::date else paid_on end
    where id = p_id;
  else
    update public.expense_lines set
      day = coalesce(v_day, day),
      supplier = case when p_line ? 'supplier' then left(coalesce(p_line ->> 'supplier', ''), 200) else supplier end,
      category = case when p_line ? 'category' then left(coalesce(p_line ->> 'category', ''), 200) else category end,
      account = case when p_line ? 'category' then left(coalesce(p_line ->> 'category', ''), 200) else account end,
      cls = case when p_line ? 'cls' and p_line ->> 'cls' in ('exp_fixed', 'exp_variable') then p_line ->> 'cls' else cls end,
      label = case when p_line ? 'label' then left(coalesce(p_line ->> 'label', ''), 200) else label end,
      amount = coalesce((p_line ->> 'amount')::numeric, amount),
      paid = case when p_line ? 'paid' then (p_line ->> 'paid')::boolean else paid end,
      paid_on = case when p_line ? 'paidOn' then nullif(p_line ->> 'paidOn', '')::date else paid_on end
    where id = p_id;
  end if;
end $$;
revoke execute on function public.update_line(text, bigint, jsonb) from public, anon;
grant execute on function public.update_line(text, bigint, jsonb) to authenticated;

create or replace function public.delete_line(p_kind text, p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_company uuid; v_source text;
begin
  if p_kind = 'sales' then select company_id, source into v_company, v_source from public.sales_lines where id = p_id;
  elsif p_kind = 'expenses' then select company_id, source into v_company, v_source from public.expense_lines where id = p_id;
  else raise exception 'unknown kind' using errcode = '22023'; end if;
  if v_company is null or v_source <> 'file' or not private.is_member(private.company_org(v_company), 'editor') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind = 'sales' then delete from public.sales_lines where id = p_id; else delete from public.expense_lines where id = p_id; end if;
end $$;
revoke execute on function public.delete_line(text, bigint) from public, anon;
grant execute on function public.delete_line(text, bigint) to authenticated;

-- One line added by hand (editors): it joins the latest upload that holds its month, or a new "Added in iReport" one.
create or replace function public.add_line(p_company uuid, p_kind text, p_line jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_day date; v_period text; v_batch uuid;
begin
  if not private.is_member(private.company_org(p_company), 'editor') then raise exception 'not allowed' using errcode = '42501'; end if;
  v_day := nullif(p_line ->> 'day', '')::date;
  if v_day is null or (p_line ->> 'amount') is null then raise exception 'a date and an amount are needed' using errcode = '22023'; end if;
  v_period := to_char(v_day, 'YYYY-MM');
  if p_kind = 'sales' then
    select id into v_batch from public.sales_batches where company_id = p_company and source = 'file' and v_period = any (periods) order by created_at desc limit 1;
    if v_batch is null then
      insert into public.sales_batches (company_id, source, filename, periods, created_by) values (p_company, 'file', 'Added in iReport', array[v_period], (select auth.uid())) returning id into v_batch;
    end if;
    return public.add_sales_lines(v_batch, jsonb_build_array(p_line || jsonb_build_object('period', v_period)));
  elsif p_kind = 'expenses' then
    select id into v_batch from public.expense_batches where company_id = p_company and source = 'file' and v_period = any (periods) order by created_at desc limit 1;
    if v_batch is null then
      insert into public.expense_batches (company_id, source, filename, periods, created_by) values (p_company, 'file', 'Added in iReport', array[v_period], (select auth.uid())) returning id into v_batch;
    end if;
    return public.add_expense_lines(v_batch, jsonb_build_array(p_line || jsonb_build_object('period', v_period, 'account', coalesce(p_line ->> 'category', ''))));
  end if;
  raise exception 'unknown kind' using errcode = '22023';
end $$;
revoke execute on function public.add_line(uuid, text, jsonb) from public, anon;
grant execute on function public.add_line(uuid, text, jsonb) to authenticated;

-- Re-uploading a sheet: a line's channel, paid and payment day count in its month's fingerprint when it has one, so a
-- sale that became paid makes its month "changed". Lines without them (every Full-mode line) keep their fingerprint.
create or replace function public.line_months(p_company uuid, p_kind text, p_source text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not private.is_member(private.company_org(p_company)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind = 'sales' then
    select coalesce(jsonb_object_agg(period, jsonb_build_object('n', n, 'print', print)), '{}'::jsonb) into v from (
      select period, count(*) n, encode(sha256(convert_to(string_agg(h, '' order by h collate "C"), 'UTF8')), 'hex') print
      from (select period, encode(sha256(convert_to(
              coalesce(day::text, '') || chr(31) || doc || chr(31) || customer || chr(31) || product || chr(31) || round(amount * 100)::bigint::text
              || chr(31) || coalesce(round(qty * 10000)::bigint::text, '') || chr(31) || coalesce(round(cost * 100)::bigint::text, '')
              || case when channel <> '' or paid is not null or paid_on is not null then chr(31) || channel || chr(31) || coalesce(paid::text, '') || chr(31) || coalesce(paid_on::text, '') else '' end, 'UTF8')), 'hex') h
            from public.sales_lines where company_id = p_company and source = p_source) l
      group by period) m;
  elsif p_kind = 'expenses' then
    select coalesce(jsonb_object_agg(period, jsonb_build_object('n', n, 'print', print)), '{}'::jsonb) into v from (
      select period, count(*) n, encode(sha256(convert_to(string_agg(h, '' order by h collate "C"), 'UTF8')), 'hex') print
      from (select period, encode(sha256(convert_to(
              coalesce(day::text, '') || chr(31) || doc || chr(31) || supplier || chr(31) || account || chr(31) || label || chr(31) || round(amount * 100)::bigint::text
              || case when paid is not null or paid_on is not null then chr(31) || coalesce(paid::text, '') || chr(31) || coalesce(paid_on::text, '') else '' end, 'UTF8')), 'hex') h
            from public.expense_lines where company_id = p_company and source = p_source) l
      group by period) m;
  else
    raise exception 'unknown kind';
  end if;
  return v;
end $$;
