alter table if exists public.financial_document_lines
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists financial_document_lines_source_uid_uidx
  on public.financial_document_lines (source_uid);

alter table if exists public.payment_allocations
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists payment_allocations_source_uid_uidx
  on public.payment_allocations (source_uid);

alter table if exists public.tax_periods
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists tax_periods_source_uid_uidx
  on public.tax_periods (source_uid);
