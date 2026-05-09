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

create table if not exists public.business_units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  unit_type text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_units_unit_type_check check (
    unit_type in (
      'feed_plant',
      'layer_farm',
      'broiler_farm',
      'egg_grading',
      'store',
      'finance',
      'admin',
      'other'
    )
  )
);

drop trigger if exists set_business_units_updated_at on public.business_units;
create trigger set_business_units_updated_at
before update on public.business_units
for each row
execute function public.set_updated_at();

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid null references public.business_units(id) on delete set null,
  code text not null unique,
  name text not null,
  location_type text not null,
  address text null,
  city text null,
  department text null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_location_type_check check (
    location_type in ('plant', 'farm', 'warehouse', 'store', 'office', 'other')
  )
);

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
before update on public.locations
for each row
execute function public.set_updated_at();

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid null references public.business_units(id) on delete set null,
  location_id uuid null references public.locations(id) on delete set null,
  code text not null unique,
  name text not null,
  warehouse_type text not null default 'general',
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_warehouses_updated_at on public.warehouses;
create trigger set_warehouses_updated_at
before update on public.warehouses
for each row
execute function public.set_updated_at();

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid null references public.business_units(id) on delete set null,
  parent_id uuid null references public.cost_centers(id) on delete set null,
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_cost_centers_updated_at on public.cost_centers;
create trigger set_cost_centers_updated_at
before update on public.cost_centers
for each row
execute function public.set_updated_at();

create table if not exists public.third_parties (
  id uuid primary key default gen_random_uuid(),
  external_code text null,
  third_party_type text not null,
  name text not null,
  legal_name text null,
  tax_id text null,
  phone text null,
  email text null,
  city text null,
  is_active boolean not null default true,
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint third_parties_type_check check (
    third_party_type in ('customer', 'supplier', 'employee', 'bank', 'other')
  )
);

create unique index if not exists third_parties_tax_id_unique_idx
  on public.third_parties (tax_id)
  where tax_id is not null;

create index if not exists third_parties_name_idx
  on public.third_parties (name);

drop trigger if exists set_third_parties_updated_at on public.third_parties;
create trigger set_third_parties_updated_at
before update on public.third_parties
for each row
execute function public.set_updated_at();

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text null,
  name text not null,
  product_type text not null,
  category text null,
  default_unit text null,
  is_active boolean not null default true,
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_type_check check (
    product_type in (
      'feed',
      'egg',
      'bird',
      'medicine',
      'packaging',
      'raw_material',
      'finished_good',
      'service',
      'other'
    )
  )
);

create unique index if not exists products_sku_unique_idx
  on public.products (sku)
  where sku is not null;

create index if not exists products_name_idx
  on public.products (name);

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

create table if not exists public.production_lots (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  lot_code text not null,
  species text null,
  start_date date null,
  end_date date null,
  status text not null default 'active',
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_unit_id, lot_code),
  constraint production_lots_status_check check (status in ('active', 'closed', 'planned'))
);

drop trigger if exists set_production_lots_updated_at on public.production_lots;
create trigger set_production_lots_updated_at
before update on public.production_lots
for each row
execute function public.set_updated_at();

create table if not exists public.poultry_houses (
  id uuid primary key default gen_random_uuid(),
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  location_id uuid null references public.locations(id) on delete set null,
  code text not null,
  name text null,
  capacity integer null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_unit_id, code)
);

drop trigger if exists set_poultry_houses_updated_at on public.poultry_houses;
create trigger set_poultry_houses_updated_at
before update on public.poultry_houses
for each row
execute function public.set_updated_at();

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  source_uid text null unique,
  business_unit_id uuid null references public.business_units(id) on delete set null,
  warehouse_id uuid null references public.warehouses(id) on delete set null,
  product_id uuid null references public.products(id) on delete set null,
  production_lot_id uuid null references public.production_lots(id) on delete set null,
  movement_date date not null,
  movement_type text not null,
  quantity numeric(18, 4) not null,
  unit text null,
  unit_cost numeric(18, 4) null,
  total_cost numeric(18, 2) null,
  reference text null,
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_movements_type_check check (
    movement_type in ('in', 'out', 'transfer', 'adjustment', 'production', 'consumption')
  )
);

create index if not exists inventory_movements_date_idx
  on public.inventory_movements (movement_date);

create index if not exists inventory_movements_product_idx
  on public.inventory_movements (product_id);

create index if not exists inventory_movements_warehouse_idx
  on public.inventory_movements (warehouse_id);

drop trigger if exists set_inventory_movements_updated_at on public.inventory_movements;
create trigger set_inventory_movements_updated_at
before update on public.inventory_movements
for each row
execute function public.set_updated_at();

create table if not exists public.daily_production_records (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  source_uid text null unique,
  business_unit_id uuid not null references public.business_units(id) on delete restrict,
  production_lot_id uuid null references public.production_lots(id) on delete set null,
  poultry_house_id uuid null references public.poultry_houses(id) on delete set null,
  production_date date not null,
  eggs_count integer null,
  mortality_count integer null,
  feed_kg numeric(18, 4) null,
  rejects_count integer null,
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists daily_production_records_date_idx
  on public.daily_production_records (production_date);

create index if not exists daily_production_records_lot_idx
  on public.daily_production_records (production_lot_id);

drop trigger if exists set_daily_production_records_updated_at on public.daily_production_records;
create trigger set_daily_production_records_updated_at
before update on public.daily_production_records
for each row
execute function public.set_updated_at();

create table if not exists public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  source_uid text null unique,
  business_unit_id uuid null references public.business_units(id) on delete set null,
  customer_id uuid null references public.third_parties(id) on delete set null,
  document_type text not null,
  document_number text null,
  document_date date not null,
  due_date date null,
  subtotal numeric(18, 2) null,
  tax_amount numeric(18, 2) null,
  total_amount numeric(18, 2) not null default 0,
  balance_amount numeric(18, 2) null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_documents_status_check check (status in ('draft', 'open', 'paid', 'void', 'overdue'))
);

create index if not exists sales_documents_date_idx
  on public.sales_documents (document_date);

create index if not exists sales_documents_customer_idx
  on public.sales_documents (customer_id);

drop trigger if exists set_sales_documents_updated_at on public.sales_documents;
create trigger set_sales_documents_updated_at
before update on public.sales_documents
for each row
execute function public.set_updated_at();

create table if not exists public.sales_document_lines (
  id uuid primary key default gen_random_uuid(),
  sales_document_id uuid not null references public.sales_documents(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  warehouse_id uuid null references public.warehouses(id) on delete set null,
  line_number integer null,
  description text null,
  quantity numeric(18, 4) not null default 0,
  unit text null,
  unit_price numeric(18, 4) null,
  total_amount numeric(18, 2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_document_lines_document_idx
  on public.sales_document_lines (sales_document_id);

drop trigger if exists set_sales_document_lines_updated_at on public.sales_document_lines;
create trigger set_sales_document_lines_updated_at
before update on public.sales_document_lines
for each row
execute function public.set_updated_at();

create table if not exists public.financial_documents (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  source_uid text null unique,
  business_unit_id uuid null references public.business_units(id) on delete set null,
  third_party_id uuid null references public.third_parties(id) on delete set null,
  cost_center_id uuid null references public.cost_centers(id) on delete set null,
  direction text not null,
  document_type text not null,
  document_number text null,
  issue_date date not null,
  due_date date null,
  total_amount numeric(18, 2) not null default 0,
  balance_amount numeric(18, 2) null,
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_documents_direction_check check (direction in ('payable', 'receivable')),
  constraint financial_documents_status_check check (status in ('open', 'paid', 'void', 'overdue'))
);

create index if not exists financial_documents_due_date_idx
  on public.financial_documents (due_date);

create index if not exists financial_documents_third_party_idx
  on public.financial_documents (third_party_id);

drop trigger if exists set_financial_documents_updated_at on public.financial_documents;
create trigger set_financial_documents_updated_at
before update on public.financial_documents
for each row
execute function public.set_updated_at();

create table if not exists public.financial_movements (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid null references public.raw_appsheet_records(id) on delete set null,
  source_uid text null unique,
  business_unit_id uuid null references public.business_units(id) on delete set null,
  financial_document_id uuid null references public.financial_documents(id) on delete set null,
  third_party_id uuid null references public.third_parties(id) on delete set null,
  cost_center_id uuid null references public.cost_centers(id) on delete set null,
  movement_date date not null,
  movement_type text not null,
  amount numeric(18, 2) not null,
  payment_method text null,
  reference text null,
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_movements_type_check check (
    movement_type in ('income', 'expense', 'payment', 'collection', 'adjustment')
  )
);

create index if not exists financial_movements_date_idx
  on public.financial_movements (movement_date);

create index if not exists financial_movements_cost_center_idx
  on public.financial_movements (cost_center_id);

drop trigger if exists set_financial_movements_updated_at on public.financial_movements;
create trigger set_financial_movements_updated_at
before update on public.financial_movements
for each row
execute function public.set_updated_at();

create table if not exists public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  raw_attachment_id uuid null references public.raw_appsheet_attachments(id) on delete set null,
  entity_table text not null,
  entity_id uuid not null,
  file_ref text not null,
  file_name text null,
  file_kind text not null default 'other',
  notes text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists record_attachments_entity_idx
  on public.record_attachments (entity_table, entity_id);

drop trigger if exists set_record_attachments_updated_at on public.record_attachments;
create trigger set_record_attachments_updated_at
before update on public.record_attachments
for each row
execute function public.set_updated_at();

create table if not exists public.transform_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  status text not null default 'running',
  source_sync_run_id uuid null references public.sync_runs(id) on delete set null,
  records_processed integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  records_failed integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  constraint transform_runs_status_check check (status in ('running', 'success', 'partial_success', 'failed'))
);

insert into public.business_units (code, name, unit_type)
values
  ('planta_concentrado', 'Planta de Concentrado', 'feed_plant'),
  ('granja_postura', 'Granjas de Postura', 'layer_farm'),
  ('pollo_engorde', 'Pollos de Engorde', 'broiler_farm'),
  ('clasificadora_huevo', 'Clasificadora de Huevo', 'egg_grading'),
  ('tienda_ventas', 'Tienda y Ventas', 'store'),
  ('costos_finanzas', 'Costos y Finanzas', 'finance')
on conflict (code) do update
set name = excluded.name,
    unit_type = excluded.unit_type,
    updated_at = now();
