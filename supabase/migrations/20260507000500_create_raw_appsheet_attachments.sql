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

create table if not exists public.raw_appsheet_attachments (
  id uuid primary key default gen_random_uuid(),
  attachment_uid text not null unique,
  raw_record_source_uid text not null references public.raw_appsheet_records(source_uid) on delete cascade,
  source_name text not null,
  app_name text not null,
  spreadsheet_id text not null,
  sheet_name text not null,
  source_row_number integer null,
  source_primary_key text null,
  column_name text not null,
  file_ref text not null,
  file_name text null,
  file_extension text null,
  file_kind text not null default 'other',
  mime_type text null,
  drive_file_id text null,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_sync_run_id uuid null references public.sync_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint raw_appsheet_attachments_file_kind_check
    check (file_kind in ('image', 'pdf', 'spreadsheet', 'document', 'other'))
);

drop trigger if exists set_raw_appsheet_attachments_updated_at on public.raw_appsheet_attachments;
create trigger set_raw_appsheet_attachments_updated_at
before update on public.raw_appsheet_attachments
for each row
execute function public.set_updated_at();

create index if not exists raw_appsheet_attachments_raw_record_source_uid_idx
  on public.raw_appsheet_attachments (raw_record_source_uid);

create index if not exists raw_appsheet_attachments_source_name_idx
  on public.raw_appsheet_attachments (source_name);

create index if not exists raw_appsheet_attachments_file_kind_idx
  on public.raw_appsheet_attachments (file_kind);

create index if not exists raw_appsheet_attachments_drive_file_id_idx
  on public.raw_appsheet_attachments (drive_file_id);
