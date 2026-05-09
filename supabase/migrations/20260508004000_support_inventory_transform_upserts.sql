alter table if exists public.inventory_movement_lines
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists inventory_movement_lines_source_uid_uidx
  on public.inventory_movement_lines (source_uid);

alter table if exists public.inventory_balances
  add column if not exists source_uid text;

create unique index if not exists inventory_balances_source_uid_uidx
  on public.inventory_balances (source_uid);
