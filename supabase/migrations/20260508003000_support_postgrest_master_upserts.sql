create unique index if not exists third_parties_external_code_full_uidx
  on public.third_parties (external_code);

create unique index if not exists third_party_details_source_uid_full_uidx
  on public.third_party_details (source_uid);
