import type { SupabaseClient } from "@supabase/supabase-js";
import { syncSources } from "../sync/sources.config";
import { chunkArray, createRowHash } from "../sync/utils";
import {
  asBoolean,
  asDateOnly,
  asLowerText,
  asNumber,
  asText,
  businessUnitCodeForAppName,
  compactRecord,
  derivedVaccinationItemCode,
  derivedVaccinationItemName,
  fetchRawRecordsBySourceNames,
  getField,
  inferEmail,
  masterCode,
  mergeMetadata,
  nameFromEmail,
  rawLineageMetadata,
  type JsonRecord,
  type RawAppSheetRecord,
  slugify,
  sourcePrimaryKey,
  splitMultiValue
} from "./utils";

export type TransformMastersOptions = {
  dryRun: boolean;
  only?: Set<string>;
};

export type StageSummary = {
  stage: string;
  processed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  referencesUpserted: number;
};

export type TransformMastersSummary = {
  dryRun: boolean;
  rawRecordsRead: number;
  stages: StageSummary[];
  totals: Omit<StageSummary, "stage">;
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

type TransformCandidate = {
  key: string;
  payload: JsonRecord;
  sourceReference?: SourceReference;
};

type ExistingRow = JsonRecord & {
  id: string;
  metadata?: JsonRecord | null;
};

type UpsertResult = StageSummary & {
  idByKey: Map<string, string>;
  entityReferences: EntityReference[];
};

type TransformContext = {
  supabase: SupabaseClient;
  dryRun: boolean;
  now: string;
  allRecords: RawAppSheetRecord[];
  recordsBySource: Map<string, RawAppSheetRecord[]>;
  businessUnitIds: Map<string, string>;
  categoryIds: Map<string, string>;
  locationIds: Map<string, string>;
  warehouseIds: Map<string, string>;
  costCenterIds: Map<string, string>;
  poultryHouseIds: Map<string, string>;
  itemIds: Map<string, string>;
  thirdPartyIds: Map<string, string>;
  salesChannelIds: Map<string, string>;
  entityReferences: EntityReference[];
};

const TRANSFORM_NAME = "masters";
const IN_FILTER_CHUNK_SIZE = 50;

const EMPTY_STAGE_COUNTS = {
  processed: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  errors: 0,
  referencesUpserted: 0
};

function normalized(record: RawAppSheetRecord): JsonRecord {
  return record.normalized_data ?? {};
}

function recordsFor(ctx: TransformContext, sourceName: string): RawAppSheetRecord[] {
  return ctx.recordsBySource.get(sourceName) ?? [];
}

function sourceRef(record: RawAppSheetRecord): SourceReference {
  return {
    sourceName: record.source_name,
    sourcePrimaryKey: sourcePrimaryKey(record),
    rawRecordId: record.id,
    sourceUid: record.source_uid,
    rawRowHash: record.row_hash
  };
}

function candidateWithHash(candidate: TransformCandidate, existing?: ExistingRow): JsonRecord {
  const baseMetadata = (candidate.payload.metadata as JsonRecord | undefined) ?? {};
  const payloadWithoutMetadata = { ...candidate.payload };
  delete payloadWithoutMetadata.metadata;
  const transformHash = createRowHash(payloadWithoutMetadata);

  return {
    ...payloadWithoutMetadata,
    metadata: mergeMetadata(existing?.metadata ?? undefined, baseMetadata, {
      transform_hash: transformHash,
      transform_name: TRANSFORM_NAME,
      transformed_at: new Date().toISOString()
    })
  };
}

function payloadHash(payload: JsonRecord): string {
  const payloadWithoutMetadata = { ...payload };
  delete payloadWithoutMetadata.metadata;
  return createRowHash(payloadWithoutMetadata);
}

function conflictKeyFromPayload(conflictColumns: string[], payload: JsonRecord): string {
  return conflictColumns.map((column) => String(payload[column] ?? "")).join("::");
}

function conflictKeyFromRow(conflictColumns: string[], row: JsonRecord): string {
  return conflictColumns.map((column) => String(row[column] ?? "")).join("::");
}

function dedupeCandidates(candidates: TransformCandidate[]): TransformCandidate[] {
  const deduped = new Map<string, TransformCandidate>();

  for (const candidate of candidates) {
    deduped.set(candidate.key, candidate);
  }

  return [...deduped.values()];
}

async function fetchExistingRows(
  supabase: SupabaseClient,
  tableName: string,
  conflictColumns: string[],
  candidates: TransformCandidate[]
): Promise<Map<string, ExistingRow>> {
  const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
  const selectColumns = ["id", "metadata", ...conflictColumns].join(",");
  const rows: ExistingRow[] = [];

  if (candidates.length === 0) {
    return new Map();
  }

  async function fetchRowsByIn(column: string, values: unknown[]): Promise<ExistingRow[]> {
    const fetchedRows: ExistingRow[] = [];

    for (const valuesChunk of chunkArray(values, IN_FILTER_CHUNK_SIZE)) {
      let from = 0;
      const pageSize = 1000;

      while (true) {
        const { data, error } = await supabase
          .from(tableName)
          .select(selectColumns)
          .in(column, valuesChunk)
          .range(from, from + pageSize - 1);

        if (error) {
          throw new Error(`Error leyendo ${tableName}: ${error.message}`);
        }

        const page = (data ?? []) as unknown as ExistingRow[];
        fetchedRows.push(...page);

        if (page.length < pageSize) {
          break;
        }

        from += pageSize;
      }
    }

    return fetchedRows;
  }

  if (conflictColumns.length === 1) {
    const [column] = conflictColumns;
    const values = [
      ...new Set(candidates.map((candidate) => candidate.payload[column]).filter(Boolean))
    ];
    rows.push(...(await fetchRowsByIn(column, values)));
  } else {
    const firstColumn = conflictColumns[0];
    const firstColumnValues = [
      ...new Set(candidates.map((candidate) => candidate.payload[firstColumn]).filter(Boolean))
    ];
    rows.push(...(await fetchRowsByIn(firstColumn, firstColumnValues)));
  }

  const indexed = new Map<string, ExistingRow>();

  for (const row of rows) {
    const key = conflictKeyFromRow(conflictColumns, row);
    if (candidateKeys.has(key)) {
      indexed.set(key, row);
    }
  }

  return indexed;
}

async function fetchCurrentIds(
  supabase: SupabaseClient,
  tableName: string,
  conflictColumns: string[],
  candidates: TransformCandidate[]
): Promise<Map<string, string>> {
  const rows = await fetchExistingRows(supabase, tableName, conflictColumns, candidates);
  const ids = new Map<string, string>();

  for (const [key, row] of rows.entries()) {
    ids.set(key, row.id);
  }

  return ids;
}

async function upsertExternalReferences(
  supabase: SupabaseClient,
  dryRun: boolean,
  references: EntityReference[],
  now: string
): Promise<number> {
  if (references.length === 0 || dryRun) {
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

  for (const chunk of chunkArray(payloads, 500)) {
    const { error } = await supabase
      .from("external_references")
      .upsert(chunk, { onConflict: "entity_table,source_name,source_primary_key" });

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
  candidatesRaw: TransformCandidate[]
): Promise<UpsertResult> {
  const candidates = dedupeCandidates(candidatesRaw).filter((candidate) =>
    conflictColumns.every((column) => candidate.payload[column] !== undefined && candidate.payload[column] !== null)
  );
  const summary: UpsertResult = {
    stage,
    ...EMPTY_STAGE_COUNTS,
    idByKey: new Map(),
    entityReferences: []
  };

  summary.processed = candidates.length;

  if (candidates.length === 0) {
    return summary;
  }

  const existingRows = await fetchExistingRows(ctx.supabase, tableName, conflictColumns, candidates);
  const changedPayloads: JsonRecord[] = [];

  for (const candidate of candidates) {
    const existing = existingRows.get(candidate.key);
    const currentHash = asText(existing?.metadata?.transform_hash);
    const nextHash = payloadHash(candidate.payload);

    if (!existing) {
      summary.inserted += 1;
      changedPayloads.push(candidateWithHash(candidate));
      continue;
    }

    if (currentHash === nextHash) {
      summary.unchanged += 1;
      continue;
    }

    summary.updated += 1;
    changedPayloads.push(candidateWithHash(candidate, existing));
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

  summary.idByKey = await fetchCurrentIds(ctx.supabase, tableName, conflictColumns, candidates);

  for (const candidate of candidates) {
    const entityId = summary.idByKey.get(candidate.key);
    if (!entityId || !candidate.sourceReference) {
      continue;
    }

    summary.entityReferences.push({
      ...candidate.sourceReference,
      entityTable: tableName,
      entityId
    });
  }

  summary.referencesUpserted = await upsertExternalReferences(
    ctx.supabase,
    ctx.dryRun,
    summary.entityReferences,
    ctx.now
  );
  ctx.entityReferences.push(...summary.entityReferences);

  return summary;
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
      throw new Error(`Error cargando lookup ${tableName}.${keyColumn}: ${error.message}`);
    }

    const rows = (data ?? []) as unknown as Array<{ id: string } & JsonRecord>;

    for (const row of rows) {
      const key = asText(row[keyColumn]);
      if (key) {
        lookup.set(key, row.id);
      }
    }

    if (rows.length < pageSize) {
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
      throw new Error(
        `Error cargando lookup compuesto ${tableName}.${firstColumn}+${secondColumn}: ${error.message}`
      );
    }

    const rows = (data ?? []) as unknown as Array<{ id: string } & JsonRecord>;

    for (const row of rows) {
      const first = asText(row[firstColumn]);
      const second = asText(row[secondColumn]);
      if (first && second) {
        lookup.set(`${first}::${second}`, row.id);
      }
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return lookup;
}

async function refreshLookups(ctx: TransformContext): Promise<void> {
  const [
    businessUnits,
    categories,
    locations,
    warehouses,
    costCenters,
    poultryHouses,
    items,
    thirdParties,
    salesChannels
  ] = await Promise.all([
    loadIdLookup(ctx.supabase, "business_units", "code"),
    loadIdLookup(ctx.supabase, "categories", "code"),
    loadIdLookup(ctx.supabase, "locations", "code"),
    loadIdLookup(ctx.supabase, "warehouses", "code"),
    loadIdLookup(ctx.supabase, "cost_centers", "code"),
    loadCompositeLookup(ctx.supabase, "poultry_houses", "business_unit_id", "code"),
    loadIdLookup(ctx.supabase, "items", "code"),
    loadIdLookup(ctx.supabase, "third_parties", "external_code"),
    loadIdLookup(ctx.supabase, "sales_channels", "code")
  ]);

  ctx.businessUnitIds = businessUnits;
  ctx.categoryIds = categories;
  ctx.locationIds = locations;
  ctx.warehouseIds = warehouses;
  ctx.costCenterIds = costCenters;
  ctx.poultryHouseIds = poultryHouses;
  ctx.itemIds = items;
  ctx.thirdPartyIds = thirdParties;
  ctx.salesChannelIds = salesChannels;
}

function shouldRun(options: TransformMastersOptions, stage: string): boolean {
  return !options.only || options.only.has(stage) || options.only.has("all");
}

function buildCategoryCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  function addCategory(params: {
    code: string | null;
    name: string | null;
    categoryType: string;
    parentId?: string | null;
    record?: RawAppSheetRecord;
    metadata?: JsonRecord;
  }): void {
    if (!params.code || !params.name) {
      return;
    }

    candidates.push({
      key: params.code,
      payload: compactRecord({
        code: params.code,
        name: params.name,
        category_type: params.categoryType,
        parent_id: params.parentId,
        is_active: true,
        metadata: mergeMetadata(params.metadata, params.record ? rawLineageMetadata(params.record) : undefined)
      }),
      sourceReference: params.record ? sourceRef(params.record) : undefined
    });
  }

  for (const record of ctx.allRecords) {
    const row = normalized(record);

    for (const categoryId of splitMultiValue(getField(row, "categoriaid"))) {
      addCategory({
        code: masterCode("categoria", categoryId),
        name: `Categoria ${categoryId}`,
        categoryType: "item",
        metadata: { synthetic_from_reference: true }
      });
    }

    for (const categoryId of splitMultiValue(getField(row, "categoriagastoid"))) {
      addCategory({
        code: masterCode("mcds_categoria_gasto", categoryId),
        name: `Categoria gasto ${categoryId}`,
        categoryType: "expense",
        metadata: { synthetic_from_reference: true }
      });
    }
  }

  for (const record of recordsFor(ctx, "gerencia_categorias")) {
    const row = normalized(record);
    const categoryId = asText(getField(row, "categoriaid"));
    addCategory({
      code: masterCode("categoria", categoryId),
      name: asText(getField(row, "categorianombre")) ?? categoryId,
      categoryType: "item",
      record
    });
  }

  for (const record of recordsFor(ctx, "mcds_categoriagastos")) {
    const row = normalized(record);
    const categoryId = asText(getField(row, "categoriagastoid"));
    addCategory({
      code: masterCode("mcds_categoria_gasto", categoryId),
      name: asText(getField(row, "categoriagastonombre")) ?? `Categoria gasto ${categoryId}`,
      categoryType: "expense",
      record
    });
  }

  for (const record of recordsFor(ctx, "gerencia_tiposcosto")) {
    const row = normalized(record);
    const categoryId = asText(getField(row, "tiposcostoid"));
    addCategory({
      code: masterCode("tipo_costo", categoryId),
      name: asText(getField(row, "tipocostonombre")) ?? `Tipo costo ${categoryId}`,
      categoryType: "cost",
      record
    });
  }

  return candidates;
}

function buildSalesChannelCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];
  const channels = new Map<string, string>();

  for (const record of ctx.allRecords) {
    const channelName = asText(getField(normalized(record), "canaldeventa"));
    if (!channelName) {
      continue;
    }

    channels.set(`channel:${slugify(channelName)}`, channelName);
  }

  for (const [code, name] of channels.entries()) {
    candidates.push({
      key: code,
      payload: {
        code,
        name,
        is_active: true,
        metadata: {
          transform_name: TRANSFORM_NAME,
          synthetic_from_distinct_value: true
        }
      }
    });
  }

  return candidates;
}

function buildLocationCandidates(ctx: TransformContext): TransformCandidate[] {
  return recordsFor(ctx, "gerencia_granjas")
    .map((record): TransformCandidate | null => {
      const row = normalized(record);
      const rawId = asText(getField(row, "granjaid"));
      const code = masterCode("granja", rawId);
      const businessUnitId = ctx.businessUnitIds.get("granja_postura");

      if (!code || !businessUnitId) {
        return null;
      }

      return {
        key: code,
        payload: compactRecord({
          business_unit_id: businessUnitId,
          code,
          name: asText(getField(row, "granjanombre")) ?? rawId,
          location_type: "farm",
          is_active: true,
          metadata: rawLineageMetadata(record)
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as TransformCandidate[];
}

function buildCostCenterCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  function addCostCenter(params: {
    rawId: unknown;
    name?: string | null;
    description?: string | null;
    record?: RawAppSheetRecord;
    metadata?: JsonRecord;
  }): void {
    const rawId = asText(params.rawId);
    const code = masterCode("centro_costo", rawId);
    if (!rawId || !code) {
      return;
    }

    candidates.push({
      key: code,
      payload: compactRecord({
        business_unit_id: ctx.businessUnitIds.get(
          params.record ? businessUnitCodeForAppName(params.record.app_name) : "costos_finanzas"
        ),
        code,
        name: params.name ?? rawId,
        description: params.description,
        is_active: true,
        metadata: mergeMetadata(params.metadata, params.record ? rawLineageMetadata(params.record) : undefined)
      }),
      sourceReference: params.record ? sourceRef(params.record) : undefined
    });
  }

  for (const record of ctx.allRecords) {
    const row = normalized(record);
    addCostCenter({
      rawId: getField(row, "centrocostoid", "centrocosto"),
      metadata: { synthetic_from_reference: true }
    });
  }

  for (const sourceName of ["gerencia_centroscosto", "gerencia_copia_de_centroscosto"]) {
    for (const record of recordsFor(ctx, sourceName)) {
      const row = normalized(record);
      addCostCenter({
        rawId: getField(row, "centrocostoid"),
        name: asText(getField(row, "centrocosto")),
        description: asText(getField(row, "descripcionbreve")),
        record
      });
    }
  }

  return candidates;
}

function inferWarehouseBusinessUnitCode(row: JsonRecord): string | null {
  const name = slugify(getField(row, "bodeganombre"));
  const rawId = asLowerText(getField(row, "bodegaid"));

  if (name.includes("planta") || rawId === "p") {
    return "planta_concentrado";
  }

  if (name.includes("mcds") || name.includes("tienda")) {
    return "mcds_tienda";
  }

  return "granja_postura";
}

function buildWarehouseCandidates(ctx: TransformContext): TransformCandidate[] {
  return recordsFor(ctx, "gerencia_bodegas")
    .map((record): TransformCandidate | null => {
      const row = normalized(record);
      const rawId = asText(getField(row, "bodegaid"));
      const code = masterCode("bodega", rawId);
      const categoryIds = splitMultiValue(getField(row, "categoriaid"));
      const firstCategoryCode = categoryIds.length === 1 ? masterCode("categoria", categoryIds[0]) : null;
      const businessUnitCode = inferWarehouseBusinessUnitCode(row);

      if (!rawId || !code) {
        return null;
      }

      return {
        key: code,
        payload: compactRecord({
          business_unit_id: businessUnitCode ? ctx.businessUnitIds.get(businessUnitCode) : null,
          location_id: ctx.locationIds.get(`granja:${rawId}`) ?? null,
          code,
          external_code: rawId,
          name: asText(getField(row, "bodeganombre")) ?? rawId,
          warehouse_type: businessUnitCode === "planta_concentrado" ? "plant" : "farm",
          category: asText(getField(row, "categoriaid")),
          category_id: firstCategoryCode ? ctx.categoryIds.get(firstCategoryCode) : null,
          is_active: true,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            category_codes: categoryIds,
            image_ref: asText(getField(row, "bodegaimagen"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as TransformCandidate[];
}

function buildPoultryHouseCandidates(ctx: TransformContext): TransformCandidate[] {
  const businessUnitId = ctx.businessUnitIds.get("granja_postura");
  if (!businessUnitId) {
    return [];
  }

  return recordsFor(ctx, "gerencia_galpones")
    .map((record): TransformCandidate | null => {
      const row = normalized(record);
      const rawId = asText(getField(row, "galponid"));
      const code = masterCode("galpon", rawId);

      if (!rawId || !code) {
        return null;
      }

      return {
        key: `${businessUnitId}::${code}`,
        payload: compactRecord({
          business_unit_id: businessUnitId,
          location_id: ctx.locationIds.get(`granja:${asText(getField(row, "granjaid"))}`) ?? null,
          code,
          external_code: rawId,
          name: asText(getField(row, "galponnombre")) ?? rawId,
          is_active: true,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            image_ref: asText(getField(row, "galponimagen")),
            usuarioid: asText(getField(row, "usuarioid"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as TransformCandidate[];
}

function inferItemType(sourceName: string, row: JsonRecord): string {
  const name = slugify(
    getField(row, "itemdescripcion", "productonombre", "materiaprimanombre", "tamanohuevonombre", "conceptonombre")
  );
  const categoryId = asLowerText(getField(row, "categoriaid"));

  if (sourceName === "gallinas_vacunaciones") {
    return "medicine";
  }
  if (sourceName === "gerencia_materiasprimas" || categoryId === "mp") {
    return "raw_material";
  }
  if (sourceName === "gerencia_productos") {
    return "feed";
  }
  if (sourceName === "gerencia_tamanohuevo" || name.includes("huevo")) {
    return "egg";
  }
  if (sourceName === "mcds_conceptos") {
    return "expense";
  }
  if (name.includes("pollo")) {
    return "chicken";
  }
  if (name.includes("vacuna") || name.includes("medic")) {
    return "medicine";
  }
  if (name.includes("empaque") || name.includes("caja") || name.includes("tula")) {
    return "packaging";
  }

  return "other";
}

function flagsForItemType(itemType: string): {
  is_inventory_item: boolean;
  is_sellable: boolean;
  is_purchasable: boolean;
} {
  return {
    is_inventory_item: ["raw_material", "feed", "egg", "chicken", "packaging", "medicine"].includes(itemType),
    is_sellable: ["feed", "egg", "chicken", "service"].includes(itemType),
    is_purchasable: ["raw_material", "packaging", "medicine", "expense", "service"].includes(itemType)
  };
}

function buildItemsCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  function addItem(params: {
    sourceName: string;
    record: RawAppSheetRecord;
    rawId: unknown;
    prefix: string;
    name: unknown;
    categoryCode?: string | null;
    unit?: unknown;
    taxRate?: unknown;
  }): void {
    const rawId = asText(params.rawId);
    const code = masterCode(params.prefix, rawId);
    const name = asText(params.name);
    const itemType = inferItemType(params.sourceName, normalized(params.record));

    if (!rawId || !code || !name) {
      return;
    }

    candidates.push({
      key: code,
      payload: compactRecord({
        code,
        name,
        category_id: params.categoryCode ? ctx.categoryIds.get(params.categoryCode) : null,
        item_type: itemType,
        unit: asText(params.unit),
        tax_rate: asNumber(params.taxRate) ?? 0,
        ...flagsForItemType(itemType),
        is_active: true,
        source_record_id: params.record.id,
        metadata: mergeMetadata(rawLineageMetadata(params.record), {
          original_id: rawId,
          image_ref: asText(
            getField(
              normalized(params.record),
              "itemimagen",
              "productoimagen",
              "materiaprimaimagen",
              "tamanohuevoimagen",
              "imagen"
            )
          )
        })
      }),
      sourceReference: sourceRef(params.record)
    });
  }

  for (const record of recordsFor(ctx, "gerencia_items")) {
    const row = normalized(record);
    addItem({
      sourceName: record.source_name,
      record,
      rawId: getField(row, "itemid"),
      prefix: "item",
      name: getField(row, "itemdescripcion"),
      categoryCode: masterCode("categoria", getField(row, "categoriaid")),
      unit: getField(row, "unidad"),
      taxRate: getField(row, "itemiva")
    });
  }

  for (const record of recordsFor(ctx, "gerencia_productos")) {
    const row = normalized(record);
    addItem({
      sourceName: record.source_name,
      record,
      rawId: getField(row, "productoid"),
      prefix: "producto",
      name: getField(row, "productonombre")
    });
  }

  for (const record of recordsFor(ctx, "gerencia_materiasprimas")) {
    const row = normalized(record);
    addItem({
      sourceName: record.source_name,
      record,
      rawId: getField(row, "materiaprimaid"),
      prefix: "materia_prima",
      name: getField(row, "materiaprimanombre"),
      taxRate: getField(row, "materiaprimaiva")
    });
  }

  for (const record of recordsFor(ctx, "gerencia_tamanohuevo")) {
    const row = normalized(record);
    addItem({
      sourceName: record.source_name,
      record,
      rawId: getField(row, "tamanohuevoid"),
      prefix: "tamano_huevo",
      name: getField(row, "tamanohuevonombre")
    });
  }

  for (const record of recordsFor(ctx, "mcds_conceptos")) {
    const row = normalized(record);
    addItem({
      sourceName: record.source_name,
      record,
      rawId: getField(row, "conceptoid"),
      prefix: "concepto",
      name: getField(row, "conceptonombre"),
      categoryCode: masterCode("mcds_categoria_gasto", getField(row, "categoriagastoid"))
    });
  }

  for (const record of recordsFor(ctx, "gallinas_vacunaciones")) {
    const row = normalized(record);

    if (asText(getField(row, "itemid"))) {
      continue;
    }

    const code = derivedVaccinationItemCode(row);
    const name = derivedVaccinationItemName(row);

    if (!code || !name) {
      continue;
    }

    candidates.push({
      key: code,
      payload: compactRecord({
        code,
        name,
        category_id: ctx.categoryIds.get(masterCode("categoria", getField(row, "categoriaid")) ?? "") ?? null,
        item_type: "medicine",
        unit: "dosis",
        tax_rate: 0,
        ...flagsForItemType("medicine"),
        is_active: true,
        source_record_id: record.id,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          synthetic_from_vaccination: true,
          original_id: asText(getField(row, "vacunacionid")),
          commercial_name: asText(getField(row, "nombrecomercial")),
          laboratory: asText(getField(row, "laboratorio")),
          strains: asText(getField(row, "cepas")),
          notes: asText(getField(row, "observacion"))
        })
      })
    });
  }

  return candidates;
}

function buildProductionLotCandidates(ctx: TransformContext): TransformCandidate[] {
  const businessUnitId = ctx.businessUnitIds.get("granja_postura");
  if (!businessUnitId) {
    return [];
  }

  return recordsFor(ctx, "gerencia_lotes")
    .map((record): TransformCandidate | null => {
      const row = normalized(record);
      const rawId = asText(getField(row, "loteid"));
      const lotCode = masterCode("lote", rawId);

      if (!rawId || !lotCode) {
        return null;
      }

      const galponCode = masterCode("galpon", getField(row, "galponid"));
      const status = asBoolean(getField(row, "estado")) === false ? "closed" : "active";

      return {
        key: `${businessUnitId}::${lotCode}`,
        payload: compactRecord({
          business_unit_id: businessUnitId,
          lot_code: lotCode,
          external_code: rawId,
          name: asText(getField(row, "lotenombre")) ?? rawId,
          species: "layer_hen",
          start_date: asDateOnly(getField(row, "fechainicio")),
          end_date: asDateOnly(getField(row, "fechafinalizacion")),
          status,
          poultry_house_id: galponCode ? ctx.poultryHouseIds.get(`${businessUnitId}::${galponCode}`) : null,
          warehouse_id: ctx.warehouseIds.get(`bodega:${asText(getField(row, "bodegaid"))}`) ?? null,
          category_id: ctx.categoryIds.get(`categoria:${asText(getField(row, "categoriaid"))}`) ?? null,
          initial_birds: asNumber(getField(row, "numeroavesinicial")),
          source_record_id: record.id,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            granjaid: asText(getField(row, "granjaid")),
            usuarioid: asText(getField(row, "usuarioid"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as TransformCandidate[];
}

function buildUserCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  function addUser(params: {
    rawId: unknown;
    email?: unknown;
    name?: unknown;
    role?: unknown;
    active?: unknown;
    businessUnitCode?: string | null;
    costCenterRawId?: unknown;
    warehouseRawId?: unknown;
    record?: RawAppSheetRecord;
    synthetic?: boolean;
  }): void {
    const email = inferEmail(params.email) ?? inferEmail(params.rawId);
    const rawId = asLowerText(params.rawId) ?? email;
    const code = masterCode("usuario", rawId);
    const name = asText(params.name) ?? (email ? nameFromEmail(email) : asText(params.rawId));

    if (!rawId || !code || !name) {
      return;
    }

    candidates.push({
      key: code,
      payload: compactRecord({
        code,
        email,
        name,
        role: asText(params.role),
        business_unit_id: ctx.businessUnitIds.get(params.businessUnitCode ?? "gerencia") ?? null,
        cost_center_id: ctx.costCenterIds.get(`centro_costo:${asText(params.costCenterRawId)}`) ?? null,
        warehouse_id: ctx.warehouseIds.get(`bodega:${asText(params.warehouseRawId)}`) ?? null,
        is_active: asBoolean(params.active) ?? true,
        metadata: mergeMetadata(params.record ? rawLineageMetadata(params.record) : undefined, {
          synthetic_from_reference: params.synthetic === true
        })
      }),
      sourceReference: params.record ? sourceRef(params.record) : undefined
    });
  }

  for (const record of ctx.allRecords) {
    const row = normalized(record);
    const userId = getField(row, "usuarioid");
    if (inferEmail(userId)) {
      addUser({
        rawId: userId,
        businessUnitCode: businessUnitCodeForAppName(record.app_name),
        synthetic: true
      });
    }
  }

  for (const record of recordsFor(ctx, "gerencia_usuarios")) {
    const row = normalized(record);
    addUser({
      rawId: getField(row, "usuarioid"),
      email: getField(row, "correoelectronico", "usuarioid"),
      name: getField(row, "nombre"),
      role: getField(row, "usuariorol"),
      active: getField(row, "usuarioactivo"),
      businessUnitCode: "gerencia",
      costCenterRawId: getField(row, "centrocosto"),
      warehouseRawId: getField(row, "bodegaid"),
      record
    });
  }

  return candidates;
}

type ThirdPartyCandidate = TransformCandidate & {
  externalCode: string;
  identityCode: string;
  roles: string[];
};

function normalizeTaxId(value: unknown): string | null {
  const text = asText(value);
  if (!text) {
    return null;
  }

  const normalized = text.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function applyThirdPartyAliases(ctx: TransformContext, candidates: ThirdPartyCandidate[]): void {
  for (const candidate of candidates) {
    const entityId = ctx.thirdPartyIds.get(candidate.identityCode);
    if (entityId) {
      ctx.thirdPartyIds.set(candidate.externalCode, entityId);
    }
  }
}

async function upsertThirdPartyExternalReferences(
  ctx: TransformContext,
  candidates: ThirdPartyCandidate[]
): Promise<number> {
  const references: EntityReference[] = [];

  for (const candidate of candidates) {
    const entityId = ctx.thirdPartyIds.get(candidate.externalCode);
    if (!entityId || !candidate.sourceReference) {
      continue;
    }

    references.push({
      ...candidate.sourceReference,
      entityTable: "third_parties",
      entityId
    });
  }

  const uniqueReferences = dedupeReferences(references);
  const count = await upsertExternalReferences(ctx.supabase, ctx.dryRun, uniqueReferences, ctx.now);
  ctx.entityReferences.push(...uniqueReferences);
  return count;
}

function dedupeReferences(references: EntityReference[]): EntityReference[] {
  const deduped = new Map<string, EntityReference>();

  for (const reference of references) {
    deduped.set(
      `${reference.entityTable}::${reference.sourceName}::${reference.sourcePrimaryKey}`,
      reference
    );
  }

  return [...deduped.values()];
}

function buildThirdPartyCandidates(ctx: TransformContext): ThirdPartyCandidate[] {
  const candidates: ThirdPartyCandidate[] = [];

  function addThirdParty(params: {
    record: RawAppSheetRecord;
    rawId: unknown;
    prefix: string;
    name: unknown;
    legalName?: unknown;
    thirdPartyType: string;
    roles: string[];
    taxId?: unknown;
    phone?: unknown;
    email?: unknown;
    address?: unknown;
  }): void {
    const rawId = asText(params.rawId);
    const externalCode = masterCode(params.prefix, rawId);
    const taxId = normalizeTaxId(params.taxId);
    const identityCode = taxId ? masterCode("tax_id", taxId) : externalCode;
    const name = asText(params.name);

    if (!rawId || !externalCode || !identityCode || !name) {
      return;
    }

    candidates.push({
      key: identityCode,
      externalCode,
      identityCode,
      roles: params.roles,
      payload: compactRecord({
        external_code: identityCode,
        third_party_type: params.thirdPartyType,
        name,
        legal_name: asText(params.legalName) ?? name,
        tax_id: taxId,
        phone: asText(params.phone),
        email: inferEmail(params.email) ?? asText(params.email),
        address: asText(params.address),
        is_active: true,
        source_record_id: params.record.id,
        metadata: mergeMetadata(rawLineageMetadata(params.record), {
          original_external_code: externalCode,
          original_id: rawId
        })
      }),
      sourceReference: sourceRef(params.record)
    });
  }

  for (const record of recordsFor(ctx, "gerencia_proveedores")) {
    const row = normalized(record);
    addThirdParty({
      record,
      rawId: getField(row, "proveedorid"),
      prefix: "proveedor",
      name: getField(row, "proveedornombre"),
      thirdPartyType: "supplier",
      roles: ["supplier"],
      taxId: getField(row, "nit"),
      phone: getField(row, "telefono"),
      email: getField(row, "emailpaginaweb"),
      address: getField(row, "direccion")
    });
  }

  for (const record of recordsFor(ctx, "gerencia_transportistas")) {
    const row = normalized(record);
    addThirdParty({
      record,
      rawId: getField(row, "transportistaid"),
      prefix: "transportista",
      name: getField(row, "transportistanombre"),
      thirdPartyType: "carrier",
      roles: ["carrier"],
      taxId: getField(row, "nit"),
      phone: getField(row, "telefono"),
      email: getField(row, "emailpaginaweb"),
      address: getField(row, "direccion")
    });
  }

  for (const record of recordsFor(ctx, "gerencia_razonsocial")) {
    const row = normalized(record);
    addThirdParty({
      record,
      rawId: getField(row, "razonsocialid"),
      prefix: "razon_social",
      name: getField(row, "razonsocialnombre"),
      thirdPartyType: "company",
      roles: ["company"],
      taxId: getField(row, "nit"),
      phone: getField(row, "telefono"),
      email: getField(row, "emailpaginaweb"),
      address: getField(row, "direccion")
    });
  }

  for (const record of recordsFor(ctx, "mercadeo_tiendas")) {
    const row = normalized(record);
    addThirdParty({
      record,
      rawId: getField(row, "tiendaid"),
      prefix: "tienda",
      name: getField(row, "nombreestablecimiento", "nombrecliente"),
      legalName: getField(row, "nombrecliente"),
      thirdPartyType: "customer",
      roles: ["customer"],
      phone: getField(row, "celular"),
      address: getField(row, "direccion")
    });
  }

  return candidates;
}

function buildThirdPartyRoleCandidates(
  thirdPartyCandidates: ThirdPartyCandidate[],
  thirdPartyIds: Map<string, string>
): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  for (const candidate of thirdPartyCandidates) {
    const thirdPartyId = thirdPartyIds.get(candidate.externalCode);
    if (!thirdPartyId) {
      continue;
    }

    for (const role of candidate.roles) {
      candidates.push({
        key: `${thirdPartyId}::${role}`,
        payload: {
          third_party_id: thirdPartyId,
          role,
          is_active: true,
          metadata: {
            transform_name: TRANSFORM_NAME
          }
        }
      });
    }
  }

  return candidates;
}

function buildStoreCandidates(ctx: TransformContext): TransformCandidate[] {
  return recordsFor(ctx, "mercadeo_tiendas")
    .map((record): TransformCandidate | null => {
      const row = normalized(record);
      const rawId = asText(getField(row, "tiendaid"));
      const storeName = asText(getField(row, "nombreestablecimiento"));
      const channelName = asText(getField(row, "canaldeventa"));

      if (!rawId || !storeName) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          third_party_id: ctx.thirdPartyIds.get(`tienda:${rawId}`) ?? null,
          store_name: storeName,
          contact_name: asText(getField(row, "nombrecliente")),
          phone: asText(getField(row, "celular")),
          address: asText(getField(row, "direccion")),
          neighborhood: asText(getField(row, "barrio")),
          location_text: asText(getField(row, "localizacion")),
          store_type: asText(getField(row, "tipotienda")),
          weekly_quantity: asNumber(getField(row, "cantidadsemanal")),
          sales_channel_id: channelName ? ctx.salesChannelIds.get(`channel:${slugify(channelName)}`) : null,
          authorizes_messages: asBoolean(getField(row, "autorizamensaje")),
          buys_from_macadasa: asBoolean(getField(row, "compraenmacadasa")),
          current_supplier: asText(getField(row, "actualproveedor")),
          notes: asText(getField(row, "comentario")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            qr_ref: asText(getField(row, "tiendaqr")),
            store_photo_ref: asText(getField(row, "fototienda")),
            rut_ref: asText(getField(row, "rut")),
            rut_pdf_ref: asText(getField(row, "rutpdf")),
            chicken_interest: asBoolean(getField(row, "pollo")),
            added_us: asBoolean(getField(row, "nosagregaron")),
            added_by: asText(getField(row, "quienagrego"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as TransformCandidate[];
}

function buildThirdPartyDetailCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  for (const record of recordsFor(ctx, "gerencia_proveedoresdetalle")) {
    const row = normalized(record);
    const rawId = asText(getField(row, "proveedordetalleid"));
    const thirdPartyId = ctx.thirdPartyIds.get(`proveedor:${asText(getField(row, "proveedorid"))}`);
    const itemId =
      ctx.itemIds.get(`materia_prima:${asText(getField(row, "materiaprimaid"))}`) ??
      ctx.itemIds.get(`item:${asText(getField(row, "materiaprimaid"))}`);

    if (!rawId || !thirdPartyId) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        third_party_id: thirdPartyId,
        item_id: itemId,
        detail_type: "supplier_item",
        tax_rate: asNumber(getField(row, "iva")),
        source_record_id: record.id,
        source_uid: record.source_uid,
        metadata: rawLineageMetadata(record)
      }),
      sourceReference: sourceRef(record)
    });
  }

  for (const record of recordsFor(ctx, "gerencia_transportistasdetalle")) {
    const row = normalized(record);
    const rawId = asText(getField(row, "transportistadetalleid"));
    const thirdPartyId = ctx.thirdPartyIds.get(`transportista:${asText(getField(row, "transportistaid"))}`);

    if (!rawId || !thirdPartyId) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        third_party_id: thirdPartyId,
        detail_type: "carrier_route",
        source_record_id: record.id,
        source_uid: record.source_uid,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          trayectoid: asText(getField(row, "trayectoid"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  for (const record of recordsFor(ctx, "gerencia_razonsocialdetalle")) {
    const row = normalized(record);
    const rawId = asText(getField(row, "razonsocialdetalleid"));
    const thirdPartyId = ctx.thirdPartyIds.get(`razon_social:${asText(getField(row, "razonsocialid"))}`);
    const itemId = ctx.itemIds.get(`item:${asText(getField(row, "itemid"))}`);

    if (!rawId || !thirdPartyId) {
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        third_party_id: thirdPartyId,
        item_id: itemId,
        detail_type: "company_item",
        source_record_id: record.id,
        source_uid: record.source_uid,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          categoriaid: asText(getField(row, "categoriaid"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return candidates;
}

function buildTransferTypeCandidates(ctx: TransformContext): TransformCandidate[] {
  const candidates: TransformCandidate[] = [];

  function addTransferType(record: RawAppSheetRecord, idField: string, prefix: string): void {
    const row = normalized(record);
    const rawId = asText(getField(row, idField));
    const code = masterCode(prefix, rawId);

    if (!rawId || !code) {
      return;
    }

    candidates.push({
      key: code,
      payload: compactRecord({
        code,
        name: asText(getField(row, "descripcion")) ?? rawId,
        movement_category: "transfer",
        affects_cost: false,
        metadata: rawLineageMetadata(record)
      }),
      sourceReference: sourceRef(record)
    });
  }

  for (const record of recordsFor(ctx, "inventario_tipostraspasobultos")) {
    addTransferType(record, "tipotraspasobultoid", "bultos");
  }

  for (const record of recordsFor(ctx, "inventario_tipostraspasohuevos")) {
    addTransferType(record, "tipostraspasohuevosid", "huevos");
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

async function promoteMasterAttachments(ctx: TransformContext): Promise<StageSummary> {
  const emptySummary: StageSummary = {
    stage: "attachments",
    ...EMPTY_STAGE_COUNTS
  };
  const refsBySourceUid = new Map<string, EntityReference[]>();

  for (const reference of ctx.entityReferences) {
    const existing = refsBySourceUid.get(reference.sourceUid) ?? [];
    existing.push(reference);
    refsBySourceUid.set(reference.sourceUid, existing);
  }

  if (refsBySourceUid.size === 0) {
    return emptySummary;
  }

  const sourceUids = [...refsBySourceUid.keys()];
  const attachments: RawAttachment[] = [];

  for (const sourceUidChunk of chunkArray(sourceUids, IN_FILTER_CHUNK_SIZE)) {
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

  const candidates: TransformCandidate[] = [];

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
        key: conflictKeyFromPayload(["entity_table", "entity_id", "file_ref"], payload),
        payload
      });
    }
  }

  return upsertCandidates(ctx, "attachments", "attachments", ["entity_table", "entity_id", "file_ref"], candidates);
}

function printStage(summary: StageSummary): void {
  console.log(
    `${summary.stage}: processed=${summary.processed}, inserted=${summary.inserted}, updated=${summary.updated}, unchanged=${summary.unchanged}, refs=${summary.referencesUpserted}, errors=${summary.errors}`
  );
}

function compactStageSummary(summary: StageSummary): StageSummary {
  return {
    stage: summary.stage,
    processed: summary.processed,
    inserted: summary.inserted,
    updated: summary.updated,
    unchanged: summary.unchanged,
    errors: summary.errors,
    referencesUpserted: summary.referencesUpserted
  };
}

export async function transformMasters(
  supabase: SupabaseClient,
  options: TransformMastersOptions
): Promise<TransformMastersSummary> {
  const sourceNames = syncSources.filter((source) => source.isActive).map((source) => source.sourceName);
  const allRecords = await fetchRawRecordsBySourceNames(supabase, sourceNames);
  const recordsBySource = new Map<string, RawAppSheetRecord[]>();

  for (const record of allRecords) {
    const existing = recordsBySource.get(record.source_name) ?? [];
    existing.push(record);
    recordsBySource.set(record.source_name, existing);
  }

  const ctx: TransformContext = {
    supabase,
    dryRun: options.dryRun,
    now: new Date().toISOString(),
    allRecords,
    recordsBySource,
    businessUnitIds: new Map(),
    categoryIds: new Map(),
    locationIds: new Map(),
    warehouseIds: new Map(),
    costCenterIds: new Map(),
    poultryHouseIds: new Map(),
    itemIds: new Map(),
    thirdPartyIds: new Map(),
    salesChannelIds: new Map(),
    entityReferences: []
  };

  await refreshLookups(ctx);

  const stages: StageSummary[] = [];

  async function runStage(
    stage: string,
    tableName: string,
    conflictColumns: string[],
    build: () => TransformCandidate[] | ThirdPartyCandidate[]
  ): Promise<UpsertResult | null> {
    if (!shouldRun(options, stage)) {
      return null;
    }

    const result = await upsertCandidates(ctx, stage, tableName, conflictColumns, build());
    stages.push(compactStageSummary(result));
    printStage(result);
    await refreshLookups(ctx);
    return result;
  }

  await runStage("categories", "categories", ["code"], () => buildCategoryCandidates(ctx));
  await runStage("sales_channels", "sales_channels", ["code"], () => buildSalesChannelCandidates(ctx));
  await runStage("locations", "locations", ["code"], () => buildLocationCandidates(ctx));
  await runStage("cost_centers", "cost_centers", ["code"], () => buildCostCenterCandidates(ctx));
  await runStage("warehouses", "warehouses", ["code"], () => buildWarehouseCandidates(ctx));
  await runStage("poultry_houses", "poultry_houses", ["business_unit_id", "code"], () =>
    buildPoultryHouseCandidates(ctx)
  );
  await runStage("items", "items", ["code"], () => buildItemsCandidates(ctx));
  await runStage("production_lots", "production_lots", ["business_unit_id", "lot_code"], () =>
    buildProductionLotCandidates(ctx)
  );
  await runStage("users", "users", ["code"], () => buildUserCandidates(ctx));

  let thirdPartyCandidates: ThirdPartyCandidate[] = [];
  if (shouldRun(options, "third_parties") || shouldRun(options, "third_party_roles")) {
    thirdPartyCandidates = buildThirdPartyCandidates(ctx);
  }

  if (shouldRun(options, "third_parties")) {
    const result = await upsertCandidates(ctx, "third_parties", "third_parties", ["external_code"], thirdPartyCandidates);
    await refreshLookups(ctx);
    applyThirdPartyAliases(ctx, thirdPartyCandidates);
    result.referencesUpserted = await upsertThirdPartyExternalReferences(ctx, thirdPartyCandidates);
    stages.push(compactStageSummary(result));
    printStage(result);
  }

  applyThirdPartyAliases(ctx, thirdPartyCandidates);

  if (shouldRun(options, "third_party_roles")) {
    const result = await upsertCandidates(
      ctx,
      "third_party_roles",
      "third_party_roles",
      ["third_party_id", "role"],
      buildThirdPartyRoleCandidates(thirdPartyCandidates, ctx.thirdPartyIds)
    );
    stages.push(compactStageSummary(result));
    printStage(result);
    await refreshLookups(ctx);
    applyThirdPartyAliases(ctx, thirdPartyCandidates);
  }

  applyThirdPartyAliases(ctx, thirdPartyCandidates);

  await runStage("stores", "stores", ["source_uid"], () => buildStoreCandidates(ctx));
  applyThirdPartyAliases(ctx, thirdPartyCandidates);
  await runStage("third_party_details", "third_party_details", ["source_uid"], () =>
    buildThirdPartyDetailCandidates(ctx)
  );
  await runStage("transfer_types", "inventory_transfer_types", ["code"], () =>
    buildTransferTypeCandidates(ctx)
  );

  if (shouldRun(options, "attachments")) {
    const result = await promoteMasterAttachments(ctx);
    stages.push(compactStageSummary(result));
    printStage(result);
  }

  const totals = stages.reduce(
    (acc, stage) => ({
      processed: acc.processed + stage.processed,
      inserted: acc.inserted + stage.inserted,
      updated: acc.updated + stage.updated,
      unchanged: acc.unchanged + stage.unchanged,
      errors: acc.errors + stage.errors,
      referencesUpserted: acc.referencesUpserted + stage.referencesUpserted
    }),
    { ...EMPTY_STAGE_COUNTS }
  );

  return {
    dryRun: options.dryRun,
    rawRecordsRead: allRecords.length,
    stages,
    totals
  };
}
