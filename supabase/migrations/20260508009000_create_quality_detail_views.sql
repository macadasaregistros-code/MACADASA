create or replace view public.v_quality_negative_inventory_details as
select
  warehouse_name,
  item_code,
  item_name,
  lot_code,
  last_movement_date,
  current_quantity,
  total_in_quantity,
  total_out_quantity
from public.v_kpi_inventario_actual
where current_quantity < 0
order by current_quantity asc;

create or replace view public.v_quality_overdue_financial_documents as
select
  id,
  document_type,
  document_subtype,
  document_number,
  issue_date,
  due_date,
  status,
  total_amount,
  paid_amount,
  open_amount,
  currency,
  third_party_name,
  business_unit_name,
  cost_center_name
from public.v_financial_open_documents
where due_date < current_date
order by due_date asc, open_amount desc;

create or replace view public.v_quality_vaccinations_missing_item as
select
  v.id,
  v.source_uid,
  v.vaccination_date,
  pl.lot_code,
  ph.name as poultry_house_name,
  c.code as category_code,
  c.name as category_name,
  v.laboratory,
  v.strains,
  v.commercial_name,
  v.administration_route,
  v.veterinarian,
  v.notes,
  v.metadata
from public.vaccinations v
left join public.production_lots pl on pl.id = v.production_lot_id
left join public.poultry_houses ph on ph.id = v.poultry_house_id
left join public.categories c on c.id = v.category_id
where v.item_id is null
order by v.vaccination_date desc;

create or replace view public.v_quality_raw_attachments_not_promoted as
select
  raa.id,
  raa.raw_record_source_uid,
  raa.source_name,
  raa.source_primary_key,
  raa.column_name,
  raa.file_ref,
  raa.file_name,
  raa.file_kind,
  raa.mime_type,
  raa.created_at
from public.raw_appsheet_attachments raa
left join public.attachments a on a.raw_attachment_id = raa.id
where a.id is null
order by raa.created_at desc;
