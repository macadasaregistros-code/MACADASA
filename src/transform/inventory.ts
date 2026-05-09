import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkArray, createRowHash } from "../sync/utils";
import {
  asBoolean,
  asDateOnly,
  asNumber,
  asText,
  businessUnitCodeForAppName,
  compactRecord,
  fetchRawRecordsBySourceNames,
  getField,
  masterCode,
  mergeMetadata,
  rawLineageMetadata,
  sourcePrimaryKey,
  type JsonRecord,
  type RawAppSheetRecord
} from "./utils";

export type TransformInventoryOptions = {
  dryRun: boolean;
  only?: Set<string>;
};

export type InventoryStageSummary = {
  stage: string;
  processed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  referencesUpserted: number;
};

export type TransformInventorySummary = {
  dryRun: boolean;
  rawRecordsRead: number;
  stages: InventoryStageSummary[];
  totals: Omit<InventoryStageSummary, "stage">;
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

type MovementLineDraft = {
  movementSourceUid: string;
  record: RawAppSheetRecord;
  lineNumber: number;
  itemId: string;
  quantity: number;
  quantitySent: number | null;
  quantityReceived: number | null;
  unit: string | null;
  unitCost: number | null;
  totalCost: number | null;
  notes: string | null;
  metadata: JsonRecord;
};

type TransformContext = {
  supabase: SupabaseClient;
  dryRun: boolean;
  now: string;
  recordsBySource: Map<string, RawAppSheetRecord[]>;
  businessUnitIds: Map<string, string>;
  warehouseIds: Map<string, string>;
  itemIds: Map<string, string>;
  categoryIds: Map<string, string>;
  locationIds: Map<string, string>;
  poultryHouseIds: Map<string, string>;
  costCenterIds: Map<string, string>;
  thirdPartyIds: Map<string, string>;
  userIds: Map<string, string>;
  transferTypeIds: Map<string, string>;
  entityReferences: EntityReference[];
};

type MovementBuildResult = {
  candidates: Candidate[];
  lineDrafts: MovementLineDraft[];
  skipped: number;
};

const TRANSFORM_NAME = "inventory";
const IN_FILTER_CHUNK_SIZE = 50;

const INVENTORY_SOURCE_NAMES = [
  "inventario_traspasosinventariobultos",
  "inventario_traspasosinventariohuevos",
  "inventario_traspasosinventariocc",
  "inventario_inventariobultos",
  "inventario_inventariohuevos",
  "gallinas_entradasg",
  "clasificadora_entradasc",
  "mcds_entradasm",
  "planta_entrada",
  "planta_salidas"
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

function shouldRun(options: TransformInventoryOptions, stage: string): boolean {
  return !options.only || options.only.has(stage) || options.only.has("all");
}

function payloadHash(payload: JsonRecord): string {
  const payloadWithoutMetadata = { ...payload };
  delete payloadWithoutMetadata.metadata;
  return createRowHash(payloadWithoutMetadata);
}

function payloadWithHash(candidate: Candidate, existing?: ExistingRow): JsonRecord {
  const metadata = (candidate.payload.metadata as JsonRecord | undefined) ?? {};
  const payloadWithoutMetadata = { ...candidate.payload };
  delete payloadWithoutMetadata.metadata;

  return {
    ...payloadWithoutMetadata,
    metadata: mergeMetadata(existing?.metadata ?? undefined, metadata, {
      transform_hash: createRowHash(payloadWithoutMetadata),
      transform_name: TRANSFORM_NAME,
      transformed_at: new Date().toISOString()
    })
  };
}

function conflictKey(conflictColumns: string[], row: JsonRecord): string {
  return conflictColumns.map((column) => String(row[column] ?? "")).join("::");
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

    const indexed = new Map<string, ExistingRow>();
    for (const row of rows) {
      const key = conflictKey(conflictColumns, row);
      if (candidateKeys.has(key)) {
        indexed.set(key, row);
      }
    }

    return indexed;
  }

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
): Promise<{ summary: InventoryStageSummary; idByKey: Map<string, string> }> {
  const candidates = dedupeCandidates(rawCandidates).filter((candidate) =>
    conflictColumns.every((column) => candidate.payload[column] !== undefined && candidate.payload[column] !== null)
  );
  const summary: InventoryStageSummary = {
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
  const entityReferences: EntityReference[] = [];

  for (const [key, row] of finalRows.entries()) {
    idByKey.set(key, row.id);
  }

  for (const candidate of candidates) {
    const entityId = idByKey.get(candidate.key);
    if (!entityId || !candidate.sourceReference) {
      continue;
    }

    entityReferences.push({
      ...candidate.sourceReference,
      entityTable: tableName,
      entityId
    });
  }

  summary.referencesUpserted = await upsertExternalReferences(
    ctx.supabase,
    ctx.dryRun,
    entityReferences,
    ctx.now
  );
  ctx.entityReferences.push(...entityReferences);

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

async function loadCompositeLookup(
  supabase: SupabaseClient,
  tableName: string,
  firstColumn: string,
  secondColumn: string
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select(`id,${firstColumn},${secondColumn}`)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Error cargando ${tableName}: ${error.message}`);
    }

    const page = (data ?? []) as unknown as Array<{ id: string } & JsonRecord>;

    for (const row of page) {
      const first = asText(row[firstColumn]);
      const second = asText(row[secondColumn]);
      if (first && second) {
        lookup.set(`${first}::${second}`, row.id);
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
  const [
    businessUnits,
    warehouses,
    items,
    categories,
    locations,
    poultryHouses,
    costCenters,
    thirdParties,
    users,
    transferTypes
  ] = await Promise.all([
    loadIdLookup(ctx.supabase, "business_units", "code"),
    loadIdLookup(ctx.supabase, "warehouses", "code"),
    loadIdLookup(ctx.supabase, "items", "code"),
    loadIdLookup(ctx.supabase, "categories", "code"),
    loadIdLookup(ctx.supabase, "locations", "code"),
    loadCompositeLookup(ctx.supabase, "poultry_houses", "business_unit_id", "code"),
    loadIdLookup(ctx.supabase, "cost_centers", "code"),
    loadIdLookup(ctx.supabase, "third_parties", "external_code"),
    loadIdLookup(ctx.supabase, "users", "code"),
    loadIdLookup(ctx.supabase, "inventory_transfer_types", "code")
  ]);

  ctx.businessUnitIds = businessUnits;
  ctx.warehouseIds = warehouses;
  ctx.itemIds = items;
  ctx.categoryIds = categories;
  ctx.locationIds = locations;
  ctx.poultryHouseIds = poultryHouses;
  ctx.costCenterIds = costCenters;
  ctx.thirdPartyIds = thirdParties;
  ctx.userIds = users;
  ctx.transferTypeIds = transferTypes;
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

function resolveCategoryId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  if (!value) {
    return null;
  }

  return (
    ctx.categoryIds.get(`categoria:${value}`) ??
    ctx.categoryIds.get(`mcds_categoria_gasto:${value}`) ??
    null
  );
}

function resolveUserId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  return value ? ctx.userIds.get(`usuario:${value.toLowerCase()}`) ?? null : null;
}

function resolveLocationId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  return value ? ctx.locationIds.get(`granja:${value}`) ?? null : null;
}

function resolvePoultryHouseId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  const businessUnitId = ctx.businessUnitIds.get("granja_postura");
  return value && businessUnitId ? ctx.poultryHouseIds.get(`${businessUnitId}::galpon:${value}`) ?? null : null;
}

function resolveThirdPartyId(ctx: TransformContext, prefix: string, rawId: unknown): string | null {
  const code = masterCode(prefix, rawId);
  return code ? ctx.thirdPartyIds.get(code) ?? null : null;
}

function transferTypeCode(sourceName: string, rawTypeId: unknown): string | null {
  const value = asText(rawTypeId);
  if (!value) {
    return null;
  }

  if (sourceName === "inventario_traspasosinventariobultos") {
    return `bultos:${value}`;
  }

  if (sourceName === "inventario_traspasosinventariohuevos") {
    return `huevos:${value}`;
  }

  if (sourceName === "inventario_traspasosinventariocc") {
    return `cc:${value}`;
  }

  return null;
}

function transferTypeName(rawTypeId: string): string {
  const knownNames: Record<string, string> = {
    Prod: "Produccion",
    Tras: "Traspaso",
    HojM: "Hoja de manejo",
    AjsP: "Ajuste planta",
    AjsG: "Ajuste granja",
    AjsC: "Ajuste clasificadora",
    ClsE: "Clasificacion entrada",
    ClsS: "Clasificacion salida"
  };

  return knownNames[rawTypeId] ?? rawTypeId;
}

function buildTransferTypeCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  function add(sourceName: string, fieldName: string): void {
    const seen = new Set<string>();

    for (const record of recordsFor(ctx, sourceName)) {
      const row = normalized(record);
      const rawTypeId = asText(getField(row, fieldName));
      const code = transferTypeCode(sourceName, rawTypeId);

      if (!rawTypeId || !code || seen.has(code)) {
        continue;
      }

      seen.add(code);
      candidates.push({
        key: code,
        payload: {
          code,
          name: transferTypeName(rawTypeId),
          movement_category: "transfer",
          affects_cost: false,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            synthetic_from_inventory_source: true,
            original_type_id: rawTypeId
          })
        },
        sourceReference: sourceRef(record, rawTypeId)
      });
    }
  }

  add("inventario_traspasosinventariobultos", "tipotraspasobultoid");
  add("inventario_traspasosinventariohuevos", "tipostraspasohuevosid");
  add("inventario_traspasosinventariocc", "tipotraspasoccid");

  return candidates;
}

function inferTransferMovementType(row: JsonRecord): "in" | "out" | "transfer" | "adjustment" {
  const rawType = asText(getField(row, "tipotraspasobultoid", "tipostraspasohuevosid", "tipotraspasoccid")) ?? "";
  const origin = asText(getField(row, "origen"));
  const destination = asText(getField(row, "destino"));

  if (rawType.toLowerCase().startsWith("ajs")) {
    return "adjustment";
  }

  if (origin && destination) {
    return "transfer";
  }

  if (destination) {
    return "in";
  }

  return "out";
}

function buildInventoryTransferMovements(ctx: TransformContext): MovementBuildResult {
  const candidates: Candidate[] = [];
  const lineDrafts: MovementLineDraft[] = [];
  let skipped = 0;

  const specs = [
    {
      sourceName: "inventario_traspasosinventariobultos",
      idField: "traspasosinventariobultosid",
      typeField: "tipotraspasobultoid",
      unit: "bulto"
    },
    {
      sourceName: "inventario_traspasosinventariohuevos",
      idField: "traspasosinventariohuevosid",
      typeField: "tipostraspasohuevosid",
      unit: "huevo"
    },
    {
      sourceName: "inventario_traspasosinventariocc",
      idField: "traspasosinventarioccid",
      typeField: "tipotraspasoccid",
      unit: "unidad"
    }
  ];

  for (const spec of specs) {
    for (const record of recordsFor(ctx, spec.sourceName)) {
      const row = normalized(record);
      const itemId = resolveItemId(ctx, getField(row, "itemid"));
      const date = asDateOnly(getField(row, "fecha"));
      const quantitySent = asNumber(getField(row, "cantidadenviada"));
      const quantityReceived = asNumber(getField(row, "cantidadrecibida"));
      const quantity = quantityReceived ?? quantitySent;

      if (!itemId || !date || quantity === null) {
        skipped += 1;
        continue;
      }

      const sourceWarehouseId = resolveWarehouseId(ctx, getField(row, "origen"));
      const destinationWarehouseId = resolveWarehouseId(ctx, getField(row, "destino"));
      const movementType = inferTransferMovementType(row);
      const transferCode = transferTypeCode(spec.sourceName, getField(row, spec.typeField));

      candidates.push({
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          business_unit_id: ctx.businessUnitIds.get("inventario_general"),
          warehouse_id: destinationWarehouseId ?? sourceWarehouseId,
          movement_date: date,
          movement_type: movementType,
          quantity,
          unit: spec.unit,
          unit_cost: asNumber(getField(row, "valorunitario")),
          total_cost: asNumber(getField(row, "valortotal")),
          reference: asText(getField(row, spec.idField)),
          notes: asText(getField(row, "validacion")),
          movement_number: asText(getField(row, spec.idField)),
          transfer_type_id: transferCode ? ctx.transferTypeIds.get(transferCode) ?? null : null,
          source_warehouse_id: sourceWarehouseId,
          destination_warehouse_id: destinationWarehouseId,
          movement_status: "posted",
          metadata: mergeMetadata(rawLineageMetadata(record), {
            inventory_source: spec.sourceName,
            transfer_type_raw: asText(getField(row, spec.typeField)),
            source_updated_at: asText(getField(row, "marcatiempo"))
          })
        }),
        sourceReference: sourceRef(record)
      });

      lineDrafts.push({
        movementSourceUid: record.source_uid,
        record,
        lineNumber: 1,
        itemId,
        quantity,
        quantitySent,
        quantityReceived,
        unit: spec.unit,
        unitCost: asNumber(getField(row, "valorunitario")),
        totalCost: asNumber(getField(row, "valortotal")),
        notes: asText(getField(row, "validacion")),
        metadata: {
          inventory_source: spec.sourceName,
          item_raw_id: asText(getField(row, "itemid"))
        }
      });
    }
  }

  return { candidates, lineDrafts, skipped };
}

function buildOperationalEntryMovements(ctx: TransformContext): MovementBuildResult {
  const candidates: Candidate[] = [];
  const lineDrafts: MovementLineDraft[] = [];
  let skipped = 0;

  function addMovement(params: {
    record: RawAppSheetRecord;
    date: unknown;
    itemRawId: unknown;
    quantity: unknown;
    unit: string;
    businessUnitCode: string;
    movementType: "in" | "out" | "transfer";
    sourceWarehouseRawId?: unknown;
    destinationWarehouseRawId?: unknown;
    reference?: unknown;
    notes?: unknown;
    unitCost?: unknown;
    totalCost?: unknown;
    metadata?: JsonRecord;
  }): void {
    const itemId = resolveItemId(ctx, params.itemRawId);
    const date = asDateOnly(params.date);
    const quantity = asNumber(params.quantity);

    if (!itemId || !date || quantity === null) {
      skipped += 1;
      return;
    }

    const sourceWarehouseId = resolveWarehouseId(ctx, params.sourceWarehouseRawId);
    const destinationWarehouseId = resolveWarehouseId(ctx, params.destinationWarehouseRawId);

    candidates.push({
      key: params.record.source_uid,
      payload: compactRecord({
        source_record_id: params.record.id,
        source_uid: params.record.source_uid,
        business_unit_id: ctx.businessUnitIds.get(params.businessUnitCode),
        warehouse_id: destinationWarehouseId ?? sourceWarehouseId,
        movement_date: date,
        movement_type: params.movementType,
        quantity,
        unit: params.unit,
        unit_cost: asNumber(params.unitCost),
        total_cost: asNumber(params.totalCost),
        reference: asText(params.reference),
        notes: asText(params.notes),
        movement_number: asText(params.reference),
        source_warehouse_id: sourceWarehouseId,
        destination_warehouse_id: destinationWarehouseId,
        movement_status: "posted",
        metadata: mergeMetadata(rawLineageMetadata(params.record), params.metadata, {
          item_raw_id: asText(params.itemRawId)
        })
      }),
      sourceReference: sourceRef(params.record)
    });

    lineDrafts.push({
      movementSourceUid: params.record.source_uid,
      record: params.record,
      lineNumber: 1,
      itemId,
      quantity,
      quantitySent: params.movementType === "out" ? quantity : null,
      quantityReceived: params.movementType === "in" ? quantity : null,
      unit: params.unit,
      unitCost: asNumber(params.unitCost),
      totalCost: asNumber(params.totalCost),
      notes: asText(params.notes),
      metadata: mergeMetadata(params.metadata, {
        item_raw_id: asText(params.itemRawId)
      })
    });
  }

  for (const record of recordsFor(ctx, "gallinas_entradasg")) {
    const row = normalized(record);
    addMovement({
      record,
      date: getField(row, "entradafecha"),
      itemRawId: getField(row, "itemid"),
      quantity: getField(row, "cantidad"),
      unit: "unidad",
      businessUnitCode: "granja_postura",
      movementType: "in",
      destinationWarehouseRawId: getField(row, "bodegaid"),
      reference: getField(row, "entradagid"),
      notes: getField(row, "observaciones"),
      unitCost: getField(row, "precioconiva"),
      totalCost: getField(row, "preciototalconiva"),
      metadata: {
        operational_table: "farm_entries",
        granjaid: asText(getField(row, "granjaid")),
        galponid: asText(getField(row, "galponid")),
        traspasos_inventario_bultos_id: asText(getField(row, "traspasosinventariobultosid")),
        traspasos_inventario_cc_id: asText(getField(row, "traspasosinventarioccid")),
        factura_detalle_id: asText(getField(row, "facturadetalleid")),
        acceptable_condition: asBoolean(getField(row, "aceptablecondicion"))
      }
    });
  }

  for (const record of recordsFor(ctx, "clasificadora_entradasc")) {
    const row = normalized(record);
    addMovement({
      record,
      date: getField(row, "entradafecha"),
      itemRawId: getField(row, "itemid"),
      quantity: getField(row, "cantidad"),
      unit: "unidad",
      businessUnitCode: "clasificadora_huevo",
      movementType: "in",
      destinationWarehouseRawId: getField(row, "bodegaid"),
      reference: getField(row, "entradacid"),
      notes: getField(row, "observaciones"),
      metadata: {
        operational_table: "egg_grading_entries",
        categoriaid: asText(getField(row, "categoriaid")),
        placa_vehiculo: asText(getField(row, "placavehiculo")),
        acceptable_condition: asBoolean(getField(row, "aceptablecondicion")),
        responsable: asText(getField(row, "responsable"))
      }
    });
  }

  for (const record of recordsFor(ctx, "mcds_entradasm")) {
    const row = normalized(record);
    addMovement({
      record,
      date: getField(row, "entradafecha"),
      itemRawId: getField(row, "itemid"),
      quantity: getField(row, "cantidad"),
      unit: "huevo",
      businessUnitCode: "mcds_tienda",
      movementType: "in",
      destinationWarehouseRawId: getField(row, "bodegaid"),
      reference: getField(row, "entradamid"),
      notes: getField(row, "observaciones"),
      metadata: {
        operational_table: "store_egg_entries",
        granjaid: asText(getField(row, "granjaid")),
        pacas: asNumber(getField(row, "pacas")),
        huevos: asNumber(getField(row, "huevos")),
        traspasos_inventario_huevos_id: asText(getField(row, "traspasosinventariohuevosid"))
      }
    });
  }

  for (const record of recordsFor(ctx, "planta_entrada")) {
    const row = normalized(record);
    addMovement({
      record,
      date: getField(row, "entradafecha"),
      itemRawId: getField(row, "materiaprimaid"),
      quantity: getField(row, "ingresokg"),
      unit: "kg",
      businessUnitCode: "planta_concentrado",
      movementType: "in",
      destinationWarehouseRawId: "P",
      reference: getField(row, "entradaid"),
      notes: getField(row, "observacion"),
      unitCost: getField(row, "preciokgconiva"),
      totalCost: getField(row, "preciototalkgconiva"),
      metadata: {
        operational_table: "raw_material_receipts",
        lote: asText(getField(row, "lote")),
        proveedorid: asText(getField(row, "proveedorid")),
        transportistaid: asText(getField(row, "transportistaid")),
        numero_factura: asText(getField(row, "numerodefactura")),
        acceptable_condition: asBoolean(getField(row, "aceptablecondicion"))
      }
    });
  }

  for (const record of recordsFor(ctx, "planta_salidas")) {
    const row = normalized(record);
    const destination = asText(getField(row, "destino"));
    addMovement({
      record,
      date: getField(row, "salidafecha"),
      itemRawId: getField(row, "productoid"),
      quantity: getField(row, "numerodebultos"),
      unit: "bulto",
      businessUnitCode: "planta_concentrado",
      movementType: destination ? "transfer" : "out",
      sourceWarehouseRawId: "P",
      destinationWarehouseRawId: destination,
      reference: getField(row, "salidaid"),
      notes: getField(row, "observaciones"),
      metadata: {
        operational_table: "planta_salidas",
        lote: asText(getField(row, "lote")),
        produccionid: asText(getField(row, "produccionid")),
        plus: asBoolean(getField(row, "plus")),
        placa_vehiculo: asText(getField(row, "placavehiculo")),
        entrega: asText(getField(row, "entrega")),
        recibe: asText(getField(row, "recibe")),
        acceptable_condition: asBoolean(getField(row, "aceptablecondicion"))
      }
    });
  }

  return { candidates, lineDrafts, skipped };
}

function lineCandidatesFromDrafts(
  movementIdBySourceUid: Map<string, string>,
  drafts: MovementLineDraft[]
): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const draft of drafts) {
    const movementId = movementIdBySourceUid.get(draft.movementSourceUid);

    if (!movementId) {
      skipped += 1;
      continue;
    }

    const sourceUid = `${draft.movementSourceUid}::line:${draft.lineNumber}`;

    candidates.push({
      key: sourceUid,
      payload: compactRecord({
        inventory_movement_id: movementId,
        source_record_id: draft.record.id,
        source_uid: sourceUid,
        line_number: draft.lineNumber,
        item_id: draft.itemId,
        quantity: draft.quantity,
        quantity_sent: draft.quantitySent,
        quantity_received: draft.quantityReceived,
        unit: draft.unit,
        unit_cost: draft.unitCost,
        total_cost: draft.totalCost,
        notes: draft.notes,
        metadata: mergeMetadata(rawLineageMetadata(draft.record), draft.metadata)
      }),
      sourceReference: sourceRef(draft.record, `${sourcePrimaryKey(draft.record)}::line:${draft.lineNumber}`)
    });
  }

  return { candidates, skipped };
}

function buildFarmEntryCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "gallinas_entradasg")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const entryDate = asDateOnly(getField(row, "entradafecha"));

      if (!entryDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          entry_date: entryDate,
          location_id: resolveLocationId(ctx, getField(row, "granjaid")),
          poultry_house_id: resolvePoultryHouseId(ctx, getField(row, "galponid")),
          warehouse_id: resolveWarehouseId(ctx, getField(row, "bodegaid")),
          category_id: resolveCategoryId(ctx, getField(row, "categoriaid")),
          item_id: resolveItemId(ctx, getField(row, "itemid")),
          quantity: asNumber(getField(row, "cantidad")),
          invoice_number: asText(getField(row, "numerodefactura")),
          transport_amount: asNumber(getField(row, "transporte")),
          total_amount: asNumber(getField(row, "preciototalconiva")),
          notes: asText(getField(row, "observaciones")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            placa_vehiculo: asText(getField(row, "placavehiculo")),
            entrega: asText(getField(row, "entrega")),
            recibe: asText(getField(row, "recibe")),
            acceptable_condition: asBoolean(getField(row, "aceptablecondicion")),
            factura_detalle_id: asText(getField(row, "facturadetalleid")),
            facturas_detalle_id_tr: asText(getField(row, "facturasdetalleidtr"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildEggGradingEntryCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "clasificadora_entradasc")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const entryDate = asDateOnly(getField(row, "entradafecha"));

      if (!entryDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          entry_date: entryDate,
          user_id: resolveUserId(ctx, getField(row, "usuarioid")),
          warehouse_id: resolveWarehouseId(ctx, getField(row, "bodegaid")),
          category_id: resolveCategoryId(ctx, getField(row, "categoriaid")),
          item_id: resolveItemId(ctx, getField(row, "itemid")),
          quantity: asNumber(getField(row, "cantidad")),
          vehicle_plate: asText(getField(row, "placavehiculo")),
          accepted_condition: asBoolean(getField(row, "aceptablecondicion")),
          notes: asText(getField(row, "observaciones")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            responsable: asText(getField(row, "responsable")),
            firma_ref: asText(getField(row, "firma"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildStoreEggEntryCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "mcds_entradasm")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const entryDate = asDateOnly(getField(row, "entradafecha"));

      if (!entryDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          entry_date: entryDate,
          location_id: resolveLocationId(ctx, getField(row, "granjaid")),
          warehouse_id: resolveWarehouseId(ctx, getField(row, "bodegaid")),
          item_id: resolveItemId(ctx, getField(row, "itemid")),
          transfer_id: asText(getField(row, "traspasosinventariohuevosid")),
          packs: asNumber(getField(row, "pacas")),
          eggs: asNumber(getField(row, "huevos")),
          quantity: asNumber(getField(row, "cantidad")),
          notes: asText(getField(row, "observaciones")),
          metadata: rawLineageMetadata(record)
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildRawMaterialReceiptCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "planta_entrada")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const receiptDate = asDateOnly(getField(row, "entradafecha"));

      if (!receiptDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          receipt_date: receiptDate,
          supplier_id: resolveThirdPartyId(ctx, "proveedor", getField(row, "proveedorid")),
          carrier_id: resolveThirdPartyId(ctx, "transportista", getField(row, "transportistaid")),
          warehouse_id: resolveWarehouseId(ctx, "P"),
          item_id: resolveItemId(ctx, getField(row, "materiaprimaid")),
          lot_code: asText(getField(row, "lote")),
          quantity_kg: asNumber(getField(row, "ingresokg")),
          invoice_number: asText(getField(row, "numerodefactura")),
          unit_price_without_tax: asNumber(getField(row, "preciokgsiniva")),
          unit_price_with_tax: asNumber(getField(row, "preciokgconiva")),
          total_without_tax: asNumber(getField(row, "preciototalkgsiniva")),
          total_with_tax: asNumber(getField(row, "preciototalkgconiva")),
          accepted_condition: asBoolean(getField(row, "aceptablecondicion")),
          notes: asText(getField(row, "observacion")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            hora: asText(getField(row, "hora")),
            proveedor_detalle_id: asText(getField(row, "proveedordetalleid")),
            transportista_detalle_id: asText(getField(row, "transportistadetalleid")),
            trayecto_id: asText(getField(row, "trayectoid")),
            placa: asText(getField(row, "placa")),
            responsable: asText(getField(row, "responsable")),
            factura_detalle_id_mp: asText(getField(row, "facturasdetalleidmp")),
            factura_detalle_id_tr: asText(getField(row, "facturasdetalleidtr")),
            transporte_kg: asNumber(getField(row, "transportekg")),
            descargue_kg: asNumber(getField(row, "descarguekg")),
            kg_ajuste_administrador: asNumber(getField(row, "kgajusteadministrador")),
            kg_restantes: asNumber(getField(row, "kgrestantes")),
            toma_envio_muestra: asBoolean(getField(row, "tomaenviomuestra")),
            certificado_calidad_proveedor: asBoolean(getField(row, "certificadocalidadproveedor"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
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

async function promoteInventoryAttachments(ctx: TransformContext): Promise<InventoryStageSummary> {
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

function compactSummary(summary: InventoryStageSummary): InventoryStageSummary {
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

function printStage(summary: InventoryStageSummary): void {
  console.log(
    `${summary.stage}: processed=${summary.processed}, inserted=${summary.inserted}, updated=${summary.updated}, unchanged=${summary.unchanged}, skipped=${summary.skipped}, refs=${summary.referencesUpserted}, errors=${summary.errors}`
  );
}

export async function transformInventory(
  supabase: SupabaseClient,
  options: TransformInventoryOptions
): Promise<TransformInventorySummary> {
  const allRecords = await fetchRawRecordsBySourceNames(supabase, INVENTORY_SOURCE_NAMES);
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
    businessUnitIds: new Map(),
    warehouseIds: new Map(),
    itemIds: new Map(),
    categoryIds: new Map(),
    locationIds: new Map(),
    poultryHouseIds: new Map(),
    costCenterIds: new Map(),
    thirdPartyIds: new Map(),
    userIds: new Map(),
    transferTypeIds: new Map(),
    entityReferences: []
  };

  await refreshLookups(ctx);

  const stages: InventoryStageSummary[] = [];

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
    await refreshLookups(ctx);
    return idByKey;
  }

  await runStage("transfer_types", "inventory_transfer_types", ["code"], () =>
    buildTransferTypeCandidates(ctx)
  );

  const transferMovements = buildInventoryTransferMovements(ctx);
  const operationalMovements = buildOperationalEntryMovements(ctx);
  const movementDrafts = [...transferMovements.lineDrafts, ...operationalMovements.lineDrafts];
  const movementCandidates = [...transferMovements.candidates, ...operationalMovements.candidates];
  let movementIds = new Map<string, string>();

  if (shouldRun(options, "inventory_movements")) {
    movementIds = await runStage(
      "inventory_movements",
      "inventory_movements",
      ["source_uid"],
      () => movementCandidates,
      transferMovements.skipped + operationalMovements.skipped
    );
  }

  if (ctx.dryRun && movementIds.size === 0) {
    for (const candidate of movementCandidates) {
      movementIds.set(candidate.key, "00000000-0000-0000-0000-000000000000");
    }
  }

  if (shouldRun(options, "inventory_movement_lines")) {
    const lineBuild = lineCandidatesFromDrafts(movementIds, movementDrafts);
    await runStage(
      "inventory_movement_lines",
      "inventory_movement_lines",
      ["source_uid"],
      () => lineBuild.candidates,
      lineBuild.skipped
    );
  }

  await runStage("farm_entries", "farm_entries", ["source_uid"], () => buildFarmEntryCandidates(ctx));
  await runStage("egg_grading_entries", "egg_grading_entries", ["source_uid"], () =>
    buildEggGradingEntryCandidates(ctx)
  );
  await runStage("store_egg_entries", "store_egg_entries", ["source_uid"], () =>
    buildStoreEggEntryCandidates(ctx)
  );
  await runStage("raw_material_receipts", "raw_material_receipts", ["source_uid"], () =>
    buildRawMaterialReceiptCandidates(ctx)
  );

  if (shouldRun(options, "inventory_balances")) {
    const balanceSourceRows =
      recordsFor(ctx, "inventario_inventariobultos").length +
      recordsFor(ctx, "inventario_inventariohuevos").length;
    const summary: InventoryStageSummary = {
      stage: "inventory_balances",
      ...EMPTY_COUNTS,
      skipped: balanceSourceRows
    };
    stages.push(summary);
    printStage(summary);
  }

  if (shouldRun(options, "attachments")) {
    const summary = compactSummary(await promoteInventoryAttachments(ctx));
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
