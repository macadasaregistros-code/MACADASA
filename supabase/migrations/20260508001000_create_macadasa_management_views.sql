create or replace view public.v_macadasa_raw_sync_summary as
select
  sr.id as sync_run_id,
  sr.started_at,
  sr.finished_at,
  sr.status,
  sr.mode,
  sr.total_sources,
  sr.total_rows_read,
  sr.total_rows_inserted,
  sr.total_rows_updated,
  sr.total_rows_unchanged,
  sr.total_errors,
  coalesce(count(sri.id), 0) as source_items_count,
  coalesce(count(*) filter (where sri.status = 'failed'), 0) as failed_sources_count
from public.sync_runs sr
left join public.sync_run_items sri on sri.sync_run_id = sr.id
group by sr.id;

create or replace view public.v_macadasa_raw_records_by_source as
select
  rar.source_name,
  rar.app_name,
  rar.spreadsheet_id,
  rar.sheet_name,
  count(*) as records_count,
  min(rar.first_synced_at) as first_synced_at,
  max(rar.last_synced_at) as last_synced_at,
  max(rar.updated_at) as latest_record_updated_at
from public.raw_appsheet_records rar
group by
  rar.source_name,
  rar.app_name,
  rar.spreadsheet_id,
  rar.sheet_name;

create or replace view public.v_inventory_balance_latest as
select
  ranked.id,
  ranked.warehouse_id,
  w.name as warehouse_name,
  ranked.item_id,
  i.code as item_code,
  i.name as item_name,
  ranked.production_lot_id,
  pl.lot_code,
  ranked.snapshot_date,
  ranked.quantity,
  ranked.unit,
  ranked.valuation_amount,
  ranked.updated_at
from (
  select
    ib.*,
    row_number() over (
      partition by ib.warehouse_id, ib.item_id, ib.production_lot_id
      order by ib.snapshot_date desc, ib.updated_at desc
    ) as row_rank
  from public.inventory_balances ib
) ranked
left join public.warehouses w on w.id = ranked.warehouse_id
left join public.items i on i.id = ranked.item_id
left join public.production_lots pl on pl.id = ranked.production_lot_id
where ranked.row_rank = 1;

create or replace view public.v_financial_open_documents as
select
  fd.id,
  fd.document_type,
  fd.document_subtype,
  fd.document_number,
  fd.issue_date,
  fd.due_date,
  fd.status,
  fd.total_amount,
  fd.paid_amount,
  greatest(fd.total_amount - fd.paid_amount, 0) as open_amount,
  fd.currency,
  tp.name as third_party_name,
  bu.name as business_unit_name,
  cc.name as cost_center_name
from public.financial_documents fd
left join public.third_parties tp on tp.id = fd.third_party_id
left join public.business_units bu on bu.id = fd.business_unit_id
left join public.cost_centers cc on cc.id = fd.cost_center_id
where fd.status is distinct from 'cancelled'
  and greatest(fd.total_amount - fd.paid_amount, 0) > 0;

create or replace view public.v_cash_movements_monthly as
select
  date_trunc('month', cm.movement_date)::date as month_start,
  cm.direction,
  bu.name as business_unit_name,
  cc.name as cost_center_name,
  count(*) as movements_count,
  sum(cm.amount) as total_amount
from public.cash_movements cm
left join public.business_units bu on bu.id = cm.business_unit_id
left join public.cost_centers cc on cc.id = cm.cost_center_id
group by
  date_trunc('month', cm.movement_date)::date,
  cm.direction,
  bu.name,
  cc.name;

create or replace view public.v_layer_daily_kpis as
select
  ldr.record_date,
  bu.name as business_unit_name,
  pl.lot_code,
  ph.name as poultry_house_name,
  sum(ldr.feed_bags) as feed_bags,
  sum(ldr.mortality_count) as mortality_count,
  sum(ldr.cull_count) as cull_count,
  sum(ldr.sacrifice_count) as sacrifice_count,
  sum(ldr.sale_count) as sale_count,
  sum(ldr.mdv_count) as mdv_count,
  sum(ldr.bird_exit_count) as bird_exit_count,
  sum(ldr.egg_production_count) as egg_production_count,
  avg(ldr.pp) as avg_pp,
  avg(ldr.guide_pp) as avg_guide_pp
from public.layer_daily_records ldr
left join public.business_units bu on bu.id = ldr.business_unit_id
left join public.production_lots pl on pl.id = ldr.production_lot_id
left join public.poultry_houses ph on ph.id = ldr.poultry_house_id
group by
  ldr.record_date,
  bu.name,
  pl.lot_code,
  ph.name;

create or replace view public.v_store_purchase_summary as
select
  sp.purchase_date,
  s.store_name,
  tp.name as third_party_name,
  sp.item_type,
  sp.status,
  sum(sp.quantity) as total_quantity,
  count(*) as purchases_count
from public.store_purchases sp
left join public.stores s on s.id = sp.store_id
left join public.third_parties tp on tp.id = s.third_party_id
group by
  sp.purchase_date,
  s.store_name,
  tp.name,
  sp.item_type,
  sp.status;

create or replace view public.v_external_reference_coverage as
select
  er.entity_table,
  er.source_name,
  count(*) as mapped_records_count,
  min(er.first_seen_at) as first_seen_at,
  max(er.last_seen_at) as last_seen_at
from public.external_references er
group by er.entity_table, er.source_name;
