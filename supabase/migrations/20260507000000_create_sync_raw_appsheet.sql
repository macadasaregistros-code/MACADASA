create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.sync_sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null unique,
  app_name text not null,
  spreadsheet_id text not null,
  sheet_name text not null,
  target_table text not null default 'raw_appsheet_records',
  primary_key_column text null,
  updated_at_column text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_sync_sources_updated_at on public.sync_sources;
create trigger set_sync_sources_updated_at
before update on public.sync_sources
for each row
execute function public.set_updated_at();

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null default 'running',
  mode text not null,
  total_sources integer not null default 0,
  total_rows_read integer not null default 0,
  total_rows_inserted integer not null default 0,
  total_rows_updated integer not null default 0,
  total_rows_unchanged integer not null default 0,
  total_errors integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  constraint sync_runs_status_check check (status in ('running', 'success', 'partial_success', 'failed')),
  constraint sync_runs_mode_check check (mode in ('live', 'dry_run'))
);

create table if not exists public.sync_run_items (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  source_name text not null,
  app_name text not null,
  spreadsheet_id text not null,
  sheet_name text not null,
  status text not null default 'running',
  rows_read integer not null default 0,
  rows_inserted integer not null default 0,
  rows_updated integer not null default 0,
  rows_unchanged integer not null default 0,
  errors_count integer not null default 0,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint sync_run_items_status_check check (status in ('running', 'success', 'failed'))
);

create table if not exists public.raw_appsheet_records (
  id uuid primary key default gen_random_uuid(),
  source_uid text not null unique,
  source_name text not null,
  app_name text not null,
  spreadsheet_id text not null,
  sheet_name text not null,
  source_row_number integer null,
  source_primary_key text null,
  source_updated_at timestamptz null,
  row_hash text not null,
  raw_data jsonb not null,
  normalized_data jsonb null,
  is_active boolean not null default true,
  first_synced_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  last_sync_run_id uuid null references public.sync_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_raw_appsheet_records_updated_at on public.raw_appsheet_records;
create trigger set_raw_appsheet_records_updated_at
before update on public.raw_appsheet_records
for each row
execute function public.set_updated_at();

create index if not exists raw_appsheet_records_source_name_idx
  on public.raw_appsheet_records (source_name);

create index if not exists raw_appsheet_records_app_name_idx
  on public.raw_appsheet_records (app_name);

create index if not exists raw_appsheet_records_spreadsheet_sheet_idx
  on public.raw_appsheet_records (spreadsheet_id, sheet_name);

create index if not exists raw_appsheet_records_source_primary_key_idx
  on public.raw_appsheet_records (source_primary_key);

create index if not exists raw_appsheet_records_last_synced_at_idx
  on public.raw_appsheet_records (last_synced_at);

create index if not exists raw_appsheet_records_raw_data_gin_idx
  on public.raw_appsheet_records using gin (raw_data);
