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

export type TransformFeedPlantOptions = {
  dryRun: boolean;
  only?: Set<string>;
};

export type FeedPlantStageSummary = {
  stage: string;
  processed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  referencesUpserted: number;
};

export type TransformFeedPlantSummary = {
  dryRun: boolean;
  rawRecordsRead: number;
  stages: FeedPlantStageSummary[];
  totals: Omit<FeedPlantStageSummary, "stage">;
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
  itemIds: Map<string, string>;
  warehouseIds: Map<string, string>;
  userIds: Map<string, string>;
  feedFormulaIdsBySourceUid: Map<string, string>;
  feedFormulaIdsByCode: Map<string, string>;
  feedProductionOrderIdsBySourceUid: Map<string, string>;
  rawMaterialReceiptIdsBySourceUid: Map<string, string>;
  entityReferences: EntityReference[];
};

const TRANSFORM_NAME = "feed_plant";
const IN_FILTER_CHUNK_SIZE = 50;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const FEED_PLANT_SOURCE_NAMES = [
  "planta_formulas",
  "planta_formulasdetalle",
  "planta_produccion",
  "planta_producciondetalle",
  "planta_entrada",
  "planta_muestras",
  "planta_administracion",
  "planta_maquila",
  "planta_precioventacomercial",
  "planta_auditorias"
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

const MAQUILA_COST_FIELDS = [
  "salarios",
  "tulas",
  "hilo",
  "energia",
  "ordenyaseo",
  "mantenimiento",
  "arriendo"
];

const SALE_PRICE_DEFINITIONS = [
  {
    providerName: "MACADASA",
    providerKey: "macadasa",
    productCode: "PL",
    withoutTaxField: "pollalevantesiniva",
    withTaxField: "pollalevanteconiva"
  },
  {
    providerName: "MACADASA",
    providerKey: "macadasa",
    productCode: "F1",
    withoutTaxField: "fase1siniva",
    withTaxField: "fase1coniva"
  },
  {
    providerName: "MACADASA",
    providerKey: "macadasa",
    productCode: "F2",
    withoutTaxField: "fase2siniva",
    withTaxField: "fase2coniva"
  },
  {
    providerName: "MACADASA",
    providerKey: "macadasa",
    productCode: "PE",
    withoutTaxField: "polloengordesiniva",
    withTaxField: "polloengordeconiva"
  },
  {
    providerName: "Italcol",
    providerKey: "italcol",
    productCode: "PL",
    withoutTaxField: "italcolpollalevantesiniva",
    withTaxField: "italcolpollalevanteconiva"
  },
  {
    providerName: "Italcol",
    providerKey: "italcol",
    productCode: "F1",
    withoutTaxField: "italcolfase1siniva",
    withTaxField: "italcolfase1coniva"
  },
  {
    providerName: "Italcol",
    providerKey: "italcol",
    productCode: "F2",
    withoutTaxField: "italcolfase2siniva",
    withTaxField: "italcolfase2coniva"
  },
  {
    providerName: "Italcol",
    providerKey: "italcol",
    productCode: "PE",
    withoutTaxField: "italcolpolloengordesiniva",
    withTaxField: "italcolpolloengordeconiva"
  },
  {
    providerName: "Contegral",
    providerKey: "contegral",
    productCode: "PL",
    withoutTaxField: "contegralpollalevantesiniva",
    withTaxField: "contegralpollalevanteconiva"
  },
  {
    providerName: "Contegral",
    providerKey: "contegral",
    productCode: "F1",
    withoutTaxField: "contegralfase1siniva",
    withTaxField: "contegralfase1coniva"
  },
  {
    providerName: "Contegral",
    providerKey: "contegral",
    productCode: "F2",
    withoutTaxField: "contegralfase2siniva",
    withTaxField: "contegralfase2coniva"
  },
  {
    providerName: "Contegral",
    providerKey: "contegral",
    productCode: "PE",
    withoutTaxField: "contegralpolloengordesiniva",
    withTaxField: "contegralpolloengordeconiva"
  }
];

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

function shouldRun(options: TransformFeedPlantOptions, stage: string): boolean {
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
): Promise<{ summary: FeedPlantStageSummary; idByKey: Map<string, string> }> {
  const candidates = dedupeCandidates(rawCandidates).filter((candidate) =>
    conflictColumns.every((column) => candidate.payload[column] !== undefined && candidate.payload[column] !== null)
  );
  const summary: FeedPlantStageSummary = {
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

async function loadFeedFormulaLookups(
  supabase: SupabaseClient
): Promise<{ bySourceUid: Map<string, string>; byCode: Map<string, string> }> {
  const bySourceUid = new Map<string, string>();
  const byCode = new Map<string, string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("feed_formulas")
      .select("id,source_uid,formula_code")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Error cargando feed_formulas: ${error.message}`);
    }

    const page = (data ?? []) as unknown as Array<{ id: string } & JsonRecord>;

    for (const row of page) {
      const sourceUid = asText(row.source_uid);
      const formulaCode = asText(row.formula_code);

      if (sourceUid) {
        bySourceUid.set(sourceUid, row.id);
      }
      if (formulaCode) {
        byCode.set(formulaCode, row.id);
      }
    }

    if (page.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return { bySourceUid, byCode };
}

async function refreshLookups(ctx: TransformContext): Promise<void> {
  const [items, warehouses, users, formulas, productionOrders, rawReceipts] = await Promise.all([
    loadIdLookup(ctx.supabase, "items", "code"),
    loadIdLookup(ctx.supabase, "warehouses", "code"),
    loadIdLookup(ctx.supabase, "users", "code"),
    loadFeedFormulaLookups(ctx.supabase),
    loadIdLookup(ctx.supabase, "feed_production_orders", "source_uid"),
    loadIdLookup(ctx.supabase, "raw_material_receipts", "source_uid")
  ]);

  ctx.itemIds = items;
  ctx.warehouseIds = warehouses;
  ctx.userIds = users;
  ctx.feedFormulaIdsBySourceUid = formulas.bySourceUid;
  ctx.feedFormulaIdsByCode = formulas.byCode;
  ctx.feedProductionOrderIdsBySourceUid = productionOrders;
  ctx.rawMaterialReceiptIdsBySourceUid = rawReceipts;
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

function resolveWarehouseId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  return value ? ctx.warehouseIds.get(`bodega:${value}`) ?? null : null;
}

function resolveUserId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  return value ? ctx.userIds.get(`usuario:${value.toLowerCase()}`) ?? null : null;
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

function resolveFormulaId(ctx: TransformContext, rawFormulaId: unknown): string | null {
  const formulaCode = asText(rawFormulaId);
  if (!formulaCode) {
    return null;
  }

  const rawSourceUid = rawSourceUidByField(ctx, "planta_formulas", "formulaid", formulaCode);
  return (
    (rawSourceUid ? ctx.feedFormulaIdsBySourceUid.get(rawSourceUid) : undefined) ??
    ctx.feedFormulaIdsByCode.get(formulaCode) ??
    null
  );
}

function resolveProductionOrderId(ctx: TransformContext, rawProductionId: unknown): string | null {
  const rawSourceUid = rawSourceUidByField(ctx, "planta_produccion", "produccionid", rawProductionId);
  return rawSourceUid ? ctx.feedProductionOrderIdsBySourceUid.get(rawSourceUid) ?? null : null;
}

function resolveRawMaterialReceiptId(ctx: TransformContext, rawEntradaId: unknown): string | null {
  const rawSourceUid = rawSourceUidByField(ctx, "planta_entrada", "entradaid", rawEntradaId);
  return rawSourceUid ? ctx.rawMaterialReceiptIdsBySourceUid.get(rawSourceUid) ?? null : null;
}

function feedProductName(productCode: string): string {
  const names: Record<string, string> = {
    F1: "Fase 1",
    F1M: "Fase 1 Medicada",
    F2: "Fase 2",
    F2M: "Fase 2 Medicada",
    PE: "Pollo Engorde",
    PL: "Polla Levante"
  };

  return names[productCode] ?? productCode;
}

function buildFeedItemStubCandidates(ctx: TransformContext): Candidate[] {
  const candidatesByCode = new Map<string, Candidate>();

  function add(productId: unknown, record: RawAppSheetRecord): void {
    const value = asText(productId);
    if (!value) {
      return;
    }

    const code = `producto:${value}`;
    if (ctx.itemIds.has(code) || candidatesByCode.has(code)) {
      return;
    }

    candidatesByCode.set(code, {
      key: code,
      payload: {
        code,
        name: feedProductName(value),
        item_type: "feed",
        unit: "bulto",
        tax_rate: 0,
        is_inventory_item: true,
        is_sellable: true,
        is_purchasable: false,
        is_active: true,
        source_record_id: record.id,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          synthetic_from_feed_plant: true,
          productoid: value
        })
      },
      sourceReference: sourceRef(record, `productoid:${value}`)
    });
  }

  for (const record of recordsFor(ctx, "planta_formulas")) {
    add(getField(normalized(record), "productoid"), record);
  }

  for (const record of recordsFor(ctx, "planta_produccion")) {
    add(getField(normalized(record), "productoid"), record);
  }

  return [...candidatesByCode.values()];
}

function buildFeedFormulaCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_formulas")) {
    const row = normalized(record);
    const formulaCode = asText(getField(row, "formulaid"));
    const formulaName =
      asText(getField(row, "formulanombre")) ??
      asText(getField(row, "formuladescripcion")) ??
      formulaCode ??
      sourcePrimaryKey(record);
    const active = asBoolean(getField(row, "estado"));

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        formula_code: formulaCode,
        item_id: resolveItemId(ctx, getField(row, "productoid")),
        formula_name: formulaName,
        description: asText(getField(row, "formuladescripcion")),
        medicated: asBoolean(getField(row, "medicada")) ?? false,
        status: active === false ? "inactive" : "active",
        effective_date: asDateOnly(getField(row, "fecha")),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          productoid: asText(getField(row, "productoid")),
          formula_pdf: asText(getField(row, "formulaspdf"))
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildFeedFormulaLineCandidates(ctx: TransformContext): BuildResult {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const record of recordsFor(ctx, "planta_formulasdetalle")) {
    const row = normalized(record);
    const formulaId = resolveFormulaId(ctx, getField(row, "formulaid"));
    const itemId = resolveItemId(ctx, getField(row, "materiaprimaid", "productoid"));

    if (!formulaId || !itemId) {
      skipped += 1;
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        feed_formula_id: formulaId,
        item_id: itemId,
        quantity_kg: asNumber(getField(row, "cantidadkg")),
        percentage: null,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          formulaid: asText(getField(row, "formulaid")),
          materiaprimaid: asText(getField(row, "materiaprimaid")),
          productoid: asText(getField(row, "productoid"))
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return { candidates, skipped };
}

function buildFeedProductionOrderCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_produccion")) {
    const row = normalized(record);
    const productionDate = asDateOnly(getField(row, "produccionfecha"));

    if (!productionDate) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        production_date: productionDate,
        formula_id: resolveFormulaId(ctx, getField(row, "formulaid")),
        output_item_id: resolveItemId(ctx, getField(row, "productoid")),
        lot_code: asText(getField(row, "lote")),
        batches: asNumber(getField(row, "baches")),
        practical_bags: asNumber(getField(row, "btopractico")),
        theoretical_bags: asNumber(getField(row, "bto_teorico")),
        responsible_user_id: resolveUserId(ctx, getField(row, "responsable")),
        status: "posted",
        metadata: mergeMetadata(rawLineageMetadata(record), {
          formulaid: asText(getField(row, "formulaid")),
          productoid: asText(getField(row, "productoid")),
          plus: asText(getField(row, "plus")),
          contador: asText(getField(row, "contador")),
          responsable_raw: asText(getField(row, "responsable")),
          firma: asText(getField(row, "firma")),
          btorestantes: asNumber(getField(row, "btorestantes")),
          btoajusteadministrador: asNumber(getField(row, "btoajusteadministrador"))
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildFeedProductionMaterialCandidates(ctx: TransformContext): BuildResult {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const record of recordsFor(ctx, "planta_producciondetalle")) {
    const row = normalized(record);
    const productionOrderId = resolveProductionOrderId(ctx, getField(row, "produccionid"));
    const itemId = resolveItemId(ctx, getField(row, "materiaprimaid"));

    if (!productionOrderId || !itemId) {
      skipped += 1;
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        feed_production_order_id: productionOrderId,
        item_id: itemId,
        quantity_kg: asNumber(getField(row, "kgsalida")) ?? 0,
        unit_cost: null,
        total_cost: null,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          produccionid: asText(getField(row, "produccionid")),
          materiaprimaid: asText(getField(row, "materiaprimaid")),
          produccionfecha: asDateOnly(getField(row, "produccionfecha")),
          kgmpacumpsub0: asNumber(getField(row, "kgmpacumpsub0")),
          kgmpacumpsubf: asNumber(getField(row, "kgmpacumpsubf"))
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return { candidates, skipped };
}

function buildFeedProductionOutputCandidates(ctx: TransformContext): BuildResult {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const record of recordsFor(ctx, "planta_produccion")) {
    const row = normalized(record);
    const productionOrderId = resolveProductionOrderId(ctx, getField(row, "produccionid"));
    const itemId = resolveItemId(ctx, getField(row, "productoid"));

    if (!productionOrderId || !itemId) {
      skipped += 1;
      continue;
    }

    const sourceUid = `${record.source_uid}::output`;
    const sourcePrimaryKeyOverride = `${sourcePrimaryKey(record)}::output`;

    candidates.push({
      key: sourceUid,
      payload: {
        source_record_id: record.id,
        source_uid: sourceUid,
        feed_production_order_id: productionOrderId,
        item_id: itemId,
        warehouse_id: resolveWarehouseId(ctx, "P"),
        quantity_bags: asNumber(getField(row, "btopractico")),
        quantity_kg: null,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          source_uid_base: record.source_uid,
          formulaid: asText(getField(row, "formulaid")),
          productoid: asText(getField(row, "productoid")),
          theoretical_bags: asNumber(getField(row, "bto_teorico"))
        })
      },
      sourceReference: sourceRef(record, sourcePrimaryKeyOverride)
    });
  }

  return { candidates, skipped };
}

function buildLabSampleCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_muestras")) {
    const row = normalized(record);
    const sampleDate = asDateOnly(getField(row, "muestrafecha"));

    if (!sampleDate) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        sample_date: sampleDate,
        sample_type: asText(getField(row, "tipomuestra")),
        raw_material_receipt_id: resolveRawMaterialReceiptId(ctx, getField(row, "entradaid")),
        feed_production_order_id: resolveProductionOrderId(ctx, getField(row, "produccionid")),
        item_id:
          resolveItemId(ctx, getField(row, "materiaprimaid")) ??
          resolveItemId(ctx, getField(row, "productoid")),
        laboratory: asText(getField(row, "laboratorio")),
        analysis: asText(getField(row, "analisis")),
        result: asText(getField(row, "resultado")),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          muestraid: asText(getField(row, "muestraid")),
          entradaid_raw: asText(getField(row, "entradaid")),
          produccionid_raw: asText(getField(row, "produccionid")),
          materiaprimaid: asText(getField(row, "materiaprimaid")),
          productoid: asText(getField(row, "productoid")),
          fotoguia: asText(getField(row, "fotoguia")),
          fotomuestra: asText(getField(row, "fotomuestra")),
          resultado_pdf: asText(getField(row, "restultadopdf"))
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function auditTypeFromView(value: unknown): string | null {
  const auditView = asText(value);
  if (!auditView) {
    return null;
  }

  if (auditView.toLowerCase().includes("mp")) {
    return "raw_material";
  }

  if (auditView.toLowerCase().includes("pt")) {
    return "finished_product";
  }

  return "other";
}

function buildPlantAuditCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_auditorias")) {
    const row = normalized(record);
    const auditCode = asText(getField(row, "auditoriasid")) ?? sourcePrimaryKey(record);
    const auditView = asText(getField(row, "auditoriavista"));

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        audit_code: auditCode,
        audit_name: asText(getField(row, "nombre")) ?? auditCode,
        audit_view: auditView,
        audit_type: auditTypeFromView(auditView),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          auditoriasid: asText(getField(row, "auditoriasid")),
          auditoriaimagen: asText(getField(row, "auditoriaimagen"))
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildAdminCostPeriodCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_administracion")) {
    const row = normalized(record);
    const periodDate = asDateOnly(getField(row, "fecha"));

    if (!periodDate) {
      continue;
    }

    const totalAmount = asNumber(getField(row, "total")) ?? 0;
    const budgetedKg = asNumber(getField(row, "kgpresupuestos"));

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        period_date: periodDate,
        period_month: asText(getField(row, "mes")),
        total_amount: totalAmount,
        budgeted_kg: budgetedKg,
        cost_per_kg:
          asNumber(getField(row, "valorporkg")) ??
          (budgetedKg && budgetedKg !== 0 ? totalAmount / budgetedKg : null),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          administracionid: asText(getField(row, "administracionid")),
          cost_components: compactRecord({
            administrador: asNumber(getField(row, "administrador")),
            internet: asNumber(getField(row, "internet")),
            gas: asNumber(getField(row, "gas")),
            energia: asNumber(getField(row, "energia")),
            agua: asNumber(getField(row, "agua")),
            arriendo: asNumber(getField(row, "arriendo"))
          })
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildMaquilaCostPeriodCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_maquila")) {
    const row = normalized(record);
    const periodDate = asDateOnly(getField(row, "fecha"));

    if (!periodDate) {
      continue;
    }

    const costComponents: Record<string, number | null> = Object.fromEntries(
      MAQUILA_COST_FIELDS.map((field) => [field, asNumber(getField(row, field))])
    );
    const totalAmount = Object.values(costComponents).reduce<number>(
      (sum, value) => sum + (typeof value === "number" ? value : 0),
      0
    );
    const budgetedKg = asNumber(getField(row, "kgpresupuestos"));

    candidates.push({
      key: record.source_uid,
      payload: {
        source_record_id: record.id,
        source_uid: record.source_uid,
        period_date: periodDate,
        period_month: asText(getField(row, "mes")),
        total_amount: totalAmount,
        budgeted_kg: budgetedKg,
        cost_per_kg:
          asNumber(getField(row, "valorporkg")) ??
          (budgetedKg && budgetedKg !== 0 ? totalAmount / budgetedKg : null),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          maquilaid: asText(getField(row, "maquilaid")),
          cost_components: compactRecord(costComponents)
        })
      },
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildFeedSalePricePeriodCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const record of recordsFor(ctx, "planta_precioventacomercial")) {
    const row = normalized(record);
    const effectiveDate = asDateOnly(getField(row, "fecha"));

    if (!effectiveDate) {
      continue;
    }

    for (const definition of SALE_PRICE_DEFINITIONS) {
      const priceWithoutTax = asNumber(getField(row, definition.withoutTaxField));
      const priceWithTax = asNumber(getField(row, definition.withTaxField));

      if (priceWithoutTax === null && priceWithTax === null) {
        continue;
      }

      const sourceUid = `${record.source_uid}::${definition.providerKey}:${definition.productCode}`;
      const sourcePrimaryKeyOverride = `${sourcePrimaryKey(record)}::${definition.providerKey}:${definition.productCode}`;

      candidates.push({
        key: sourceUid,
        payload: {
          source_record_id: record.id,
          source_uid: sourceUid,
          effective_date: effectiveDate,
          item_id: resolveItemId(ctx, definition.productCode),
          provider_name: definition.providerName,
          price_without_tax: priceWithoutTax,
          price_with_tax: priceWithTax,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            source_uid_base: record.source_uid,
            provider_key: definition.providerKey,
            product_code: definition.productCode,
            transport_bag: asNumber(getField(row, "transportebto"))
          })
        },
        sourceReference: sourceRef(record, sourcePrimaryKeyOverride)
      });
    }
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

async function promoteFeedPlantAttachments(ctx: TransformContext): Promise<FeedPlantStageSummary> {
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
      if (reference.entityTable === "items") {
        continue;
      }

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

function compactSummary(summary: FeedPlantStageSummary): FeedPlantStageSummary {
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

function printStage(summary: FeedPlantStageSummary): void {
  console.log(
    `${summary.stage}: processed=${summary.processed}, inserted=${summary.inserted}, updated=${summary.updated}, unchanged=${summary.unchanged}, skipped=${summary.skipped}, refs=${summary.referencesUpserted}, errors=${summary.errors}`
  );
}

export async function transformFeedPlant(
  supabase: SupabaseClient,
  options: TransformFeedPlantOptions
): Promise<TransformFeedPlantSummary> {
  const allRecords = await fetchRawRecordsBySourceNames(supabase, FEED_PLANT_SOURCE_NAMES);
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
    itemIds: new Map(),
    warehouseIds: new Map(),
    userIds: new Map(),
    feedFormulaIdsBySourceUid: new Map(),
    feedFormulaIdsByCode: new Map(),
    feedProductionOrderIdsBySourceUid: new Map(),
    rawMaterialReceiptIdsBySourceUid: new Map(),
    entityReferences: []
  };

  await refreshLookups(ctx);

  const stages: FeedPlantStageSummary[] = [];

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

  await runStage("feed_item_stubs", "items", ["code"], () => buildFeedItemStubCandidates(ctx));

  if (ctx.dryRun) {
    for (const candidate of buildFeedItemStubCandidates(ctx)) {
      if (!ctx.itemIds.has(candidate.key)) {
        ctx.itemIds.set(candidate.key, ZERO_UUID);
      }
    }
  }

  await runStage("feed_formulas", "feed_formulas", ["source_uid"], () =>
    buildFeedFormulaCandidates(ctx)
  );

  if (ctx.dryRun) {
    for (const candidate of buildFeedFormulaCandidates(ctx)) {
      if (!ctx.feedFormulaIdsBySourceUid.has(candidate.key)) {
        ctx.feedFormulaIdsBySourceUid.set(candidate.key, ZERO_UUID);
      }

      const formulaCode = asText(candidate.payload.formula_code);
      if (formulaCode && !ctx.feedFormulaIdsByCode.has(formulaCode)) {
        ctx.feedFormulaIdsByCode.set(formulaCode, ZERO_UUID);
      }
    }
  }

  if (shouldRun(options, "feed_formula_lines")) {
    const result = buildFeedFormulaLineCandidates(ctx);
    await runStage(
      "feed_formula_lines",
      "feed_formula_lines",
      ["source_uid"],
      () => result.candidates,
      result.skipped
    );
  }

  await runStage("feed_production_orders", "feed_production_orders", ["source_uid"], () =>
    buildFeedProductionOrderCandidates(ctx)
  );

  if (ctx.dryRun) {
    for (const candidate of buildFeedProductionOrderCandidates(ctx)) {
      if (!ctx.feedProductionOrderIdsBySourceUid.has(candidate.key)) {
        ctx.feedProductionOrderIdsBySourceUid.set(candidate.key, ZERO_UUID);
      }
    }
  }

  if (shouldRun(options, "feed_production_materials")) {
    const result = buildFeedProductionMaterialCandidates(ctx);
    await runStage(
      "feed_production_materials",
      "feed_production_materials",
      ["source_uid"],
      () => result.candidates,
      result.skipped
    );
  }

  if (shouldRun(options, "feed_production_outputs")) {
    const result = buildFeedProductionOutputCandidates(ctx);
    await runStage(
      "feed_production_outputs",
      "feed_production_outputs",
      ["source_uid"],
      () => result.candidates,
      result.skipped
    );
  }

  await runStage("lab_samples", "lab_samples", ["source_uid"], () => buildLabSampleCandidates(ctx));
  await runStage("plant_audits", "plant_audits", ["source_uid"], () => buildPlantAuditCandidates(ctx));
  await runStage("admin_cost_periods", "admin_cost_periods", ["source_uid"], () =>
    buildAdminCostPeriodCandidates(ctx)
  );
  await runStage("maquila_cost_periods", "maquila_cost_periods", ["source_uid"], () =>
    buildMaquilaCostPeriodCandidates(ctx)
  );
  await runStage("feed_sale_price_periods", "feed_sale_price_periods", ["source_uid"], () =>
    buildFeedSalePricePeriodCandidates(ctx)
  );

  if (shouldRun(options, "attachments")) {
    const summary = compactSummary(await promoteFeedPlantAttachments(ctx));
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
