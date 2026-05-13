import { config } from "dotenv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSheetValues } from "../src/lib/googleSheetsClient";
import { getSupabaseAdminClient } from "../src/lib/supabaseAdmin";
import { syncSources, type SyncSourceConfig } from "../src/sync/sources.config";
import {
  buildSourceUid,
  chunkArray,
  createRowHash,
  normalizeHeader,
  normalizeRow,
  parseSheetRows,
  safeDateParser
} from "../src/sync/utils";

config();

type CliOptions = {
  sourceName?: string;
  dryRun: boolean;
  help: boolean;
};

type ExistingRawRecord = {
  source_uid: string;
  row_hash: string;
};

type RawAppSheetRecordPayload = {
  source_uid: string;
  source_name: string;
  app_name: string;
  spreadsheet_id: string;
  sheet_name: string;
  source_row_number: number;
  source_primary_key: string | null;
  source_updated_at: string | null;
  row_hash: string;
  raw_data: Record<string, unknown>;
  normalized_data: Record<string, unknown>;
  is_active: boolean;
  first_synced_at?: string;
  last_synced_at: string;
  last_sync_run_id: string | null;
  updated_at: string;
};

type RawAttachmentPayload = {
  attachment_uid: string;
  raw_record_source_uid: string;
  source_name: string;
  app_name: string;
  spreadsheet_id: string;
  sheet_name: string;
  source_row_number: number;
  source_primary_key: string | null;
  column_name: string;
  file_ref: string;
  file_name: string | null;
  file_extension: string | null;
  file_kind: "image" | "pdf" | "spreadsheet" | "document" | "other";
  mime_type: string | null;
  drive_file_id: string | null;
  is_active: boolean;
  last_seen_at: string;
  last_sync_run_id: string | null;
  metadata: Record<string, unknown>;
};

type SourceStats = {
  rowsRead: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  attachmentsFound: number;
  attachmentsUpserted: number;
  errorsCount: number;
};

type SourceResult = SourceStats & {
  status: "success" | "failed";
  errorMessage?: string;
};

const FETCH_BATCH_SIZE = 50;
const UPSERT_BATCH_SIZE = 500;

function formatSupabaseError(error: {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
}): string {
  return [error.message, error.details, error.hint, error.code ? `code=${error.code}` : undefined]
    .filter(Boolean)
    .join(" | ");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--source") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --source.");
      }
      options.sourceName = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--source=")) {
      options.sourceName = arg.slice("--source=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage:
  npm run sync:sheets
  npm run sync:sheets -- --source planta_movimientos_inventario
  npm run sync:sheets -- --dry-run
  npm run sync:sheets -- --source tienda_ventas --dry-run
`);
}

function isPlaceholderSpreadsheetId(spreadsheetId: string): boolean {
  return spreadsheetId.startsWith("PEGAR_ID_DEL_GOOGLE_SHEET");
}

function getColumnValue(row: Record<string, unknown>, columnName?: string): unknown {
  if (!columnName) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(row, columnName)) {
    return row[columnName];
  }

  const expected = normalizeHeader(columnName);
  const matchingKey = Object.keys(row).find((key) => normalizeHeader(key) === expected);
  return matchingKey ? row[matchingKey] : undefined;
}

function validateRequiredColumns(headers: string[], requiredColumns: string[]): void {
  const normalizedHeaders = new Set(headers.map((header) => normalizeHeader(header)));
  const missingColumns = requiredColumns.filter(
    (column) => !normalizedHeaders.has(normalizeHeader(column))
  );

  if (missingColumns.length > 0) {
    throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
  }
}

function assertNoDuplicateSourceUids(sourceUids: string[], sourceName: string): void {
  const seen = new Set<string>();

  for (const sourceUid of sourceUids) {
    if (seen.has(sourceUid)) {
      throw new Error(
        `Duplicate source_uid generated in ${sourceName}. Check duplicated primary key values in the sheet.`
      );
    }

    seen.add(sourceUid);
  }
}

function splitAttachmentRefs(value: unknown): string[] {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => splitAttachmentRefs(item));
  }

  const raw = String(value).trim();

  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return splitAttachmentRefs(parsed);
    } catch {
      return [raw];
    }
  }

  if (!raw.startsWith("http") && /[,;]/.test(raw)) {
    return raw
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [raw];
}

function getFileName(fileRef: string): string | null {
  try {
    const url = new URL(fileRef);
    const fileNameParam = url.searchParams.get("fileName") ?? url.searchParams.get("filename");
    if (fileNameParam) {
      return decodeURIComponent(fileNameParam.split("/").pop() ?? fileNameParam);
    }

    const pathName = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    return pathName || null;
  } catch {
    const normalizedPath = fileRef.replace(/\\/g, "/");
    const lastPart = normalizedPath.split("/").pop()?.trim();
    return lastPart && lastPart.length > 0 ? lastPart : null;
  }
}

function getFileExtension(fileName: string | null): string | null {
  if (!fileName || !fileName.includes(".")) {
    return null;
  }

  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension && extension.length > 0 ? extension : null;
}

function getFileKind(
  extension: string | null
): "image" | "pdf" | "spreadsheet" | "document" | "other" {
  if (!extension) {
    return "other";
  }

  if (["jpg", "jpeg", "png", "webp", "gif", "heic", "bmp", "tiff"].includes(extension)) {
    return "image";
  }

  if (extension === "pdf") {
    return "pdf";
  }

  if (["xls", "xlsx", "csv", "ods"].includes(extension)) {
    return "spreadsheet";
  }

  if (["doc", "docx", "txt", "rtf"].includes(extension)) {
    return "document";
  }

  return "other";
}

function getMimeType(
  extension: string | null,
  fileKind: RawAttachmentPayload["file_kind"]
): string | null {
  if (extension === "pdf") {
    return "application/pdf";
  }

  if (fileKind === "image" && extension) {
    return `image/${extension === "jpg" ? "jpeg" : extension}`;
  }

  return null;
}

function extractDriveFileId(fileRef: string): string | null {
  const patterns = [
    /drive\.google\.com\/file\/d\/([^/?#]+)/i,
    /drive\.google\.com\/open\?id=([^&#]+)/i,
    /[?&]id=([^&#]+)/i
  ];

  for (const pattern of patterns) {
    const match = fileRef.match(pattern);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

async function createSyncRun(
  supabase: SupabaseClient,
  params: { mode: "live"; totalSources: number; sourceName?: string }
): Promise<string> {
  const { data, error } = await supabase
    .from("sync_runs")
    .insert({
      status: "running",
      mode: params.mode,
      total_sources: params.totalSources,
      metadata: {
        source_filter: params.sourceName ?? null
      }
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not create sync run: ${error.message}`);
  }

  return String(data.id);
}

async function finishSyncRun(
  supabase: SupabaseClient,
  syncRunId: string,
  params: SourceStats & { status: "success" | "partial_success" | "failed" }
): Promise<void> {
  const { error } = await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      status: params.status,
      total_rows_read: params.rowsRead,
      total_rows_inserted: params.rowsInserted,
      total_rows_updated: params.rowsUpdated,
      total_rows_unchanged: params.rowsUnchanged,
      total_errors: params.errorsCount
    })
    .eq("id", syncRunId);

  if (error) {
    throw new Error(`Could not finish sync run ${syncRunId}: ${error.message}`);
  }
}

async function createSyncRunItem(
  supabase: SupabaseClient,
  syncRunId: string,
  source: SyncSourceConfig
): Promise<string> {
  const { data, error } = await supabase
    .from("sync_run_items")
    .insert({
      sync_run_id: syncRunId,
      source_name: source.sourceName,
      app_name: source.appName,
      spreadsheet_id: source.spreadsheetId,
      sheet_name: source.sheetName,
      status: "running"
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not create sync run item for ${source.sourceName}: ${error.message}`);
  }

  return String(data.id);
}

async function finishSyncRunItem(
  supabase: SupabaseClient,
  itemId: string,
  result: SourceResult
): Promise<void> {
  const { error } = await supabase
    .from("sync_run_items")
    .update({
      status: result.status,
      rows_read: result.rowsRead,
      rows_inserted: result.rowsInserted,
      rows_updated: result.rowsUpdated,
      rows_unchanged: result.rowsUnchanged,
      errors_count: result.errorsCount,
      error_message: result.errorMessage ?? null,
      finished_at: new Date().toISOString(),
      metadata: {
        attachments_found: result.attachmentsFound,
        attachments_upserted: result.attachmentsUpserted
      }
    })
    .eq("id", itemId);

  if (error) {
    throw new Error(`Could not finish sync run item ${itemId}: ${error.message}`);
  }
}

async function getExistingRecords(
  supabase: SupabaseClient,
  sourceUids: string[]
): Promise<Map<string, ExistingRawRecord>> {
  const existing = new Map<string, ExistingRawRecord>();

  for (const sourceUidChunk of chunkArray(sourceUids, FETCH_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("raw_appsheet_records")
      .select("source_uid,row_hash")
      .in("source_uid", sourceUidChunk);

    if (error) {
      throw new Error(`Could not fetch existing raw records: ${formatSupabaseError(error)}`);
    }

    for (const record of (data ?? []) as ExistingRawRecord[]) {
      existing.set(record.source_uid, record);
    }
  }

  return existing;
}

async function insertRecords(
  supabase: SupabaseClient,
  records: RawAppSheetRecordPayload[]
): Promise<void> {
  for (const recordChunk of chunkArray(records, UPSERT_BATCH_SIZE)) {
    const { error } = await supabase
      .from("raw_appsheet_records")
      .insert(recordChunk);

    if (error) {
      throw new Error(`Could not insert raw records: ${formatSupabaseError(error)}`);
    }
  }
}

async function updateRecords(
  supabase: SupabaseClient,
  records: RawAppSheetRecordPayload[]
): Promise<void> {
  for (const recordChunk of chunkArray(records, FETCH_BATCH_SIZE)) {
    await Promise.all(recordChunk.map(async (record) => {
      const { first_synced_at: _firstSyncedAt, source_uid: _sourceUid, ...updatePayload } = record;
      const { error } = await supabase
        .from("raw_appsheet_records")
        .update(updatePayload)
        .eq("source_uid", record.source_uid);

      if (error) {
        throw new Error(`Could not update raw record ${record.source_uid}: ${formatSupabaseError(error)}`);
      }
    }));
  }
}

async function upsertRecords(
  supabase: SupabaseClient,
  params: {
    recordsToInsert: RawAppSheetRecordPayload[];
    recordsToUpdate: RawAppSheetRecordPayload[];
  }
): Promise<void> {
  if (params.recordsToInsert.length > 0) {
    await insertRecords(supabase, params.recordsToInsert);
  }

  if (params.recordsToUpdate.length > 0) {
    await updateRecords(supabase, params.recordsToUpdate);
  }
}

async function upsertAttachments(
  supabase: SupabaseClient,
  attachments: RawAttachmentPayload[]
): Promise<void> {
  for (const attachmentChunk of chunkArray(attachments, UPSERT_BATCH_SIZE)) {
    const { error } = await supabase
      .from("raw_appsheet_attachments")
      .upsert(attachmentChunk, { onConflict: "attachment_uid" });

    if (error) {
      throw new Error(`Could not upsert raw attachments: ${formatSupabaseError(error)}`);
    }
  }
}

function buildRecordPayload(params: {
  source: SyncSourceConfig;
  rowNumber: number;
  rawData: Record<string, unknown>;
  now: string;
  syncRunId: string | null;
}): RawAppSheetRecordPayload {
  const primaryKeyValue = getColumnValue(params.rawData, params.source.primaryKeyColumn);
  const hasPrimaryKey =
    primaryKeyValue !== undefined &&
    primaryKeyValue !== null &&
    String(primaryKeyValue).trim().length > 0;
  const updatedAtValue = getColumnValue(params.rawData, params.source.updatedAtColumn);
  const normalizedData = normalizeRow(
    params.rawData,
    params.source.columnMap,
    params.source.typeMap
  );
  const sourceUid = buildSourceUid({
    appName: params.source.appName,
    spreadsheetId: params.source.spreadsheetId,
    sheetName: params.source.sheetName,
    primaryKeyValue: hasPrimaryKey ? primaryKeyValue : undefined,
    rowNumber: params.rowNumber
  });

  return {
    source_uid: sourceUid,
    source_name: params.source.sourceName,
    app_name: params.source.appName,
    spreadsheet_id: params.source.spreadsheetId,
    sheet_name: params.source.sheetName,
    source_row_number: params.rowNumber,
    source_primary_key: hasPrimaryKey ? String(primaryKeyValue).trim() : null,
    source_updated_at: safeDateParser(updatedAtValue),
    row_hash: createRowHash({
      raw_data: params.rawData,
      normalized_data: normalizedData
    }),
    raw_data: params.rawData,
    normalized_data: normalizedData,
    is_active: true,
    last_synced_at: params.now,
    last_sync_run_id: params.syncRunId,
    updated_at: params.now
  };
}

function buildAttachmentPayloads(params: {
  source: SyncSourceConfig;
  rawData: Record<string, unknown>;
  record: RawAppSheetRecordPayload;
  now: string;
  syncRunId: string | null;
}): RawAttachmentPayload[] {
  return params.source.attachmentColumns.flatMap((columnName) => {
    const rawValue = getColumnValue(params.rawData, columnName);
    const fileRefs = splitAttachmentRefs(rawValue);

    return fileRefs.map((fileRef, index) => {
      const fileName = getFileName(fileRef);
      const fileExtension = getFileExtension(fileName);
      const fileKind = getFileKind(fileExtension);

      return {
        attachment_uid: [
          params.record.source_uid,
          normalizeHeader(columnName),
          createRowHash(fileRef).slice(0, 24)
        ].join("::"),
        raw_record_source_uid: params.record.source_uid,
        source_name: params.source.sourceName,
        app_name: params.source.appName,
        spreadsheet_id: params.source.spreadsheetId,
        sheet_name: params.source.sheetName,
        source_row_number: params.record.source_row_number,
        source_primary_key: params.record.source_primary_key,
        column_name: columnName,
        file_ref: fileRef,
        file_name: fileName,
        file_extension: fileExtension,
        file_kind: fileKind,
        mime_type: getMimeType(fileExtension, fileKind),
        drive_file_id: extractDriveFileId(fileRef),
        is_active: true,
        last_seen_at: params.now,
        last_sync_run_id: params.syncRunId,
        metadata: {
          attachment_index: index
        }
      };
    });
  });
}

async function syncSource(params: {
  supabase: SupabaseClient;
  source: SyncSourceConfig;
  dryRun: boolean;
  syncRunId: string | null;
}): Promise<SourceResult> {
  const stats: SourceStats = {
    rowsRead: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    attachmentsFound: 0,
    attachmentsUpserted: 0,
    errorsCount: 0
  };

  try {
    if (isPlaceholderSpreadsheetId(params.source.spreadsheetId)) {
      throw new Error(
        `Source ${params.source.sourceName} still has a placeholder spreadsheetId.`
      );
    }

    const values = await readSheetValues({
      spreadsheetId: params.source.spreadsheetId,
      sheetName: params.source.sheetName
    });
    const parsed = parseSheetRows(values, params.source.headerRow);

    validateRequiredColumns(parsed.headers, params.source.requiredColumns);
    stats.rowsRead = parsed.rows.length;

    const now = new Date().toISOString();
    const payloads = parsed.rows.map((row) =>
      buildRecordPayload({
        source: params.source,
        rowNumber: row.rowNumber,
        rawData: row.rawData,
        now,
        syncRunId: params.syncRunId
      })
    );
    const attachmentPayloads = parsed.rows.flatMap((row, index) =>
      buildAttachmentPayloads({
        source: params.source,
        rawData: row.rawData,
        record: payloads[index],
        now,
        syncRunId: params.syncRunId
      })
    );
    const sourceUids = payloads.map((record) => record.source_uid);
    assertNoDuplicateSourceUids(sourceUids, params.source.sourceName);
    stats.attachmentsFound = attachmentPayloads.length;
    const existingRecords = await getExistingRecords(params.supabase, sourceUids);
    const recordsToInsert: RawAppSheetRecordPayload[] = [];
    const recordsToUpdate: RawAppSheetRecordPayload[] = [];

    for (const payload of payloads) {
      const existing = existingRecords.get(payload.source_uid);

      if (!existing) {
        stats.rowsInserted += 1;
        recordsToInsert.push({
          ...payload,
          first_synced_at: now
        });
        continue;
      }

      if (existing.row_hash !== payload.row_hash) {
        stats.rowsUpdated += 1;
        recordsToUpdate.push(payload);
        continue;
      }

      stats.rowsUnchanged += 1;
    }

    if (!params.dryRun && (recordsToInsert.length > 0 || recordsToUpdate.length > 0)) {
      await upsertRecords(params.supabase, { recordsToInsert, recordsToUpdate });
    }

    if (!params.dryRun && attachmentPayloads.length > 0) {
      await upsertAttachments(params.supabase, attachmentPayloads);
      stats.attachmentsUpserted = attachmentPayloads.length;
    }

    return {
      ...stats,
      status: "success"
    };
  } catch (error) {
    return {
      ...stats,
      status: "failed",
      errorsCount: 1,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

function resolveSources(sourceName?: string): SyncSourceConfig[] {
  if (!sourceName) {
    return syncSources.filter((source) => source.isActive);
  }

  const source = syncSources.find((item) => item.sourceName === sourceName);

  if (!source) {
    const availableSources = syncSources.map((item) => item.sourceName).join(", ");
    throw new Error(`Source ${sourceName} was not found. Available sources: ${availableSources}`);
  }

  if (!source.isActive) {
    throw new Error(
      `Source ${sourceName} is inactive. Set isActive: true after replacing its spreadsheetId.`
    );
  }

  return [source];
}

function sumResults(results: SourceResult[]): SourceStats {
  return results.reduce<SourceStats>(
    (acc, result) => ({
      rowsRead: acc.rowsRead + result.rowsRead,
      rowsInserted: acc.rowsInserted + result.rowsInserted,
      rowsUpdated: acc.rowsUpdated + result.rowsUpdated,
      rowsUnchanged: acc.rowsUnchanged + result.rowsUnchanged,
      attachmentsFound: acc.attachmentsFound + result.attachmentsFound,
      attachmentsUpserted: acc.attachmentsUpserted + result.attachmentsUpserted,
      errorsCount: acc.errorsCount + result.errorsCount
    }),
    {
      rowsRead: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      attachmentsFound: 0,
      attachmentsUpserted: 0,
      errorsCount: 0
    }
  );
}

function getRunStatus(results: SourceResult[]): "success" | "partial_success" | "failed" {
  const failedSources = results.filter((result) => result.status === "failed").length;

  if (failedSources === 0) {
    return "success";
  }

  if (failedSources === results.length) {
    return "failed";
  }

  return "partial_success";
}

function printSummary(params: {
  dryRun: boolean;
  syncRunId: string | null;
  results: Array<{ source: SyncSourceConfig; result: SourceResult }>;
}): void {
  const totals = sumResults(params.results.map((item) => item.result));
  const status = getRunStatus(params.results.map((item) => item.result));

  console.log("");
  console.log("Sync summary");
  console.log("============");
  console.log(`Mode: ${params.dryRun ? "dry-run" : "live"}`);
  console.log(`Status: ${status}`);
  console.log(`Sync run id: ${params.syncRunId ?? "not persisted in dry-run"}`);
  console.log(`Sources: ${params.results.length}`);
  console.log(`Rows read: ${totals.rowsRead}`);
  console.log(`Rows inserted: ${totals.rowsInserted}`);
  console.log(`Rows updated: ${totals.rowsUpdated}`);
  console.log(`Rows unchanged: ${totals.rowsUnchanged}`);
  console.log(`Attachments found: ${totals.attachmentsFound}`);
  console.log(`Attachments upserted: ${totals.attachmentsUpserted}`);
  console.log(`Errors: ${totals.errorsCount}`);
  console.log("");

  for (const item of params.results) {
    const prefix = item.result.status === "success" ? "OK" : "ERROR";
    console.log(
      `${prefix} ${item.source.sourceName}: read=${item.result.rowsRead}, insert=${item.result.rowsInserted}, update=${item.result.rowsUpdated}, unchanged=${item.result.rowsUnchanged}, attachments=${item.result.attachmentsFound}`
    );
    if (item.result.errorMessage) {
      console.log(`  ${item.result.errorMessage}`);
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const sources = resolveSources(options.sourceName);

  if (sources.length === 0) {
    console.log("No active sync sources found. Configure spreadsheetId values and set isActive: true.");
    return;
  }

  const supabase = getSupabaseAdminClient();

  const syncRunId = options.dryRun
    ? null
    : await createSyncRun(supabase, {
        mode: "live",
        totalSources: sources.length,
        sourceName: options.sourceName
      });

  const results: Array<{ source: SyncSourceConfig; result: SourceResult }> = [];

  for (const source of sources) {
    console.log(`Syncing ${source.sourceName} (${source.sheetName})...`);

    let itemId: string | null = null;
    if (!options.dryRun && syncRunId) {
      itemId = await createSyncRunItem(supabase, syncRunId, source);
    }

    const result = await syncSource({
      supabase,
      source,
      dryRun: options.dryRun,
      syncRunId
    });

    if (!options.dryRun && itemId) {
      await finishSyncRunItem(supabase, itemId, result);
    }

    results.push({ source, result });
  }

  if (!options.dryRun && syncRunId) {
    const totals = sumResults(results.map((item) => item.result));
    await finishSyncRun(supabase, syncRunId, {
      ...totals,
      status: getRunStatus(results.map((item) => item.result))
    });
  }

  printSummary({
    dryRun: options.dryRun,
    syncRunId,
    results
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
