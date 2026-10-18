-- A live Odoo sync may keep every month since the company's books start (the main company: July 2021 onward, 64 months and
-- growing), not only the last five years. The sync itself starts no earlier than the books start. Safe to run again.

alter table public.odoo_connections drop constraint if exists odoo_connections_months_history_check;
alter table public.odoo_connections add constraint odoo_connections_months_history_check check (months_history between 2 and 240);
