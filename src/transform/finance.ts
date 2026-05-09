import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkArray, createRowHash } from "../sync/utils";
import {
  asDateOnly,
  asNumber,
  asText,
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

export type TransformFinanceOptions = {
  dryRun: boolean;
  only?: Set<string>;
};

export type FinanceStageSummary = {
  stage: string;
  processed: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
  referencesUpserted: number;
};

export type TransformFinanceSummary = {
  dryRun: boolean;
  rawRecordsRead: number;
  stages: FinanceStageSummary[];
  totals: Omit<FinanceStageSummary, "stage">;
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

type TransformContext = {
  supabase: SupabaseClient;
  dryRun: boolean;
  now: string;
  recordsBySource: Map<string, RawAppSheetRecord[]>;
  businessUnitIds: Map<string, string>;
  thirdPartyIds: Map<string, string>;
  costCenterIds: Map<string, string>;
  itemIds: Map<string, string>;
  categoryIds: Map<string, string>;
  financialDocumentIdsBySourceUid: Map<string, string>;
  paymentIdsBySourceUid: Map<string, string>;
  fixedAssetIdsBySourceUid: Map<string, string>;
  entityReferences: EntityReference[];
};

const TRANSFORM_NAME = "finance";
const IN_FILTER_CHUNK_SIZE = 50;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const FINANCE_SOURCE_NAMES = [
  "facturas_facturas",
  "facturas_facturasdetalle",
  "facturas_pagos",
  "facturas_pagosdetalle",
  "facturas_flujoefectivo",
  "facturas_ivabimestre",
  "mcds_hojadegastos",
  "gerencia_costostransacciones",
  "planta_depreciaciones"
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

function shouldRun(options: TransformFinanceOptions, stage: string): boolean {
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
): Promise<{ summary: FinanceStageSummary; idByKey: Map<string, string> }> {
  const candidates = dedupeCandidates(rawCandidates).filter((candidate) =>
    conflictColumns.every((column) => candidate.payload[column] !== undefined && candidate.payload[column] !== null)
  );
  const summary: FinanceStageSummary = {
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
  const [
    businessUnits,
    thirdParties,
    costCenters,
    items,
    categories,
    financialDocuments,
    payments,
    fixedAssets
  ] = await Promise.all([
    loadIdLookup(ctx.supabase, "business_units", "code"),
    loadIdLookup(ctx.supabase, "third_parties", "external_code"),
    loadIdLookup(ctx.supabase, "cost_centers", "code"),
    loadIdLookup(ctx.supabase, "items", "code"),
    loadIdLookup(ctx.supabase, "categories", "code"),
    loadIdLookup(ctx.supabase, "financial_documents", "source_uid"),
    loadIdLookup(ctx.supabase, "payments", "source_uid"),
    loadIdLookup(ctx.supabase, "fixed_assets", "source_uid")
  ]);

  ctx.businessUnitIds = businessUnits;
  ctx.thirdPartyIds = thirdParties;
  ctx.costCenterIds = costCenters;
  ctx.itemIds = items;
  ctx.categoryIds = categories;
  ctx.financialDocumentIdsBySourceUid = financialDocuments;
  ctx.paymentIdsBySourceUid = payments;
  ctx.fixedAssetIdsBySourceUid = fixedAssets;
}

function resolveItemId(ctx: TransformContext, rawId: unknown): string | null {
  const value = asText(rawId);
  if (!value) {
    return null;
  }

  for (const prefix of ["item", "producto", "materia_prima", "tamano_huevo", "concepto"]) {
    const id = ctx.itemIds.get(`${prefix}:${value}`);
    if (id) {
      return id;
    }
  }

  return null;
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

function resolveThirdPartyId(ctx: TransformContext, rawId: unknown): string | null {
  const code = masterCode("razon_social", rawId);
  return code ? ctx.thirdPartyIds.get(code) ?? null : null;
}

function resolveCostCenterId(ctx: TransformContext, rawId: unknown): string | null {
  const code = masterCode("centro_costo", rawId);
  return code ? ctx.costCenterIds.get(code) ?? null : null;
}

function financeDocumentSourceUidByFacturaId(ctx: TransformContext, facturaId: unknown): string | null {
  const value = asText(facturaId);
  if (!value) {
    return null;
  }

  const record = recordsFor(ctx, "facturas_facturas").find((item) => {
    const row = normalized(item);
    return asText(getField(row, "facturaid")) === value || asText(item.source_primary_key) === value;
  });

  return record?.source_uid ?? null;
}

function paymentSourceUidByPagoId(ctx: TransformContext, pagoId: unknown): string | null {
  const value = asText(pagoId);
  if (!value) {
    return null;
  }

  const record = recordsFor(ctx, "facturas_pagos").find((item) => {
    const row = normalized(item);
    return asText(getField(row, "pagoid")) === value || asText(item.source_primary_key) === value;
  });

  return record?.source_uid ?? null;
}

function inferDocumentDirection(tipoTransaccion: unknown): "payable" | "receivable" {
  const text = (asText(tipoTransaccion) ?? "").toLowerCase();
  return text.includes("debito") || text.includes("débito") ? "receivable" : "payable";
}

function cashDirection(value: unknown): "income" | "expense" | "transfer" | "adjustment" {
  const text = (asText(value) ?? "").toLowerCase();

  if (text.includes("ingreso")) {
    return "income";
  }

  if (text.includes("gasto") || text.includes("egreso")) {
    return "expense";
  }

  if (text.includes("tras")) {
    return "transfer";
  }

  return "adjustment";
}

function computePaidAmountByFacturaId(ctx: TransformContext): Map<string, number> {
  const totals = new Map<string, number>();

  for (const record of recordsFor(ctx, "facturas_pagosdetalle")) {
    const row = normalized(record);
    const facturaId = asText(getField(row, "facturaid"));
    const amount = asNumber(getField(row, "pagofactura")) ?? 0;

    if (!facturaId) {
      continue;
    }

    totals.set(facturaId, (totals.get(facturaId) ?? 0) + amount);
  }

  return totals;
}

function buildThirdPartyStubCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const sourceName of ["facturas_facturas", "facturas_pagos"]) {
    for (const record of recordsFor(ctx, sourceName)) {
      const row = normalized(record);
      const rawId = asText(getField(row, "razonsocialid"));
      const externalCode = masterCode("razon_social", rawId);

      if (!rawId || !externalCode || seen.has(externalCode)) {
        continue;
      }

      seen.add(externalCode);
      candidates.push({
        key: externalCode,
        payload: {
          external_code: externalCode,
          third_party_type: "company",
          name: `Razon Social ${rawId}`,
          legal_name: `Razon Social ${rawId}`,
          is_active: true,
          source_record_id: record.id,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            synthetic_from_finance_reference: true,
            original_id: rawId
          })
        },
        sourceReference: sourceRef(record, rawId)
      });
    }
  }

  return candidates;
}

function buildThirdPartyRoleCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  for (const [externalCode, thirdPartyId] of ctx.thirdPartyIds.entries()) {
    if (!externalCode.startsWith("razon_social:")) {
      continue;
    }

    candidates.push({
      key: `${thirdPartyId}::company`,
      payload: {
        third_party_id: thirdPartyId,
        role: "company",
        is_active: true,
        metadata: {
          transform_name: TRANSFORM_NAME,
          synthetic_from_finance_reference: true
        }
      }
    });
  }

  return candidates;
}

function buildFinancialDocumentCandidates(ctx: TransformContext): Candidate[] {
  const paidByFacturaId = computePaidAmountByFacturaId(ctx);

  return recordsFor(ctx, "facturas_facturas")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const issueDate = asDateOnly(getField(row, "facturafecha"));
      const totalAmount = asNumber(getField(row, "facturatotalapagar")) ?? 0;
      const facturaId = asText(getField(row, "facturaid")) ?? sourcePrimaryKey(record);
      const paidAmount = paidByFacturaId.get(facturaId) ?? 0;

      if (!issueDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          business_unit_id: ctx.businessUnitIds.get("costos_finanzas"),
          third_party_id: resolveThirdPartyId(ctx, getField(row, "razonsocialid")),
          direction: inferDocumentDirection(getField(row, "tipotransaccion")),
          document_type: "invoice",
          document_subtype: asText(getField(row, "tipotransaccion")),
          document_number: asText(getField(row, "numerodefactura")) ?? facturaId,
          issue_date: issueDate,
          due_date: asDateOnly(getField(row, "fechavencimiento")),
          total_amount: totalAmount,
          paid_amount: paidAmount,
          balance_amount: Math.max(totalAmount - paidAmount, 0),
          status: totalAmount > 0 && paidAmount >= totalAmount ? "paid" : "open",
          currency: "COP",
          metadata: mergeMetadata(rawLineageMetadata(record), {
            facturaid: facturaId,
            usuarioid: asText(getField(row, "usuarioid")),
            razonsocialid: asText(getField(row, "razonsocialid")),
            subtotal_without_tax: asNumber(getField(row, "preciofacturasiniva")),
            total_with_tax: asNumber(getField(row, "preciofacturaconiva")),
            tax_amount: asNumber(getField(row, "facturaiva")),
            withholding_amount: asNumber(getField(row, "facturaretenciones")),
            discount_amount: asNumber(getField(row, "facturadescuento")),
            file_ref: asText(getField(row, "facturapdf"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildFinancialDocumentLineCandidates(ctx: TransformContext): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const record of recordsFor(ctx, "facturas_facturasdetalle")) {
    const row = normalized(record);
    const facturaSourceUid = financeDocumentSourceUidByFacturaId(ctx, getField(row, "facturaid"));
    const financialDocumentId = facturaSourceUid
      ? ctx.financialDocumentIdsBySourceUid.get(facturaSourceUid)
      : null;

    if (!financialDocumentId) {
      skipped += 1;
      continue;
    }

    const withholding =
      (asNumber(getField(row, "retencionfuente")) ?? 0) + (asNumber(getField(row, "reteica")) ?? 0);

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        financial_document_id: financialDocumentId,
        source_record_id: record.id,
        source_uid: record.source_uid,
        item_id: resolveItemId(ctx, getField(row, "itemid")),
        category_id: resolveCategoryId(ctx, getField(row, "categoriaid")),
        quantity: asNumber(getField(row, "cantidad")) ?? 1,
        unit: asText(getField(row, "unidad")),
        unit_price: asNumber(getField(row, "precioundsiniva")),
        subtotal_amount: asNumber(getField(row, "preciototalconiva")),
        tax_rate: asNumber(getField(row, "ivaporcentaje")),
        tax_amount: asNumber(getField(row, "iva")),
        withholding_amount: withholding,
        total_amount: asNumber(getField(row, "valorapagar")) ?? asNumber(getField(row, "preciototalconiva")) ?? 0,
        notes: asText(getField(row, "observacion")),
        metadata: mergeMetadata(rawLineageMetadata(record), {
          facturaid: asText(getField(row, "facturaid")),
          facturas_detalle_id: asText(getField(row, "facturasdetalleid")),
          razon_social_detalle_id: asText(getField(row, "razonsocialdetalleid")),
          unit_price_with_tax: asNumber(getField(row, "precioundconiva")),
          retefuente_rate: asNumber(getField(row, "retefuenteporcentaje")),
          reteica_rate: asNumber(getField(row, "reteicaporcentaje")),
          remaining_units: asNumber(getField(row, "unidadesrestantes"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return { candidates, skipped };
}

function buildPaymentCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "facturas_pagos")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const paymentDate = asDateOnly(getField(row, "pagofecha"));

      if (!paymentDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          business_unit_id: ctx.businessUnitIds.get("costos_finanzas"),
          third_party_id: resolveThirdPartyId(ctx, getField(row, "razonsocialid")),
          cost_center_id: resolveCostCenterId(ctx, getField(row, "centrocostoid")),
          payment_date: paymentDate,
          amount: asNumber(getField(row, "pago")) ?? 0,
          payer_name: asText(getField(row, "quienpaga")),
          transaction_number: asText(getField(row, "numerodetransaccion")),
          notes: asText(getField(row, "observaciones")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            pagoid: asText(getField(row, "pagoid")),
            usuarioid: asText(getField(row, "usuarioid")),
            razonsocialid: asText(getField(row, "razonsocialid")),
            receipt_ref: asText(getField(row, "fotocomprobante"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildPaymentAllocationCandidates(ctx: TransformContext): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const record of recordsFor(ctx, "facturas_pagosdetalle")) {
    const row = normalized(record);
    const paymentSourceUid = paymentSourceUidByPagoId(ctx, getField(row, "pagoid"));
    const documentSourceUid = financeDocumentSourceUidByFacturaId(ctx, getField(row, "facturaid"));
    const paymentId = paymentSourceUid ? ctx.paymentIdsBySourceUid.get(paymentSourceUid) : null;
    const financialDocumentId = documentSourceUid
      ? ctx.financialDocumentIdsBySourceUid.get(documentSourceUid)
      : null;

    if (!paymentId || !financialDocumentId) {
      skipped += 1;
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        payment_id: paymentId,
        financial_document_id: financialDocumentId,
        source_record_id: record.id,
        source_uid: record.source_uid,
        amount: asNumber(getField(row, "pagofactura")) ?? 0,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          pagoid: asText(getField(row, "pagoid")),
          facturaid: asText(getField(row, "facturaid")),
          pagos_detalle_id: asText(getField(row, "pagosdetalleid"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return { candidates, skipped };
}

function buildCashMovementCandidates(ctx: TransformContext): Candidate[] {
  const candidates: Candidate[] = [];

  function add(sourceName: string, businessUnitCode: string, idField: string): void {
    for (const record of recordsFor(ctx, sourceName)) {
      const row = normalized(record);
      const movementDate = asDateOnly(getField(row, "fecha"));

      if (!movementDate) {
        continue;
      }

      candidates.push({
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          business_unit_id: ctx.businessUnitIds.get(businessUnitCode),
          cost_center_id: resolveCostCenterId(ctx, getField(row, "centrocostoid")),
          movement_date: movementDate,
          direction: cashDirection(getField(row, "tipodemovimiento")),
          concept: asText(getField(row, "concepto")),
          detail: asText(getField(row, "detalle")),
          amount: asNumber(getField(row, "valor")) ?? 0,
          beneficiary: asText(getField(row, "beneficiario")),
          reconciliation_status: "unreconciled",
          metadata: mergeMetadata(rawLineageMetadata(record), {
            source_cash_table: sourceName,
            source_cash_id: asText(getField(row, idField)),
            original_direction: asText(getField(row, "tipodemovimiento")),
            receipt_ref: asText(getField(row, "fotocomprobante", "firma"))
          })
        }),
        sourceReference: sourceRef(record)
      });
    }
  }

  add("facturas_flujoefectivo", "costos_finanzas", "flujoefectivoid");
  add("mcds_hojadegastos", "mcds_tienda", "hojagastoid");

  return candidates;
}

function buildStoreExpenseCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "mcds_hojadegastos")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const expenseDate = asDateOnly(getField(row, "fecha"));

      if (!expenseDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          expense_date: expenseDate,
          cost_center_id: resolveCostCenterId(ctx, getField(row, "centrocostoid")),
          movement_type: asText(getField(row, "tipodemovimiento")),
          concept: asText(getField(row, "concepto")),
          detail: asText(getField(row, "detalle")),
          amount: asNumber(getField(row, "valor")) ?? 0,
          beneficiary: asText(getField(row, "beneficiario")),
          metadata: mergeMetadata(rawLineageMetadata(record), {
            hojagastoid: asText(getField(row, "hojagastoid")),
            firma_ref: asText(getField(row, "firma"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildCostTransactionCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "gerencia_costostransacciones")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const transactionDate = asDateOnly(getField(row, "ultimaactualizacion")) ?? record.last_synced_at?.slice(0, 10);

      if (!transactionDate) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          category_id: resolveCategoryId(ctx, getField(row, "categoriaid")),
          item_id: resolveItemId(ctx, getField(row, "itemid")),
          transaction_date: transactionDate,
          cost_amount: asNumber(getField(row, "costo")) ?? 0,
          metadata: mergeMetadata(rawLineageMetadata(record), {
            costotransaccionid: asText(getField(row, "costotransaccionid"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function buildTaxPeriodCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "facturas_ivabimestre")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const startDate = asDateOnly(getField(row, "fecha"));
      const periodCode = asText(getField(row, "ivabimestreid")) ?? sourcePrimaryKey(record);

      if (!startDate || !periodCode) {
        return null;
      }

      const start = new Date(`${startDate}T00:00:00.000Z`);
      const end = addMonths(start, 2);
      end.setUTCDate(end.getUTCDate() - 1);

      return {
        key: record.source_uid,
        payload: compactRecord({
          period_code: periodCode,
          source_record_id: record.id,
          source_uid: record.source_uid,
          start_date: startDate,
          end_date: end.toISOString().slice(0, 10),
          tax_type: "iva",
          status: "open",
          metadata: rawLineageMetadata(record)
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildFixedAssetCandidates(ctx: TransformContext): Candidate[] {
  return recordsFor(ctx, "planta_depreciaciones")
    .map((record): Candidate | null => {
      const row = normalized(record);
      const code = asText(getField(row, "depreciacionid")) ?? sourcePrimaryKey(record);
      const description = asText(getField(row, "descripcion"));

      if (!code || !description) {
        return null;
      }

      return {
        key: record.source_uid,
        payload: compactRecord({
          source_record_id: record.id,
          source_uid: record.source_uid,
          code,
          description,
          category: asText(getField(row, "categoria")),
          acquisition_date: asDateOnly(getField(row, "fecha")),
          cost: asNumber(getField(row, "costo")) ?? 0,
          salvage_value: asNumber(getField(row, "valordesalvamento")) ?? 0,
          useful_life_years: asNumber(getField(row, "vidaanos")),
          status: "active",
          metadata: mergeMetadata(rawLineageMetadata(record), {
            salvage_percentage: asNumber(getField(row, "pvalordesalvamento")),
            depreciation_end_raw: asText(getField(row, "findepreciacion"))
          })
        }),
        sourceReference: sourceRef(record)
      };
    })
    .filter(Boolean) as Candidate[];
}

function buildDepreciationEntryCandidates(ctx: TransformContext): { candidates: Candidate[]; skipped: number } {
  const candidates: Candidate[] = [];
  let skipped = 0;

  for (const record of recordsFor(ctx, "planta_depreciaciones")) {
    const row = normalized(record);
    const fixedAssetId = ctx.fixedAssetIdsBySourceUid.get(record.source_uid);
    const depreciationDate = asDateOnly(getField(row, "fecha"));

    if (!fixedAssetId || !depreciationDate) {
      skipped += 1;
      continue;
    }

    candidates.push({
      key: record.source_uid,
      payload: compactRecord({
        fixed_asset_id: fixedAssetId,
        source_record_id: record.id,
        source_uid: record.source_uid,
        depreciation_date: depreciationDate,
        amount: asNumber(getField(row, "depreciacion")) ?? 0,
        metadata: mergeMetadata(rawLineageMetadata(record), {
          depreciacionid: asText(getField(row, "depreciacionid")),
          depreciation_end_raw: asText(getField(row, "findepreciacion"))
        })
      }),
      sourceReference: sourceRef(record)
    });
  }

  return { candidates, skipped };
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

async function promoteFinanceAttachments(ctx: TransformContext): Promise<FinanceStageSummary> {
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

function compactSummary(summary: FinanceStageSummary): FinanceStageSummary {
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

function printStage(summary: FinanceStageSummary): void {
  console.log(
    `${summary.stage}: processed=${summary.processed}, inserted=${summary.inserted}, updated=${summary.updated}, unchanged=${summary.unchanged}, skipped=${summary.skipped}, refs=${summary.referencesUpserted}, errors=${summary.errors}`
  );
}

export async function transformFinance(
  supabase: SupabaseClient,
  options: TransformFinanceOptions
): Promise<TransformFinanceSummary> {
  const allRecords = await fetchRawRecordsBySourceNames(supabase, FINANCE_SOURCE_NAMES);
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
    thirdPartyIds: new Map(),
    costCenterIds: new Map(),
    itemIds: new Map(),
    categoryIds: new Map(),
    financialDocumentIdsBySourceUid: new Map(),
    paymentIdsBySourceUid: new Map(),
    fixedAssetIdsBySourceUid: new Map(),
    entityReferences: []
  };

  await refreshLookups(ctx);

  const stages: FinanceStageSummary[] = [];

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

  await runStage("third_party_stubs", "third_parties", ["external_code"], () =>
    buildThirdPartyStubCandidates(ctx)
  );
  await runStage("third_party_roles", "third_party_roles", ["third_party_id", "role"], () =>
    buildThirdPartyRoleCandidates(ctx)
  );

  const financialDocumentIds = await runStage(
    "financial_documents",
    "financial_documents",
    ["source_uid"],
    () => buildFinancialDocumentCandidates(ctx)
  );

  if (ctx.dryRun && ctx.financialDocumentIdsBySourceUid.size === 0) {
    ctx.financialDocumentIdsBySourceUid = financialDocumentIds;
    for (const candidate of buildFinancialDocumentCandidates(ctx)) {
      ctx.financialDocumentIdsBySourceUid.set(candidate.key, ZERO_UUID);
    }
  }

  if (shouldRun(options, "financial_document_lines")) {
    const { candidates, skipped } = buildFinancialDocumentLineCandidates(ctx);
    await runStage(
      "financial_document_lines",
      "financial_document_lines",
      ["source_uid"],
      () => candidates,
      skipped
    );
  }

  await runStage("payments", "payments", ["source_uid"], () => buildPaymentCandidates(ctx));

  if (ctx.dryRun) {
    for (const candidate of buildFinancialDocumentCandidates(ctx)) {
      if (!ctx.financialDocumentIdsBySourceUid.has(candidate.key)) {
        ctx.financialDocumentIdsBySourceUid.set(candidate.key, ZERO_UUID);
      }
    }

    for (const candidate of buildPaymentCandidates(ctx)) {
      if (!ctx.paymentIdsBySourceUid.has(candidate.key)) {
        ctx.paymentIdsBySourceUid.set(candidate.key, ZERO_UUID);
      }
    }
  }

  if (shouldRun(options, "payment_allocations")) {
    const { candidates, skipped } = buildPaymentAllocationCandidates(ctx);
    await runStage(
      "payment_allocations",
      "payment_allocations",
      ["source_uid"],
      () => candidates,
      skipped
    );
  }

  await runStage("cash_movements", "cash_movements", ["source_uid"], () =>
    buildCashMovementCandidates(ctx)
  );
  await runStage("store_expenses", "store_expenses", ["source_uid"], () =>
    buildStoreExpenseCandidates(ctx)
  );
  await runStage("cost_transactions", "cost_transactions", ["source_uid"], () =>
    buildCostTransactionCandidates(ctx)
  );
  await runStage("tax_periods", "tax_periods", ["source_uid"], () => buildTaxPeriodCandidates(ctx));

  await runStage("fixed_assets", "fixed_assets", ["source_uid"], () => buildFixedAssetCandidates(ctx));

  if (ctx.dryRun && ctx.fixedAssetIdsBySourceUid.size === 0) {
    for (const candidate of buildFixedAssetCandidates(ctx)) {
      ctx.fixedAssetIdsBySourceUid.set(candidate.key, ZERO_UUID);
    }
  }

  if (shouldRun(options, "depreciation_entries")) {
    const { candidates, skipped } = buildDepreciationEntryCandidates(ctx);
    await runStage(
      "depreciation_entries",
      "depreciation_entries",
      ["source_uid"],
      () => candidates,
      skipped
    );
  }

  if (shouldRun(options, "attachments")) {
    const summary = compactSummary(await promoteFinanceAttachments(ctx));
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
