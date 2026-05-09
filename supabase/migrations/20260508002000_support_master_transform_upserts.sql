create unique index if not exists external_references_entity_source_key_uidx
  on public.external_references (entity_table, source_name, source_primary_key);

create unique index if not exists third_parties_external_code_unique_idx
  on public.third_parties (external_code)
  where external_code is not null;

alter table if exists public.production_lots
  add column if not exists name text,
  add column if not exists category_id uuid references public.categories(id) on delete set null;

alter table if exists public.warehouses
  add column if not exists category_id uuid references public.categories(id) on delete set null;

alter table if exists public.third_party_details
  add column if not exists source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  add column if not exists source_uid text;

create unique index if not exists third_party_details_source_uid_unique_idx
  on public.third_party_details (source_uid)
  where source_uid is not null;
