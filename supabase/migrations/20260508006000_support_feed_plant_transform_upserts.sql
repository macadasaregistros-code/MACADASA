alter table if exists public.feed_formula_lines
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists feed_formula_lines_source_uid_uidx
  on public.feed_formula_lines (source_uid);

alter table if exists public.feed_production_materials
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists feed_production_materials_source_uid_uidx
  on public.feed_production_materials (source_uid);

alter table if exists public.feed_production_outputs
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists feed_production_outputs_source_uid_uidx
  on public.feed_production_outputs (source_uid);
