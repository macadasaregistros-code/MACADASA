import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkArray, createRowHash } from "../sync/utils";
import {
  asBoolean,
  asDateOnly,
  asNumber,
  asText,
  compactRecord,
  fetchRawRecordsBySourceNames,
  getField,
  mergeMetadata,
  rawLineageMetadata,
  sourcePrimaryKey,
  type JsonRecord,
  type RawAppSheetRecord
} from "./utils";

export type TransformStoreMarketingOptions = {
  dryRun: boolean;
  only?: Set<string>;
};

export type StoreMarketingStageSummary = {
  stage: string;
  processed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  referencesUpserted: number;
};

export type TransformStoreMarketingSummary = {
  dryRun: boolean;
  rawRecordsRead: number;
  stages: StoreMarketingStageSummary[];
  totals: Omit<StoreMarketingStageSummary, "stage">;
};

type SourceReference = {
  sourceName: string;
  sourcePrimaryKey: string;
  rawRecordId: string;
  sourceUid: string;
  rawRowHash: string;
};

type EntityReference = SourceReference & {
  entityTable: string;
  entityId: string;
};

type Candidate = {
  key: string;
  payload: JsonRecord;
  sourceReference?: SourceReference;
};

type ExistingRow = JsonRecord & {
  id: string;
  metadata?: JsonRecord | null;
};

type BuildResult = {
  candidates: Candidate[];
  skipped: number;
};

type TransformContext = {
  supabase: SupabaseClient;
  dryRun: boolean;
  now: string;
  recordsBySource: Map<string, RawAppSheetRecord[]>;
  locationIds: Map<string, string>;
  warehouseIds: Map<string, string>;
  itemIds: Map<string, string>;
  storeIdsBySourceUid: Map<string, string>;
  chickenWeightBatchIdsBySourceUid: Map<string, string>;
  entityReferences: EntityReference[];
};

const TRANSFORM_NAME = "store_marketing";
const IN_FILTER_CHUNK_SIZE = 50;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const STORE_MARKETING_SOURCE_NAMES = [
  "mcds_inventariohuevom",
  "mcds_pesopollo",
  "mcds_pesopollodetalle",
  "mcds_pesopollomenudenciadetalle",
  "mcds_precios",
  "mcds_z_promociones",
  "mercadeo_tiendas",
  "mercadeo_tiendascompras"
];

const EMPTY_COUNTS = {
  processed: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  errors: 0,
  referencesUpserted: 0
};

function normalized(record: RawAppSheetRecord): JsonRecord {
  return record.normalized_data ?? {};
}

function recordsFor(ctx: TransformContext, sourceName: string): RawAppSheetRecord[] {
  return ctx.recordsBySource.get(sourceName) ?? [];
}

function sourceRef(record: RawAppSheetRecord, sourcePrimaryKeyOverride?: string): SourceReference {
  return {
    sourceName: record.source_name,
    sourcePrimaryKey: sourcePrimaryKeyOverride ?? sourcePrimaryKey(record),
    rawRecordId: record.id,
    sourceUid: record.source_uid,
    rawRowHash: record.row_hash
  };
}

function shouldRun(options: TransformStoreMarketingOptions, stage: string): boolean {
  return !options.only || options.only.has(stage) || options.only.has("all");
}

function payloadHash(payload: JsonRecord): string {
  const copy = { ...payload };
  delete copy.metadata;
  return createRowHash(copy);
}

function payloadWithHash(candidate: Candidate, existing?: ExistingRow): JsonRecord {
  const metadata = (candidate.payload.metadata as JsonRecord | undefined) ?? {};
  const copy = { ...candidate.payload };
  delete copy.metadata;

  return {
    ...copy,
    metadata: mergeMetadata(existing?.metadata ?? undefined, metadata, {
      transform_hash: createRowHash(copy),
      transform_name: TRANSFORM_NAME,
      transformed_at: new Date().toISOString()
    })
  };
}

function conflictKey(columns: string[], row: JsonRecord): string {
  return columns.map((column) => String(row[column] ?? "")).join("::");
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const deduped = new Map<string, Candidate>();

  for (const candidate of candidates) {
    deduped.set(candidate.key, candidate);
  }

  return [...deduped.values()];
}

async function fetchExistingRows(
  supabase: SupabaseClient,
  tableName: string,
  conflictColumns: string[],
  candidates: Candidate[]
): Promise<Map<string, ExistingRow>> {
  const rows: ExistingRow[] = [];
  const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
  const selectColumns = ["id", "metadata", ...conflictColumns].join(",");

  if (candidates.length === 0) {
    return new Map();
  }

  if (candidates.length > 1000) {
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from(tableName)
        .select(selectColumns)
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(`Error leyendo ${tableName}: ${error.message}`);
      }

      const page = (data ?? []) as unknown as ExistingRow[];
      rows.push(...page);

      if (page.length < pageSize) {
        break;
      }

      from += pageSize;
    }
  } else {
    const firstColumn = conflictColumns[0];
    const values = [
      ...new Set(candidates.map((candidate) => candidate.payload[firstColumn]).filter(Boolean))
    ];

    for (const valuesChunk of chunkArray(values, IN_FILTER_CHUNK_SIZE)) {
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select(selectColumns)
          .in(firstColumn, valuesChunk)
          .range(from, from + pageSize - 1);

        if (error) {
          throw new Error(`Error leyendo ${tableName}: ${error.message}`);
        }

        const page = (data ?? []) as unknown as ExistingRow[];
        rows.push(...page);

        if (page.length < pageSize) {
          break;
        }

        from += pageSize;
      }
    }
  }

  const indexed = new Map<string, ExistingRow>();

  for (const row of rows) {
    const key = conflictKey(conflictColumns, row);
    if (candidateKeys.has(key)) {
      indexed.set(key, row);
    }
  }

  return indexed;
}

async function upsertExternalReferences(
  supabase: SupabaseClient,
  dryRun: boolean,
  references: EntityReference[],
  now: string
): Promise<number> {
  if (dryRun || references.length === 0) {
    return 0;
  }

  const payloads = references.map((reference) => ({
    entity_table: reference.entityTable,
    entity_id: reference.entityId,
    source_name: reference.sourceName,
    source_primary_key: reference.sourcePrimaryKey,
    raw_record_id: reference.rawRecordId,
    row_hash: reference.rawRowHash,
    last_seen_at: now,
    metadata: {
      source_uid: reference.sourceUid,
      transform_name: TRANSFORM_NAME
    }
  }));

  for (const payloadChunk of chunkArray(payloads, 500)) {
    const { error } = await supabase
      .from("external_references")
      .upsert(payloadChunk, { onConflict: "entity_table,source_name,source_primary_key" });

    if (error) {
      throw new Error(`Error actualizando external_references: ${error.message}`);
    }
  }

  return payloads.length;
}

async function upsertCandidates(
  ctx: TransformContext,
  stage: string,
  tableName: string,
  conflictColumns: string[],
  rawCandidates: Candidate[],
  extraSkipped = 0
): Promise<{ summary: StoreMarketingStageSummary; idByKey: Map<string, string> }> {
  const candidates = dedupeCandidates(rawCandidates).filter((candidate) =>
    conflictColumns.every((column) => candidate.payload[column] !== undefined && candidate.payload[column] !== null)
  );
  const summary: StoreMarketingStageSummary = {
    stage,
    ...EMPTY_COUNTS,
    skipped: extraSkipped + (rawCandidates.length - candidates.length)
  };

  summary.processed = candidates.length;

  if (candidates.length === 0) {
    return { summary, idByKey: new Map() };
  }

  const existingRows = await fetchExistingRows(ctx.supabase, tableName, conflictColumns, candidates);
  const changedPayloads: JsonRecord[] = [];

  for (const candidate of candidates) {
    const existing = existingRows.get(candidate.key);
    const existingHash = asText(existing?.metadata?.transform_hash);
    const nextHash = payloadHash(candidate.payload);

    if (!existing) {
      summary.inserted += 1;
      changedPayloads.push(payloadWithHash(candidate));
      continue;
    }

    if (existingHash === nextHash) {
      summary.unchanged += 1;
      continue;
    }

    summary.updated += 1;
    changedPayloads.push(payloadWithHash(candidate, existing));
  }

  if (!ctx.dryRun && changedPayloads.length > 0) {
    for (const payloadChunk of chunkArray(changedPayloads, 500)) {
      const { error } = await ctx.supabase
        .from(tableName)
        .upsert(payloadChunk, { onConflict: conflictColumns.join(",") });

      if (error) {
        throw new Error(`Error haciendo upsert en ${tableName}: ${error.message}`);
      }
    }
  }

  const finalRows = await fetchExistingRows(ctx.supabase, tableName, conflictColumns, candidates);
  const idByKey = new Map<string, string>();
  const references: EntityReference[] = [];

  for (const [key, row] of finalRows.entries()) {
    idByKey.set(key, row.id);
  }

  for (const candidate of candidates) {
    const entityId = idByKey.get(candidate.key);
    if (!entityId || !candidate.sourceReference) {
      continue;
    }

    references.push({
      ...candidate.sourceReference,
      entityTable: tableName,
      entityId
    });
  }

  summary.referencesUpserted = await upsertExternalReferences(
    ctx.supabase,
    ctx.dryRun,
    references,
    ctx.now
  );
  ctx.entityReferences.push(...references);

  return { summary, idByKey };
}

async function loadIdLookup(
  supabase: SupabaseClient,
  tableName: string,
  keyColumn: string
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(`id,${keyColumn}`)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Error cargando ${tableName}.${keyColumn}: ${error.message}`);
    }

    const page = (data ?? []) as unknown as Array<{ id: string } & JsonRecord>;

    for (const row of page) {
      const key = asText(row[keyColumn]);
      if (key) {
        lookup.set(key, row.id);
      }
    }

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return lookup;
}

async function refreshLookups(ctx: TransformContext): Promise<void> {
  const [locations, warehouses, items, stores, chickenBatches] = await Promise.all([
    loadIdLookup(ctx.supabase, "locations", "code"),
    loadIdLookup(ctx.supabase, "warehouses", "code"),
    loadIdLookup(ctx.supabase, "items", "code"),
    loadIdLookup(ctx.supabase, "stores", "source_uid"),
    loadIdLookup(ctx.supabase, "chicken_weight_batches", "source_uid")
  ]);

  ctx.locationIds = locations;
  ctx.warehouseIds = warehouses;
  ctx.itemIds = items;
  ctx.storeIdsBySourceUid = stores;
  ctx.chickenWeightBatchIdsBySourceUid = chickenBatches;
}

function resolveLocationId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  return value ? ctx.locationIds.get(`granja:${value}`) ?? null : null;
}

function resolveWarehouseId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  return value ? ctx.warehouseIds.get(`bodega:${value}`) ?? null : null;
}

function resolveItemId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  if (!value) {
    return null;
  }

  for (const prefix of ["item", "producto", "materia_prima", "tamano_huevo", "concepto"]) {
    const itemId = ctx.itemIds.get(`${prefix}:${value}`);
    if (itemId) {
      return itemId;
    }
  }

  return null;
}

function rawSourceUidByField(
  ctx: TransformContext,
  sourceName: string,
  fieldName: string,
  rawId: unknown
): string | null {
  const value = asText(rawId);
  if (!value) {
    return null;
  }

  for (const record of recordsFor(ctx, sourceName)) {
    if (asText(getField(normalized(record), fieldName)) === value) {
      return record.source_uid;
    }
  }

  return null;
}

function resolveStoreId(ctx: TransformContext, rawStoreId: unknown): string | null {
  const rawSourceUid = rawSourceUidByField(ctx, "mercadeo_tiendas", "tiendaid", rawStoreId);
  return rawSourceUid ? ctx.storeIdsBySourceUid.get(rawSourceUid) ?? null : null;
}

function resolveChickenWeightBatchId(ctx: TransformContext, rawBatchId: unknown): string | null {
  const rawSourceUid = rawSourceUidByField(ctx, "mcds_pesopollo", "pesopolloid", rawBatchId);
  return rawSourceUid ? ctx.chickenWeightBatchIdsBySourceUid.get(rawSourceUid) ?? null : null;
}

function sourceEffectiveDate(record: RawAppSheetRecord): string {
  return asDateOnly(record.source_updated_at) ?? "1970-01-01";
}

function buildStoreEggInventoryCountCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "mcds_inventariohuevom")) {
    const row = normalized(record);
    const countDate = asDateOnly(getField(row, "inventariofecha"));

    if (!countDate) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        source_record_id: record.id,
        source_uid: record.source_uid,
        count_date: countDate,
        count_time: asText(getField(row, "inventariohora")),
        warehouse_id: resolveWarehouseId(ctx, getField(row, "bodegaid")),
        item_id: resolveItemId(ctx, getField(row, "itemid")),
        packs: asNumber(getField(row, "pacas")),
        eggs: asNumber(getField(row, "huevos")),
        quantity: asNumber(getField(row, "cantidad")),
        notes: asText(getField(row, "observaciones")),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          inventariohuevomid: asText(getField(row, "inventariohuevomid")),
          itemid: asText(getField(row, "itemid")),
          bodegaid: asText(getField(row, "bodegaid")),
          marcatiempo: asText(getField(row, "marcatiempo"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildChickenWeightBatchCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "mcds_pesopollo")) {
    const row = normalized(record);
    const weighingDate = asDateOnly(getField(row, "pesopollofecha"));

    if (!weighingDate) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        source_record_id: record.id,
        source_uid: record.source_uid,
        weighing_date: weighingDate,
        location_id: resolveLocationId(ctx, getField(row, "granjaid")),
        item_id: resolveItemId(ctx, getField(row, "itemid")),
        quantity: asNumber(getField(row, "cantidad")),
        average_weight: asNumber(getField(row, "pesopromedio")),
        crate_count: asNumber(getField(row, "canastillas")),
        processor_receipt_ref: asText(getField(row, "procesadoraavesrecibo")),
        macadasa_sheet_ref: asText(getField(row, "pesomacadasahoja")),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          pesopolloid: asText(getField(row, "pesopolloid")),
          granjaid: asText(getField(row, "granjaid")),
          marcatiempo: asText(getField(row, "marcatiempo"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildChickenWeightLineCandidates(ctx: TransformContext): BuildResult {
  const candidates: Candidate[] = [];
  let skipped = 0;

  function add(sourceName: string, lineType: "carcass" | "offal"): void {
    for (const record of recordsFor(ctx, sourceName)) {
      const row = normalized(record);
      const batchId = resolveChickenWeightBatchId(ctx, getField(row, "pesopolloid"));

      if (!batchId) {
        skipped += 1;
        continue;
      }

      candidates.push({
        key: record.source_uid,
        payload: compactRecord({
          chicken_weight_batch_id: batchId,
          source_record_id: record.id,
          source_uid: record.source_uid,
          line_type: lineType,
          crates: asNumber(getField(row, "canastillas")),
          weight_kg: asNumber(getField(row, "pesokg")),
          units: asNumber(getField(row, "unidades")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            pesopolloid: asText(getField(row, "pesopolloid")),
            pesopollodetalleid: asText(getField(row, "pesopollodetalleid")),
            pesopollomenudenciadetalleid: asText(getField(row, "pesopollomenudenciadetalleid"))
          })
        }),
        sourceReference: sourceRef(record)
      });
    }
  }

  add("mcds_pesopollodetalle", "carcass");
  add("mcds_pesopollomenudenciadetalle", "offal");

  return { candidates, skipped };
}

function buildStorePriceCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "mcds_precios")) {
    const row = normalized(record);

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        source_record_id: record.id,
        source_uid: record.source_uid,
        item_id: resolveItemId(ctx, getField(row, "itemid")),
        price: asNumber(getField(row, "precio")) ?? 0,
        price_level: asText(getField(row, "nivel")),
        effective_date: sourceEffectiveDate(record),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          preciosid: asText(getField(row, "preciosid")),
          itemid: asText(getField(row, "itemid")),
          no_source_effective_date: true
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildPromotionCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "mcds_z_promociones")) {
    const row = normalized(record);
    const promotionDate = asDateOnly(getField(row, "fecha"));

    if (!promotionDate) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        source_record_id: record.id,
        source_uid: record.source_uid,
        promotion_date: promotionDate,
        item_id: resolveItemId(ctx, getField(row, "itemid")),
        product_name: asText(getField(row, "producto")),
        description: asText(getField(row, "promocion")),
        discount_amount: asNumber(getField(row, "descuento")),
        discount_percentage: asNumber(getField(row, "porcentaje")),
        quantity: asNumber(getField(row, "cantidad")),
        sales_amount: asNumber(getField(row, "ventas")),
        cost_amount: asNumber(getField(row, "costo")),
        result_amount: asNumber(getField(row, "resultado")),
        comments: asText(getField(row, "comentarios")),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          promocionid: asText(getField(row, "promocionid")),
          dias: asNumber(getField(row, "dias")),
          imagen: asText(getField(row, "imagen"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildStorePurchaseCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "mercadeo_tiendascompras")) {
    const row = normalized(record);
    const purchaseDate = asDateOnly(getField(row, "fecha"));

    if (!purchaseDate) {
      continue;
    }

    const statusFlag = asBoolean(getField(row, "estado"));

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        source_record_id: record.id,
        source_uid: record.source_uid,
        store_id: resolveStoreId(ctx, getField(row, "tiendaid")),
        purchase_date: purchaseDate,
        item_type: asText(getField(row, "tipo")),
        quantity: asNumber(getField(row, "cantidad")),
        status: statusFlag === null ? null : statusFlag ? "completed" : "pending",
        metadata: mergeMetadata(rawLineageMetadata(record), {
          tiendacompraid: asText(getField(row, "tiendacompraid")),
          tiendaid: asText(getField(row, "tiendaid")),
          estado_raw: asText(getField(row, "estado")),
          marcatiempo: asText(getField(row, "marcatiempo"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

type RawAttachment = {
  id: string;
  raw_record_source_uid: string;
  source_name: string;
  source_primary_key: string | null;
  column_name: string;
  file_ref: string;
  file_name: string | null;
  file_kind: string;
  mime_type: string | null;
  metadata: JsonRecord | null;
};

async function promoteStoreMarketingAttachments(
  ctx: TransformContext
): Promise<StoreMarketingStageSummary> {
  const refsBySourceUid = new Map<string, EntityReference[]>();

  for (const reference of ctx.entityReferences) {
    const current = refsBySourceUid.get(reference.sourceUid) ?? [];
    current.push(reference);
    refsBySourceUid.set(reference.sourceUid, current);
  }

  if (refsBySourceUid.size === 0) {
    return { stage: "attachments", ...EMPTY_COUNTS };
  }

  const attachments: RawAttachment[] = [];

  for (const sourceUidChunk of chunkArray([...refsBySourceUid.keys()], IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await ctx.supabase
      .from("raw_appsheet_attachments")
      .select(
        "id,raw_record_source_uid,source_name,source_primary_key,column_name,file_ref,file_name,file_kind,mime_type,metadata"
      )
      .in("raw_record_source_uid", sourceUidChunk);

    if (error) {
      throw new Error(`Error leyendo raw_appsheet_attachments: ${error.message}`);
    }

    attachments.push(...((data ?? []) as RawAttachment[]));
  }

  const candidates: Candidate[] = [];

  for (const attachment of attachments) {
    const references = refsBySourceUid.get(attachment.raw_record_source_uid) ?? [];

    for (const reference of references) {
      const payload = {
        raw_attachment_id: attachment.id,
        entity_table: reference.entityTable,
        entity_id: reference.entityId,
        file_ref: attachment.file_ref,
        file_name: attachment.file_name,
        file_kind: attachment.file_kind,
        mime_type: attachment.mime_type,
        is_migrated: false,
        metadata: mergeMetadata(attachment.metadata ?? undefined, {
          transform_name: TRANSFORM_NAME,
          source_name: attachment.source_name,
          source_primary_key: attachment.source_primary_key,
          column_name: attachment.column_name
        })
      };

      candidates.push({
        key: conflictKey(["entity_table", "entity_id", "file_ref"], payload),
        payload
      });
    }
  }

  const { summary } = await upsertCandidates(
    ctx,
    "attachments",
    "attachments",
    ["entity_table", "entity_id", "file_ref"],
    candidates
  );

  return summary;
}

function compactSummary(summary: StoreMarketingStageSummary): StoreMarketingStageSummary {
  return {
    stage: summary.stage,
    processed: summary.processed,
    inserted: summary.inserted,
    updated: summary.updated,
    unchanged: summary.unchanged,
    skipped: summary.skipped,
    errors: summary.errors,
    referencesUpserted: summary.referencesUpserted
  };
}

function printStage(summary: StoreMarketingStageSummary): void {
  console.log(
    `${summary.stage}: processed=${summary.processed}, inserted=${summary.inserted}, updated=${summary.updated}, unchanged=${summary.unchanged}, skipped=${summary.skipped}, refs=${summary.referencesUpserted}, errors=${summary.errors}`
  );
}

export async function transformStoreMarketing(
  supabase: SupabaseClient,
  options: TransformStoreMarketingOptions
): Promise<TransformStoreMarketingSummary> {
  const allRecords = await fetchRawRecordsBySourceNames(supabase, STORE_MARKETING_SOURCE_NAMES);
  const recordsBySource = new Map<string, RawAppSheetRecord[]>();

  for (const record of allRecords) {
    const current = recordsBySource.get(record.source_name) ?? [];
    current.push(record);
    recordsBySource.set(record.source_name, current);
  }

  const ctx: TransformContext = {
    supabase,
    dryRun: options.dryRun,
    now: new Date().toISOString(),
    recordsBySource,
    locationIds: new Map(),
    warehouseIds: new Map(),
    itemIds: new Map(),
    storeIdsBySourceUid: new Map(),
    chickenWeightBatchIdsBySourceUid: new Map(),
    entityReferences: []
  };

  await refreshLookups(ctx);

  const stages: StoreMarketingStageSummary[] = [];

  async function runStage(
    stage: string,
    tableName: string,
    conflictColumns: string[],
    build: () => Candidate[],
    extraSkipped = 0
  ): Promise<Map<string, string>> {
    if (!shouldRun(options, stage)) {
      return new Map();
    }

    const { summary, idByKey } = await upsertCandidates(
      ctx,
      stage,
      tableName,
      conflictColumns,
      build(),
      extraSkipped
    );
    const compacted = compactSummary(summary);
    stages.push(compacted);
    printStage(compacted);
    if (!ctx.dryRun) {
      await refreshLookups(ctx);
    }
    return idByKey;
  }

  await runStage("store_egg_inventory_counts", "store_egg_inventory_counts", ["source_uid"], () =>
    buildStoreEggInventoryCountCandidates(ctx)
  );
  await runStage("chicken_weight_batches", "chicken_weight_batches", ["source_uid"], () =>
    buildChickenWeightBatchCandidates(ctx)
  );

  if (ctx.dryRun) {
    for (const candidate of buildChickenWeightBatchCandidates(ctx)) {
      if (!ctx.chickenWeightBatchIdsBySourceUid.has(candidate.key)) {
        ctx.chickenWeightBatchIdsBySourceUid.set(candidate.key, ZERO_UUID);
      }
    }
  }

  if (shouldRun(options, "chicken_weight_lines")) {
    const result = buildChickenWeightLineCandidates(ctx);
    await runStage(
      "chicken_weight_lines",
      "chicken_weight_lines",
      ["source_uid"],
      () => result.candidates,
      result.skipped
    );
  }

  await runStage("store_prices", "store_prices", ["source_uid"], () => buildStorePriceCandidates(ctx));
  await runStage("promotions", "promotions", ["source_uid"], () => buildPromotionCandidates(ctx));
  await runStage("store_purchases", "store_purchases", ["source_uid"], () =>
    buildStorePurchaseCandidates(ctx)
  );

  if (shouldRun(options, "attachments")) {
    const summary = compactSummary(await promoteStoreMarketingAttachments(ctx));
    stages.push(summary);
    printStage(summary);
  }

  const totals = stages.reduce(
    (acc, stage) => ({
      processed: acc.processed + stage.processed,
      inserted: acc.inserted + stage.inserted,
      updated: acc.updated + stage.updated,
      unchanged: acc.unchanged + stage.unchanged,
      skipped: acc.skipped + stage.skipped,
      errors: acc.errors + stage.errors,
      referencesUpserted: acc.referencesUpserted + stage.referencesUpserted
    }),
    { ...EMPTY_COUNTS }
  );

  return {
    dryRun: options.dryRun,
    rawRecordsRead: allRecords.length,
    stages,
    totals
  };
}
