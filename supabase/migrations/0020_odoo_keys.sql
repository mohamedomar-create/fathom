-- One key per Odoo record, however it was exported.
--
-- Odoo's import-compatible export can carry a record's database ID (".id": 4512) or its External ID ("id"). For a record
-- Odoo named itself, the External ID is "__export__.<model>_<database ID>_<random>", so the two describe the same record.
-- iReport now recognises the ".id" column too; without this, stock saved with External IDs (a real moves export) would
-- look new when the same moves arrive with ".id", and "Add only new" would save every one of them a second time.
-- Every key is reduced to the database ID when it carries one, as rows are staged and as they are saved, and the keys
-- already saved are converted once. Keys built from a row's contents ("fp:…") and other External IDs are unchanged.
-- Safe to run again.

create or replace function private.odoo_key(k text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when k ~ '^__export__\.[A-Za-z0-9_]+_[0-9]+_[0-9a-fA-F]{4,}$'
      then substring(k from '_([0-9]+)_[0-9a-fA-F]{4,}$')
    when k ~ '^[0-9]+\.0+$' then split_part(k, '.', 1)
    else k
  end
$$;

create or replace function private.odoo_key_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.odoo_key := private.odoo_key(new.odoo_key);
  return new;
end $$;

create or replace function private.odoo_key_staged()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.data ? 'odoo_key' and jsonb_typeof(new.data -> 'odoo_key') = 'string' then
    new.data := jsonb_set(new.data, '{odoo_key}', to_jsonb(private.odoo_key(new.data ->> 'odoo_key')));
  end if;
  return new;
end $$;

drop trigger if exists odoo_key_norm on public.stock_layers;
create trigger odoo_key_norm before insert or update of odoo_key on public.stock_layers
  for each row execute function private.odoo_key_row();
drop trigger if exists odoo_key_norm on public.stock_moves;
create trigger odoo_key_norm before insert or update of odoo_key on public.stock_moves
  for each row execute function private.odoo_key_row();
drop trigger if exists odoo_key_norm on public.import_rows;
create trigger odoo_key_norm before insert or update of data on public.import_rows
  for each row execute function private.odoo_key_staged();

-- The keys already saved (on companies that already hold stock).
update public.stock_layers set odoo_key = private.odoo_key(odoo_key) where odoo_key like '\_\_export\_\_.%' and odoo_key <> private.odoo_key(odoo_key);
update public.stock_moves set odoo_key = private.odoo_key(odoo_key) where odoo_key like '\_\_export\_\_.%' and odoo_key <> private.odoo_key(odoo_key);

revoke all on function private.odoo_key(text) from public, anon;
