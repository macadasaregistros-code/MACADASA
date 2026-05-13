create or replace view public.v_raw_validation_sources as
select
  app_name,
  source_name,
  spreadsheet_id,
  sheet_name,
  count(*)::integer as rows_count,
  min(first_synced_at) as first_synced_at,
  max(last_synced_at) as last_synced_at,
  max(source_updated_at) as latest_source_updated_at,
  min(source_row_number) as first_source_row_number,
  max(source_row_number) as last_source_row_number
from public.raw_appsheet_records
group by
  app_name,
  source_name,
  spreadsheet_id,
  sheet_name;

create or replace view public.v_raw_validation_records as
select
  id,
  source_uid,
  source_name,
  app_name,
  spreadsheet_id,
  sheet_name,
  source_row_number,
  source_primary_key,
  source_updated_at,
  row_hash,
  raw_data,
  normalized_data,
  is_active,
  first_synced_at,
  last_synced_at,
  last_sync_run_id,
  created_at,
  updated_at,
  concat_ws(
    ' ',
    source_uid,
    source_name,
    app_name,
    sheet_name,
    source_primary_key,
    raw_data::text
  ) as raw_search_text
from public.raw_appsheet_records;
