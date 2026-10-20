-- A made-up company the size of a large Odoo user: 150 accounts × 64 months, 31k expense lines,
-- 17k sales lines, 22k payments. Local stack only, for timing pages and summary functions under the live limits.
-- Usage: psql -v company="'<uuid>'" -f seed-big.sql   (without -v it creates its own bench user and company)
\if :{?company}
\else
\set company '''00000000-0000-0000-0000-0000000000c1'''
insert into auth.users (id, email, aud, role) values ('00000000-0000-0000-0000-00000000b16b', 'bench@test.local', 'authenticated', 'authenticated') on conflict do nothing;
insert into public.organizations (id, name, created_by) values ('00000000-0000-0000-0000-0000000000b1', 'Bench Org', '00000000-0000-0000-0000-00000000b16b') on conflict do nothing;
insert into public.memberships (org_id, user_id, role) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000b16b', 'admin') on conflict do nothing;
insert into public.companies (id, org_id, name, created_by) values (:company, '00000000-0000-0000-0000-0000000000b1', 'Bench Co', '00000000-0000-0000-0000-00000000b16b') on conflict do nothing;
\endif
-- 150 accounts × 64 months (version 1): 100 P&L accounts, 50 balance-sheet accounts.
delete from public.source_accounts where company_id = :company;
with a as (
  insert into public.source_accounts (company_id, version, code, name, statement, class, mapped_by, sort_order)
  select :company, 1, (case when i <= 100 then 400000 else 100000 end + i)::text, 'Account ' || i, case when i <= 100 then 'PL' else 'BS' end,
         case when i <= 100 then (array['revenue','cos_variable','exp_fixed','exp_variable','other_income'])[1 + i % 5]
              else (array['cash','ar','inventory','fixed_assets','ap','other_cl','ltd'])[1 + i % 7] end, 'auto', i
  from generate_series(1, 150) i returning id, class
), m as (select to_char(date '2021-07-01' + make_interval(months => g), 'YYYY-MM') p from generate_series(0, 63) g)
insert into public.account_balances (account_id, company_id, period, amount)
select a.id, :company, m.p, round((random() * 900000 + 1000)::numeric, 2) * case when a.class in ('revenue','other_income','ap','other_cl','ltd') then -1 else 1 end
from a, m;
update public.companies set data_version = 1 where id = :company;
delete from public.expense_lines where company_id = :company;
delete from public.sales_lines where company_id = :company;
delete from public.payment_lines where company_id = :company;
with m as (select to_char(date '2021-07-01' + make_interval(months => g), 'YYYY-MM') p from generate_series(0, 63) g),
 b as (insert into public.expense_batches (company_id, source, filename, periods) select :company, 'ledger', 'bench', array_agg(p) from m returning id)
insert into public.expense_lines (company_id, batch_id, source, day, period, doc, series, supplier, account, cls, category, label, amount)
select :company, b.id, 'ledger', date '2021-07-01' + (i % 1940), to_char(date '2021-07-01' + (i % 1940), 'YYYY-MM'),
       'BILL/' || i, 'BILL', 'Supplier ' || (i % 900), '5' || lpad((i % 60)::text, 5, '0') || ' Account ' || (i % 60),
       (array['exp_fixed','exp_variable','cos_variable','interest_expenses','other_expenses'])[1 + i % 5], 'Cat ' || (i % 20), 'Line ' || i, round((random() * 20000)::numeric, 2)
from b, generate_series(1, 31300) i;
with m as (select to_char(date '2021-07-01' + make_interval(months => g), 'YYYY-MM') p from generate_series(0, 63) g),
 b as (insert into public.sales_batches (company_id, source, filename, periods) select :company, 'ledger', 'bench', array_agg(p) from m returning id)
insert into public.sales_lines (company_id, batch_id, source, day, period, doc, series, customer, product, category, salesperson, qty, amount, cost)
select :company, b.id, 'ledger', date '2021-07-01' + (i % 1940), to_char(date '2021-07-01' + (i % 1940), 'YYYY-MM'),
       'INV/' || (i / 3), 'INV', 'Customer ' || (i % 700), 'Product ' || (i % 450), 'Cat ' || (i % 15), 'Rep ' || (i % 8), 1 + i % 5, round((random() * 50000)::numeric, 2), null
from b, generate_series(1, 17200) i;
with m as (select to_char(date '2021-07-01' + make_interval(months => g), 'YYYY-MM') p from generate_series(0, 63) g),
 b as (insert into public.payment_batches (company_id, source, filename, periods) select :company, 'ledger', 'bench', array_agg(p) from m returning id)
insert into public.payment_lines (company_id, batch_id, day, period, number, journal, method, partner, direction, amount, currency, amount_currency, state, kind, counter)
select :company, b.id, date '2021-07-01' + (i % 1940), to_char(date '2021-07-01' + (i % 1940), 'YYYY-MM'),
       'BNK/' || i, '1212' || (i % 23) || ' Bank', 'Manual', 'Partner ' || (i % 1200), case when i % 2 = 0 then 'in' else 'out' end,
       round(((random() * 100000) * case when i % 2 = 0 then 1 else -1 end)::numeric, 2), 'EGP', null, 'paid',
       (array['customers','suppliers','transfer','other'])[1 + i % 4], ''
from b, generate_series(1, 22400) i;
analyze public.expense_lines; analyze public.sales_lines; analyze public.payment_lines;
