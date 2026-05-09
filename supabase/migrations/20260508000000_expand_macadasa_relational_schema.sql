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

-- ---------------------------------------------------------------------------
-- Integration / lineage
-- ---------------------------------------------------------------------------

alter table if exists public.transform_runs
  add column if not exists transform_name text,
  add column if not exists mode text not null default 'manual',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists error_message text;

create table if not exists public.external_references (
  id uuid primary key default gen_random_uuid(),
  entity_table text not null,
  entity_id uuid not null,
  source_name text not null,
  source_primary_key text,
  raw_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  row_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists external_references_entity_source_uidx
  on public.external_references (entity_table, source_name, source_primary_key)
  where source_primary_key is not null;

create index if not exists external_references_entity_idx
  on public.external_references (entity_table, entity_id);

create index if not exists external_references_source_idx
  on public.external_references (source_name, source_primary_key);

create index if not exists external_references_raw_record_idx
  on public.external_references (raw_record_id);

-- ---------------------------------------------------------------------------
-- Shared masters
-- ---------------------------------------------------------------------------

alter table if exists public.business_units
  add column if not exists description text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

insert into public.business_units (code, name, unit_type, is_active)
values
  ('gerencia', 'Gerencia MACADASA', 'admin', true),
  ('mcds_tienda', 'MCDS / Tienda', 'store', true),
  ('mercadeo_clientes', 'Mercadeo y Clientes', 'admin', true),
  ('inventario_general', 'Inventario General', 'other', true)
on conflict (code) do nothing;

alter table if exists public.locations
  add column if not exists location_type text,
  add column if not exists address text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.warehouses
  add column if not exists external_code text,
  add column if not exists category text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.cost_centers
  add column if not exists description text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.poultry_houses
  add column if not exists external_code text,
  add column if not exists capacity integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.production_lots
  add column if not exists external_code text,
  add column if not exists poultry_house_id uuid references public.poultry_houses(id) on delete set null,
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists initial_birds integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table if exists public.third_parties
  drop constraint if exists third_parties_type_check;

alter table if exists public.third_parties
  add constraint third_parties_type_check
  check (
    third_party_type in (
      'supplier',
      'customer',
      'carrier',
      'company',
      'employee',
      'beneficiary',
      'bank',
      'other'
    )
  );

alter table if exists public.third_parties
  add column if not exists legal_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category_type text not null default 'general',
  parent_id uuid references public.categories(id) on delete set null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categories_parent_idx
  on public.categories (parent_id);

create index if not exists categories_type_idx
  on public.categories (category_type);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  item_type text not null default 'other',
  unit text,
  tax_rate numeric(7,4) not null default 0,
  is_inventory_item boolean not null default false,
  is_sellable boolean not null default false,
  is_purchasable boolean not null default false,
  is_active boolean not null default true,
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_item_type_check check (
    item_type in (
      'raw_material',
      'feed',
      'egg',
      'chicken',
      'service',
      'expense',
      'packaging',
      'medicine',
      'other'
    )
  )
);

create index if not exists items_category_idx
  on public.items (category_id);

create index if not exists items_type_idx
  on public.items (item_type);

create index if not exists items_source_record_idx
  on public.items (source_record_id);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  email text unique,
  name text not null,
  role text,
  business_unit_id uuid references public.business_units(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_business_unit_idx
  on public.users (business_unit_id);

create index if not exists users_cost_center_idx
  on public.users (cost_center_id);

create table if not exists public.third_party_roles (
  id uuid primary key default gen_random_uuid(),
  third_party_id uuid not null references public.third_parties(id) on delete cascade,
  role text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint third_party_roles_role_check check (
    role in (
      'supplier',
      'customer',
      'carrier',
      'company',
      'employee',
      'beneficiary',
      'bank',
      'other'
    )
  ),
  constraint third_party_roles_unique unique (third_party_id, role)
);

create index if not exists third_party_roles_role_idx
  on public.third_party_roles (role);

create table if not exists public.third_party_details (
  id uuid primary key default gen_random_uuid(),
  third_party_id uuid not null references public.third_parties(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  detail_type text not null default 'general',
  tax_rate numeric(7,4),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists third_party_details_party_idx
  on public.third_party_details (third_party_id);

create index if not exists third_party_details_item_idx
  on public.third_party_details (item_id);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  raw_attachment_id uuid references public.raw_appsheet_attachments(id) on delete set null,
  entity_table text not null,
  entity_id uuid not null,
  file_ref text not null,
  file_name text,
  file_kind text,
  mime_type text,
  storage_bucket text,
  storage_path text,
  is_migrated boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists attachments_entity_file_uidx
  on public.attachments (entity_table, entity_id, file_ref);

create index if not exists attachments_raw_attachment_idx
  on public.attachments (raw_attachment_id);

create index if not exists attachments_entity_idx
  on public.attachments (entity_table, entity_id);

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

create table if not exists public.calendar_dates (
  id uuid primary key default gen_random_uuid(),
  calendar_date date not null unique,
  year integer not null,
  month integer not null,
  day integer not null,
  day_of_week integer not null,
  week_start_date date,
  week_end_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_dates_week_idx
  on public.calendar_dates (week_start_date, week_end_date);

create table if not exists public.calendar_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start_date date not null,
  week_end_date date not null,
  iso_year integer,
  iso_week integer,
  item_id uuid references public.items(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists calendar_weeks_unique_idx
  on public.calendar_weeks (
    week_start_date,
    week_end_date,
    coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------

create table if not exists public.inventory_transfer_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  movement_category text not null default 'transfer',
  affects_cost boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.inventory_movements
  add column if not exists movement_number text,
  add column if not exists transfer_type_id uuid references public.inventory_transfer_types(id) on delete set null,
  add column if not exists source_warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists destination_warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null,
  add column if not exists production_lot_id uuid references public.production_lots(id) on delete set null,
  add column if not exists movement_status text not null default 'posted',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists inventory_movements_transfer_type_idx
  on public.inventory_movements (transfer_type_id);

create index if not exists inventory_movements_source_warehouse_idx
  on public.inventory_movements (source_warehouse_id);

create index if not exists inventory_movements_destination_warehouse_idx
  on public.inventory_movements (destination_warehouse_id);

create index if not exists inventory_movements_cost_center_idx
  on public.inventory_movements (cost_center_id);

create table if not exists public.inventory_movement_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_movement_id uuid not null references public.inventory_movements(id) on delete cascade,
  line_number integer,
  item_id uuid not null references public.items(id) on delete restrict,
  quantity numeric(18,4) not null default 0,
  quantity_sent numeric(18,4),
  quantity_received numeric(18,4),
  unit text,
  unit_cost numeric(18,6),
  total_cost numeric(18,2),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_movement_lines_movement_idx
  on public.inventory_movement_lines (inventory_movement_id);

create index if not exists inventory_movement_lines_item_idx
  on public.inventory_movement_lines (item_id);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  production_lot_id uuid references public.production_lots(id) on delete set null,
  snapshot_date date not null default current_date,
  quantity numeric(18,4) not null default 0,
  unit text,
  valuation_amount numeric(18,2),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_balances_snapshot_uidx
  on public.inventory_balances (
    warehouse_id,
    item_id,
    coalesce(production_lot_id, '00000000-0000-0000-0000-000000000000'::uuid),
    snapshot_date
  );

create index if not exists inventory_balances_latest_idx
  on public.inventory_balances (warehouse_id, item_id, snapshot_date desc);

-- ---------------------------------------------------------------------------
-- Finance, invoices, payments, cash
-- ---------------------------------------------------------------------------

alter table if exists public.financial_documents
  add column if not exists document_subtype text,
  add column if not exists currency text not null default 'COP',
  add column if not exists paid_amount numeric(18,2) not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.financial_document_lines (
  id uuid primary key default gen_random_uuid(),
  financial_document_id uuid not null references public.financial_documents(id) on delete cascade,
  line_number integer,
  item_id uuid references public.items(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  quantity numeric(18,4) not null default 1,
  unit text,
  unit_price numeric(18,6),
  subtotal_amount numeric(18,2),
  tax_rate numeric(7,4),
  tax_amount numeric(18,2),
  withholding_amount numeric(18,2),
  total_amount numeric(18,2) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists financial_document_lines_document_idx
  on public.financial_document_lines (financial_document_id);

create index if not exists financial_document_lines_item_idx
  on public.financial_document_lines (item_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  business_unit_id uuid references public.business_units(id) on delete set null,
  third_party_id uuid references public.third_parties(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  payment_date date not null,
  amount numeric(18,2) not null default 0,
  payer_name text,
  payment_method text,
  transaction_number text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_third_party_idx
  on public.payments (third_party_id);

create index if not exists payments_date_idx
  on public.payments (payment_date);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  financial_document_id uuid not null references public.financial_documents(id) on delete cascade,
  amount numeric(18,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_allocations_unique unique (payment_id, financial_document_id)
);

create index if not exists payment_allocations_document_idx
  on public.payment_allocations (financial_document_id);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  business_unit_id uuid references public.business_units(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  third_party_id uuid references public.third_parties(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  financial_document_id uuid references public.financial_documents(id) on delete set null,
  movement_date date not null,
  direction text not null,
  concept text,
  detail text,
  amount numeric(18,2) not null default 0,
  beneficiary text,
  reconciliation_status text not null default 'unreconciled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_movements_direction_check check (
    direction in ('income', 'expense', 'transfer', 'adjustment')
  ),
  constraint cash_movements_reconciliation_check check (
    reconciliation_status in ('unreconciled', 'matched', 'ignored', 'needs_review')
  )
);

create index if not exists cash_movements_date_idx
  on public.cash_movements (movement_date);

create index if not exists cash_movements_cost_center_idx
  on public.cash_movements (cost_center_id);

create table if not exists public.cost_transactions (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  category_id uuid references public.categories(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  transaction_date date not null,
  cost_amount numeric(18,2) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_transactions_date_idx
  on public.cost_transactions (transaction_date);

create table if not exists public.tax_periods (
  id uuid primary key default gen_random_uuid(),
  period_code text not null unique,
  start_date date not null,
  end_date date not null,
  tax_type text not null default 'iva',
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  code text unique,
  description text not null,
  category text,
  acquisition_date date,
  cost numeric(18,2) not null default 0,
  salvage_value numeric(18,2) not null default 0,
  useful_life_years numeric(8,2),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.depreciation_entries (
  id uuid primary key default gen_random_uuid(),
  fixed_asset_id uuid not null references public.fixed_assets(id) on delete cascade,
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  depreciation_date date not null,
  amount numeric(18,2) not null default 0,
  accumulated_amount numeric(18,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists depreciation_entries_asset_idx
  on public.depreciation_entries (fixed_asset_id);

-- ---------------------------------------------------------------------------
-- Feed plant
-- ---------------------------------------------------------------------------

create table if not exists public.feed_formulas (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  formula_code text unique,
  item_id uuid references public.items(id) on delete set null,
  formula_name text not null,
  description text,
  medicated boolean not null default false,
  status text not null default 'active',
  effective_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feed_formula_lines (
  id uuid primary key default gen_random_uuid(),
  feed_formula_id uuid not null references public.feed_formulas(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  quantity_kg numeric(18,4),
  percentage numeric(9,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feed_formula_lines_formula_idx
  on public.feed_formula_lines (feed_formula_id);

create index if not exists feed_formula_lines_item_idx
  on public.feed_formula_lines (item_id);

create table if not exists public.feed_production_orders (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  production_date date not null,
  formula_id uuid references public.feed_formulas(id) on delete set null,
  output_item_id uuid references public.items(id) on delete set null,
  lot_code text,
  batches numeric(18,4),
  practical_bags numeric(18,4),
  theoretical_bags numeric(18,4),
  responsible_user_id uuid references public.users(id) on delete set null,
  status text not null default 'posted',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feed_production_orders_formula_idx
  on public.feed_production_orders (formula_id);

create table if not exists public.feed_production_materials (
  id uuid primary key default gen_random_uuid(),
  feed_production_order_id uuid not null references public.feed_production_orders(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  quantity_kg numeric(18,4) not null default 0,
  unit_cost numeric(18,6),
  total_cost numeric(18,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feed_production_materials_order_idx
  on public.feed_production_materials (feed_production_order_id);

create table if not exists public.feed_production_outputs (
  id uuid primary key default gen_random_uuid(),
  feed_production_order_id uuid not null references public.feed_production_orders(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  quantity_bags numeric(18,4),
  quantity_kg numeric(18,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feed_production_outputs_order_idx
  on public.feed_production_outputs (feed_production_order_id);

create table if not exists public.raw_material_receipts (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  receipt_date date not null,
  supplier_id uuid references public.third_parties(id) on delete set null,
  carrier_id uuid references public.third_parties(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  lot_code text,
  quantity_kg numeric(18,4),
  invoice_number text,
  unit_price_without_tax numeric(18,6),
  unit_price_with_tax numeric(18,6),
  total_without_tax numeric(18,2),
  total_with_tax numeric(18,2),
  accepted_condition boolean,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists raw_material_receipts_supplier_idx
  on public.raw_material_receipts (supplier_id);

create index if not exists raw_material_receipts_item_idx
  on public.raw_material_receipts (item_id);

create table if not exists public.lab_samples (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  sample_date date not null,
  sample_type text,
  raw_material_receipt_id uuid references public.raw_material_receipts(id) on delete set null,
  feed_production_order_id uuid references public.feed_production_orders(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  laboratory text,
  analysis text,
  result text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_cost_periods (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  period_date date not null,
  period_month text,
  total_amount numeric(18,2) not null default 0,
  budgeted_kg numeric(18,4),
  cost_per_kg numeric(18,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.maquila_cost_periods (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  period_date date not null,
  period_month text,
  total_amount numeric(18,2) not null default 0,
  budgeted_kg numeric(18,4),
  cost_per_kg numeric(18,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feed_sale_price_periods (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  effective_date date not null,
  item_id uuid references public.items(id) on delete set null,
  provider_name text,
  price_without_tax numeric(18,6),
  price_with_tax numeric(18,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Layer farms
-- ---------------------------------------------------------------------------

create table if not exists public.layer_standard_curves (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  week_number integer not null,
  gad numeric(18,4),
  weight_gr numeric(18,4),
  pp numeric(18,6),
  haa numeric(18,6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.layer_daily_records (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  business_unit_id uuid references public.business_units(id) on delete set null,
  production_lot_id uuid references public.production_lots(id) on delete set null,
  poultry_house_id uuid references public.poultry_houses(id) on delete set null,
  record_date date not null,
  week_number integer,
  day_number integer,
  feed_bags numeric(18,4),
  mortality_count integer not null default 0,
  cull_count integer not null default 0,
  sacrifice_count integer not null default 0,
  sale_count integer not null default 0,
  mdv_count integer not null default 0,
  bird_exit_count integer not null default 0,
  egg_production_count integer not null default 0,
  calcium_amount numeric(18,4),
  litter_amount numeric(18,4),
  guide_pp numeric(18,6),
  pp numeric(18,6),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists layer_daily_records_lot_date_idx
  on public.layer_daily_records (production_lot_id, record_date);

create index if not exists layer_daily_records_house_date_idx
  on public.layer_daily_records (poultry_house_id, record_date);

create table if not exists public.farm_entries (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  entry_date date not null,
  location_id uuid references public.locations(id) on delete set null,
  poultry_house_id uuid references public.poultry_houses(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  quantity numeric(18,4),
  invoice_number text,
  transport_amount numeric(18,2),
  total_amount numeric(18,2),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vaccinations (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  vaccination_date date not null,
  production_lot_id uuid references public.production_lots(id) on delete set null,
  poultry_house_id uuid references public.poultry_houses(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  laboratory text,
  strains text,
  commercial_name text,
  administration_route text,
  veterinarian text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.farm_adjustments (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  adjustment_date date not null,
  layer_daily_record_id uuid references public.layer_daily_records(id) on delete set null,
  production_lot_id uuid references public.production_lots(id) on delete set null,
  poultry_house_id uuid references public.poultry_houses(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  adjustment_type text not null,
  quantity numeric(18,4) not null default 0,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Egg grading
-- ---------------------------------------------------------------------------

create table if not exists public.egg_grading_records (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  grading_date date not null,
  user_id uuid references public.users(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  poultry_house_id uuid references public.poultry_houses(id) on delete set null,
  production_lot_id uuid references public.production_lots(id) on delete set null,
  week_number integer,
  item_id uuid references public.items(id) on delete set null,
  quantity numeric(18,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.egg_grading_entries (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  entry_date date not null,
  user_id uuid references public.users(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  quantity numeric(18,4),
  vehicle_plate text,
  accepted_condition boolean,
  responsible_user_id uuid references public.users(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.egg_grading_outputs (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  output_date date not null,
  user_id uuid references public.users(id) on delete set null,
  destination text,
  delivered_by text,
  received_by text,
  counter text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.egg_grading_output_lines (
  id uuid primary key default gen_random_uuid(),
  egg_grading_output_id uuid not null references public.egg_grading_outputs(id) on delete cascade,
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  item_id uuid references public.items(id) on delete set null,
  packs numeric(18,4),
  eggs numeric(18,4),
  quantity numeric(18,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists egg_grading_output_lines_output_idx
  on public.egg_grading_output_lines (egg_grading_output_id);

-- ---------------------------------------------------------------------------
-- MCDS / store / sales
-- ---------------------------------------------------------------------------

create table if not exists public.store_egg_entries (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  entry_date date not null,
  location_id uuid references public.locations(id) on delete set null,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  transfer_id text,
  packs numeric(18,4),
  eggs numeric(18,4),
  quantity numeric(18,4),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_egg_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  count_date date not null,
  count_time time,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  packs numeric(18,4),
  eggs numeric(18,4),
  quantity numeric(18,4),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chicken_weight_batches (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  weighing_date date not null,
  location_id uuid references public.locations(id) on delete set null,
  item_id uuid references public.items(id) on delete set null,
  quantity numeric(18,4),
  average_weight numeric(18,4),
  crate_count numeric(18,4),
  processor_receipt_ref text,
  macadasa_sheet_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chicken_weight_lines (
  id uuid primary key default gen_random_uuid(),
  chicken_weight_batch_id uuid not null references public.chicken_weight_batches(id) on delete cascade,
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  line_type text not null default 'carcass',
  crates numeric(18,4),
  weight_kg numeric(18,4),
  units numeric(18,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chicken_weight_lines_batch_idx
  on public.chicken_weight_lines (chicken_weight_batch_id);

create table if not exists public.store_expenses (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  expense_date date not null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  movement_type text,
  concept text,
  detail text,
  amount numeric(18,2) not null default 0,
  beneficiary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_prices (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  item_id uuid references public.items(id) on delete set null,
  price numeric(18,2) not null default 0,
  price_level text,
  effective_date date not null default current_date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  promotion_date date not null,
  item_id uuid references public.items(id) on delete set null,
  product_name text,
  description text,
  discount_amount numeric(18,2),
  discount_percentage numeric(9,6),
  quantity numeric(18,4),
  sales_amount numeric(18,2),
  cost_amount numeric(18,2),
  result_amount numeric(18,2),
  comments text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Marketing / customers
-- ---------------------------------------------------------------------------

create table if not exists public.sales_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.sales_channels (code, name)
values
  ('direct', 'Venta directa'),
  ('store', 'Tienda'),
  ('wholesale', 'Mayorista'),
  ('prospecting', 'Prospección')
on conflict (code) do nothing;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  third_party_id uuid references public.third_parties(id) on delete set null,
  store_name text not null,
  contact_name text,
  phone text,
  tax_id text,
  address text,
  neighborhood text,
  location_text text,
  store_type text,
  weekly_quantity numeric(18,4),
  sales_channel_id uuid references public.sales_channels(id) on delete set null,
  authorizes_messages boolean,
  buys_from_macadasa boolean,
  current_supplier text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stores_third_party_idx
  on public.stores (third_party_id);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  prospect_date date,
  establishment_name text not null,
  contact_name text,
  phone text,
  address text,
  sales_channel_id uuid references public.sales_channels(id) on delete set null,
  current_supplier text,
  contacted boolean,
  purchase_date date,
  purchase_amount numeric(18,2),
  location_text text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.price_research (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  prospect_id uuid references public.prospects(id) on delete set null,
  item_type text,
  weekly_quantity numeric(18,4),
  chicken_size text,
  current_price_lb numeric(18,2),
  attractive_price_lb numeric(18,2),
  offered_price_lb numeric(18,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_purchases (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  store_id uuid references public.stores(id) on delete set null,
  purchase_date date not null,
  item_type text,
  quantity numeric(18,4),
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Link legacy sales lines to the new item master without breaking current data.
alter table if exists public.sales_document_lines
  add column if not exists item_id uuid references public.items(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'external_references',
    'categories',
    'items',
    'users',
    'third_party_roles',
    'third_party_details',
    'attachments',
    'calendar_dates',
    'calendar_weeks',
    'inventory_transfer_types',
    'inventory_movement_lines',
    'inventory_balances',
    'financial_document_lines',
    'payments',
    'payment_allocations',
    'cash_movements',
    'cost_transactions',
    'tax_periods',
    'fixed_assets',
    'depreciation_entries',
    'feed_formulas',
    'feed_formula_lines',
    'feed_production_orders',
    'feed_production_materials',
    'feed_production_outputs',
    'raw_material_receipts',
    'lab_samples',
    'admin_cost_periods',
    'maquila_cost_periods',
    'feed_sale_price_periods',
    'layer_standard_curves',
    'layer_daily_records',
    'farm_entries',
    'vaccinations',
    'farm_adjustments',
    'egg_grading_records',
    'egg_grading_entries',
    'egg_grading_outputs',
    'egg_grading_output_lines',
    'store_egg_entries',
    'store_egg_inventory_counts',
    'chicken_weight_batches',
    'chicken_weight_lines',
    'store_expenses',
    'store_prices',
    'promotions',
    'sales_channels',
    'stores',
    'prospects',
    'price_research',
    'store_purchases'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'set_' || table_name || '_updated_at',
      table_name
    );
  end loop;
end;
$$;
