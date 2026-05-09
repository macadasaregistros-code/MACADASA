-- Refine KPI calculations after validating sample output.

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
    sum(cull_count + sacrifice_count + sale_count + bird_exit_count) over (
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
    coalesce(ldr.bird_exit_count, 0)
  ) as total_other_exits_count,
  greatest(
    coalesce(pl.initial_birds, 0) -
    sum(coalesce(ldr.mortality_count, 0)) -
    sum(
      coalesce(ldr.cull_count, 0) +
      coalesce(ldr.sacrifice_count, 0) +
      coalesce(ldr.sale_count, 0) +
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
  coalesce(sum(signed_quantity) filter (where signed_quantity > 0), 0) as total_in_quantity,
  coalesce(abs(sum(signed_quantity) filter (where signed_quantity < 0)), 0) as total_out_quantity
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
