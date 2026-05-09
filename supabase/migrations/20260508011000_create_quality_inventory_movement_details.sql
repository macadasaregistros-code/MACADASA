create or replace view public.v_quality_negative_inventory_movements as
with negative_balances as (
  select
    warehouse_id,
    item_id,
    production_lot_id,
    current_quantity
  from public.v_kpi_inventario_actual
  where current_quantity < 0
)
select
  m.warehouse_name,
  m.item_code,
  m.item_name,
  m.lot_code,
  nb.current_quantity as negative_current_quantity,
  m.movement_date,
  m.movement_type,
  m.movement_number,
  m.movement_quantity,
  m.signed_quantity,
  sum(m.signed_quantity) over (
    partition by m.warehouse_id, m.item_id, m.production_lot_id
    order by m.movement_date, m.inventory_movement_id
    rows between unbounded preceding and current row
  ) as running_quantity,
  m.unit,
  m.reference,
  m.notes,
  m.source_uid as movement_source_uid,
  m.inventory_movement_id
from public.v_kpi_inventario_movimientos_signed m
join negative_balances nb
  on nb.warehouse_id = m.warehouse_id
 and nb.item_id = m.item_id
 and nb.production_lot_id is not distinct from m.production_lot_id
order by
  m.warehouse_name,
  m.item_name,
  m.lot_code nulls first,
  m.movement_date,
  m.inventory_movement_id;
