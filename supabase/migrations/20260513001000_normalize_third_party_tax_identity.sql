with normalized as (
  select
    id,
    external_code as legacy_external_code,
    regexp_replace(upper(tax_id), '[^0-9A-Z]', '', 'g') as normalized_tax_id
  from public.third_parties
  where tax_id is not null
)
update public.third_parties tp
set
  external_code = 'tax_id:' || normalized.normalized_tax_id,
  tax_id = normalized.normalized_tax_id,
  metadata = coalesce(tp.metadata, '{}'::jsonb) ||
    jsonb_build_object(
      'legacy_external_code', normalized.legacy_external_code,
      'tax_identity_normalized_at', now()
    )
from normalized
where tp.id = normalized.id
  and normalized.normalized_tax_id <> ''
  and tp.external_code <> 'tax_id:' || normalized.normalized_tax_id;
