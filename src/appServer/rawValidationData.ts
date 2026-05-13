import { getSyncSourceByName } from "../sync/sources.config";
import { getSupabaseAdminClient } from "../lib/supabaseAdmin";

export const RAW_VALIDATION_DEFAULT_PAGE_SIZE = 100;
export const RAW_VALIDATION_MAX_PAGE_SIZE = 500;
export const RAW_VALIDATION_EXPORT_LIMIT = 25000;

export type JsonRecord = Record<string, unknown>;

export type RawValidationSource = {
  app_name: string;
  source_name: string;
  spreadsheet_id: string;
  sheet_name: string;
  rows_count: number;
  first_synced_at: string | null;
  last_synced_at: string | null;
  latest_source_updated_at: string | null;
  first_source_row_number: number | null;
  last_source_row_number: number | null;
};

export type RawValidationRecord = {
  id: string;
  source_uid: string;
  source_name: string;
  app_name: string;
  spreadsheet_id: string;
  sheet_name: string;
  source_row_number: number | null;
  source_primary_key: string | null;
  source_updated_at: string | null;
  row_hash: string;
  raw_data: JsonRecord;
  normalized_data: JsonRecord | null;
  is_active: boolean;
  first_synced_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RawValidationRecordsResult = {
  columns: string[];
  fixedColumns: string[];
  generatedAt: string;
  page: number;
  pageSize: number;
  query: string | null;
  records: RawValidationRecord[];
  source: RawValidationSource;
  totalRows: number;
  totalPages: number;
};

export type RawValidationExportResult = {
  columns: string[];
  fileName: string;
  rows: Array<Record<string, unknown>>;
  totalRows: number;
};

const FIXED_COLUMNS = [
  "app_name",
  "source_name",
  "sheet_name",
  "source_row_number",
  "source_primary_key",
  "source_updated_at",
  "last_synced_at"
];

const RECORD_SELECT =
  "id,source_uid,source_name,app_name,spreadsheet_id,sheet_name,source_row_number,source_primary_key,source_updated_at,row_hash,raw_data,normalized_data,is_active,first_synced_at,last_synced_at,created_at,updated_at";

function normalizePage(value: unknown): number {
  const page = Number(value ?? 1);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function normalizePageSize(value: unknown): number {
  const pageSize = Number(value ?? RAW_VALIDATION_DEFAULT_PAGE_SIZE);

  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return RAW_VALIDATION_DEFAULT_PAGE_SIZE;
  }

  return Math.min(pageSize, RAW_VALIDATION_MAX_PAGE_SIZE);
}

function normalizeSearch(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sourceFileName(sourceName: string): string {
  return `macadasa_validacion_${sourceName.replace(/[^a-zA-Z0-9_-]+/g, "_")}.csv`;
}

function configuredColumnsForSource(sourceName: string): string[] {
  const source = getSyncSourceByName(sourceName);
  return source ? Object.keys(source.columnMap) : [];
}

function rawColumnsFor(sourceName: string, records: RawValidationRecord[]): string[] {
  const columns = new Set(configuredColumnsForSource(sourceName));

  for (const record of records) {
    for (const column of Object.keys(record.raw_data ?? {})) {
      columns.add(column);
    }
  }

  return [...columns];
}

function applyRecordFilters(query: any, sourceName: string, search: string | null): any {
  let nextQuery = query.eq("source_name", sourceName);

  if (search) {
    nextQuery = nextQuery.ilike("raw_search_text", `%${search}%`);
  }

  return nextQuery;
}

async function fetchSource(sourceName: string): Promise<RawValidationSource> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("v_raw_validation_sources")
    .select("*")
    .eq("source_name", sourceName)
    .single();

  if (error) {
    throw new Error(`No se encontro la fuente raw ${sourceName}: ${error.message}`);
  }

  return data as RawValidationSource;
}

async function fetchRecordsPage(params: {
  page: number;
  pageSize: number;
  query: string | null;
  sourceName: string;
}): Promise<{ records: RawValidationRecord[]; totalRows: number }> {
  const supabase = getSupabaseAdminClient();
  const from = (params.page - 1) * params.pageSize;
  const to = from + params.pageSize - 1;
  let query = supabase
    .from("v_raw_validation_records")
    .select(RECORD_SELECT, { count: "exact" })
    .order("source_row_number", { ascending: true, nullsFirst: false })
    .range(from, to);

  query = applyRecordFilters(query, params.sourceName, params.query);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Error leyendo registros raw: ${error.message}`);
  }

  return {
    records: (data ?? []) as RawValidationRecord[],
    totalRows: count ?? 0
  };
}

async function countFilteredRows(sourceName: string, search: string | null): Promise<number> {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from("v_raw_validation_records")
    .select("id", { count: "exact", head: true });

  query = applyRecordFilters(query, sourceName, search);

  const { count, error } = await query;

  if (error) {
    throw new Error(`Error contando registros raw: ${error.message}`);
  }

  return count ?? 0;
}

function recordToFlatRow(record: RawValidationRecord, rawColumns: string[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    app_name: record.app_name,
    source_name: record.source_name,
    sheet_name: record.sheet_name,
    source_row_number: record.source_row_number,
    source_primary_key: record.source_primary_key,
    source_updated_at: record.source_updated_at,
    last_synced_at: record.last_synced_at
  };

  for (const column of rawColumns) {
    flat[column] = record.raw_data?.[column] ?? null;
  }

  return flat;
}

export async function getRawValidationSources(): Promise<RawValidationSource[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("v_raw_validation_sources")
    .select("*")
    .order("app_name")
    .order("sheet_name")
    .order("source_name");

  if (error) {
    throw new Error(`Error leyendo fuentes raw: ${error.message}`);
  }

  return (data ?? []) as RawValidationSource[];
}

export async function getRawValidationRecords(params: {
  page?: unknown;
  pageSize?: unknown;
  query?: unknown;
  sourceName: string;
}): Promise<RawValidationRecordsResult> {
  const sourceName = params.sourceName.trim();

  if (!sourceName) {
    throw new Error("source es obligatorio.");
  }

  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize);
  const search = normalizeSearch(params.query);
  const [source, pageResult] = await Promise.all([
    fetchSource(sourceName),
    fetchRecordsPage({ page, pageSize, query: search, sourceName })
  ]);
  const rawColumns = rawColumnsFor(sourceName, pageResult.records);

  return {
    columns: rawColumns,
    fixedColumns: FIXED_COLUMNS,
    generatedAt: new Date().toISOString(),
    page,
    pageSize,
    query: search,
    records: pageResult.records,
    source,
    totalRows: pageResult.totalRows,
    totalPages: Math.max(1, Math.ceil(pageResult.totalRows / pageSize))
  };
}

export async function getRawValidationExport(params: {
  query?: unknown;
  sourceName: string;
}): Promise<RawValidationExportResult> {
  const sourceName = params.sourceName.trim();

  if (!sourceName) {
    throw new Error("source es obligatorio.");
  }

  const search = normalizeSearch(params.query);
  await fetchSource(sourceName);

  const totalRows = await countFilteredRows(sourceName, search);

  if (totalRows > RAW_VALIDATION_EXPORT_LIMIT) {
    throw new Error(
      `La exportacion tiene ${totalRows} filas. Filtra la fuente antes de exportar; el maximo es ${RAW_VALIDATION_EXPORT_LIMIT}.`
    );
  }

  const records: RawValidationRecord[] = [];

  for (let from = 0; from < totalRows; from += 1000) {
    const page = Math.floor(from / 1000) + 1;
    const { records: pageRecords } = await fetchRecordsPage({
      page,
      pageSize: 1000,
      query: search,
      sourceName
    });
    records.push(...pageRecords);
  }

  const columns = rawColumnsFor(sourceName, records);
  const exportColumns = [...FIXED_COLUMNS, ...columns];
  const rows = records.map((record) => recordToFlatRow(record, columns));

  return {
    columns: exportColumns,
    fileName: sourceFileName(sourceName),
    rows,
    totalRows
  };
}

export function recordToDisplayRow(
  record: RawValidationRecord,
  rawColumns: string[]
): Record<string, unknown> {
  return recordToFlatRow(record, rawColumns);
}
