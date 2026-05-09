create table if not exists public.plant_audits (
  id uuid primary key default gen_random_uuid(),
  source_record_id uuid references public.raw_appsheet_records(id) on delete set null,
  source_uid text unique,
  audit_code text unique,
  audit_name text not null,
  audit_view text,
  audit_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plant_audits_audit_type_idx
  on public.plant_audits (audit_type);

create index if not exists plant_audits_source_record_idx
  on public.plant_audits (source_record_id);

drop trigger if exists set_plant_audits_updated_at on public.plant_audits;
create trigger set_plant_audits_updated_at
before update on public.plant_audits
for each row execute function public.set_updated_at();
