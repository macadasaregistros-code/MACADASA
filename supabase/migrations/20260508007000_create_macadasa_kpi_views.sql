-- KPI views for the MACADASA management app.
-- These views read only from normalized tables, not from raw_data.

create or replace view public.v_kpi_postura_lote_diario as
with daily as (
  select
    ldr.id,
    ldr.record_date,
    bu.name as business_unit_name,
    pl.id as production_lot_id,
    pl.lot_code,
    pl.name as lot_name,
    pl.initial_birds,
    ph.id as poultry_house_id,
    ph.name as poultry_house_name,
    ldr.week_number,
    ldr.day_number,
    coalesce(ldr.feed_bags, 0) as feed_bags,
    coalesce(ldr.mortality_count, 0) as mortality_count,
    coalesce(ldr.cull_count, 0) as cull_count,
    coalesce(ldr.sacrifice_count, 0) as sacrifice_count,
    coalesce(ldr.sale_count, 0) as sale_count,
    coalesce(ldr.mdv_count, 0) as mdv_count,
    coalesce(ldr.bird_exit_count, 0) as bird_exit_count,
    coalesce(ldr.egg_production_count, 0) as egg_production_count,
    ldr.calcium_amount,
    ldr.litter_amount,
    ldr.guide_pp,
    ldr.pp,
    ldr.notes
  from public.layer_daily_records ldr
  left join public.business_units bu on bu.id = ldr.business_unit_id
  left join public.production_lots pl on pl.id = ldr.production_lot_id
  left join public.poultry_houses ph on ph.id = ldr.poultry_house_id
),
cumulative as (
  select
    daily.*,
    sum(mortality_count) over (
      partition by production_lot_id
      order by record_date, id
      rows between unbounded preceding and current row
    ) as cumulative_mortality_count,
    sum(cull_count + sacrifice_count + sale_count + mdv_count + bird_exit_count) over (
      partition by production_lot_id
      order by record_date, id
      rows between unbounded preceding and current row
    ) as cumulative_other_exits_count
  from daily
)
select
  cumulative.*,
  cumulative_mortality_count + cumulative_other_exits_count as cumulative_total_exits_count,
  greatest(
    coalesce(initial_birds, 0) - cumulative_mortality_count - cumulative_other_exits_count,
    0
  ) as estimated_birds_alive,
  round(
    (cumulative_mortality_count::numeric / nullif(initial_birds, 0)) * 100,
    4
  ) as cumulative_mortality_pct,
  round(
    (egg_production_count::numeric / nullif(
      greatest(coalesce(initial_birds, 0) - cumulative_mortality_count - cumulative_other_exits_count, 0),
      0
    )) * 100,
    4
  ) as calculated_daily_lay_rate_pct
from cumulative;

create or replace view public.v_kpi_postura_lote_resumen as
select
  pl.id as production_lot_id,
  pl.lot_code,
  pl.name as lot_name,
  ph.name as poultry_house_name,
  pl.initial_birds,
  min(ldr.record_date) as first_record_date,
  max(ldr.record_date) as last_record_date,
  max(ldr.week_number) as latest_week_number,
  count(*) as records_count,
  sum(coalesce(ldr.feed_bags, 0)) as total_feed_bags,
  sum(coalesce(ldr.egg_production_count, 0)) as total_egg_production_count,
  sum(coalesce(ldr.mortality_count, 0)) as total_mortality_count,
  sum(
    coalesce(ldr.cull_count, 0) +
    coalesce(ldr.sacrifice_count, 0) +
    coalesce(ldr.sale_count, 0) +
    coalesce(ldr.mdv_count, 0) +
    coalesce(ldr.bird_exit_count, 0)
  ) as total_other_exits_count,
  greatest(
    coalesce(pl.initial_birds, 0) -
    sum(coalesce(ldr.mortality_count, 0)) -
    sum(
      coalesce(ldr.cull_count, 0) +
      coalesce(ldr.sacrifice_count, 0) +
      coalesce(ldr.sale_count, 0) +
      coalesce(ldr.mdv_count, 0) +
      coalesce(ldr.bird_exit_count, 0)
    ),
    0
  ) as estimated_birds_alive,
  round((sum(coalesce(ldr.mortality_count, 0))::numeric / nullif(pl.initial_birds, 0)) * 100, 4)
    as total_mortality_pct,
  avg(ldr.pp) as avg_reported_pp,
  avg(ldr.guide_pp) as avg_guide_pp
from public.layer_daily_records ldr
left join public.production_lots pl on pl.id = ldr.production_lot_id
left join public.poultry_houses ph on ph.id = ldr.poultry_house_id
group by
  pl.id,
  pl.lot_code,
  pl.name,
  ph.name,
  pl.initial_birds;

create or replace view public.v_kpi_inventario_movimientos_signed as
select
  im.id as inventory_movement_id,
  im.source_uid,
  im.movement_date,
  im.movement_type,
  im.movement_number,
  coalesce(im.destination_warehouse_id, im.warehouse_id) as warehouse_id,
  w.name as warehouse_name,
  il.item_id,
  i.code as item_code,
  i.name as item_name,
  im.production_lot_id,
  pl.lot_code,
  il.quantity as movement_quantity,
  il.unit,
  il.quantity as signed_quantity,
  im.reference,
  im.notes
from public.inventory_movements im
join public.inventory_movement_lines il on il.inventory_movement_id = im.id
left join public.warehouses w on w.id = coalesce(im.destination_warehouse_id, im.warehouse_id)
left join public.items i on i.id = il.item_id
left join public.production_lots pl on pl.id = im.production_lot_id
where im.movement_type in ('in', 'production')

union all

select
  im.id as inventory_movement_id,
  im.source_uid,
  im.movement_date,
  im.movement_type,
  im.movement_number,
  coalesce(im.source_warehouse_id, im.warehouse_id) as warehouse_id,
  w.name as warehouse_name,
  il.item_id,
  i.code as item_code,
  i.name as item_name,
  im.production_lot_id,
  pl.lot_code,
  il.quantity as movement_quantity,
  il.unit,
  -il.quantity as signed_quantity,
  im.reference,
  im.notes
from public.inventory_movements im
join public.inventory_movement_lines il on il.inventory_movement_id = im.id
left join public.warehouses w on w.id = coalesce(im.source_warehouse_id, im.warehouse_id)
left join public.items i on i.id = il.item_id
left join public.production_lots pl on pl.id = im.production_lot_id
where im.movement_type in ('out', 'consumption')

union all

select
  im.id as inventory_movement_id,
  im.source_uid,
  im.movement_date,
  im.movement_type,
  im.movement_number,
  im.source_warehouse_id as warehouse_id,
  w.name as warehouse_name,
  il.item_id,
  i.code as item_code,
  i.name as item_name,
  im.production_lot_id,
  pl.lot_code,
  il.quantity as movement_quantity,
  il.unit,
  -il.quantity as signed_quantity,
  im.reference,
  im.notes
from public.inventory_movements im
join public.inventory_movement_lines il on il.inventory_movement_id = im.id
left join public.warehouses w on w.id = im.source_warehouse_id
left join public.items i on i.id = il.item_id
left join public.production_lots pl on pl.id = im.production_lot_id
where im.movement_type = 'transfer'
  and im.source_warehouse_id is not null

union all

select
  im.id as inventory_movement_id,
  im.source_uid,
  im.movement_date,
  im.movement_type,
  im.movement_number,
  im.destination_warehouse_id as warehouse_id,
  w.name as warehouse_name,
  il.item_id,
  i.code as item_code,
  i.name as item_name,
  im.production_lot_id,
  pl.lot_code,
  il.quantity as movement_quantity,
  il.unit,
  il.quantity as signed_quantity,
  im.reference,
  im.notes
from public.inventory_movements im
join public.inventory_movement_lines il on il.inventory_movement_id = im.id
left join public.warehouses w on w.id = im.destination_warehouse_id
left join public.items i on i.id = il.item_id
left join public.production_lots pl on pl.id = im.production_lot_id
where im.movement_type = 'transfer'
  and im.destination_warehouse_id is not null

union all

select
  im.id as inventory_movement_id,
  im.source_uid,
  im.movement_date,
  im.movement_type,
  im.movement_number,
  coalesce(im.destination_warehouse_id, im.source_warehouse_id, im.warehouse_id) as warehouse_id,
  w.name as warehouse_name,
  il.item_id,
  i.code as item_code,
  i.name as item_name,
  im.production_lot_id,
  pl.lot_code,
  il.quantity as movement_quantity,
  il.unit,
  il.quantity as signed_quantity,
  im.reference,
  im.notes
from public.inventory_movements im
join public.inventory_movement_lines il on il.inventory_movement_id = im.id
left join public.warehouses w on w.id = coalesce(im.destination_warehouse_id, im.source_warehouse_id, im.warehouse_id)
left join public.items i on i.id = il.item_id
left join public.production_lots pl on pl.id = im.production_lot_id
where im.movement_type = 'adjustment';

create or replace view public.v_kpi_inventario_actual as
select
  warehouse_id,
  warehouse_name,
  item_id,
  item_code,
  item_name,
  production_lot_id,
  lot_code,
  max(movement_date) as last_movement_date,
  count(*) as movements_count,
  sum(signed_quantity) as current_quantity,
  sum(signed_quantity) filter (where signed_quantity > 0) as total_in_quantity,
  abs(sum(signed_quantity) filter (where signed_quantity < 0)) as total_out_quantity
from public.v_kpi_inventario_movimientos_signed
where warehouse_id is not null
group by
  warehouse_id,
  warehouse_name,
  item_id,
  item_code,
  item_name,
  production_lot_id,
  lot_code;

create or replace view public.v_kpi_planta_produccion_diaria as
with materials as (
  select
    feed_production_order_id,
    sum(quantity_kg) as material_quantity_kg,
    count(*) as material_lines_count
  from public.feed_production_materials
  group by feed_production_order_id
),
outputs as (
  select
    feed_production_order_id,
    sum(quantity_bags) as output_quantity_bags,
    sum(quantity_kg) as output_quantity_kg,
    count(*) as output_lines_count
  from public.feed_production_outputs
  group by feed_production_order_id
)
select
  fpo.production_date,
  ff.formula_code,
  ff.formula_name,
  i.code as output_item_code,
  i.name as output_item_name,
  count(*) as production_orders_count,
  sum(coalesce(fpo.batches, 0)) as total_batches,
  sum(coalesce(fpo.theoretical_bags, 0)) as theoretical_bags,
  sum(coalesce(fpo.practical_bags, 0)) as practical_bags,
  sum(coalesce(outputs.output_quantity_bags, 0)) as output_quantity_bags,
  sum(coalesce(outputs.output_quantity_kg, 0)) as output_quantity_kg,
  sum(coalesce(materials.material_quantity_kg, 0)) as material_quantity_kg,
  sum(coalesce(materials.material_lines_count, 0)) as material_lines_count
from public.feed_production_orders fpo
left join public.feed_formulas ff on ff.id = fpo.formula_id
left join public.items i on i.id = fpo.output_item_id
left join materials on materials.feed_production_order_id = fpo.id
left join outputs on outputs.feed_production_order_id = fpo.id
group by
  fpo.production_date,
  ff.formula_code,
  ff.formula_name,
  i.code,
  i.name;

create or replace view public.v_kpi_planta_costos_mensuales as
with admin_costs as (
  select
    date_trunc('month', period_date)::date as month_start,
    sum(total_amount) as admin_total_amount,
    sum(budgeted_kg) as admin_budgeted_kg
  from public.admin_cost_periods
  group by date_trunc('month', period_date)::date
),
maquila_costs as (
  select
    date_trunc('month', period_date)::date as month_start,
    sum(total_amount) as maquila_total_amount,
    sum(budgeted_kg) as maquila_budgeted_kg
  from public.maquila_cost_periods
  group by date_trunc('month', period_date)::date
)
select
  coalesce(admin_costs.month_start, maquila_costs.month_start) as month_start,
  coalesce(admin_total_amount, 0) as admin_total_amount,
  coalesce(admin_budgeted_kg, 0) as admin_budgeted_kg,
  round(coalesce(admin_total_amount, 0) / nullif(admin_budgeted_kg, 0), 6) as admin_cost_per_kg,
  coalesce(maquila_total_amount, 0) as maquila_total_amount,
  coalesce(maquila_budgeted_kg, 0) as maquila_budgeted_kg,
  round(coalesce(maquila_total_amount, 0) / nullif(maquila_budgeted_kg, 0), 6) as maquila_cost_per_kg,
  coalesce(admin_total_amount, 0) + coalesce(maquila_total_amount, 0) as combined_total_amount,
  round(
    (coalesce(admin_total_amount, 0) + coalesce(maquila_total_amount, 0)) /
    nullif(greatest(coalesce(admin_budgeted_kg, 0), coalesce(maquila_budgeted_kg, 0)), 0),
    6
  ) as combined_cost_per_kg
from admin_costs
full join maquila_costs on maquila_costs.month_start = admin_costs.month_start;

create or replace view public.v_kpi_clasificadora_diaria as
select
  egr.grading_date,
  pl.lot_code,
  ph.name as poultry_house_name,
  i.code as item_code,
  i.name as item_name,
  count(*) as records_count,
  sum(coalesce(egr.quantity, 0)) as quantity
from public.egg_grading_records egr
left join public.production_lots pl on pl.id = egr.production_lot_id
left join public.poultry_houses ph on ph.id = egr.poultry_house_id
left join public.items i on i.id = egr.item_id
group by
  egr.grading_date,
  pl.lot_code,
  ph.name,
  i.code,
  i.name;

create or replace view public.v_kpi_clasificadora_salidas_diarias as
select
  ego.output_date,
  ego.destination,
  i.code as item_code,
  i.name as item_name,
  count(*) as lines_count,
  sum(coalesce(egol.packs, 0)) as packs,
  sum(coalesce(egol.eggs, 0)) as eggs,
  sum(coalesce(egol.quantity, 0)) as quantity
from public.egg_grading_outputs ego
join public.egg_grading_output_lines egol on egol.egg_grading_output_id = ego.id
left join public.items i on i.id = egol.item_id
group by
  ego.output_date,
  ego.destination,
  i.code,
  i.name;

create or replace view public.v_kpi_finanzas_documentos_mensual as
select
  date_trunc('month', fd.issue_date)::date as month_start,
  fd.direction,
  fd.document_type,
  fd.document_subtype,
  fd.status,
  count(*) as documents_count,
  sum(fd.total_amount) as total_amount,
  sum(fd.paid_amount) as paid_amount,
  sum(greatest(fd.total_amount - fd.paid_amount, 0)) as open_amount
from public.financial_documents fd
where fd.status is distinct from 'void'
group by
  date_trunc('month', fd.issue_date)::date,
  fd.direction,
  fd.document_type,
  fd.document_subtype,
  fd.status;

create or replace view public.v_kpi_finanzas_caja_mensual as
select
  date_trunc('month', cm.movement_date)::date as month_start,
  sum(cm.amount) filter (where cm.direction = 'income') as income_amount,
  sum(cm.amount) filter (where cm.direction = 'expense') as expense_amount,
  sum(cm.amount) filter (where cm.direction = 'transfer') as transfer_amount,
  sum(cm.amount) filter (where cm.direction = 'adjustment') as adjustment_amount,
  coalesce(sum(cm.amount) filter (where cm.direction = 'income'), 0) -
  coalesce(sum(cm.amount) filter (where cm.direction = 'expense'), 0) as net_cash_amount,
  count(*) as movements_count
from public.cash_movements cm
group by date_trunc('month', cm.movement_date)::date;

create or replace view public.v_kpi_tienda_resumen_diario as
with purchases as (
  select
    purchase_date as summary_date,
    count(*) as store_purchase_records,
    count(distinct store_id) as stores_with_purchase_records,
    sum(coalesce(quantity, 0)) as store_purchase_quantity
  from public.store_purchases
  group by purchase_date
),
inventory_counts as (
  select
    count_date as summary_date,
    count(*) as inventory_count_records,
    sum(coalesce(quantity, 0)) as inventory_count_quantity
  from public.store_egg_inventory_counts
  group by count_date
),
chicken_weights as (
  select
    cwb.weighing_date as summary_date,
    count(distinct cwb.id) as chicken_weight_batches,
    count(cwl.id) as chicken_weight_lines,
    sum(coalesce(cwb.quantity, 0)) as chicken_units,
    sum(coalesce(cwl.weight_kg, 0)) as chicken_weight_kg
  from public.chicken_weight_batches cwb
  left join public.chicken_weight_lines cwl on cwl.chicken_weight_batch_id = cwb.id
  group by cwb.weighing_date
),
dates as (
  select summary_date from purchases
  union
  select summary_date from inventory_counts
  union
  select summary_date from chicken_weights
)
select
  dates.summary_date,
  coalesce(purchases.store_purchase_records, 0) as store_purchase_records,
  coalesce(purchases.stores_with_purchase_records, 0) as stores_with_purchase_records,
  coalesce(purchases.store_purchase_quantity, 0) as store_purchase_quantity,
  coalesce(inventory_counts.inventory_count_records, 0) as inventory_count_records,
  coalesce(inventory_counts.inventory_count_quantity, 0) as inventory_count_quantity,
  coalesce(chicken_weights.chicken_weight_batches, 0) as chicken_weight_batches,
  coalesce(chicken_weights.chicken_weight_lines, 0) as chicken_weight_lines,
  coalesce(chicken_weights.chicken_units, 0) as chicken_units,
  coalesce(chicken_weights.chicken_weight_kg, 0) as chicken_weight_kg
from dates
left join purchases on purchases.summary_date = dates.summary_date
left join inventory_counts on inventory_counts.summary_date = dates.summary_date
left join chicken_weights on chicken_weights.summary_date = dates.summary_date;

create or replace view public.v_kpi_sync_transform_health as
with latest_sync as (
  select *
  from public.sync_runs
  order by started_at desc
  limit 1
),
latest_transforms as (
  select distinct on (transform_name)
    transform_name,
    started_at,
    finished_at,
    status,
    records_processed,
    records_inserted,
    records_updated,
    records_failed
  from public.transform_runs
  order by transform_name, started_at desc
)
select
  'sync'::text as process_type,
  'google_sheets_to_raw'::text as process_name,
  latest_sync.started_at,
  latest_sync.finished_at,
  latest_sync.status,
  latest_sync.total_rows_read as records_processed,
  latest_sync.total_rows_inserted as records_inserted,
  latest_sync.total_rows_updated as records_updated,
  latest_sync.total_errors as records_failed
from latest_sync

union all

select
  'transform'::text as process_type,
  latest_transforms.transform_name as process_name,
  latest_transforms.started_at,
  latest_transforms.finished_at,
  latest_transforms.status,
  latest_transforms.records_processed,
  latest_transforms.records_inserted,
  latest_transforms.records_updated,
  latest_transforms.records_failed
from latest_transforms;

create or replace view public.v_data_quality_alerts as
with alerts as (
  select
    'critical'::text as severity,
    'integration'::text as area,
    'sync_failures_last_7_days'::text as alert_code,
    'sync_runs'::text as entity_table,
    count(*)::bigint as issue_count,
    'Sync runs failed or with errors in the last 7 days.'::text as detail
  from public.sync_runs
  where started_at >= now() - interval '7 days'
    and (status <> 'success' or coalesce(total_errors, 0) > 0)

  union all

  select
    'critical',
    'integration',
    'transform_failures_last_7_days',
    'transform_runs',
    count(*)::bigint,
    'Transform runs failed or with failed records in the last 7 days.'
  from public.transform_runs
  where started_at >= now() - interval '7 days'
    and (status <> 'success' or coalesce(records_failed, 0) > 0)

  union all

  select
    'high',
    'inventory',
    'negative_inventory_from_movements',
    'v_kpi_inventario_actual',
    count(*)::bigint,
    'Items with negative derived inventory from normalized movements.'
  from public.v_kpi_inventario_actual
  where current_quantity < 0

  union all

  select
    'high',
    'postura',
    'layer_daily_records_missing_lot',
    'layer_daily_records',
    count(*)::bigint,
    'Layer daily records without production lot.'
  from public.layer_daily_records
  where production_lot_id is null

  union all

  select
    'high',
    'postura',
    'layer_daily_records_missing_house',
    'layer_daily_records',
    count(*)::bigint,
    'Layer daily records without poultry house.'
  from public.layer_daily_records
  where poultry_house_id is null

  union all

  select
    'medium',
    'postura',
    'vaccinations_missing_item',
    'vaccinations',
    count(*)::bigint,
    'Vaccination records without vaccine/item.'
  from public.vaccinations
  where item_id is null

  union all

  select
    'high',
    'clasificadora',
    'egg_grading_records_missing_item',
    'egg_grading_records',
    count(*)::bigint,
    'Egg grading records without item.'
  from public.egg_grading_records
  where item_id is null

  union all

  select
    'high',
    'tienda',
    'store_purchases_missing_store',
    'store_purchases',
    count(*)::bigint,
    'Store purchases without linked store.'
  from public.store_purchases
  where store_id is null

  union all

  select
    'medium',
    'attachments',
    'raw_attachments_not_promoted',
    'raw_appsheet_attachments',
    count(raa.id)::bigint,
    'Raw attachments without promoted attachment reference.'
  from public.raw_appsheet_attachments raa
  left join public.attachments a on a.raw_attachment_id = raa.id
  where a.id is null

  union all

  select
    'medium',
    'finance',
    'overdue_open_financial_documents',
    'financial_documents',
    count(*)::bigint,
    'Open financial documents past due date.'
  from public.financial_documents
  where due_date < current_date
    and status not in ('paid', 'void')
    and greatest(total_amount - paid_amount, 0) > 0
)
select *
from alerts
where issue_count > 0;
