import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkArray, normalizeHeader, safeDateParser, safeNumberParser } from "../sync/utils";

export type JsonRecord = Record<string, unknown>;

export type RawAppSheetRecord = {
  id: string;
  source_uid: string;
  source_name: string;
  app_name: string;
  spreadsheet_id: string;
  sheet_name: string;
  source_primary_key: string | null;
  row_hash: string;
  raw_data: JsonRecord;
  normalized_data: JsonRecord;
  source_updated_at: string | null;
  last_synced_at: string | null;
};

const RAW_RECORD_SELECT =
  "id,source_uid,source_name,app_name,spreadsheet_id,sheet_name,source_primary_key,row_hash,raw_data,normalized_data,source_updated_at,last_synced_at";

export function asText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function asLowerText(value: unknown): string | null {
  const text = asText(value);
  return text ? text.toLowerCase() : null;
}

export function asNumber(value: unknown): number | null {
  return safeNumberParser(value);
}

export function asBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }

  const normalized = normalizeHeader(String(value));
  if (["true", "si", "s", "yes", "y", "1", "activo", "activa", "x"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "n", "0", "inactivo", "inactiva"].includes(normalized)) {
    return false;
  }

  return null;
}

export function asDateOnly(value: unknown): string | null {
  const parsed = safeDateParser(value);
  return parsed ? parsed.slice(0, 10) : null;
}

export function getField(row: JsonRecord, ...fieldNames: string[]): unknown {
  for (const fieldName of fieldNames) {
    if (Object.prototype.hasOwnProperty.call(row, fieldName)) {
      return row[fieldName];
    }
  }

  return undefined;
}

export function slugify(value: unknown): string {
  const text = asText(value) ?? "sin_nombre";
  const slug = normalizeHeader(text);
  return slug.length > 0 ? slug : "sin_nombre";
}

export function masterCode(prefix: string, rawId: unknown): string | null {
  const id = asText(rawId);
  return id ? `${prefix}:${id}` : null;
}

export function derivedVaccinationItemName(row: JsonRecord): string | null {
  return (
    asText(getField(row, "nombrecomercial")) ??
    asText(getField(row, "observacion")) ??
    asText(getField(row, "cepas"))
  );
}

export function derivedVaccinationItemCode(row: JsonRecord): string | null {
  const name = derivedVaccinationItemName(row);
  return name ? masterCode("vacuna", slugify(name)) : null;
}

export function splitMultiValue(value: unknown): string[] {
  const text = asText(value);
  if (!text) {
    return [];
  }

  return text
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function compactRecord(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function mergeMetadata(...records: Array<JsonRecord | undefined>): JsonRecord {
  return Object.assign({}, ...records.filter(Boolean));
}

export function businessUnitCodeForAppName(appName: string): string {
  switch (appName) {
    case "Planta de Concentrado":
      return "planta_concentrado";
    case "Granjas de Postura":
      return "granja_postura";
    case "Clasificadora de Huevo":
      return "clasificadora_huevo";
    case "MCDS":
      return "mcds_tienda";
    case "Mercadeo y Clientes":
      return "mercadeo_clientes";
    case "Inventario General":
      return "inventario_general";
    case "Facturas":
      return "costos_finanzas";
    case "Gerencia":
      return "gerencia";
    default:
      return "gerencia";
  }
}

export function inferEmail(value: unknown): string | null {
  const text = asLowerText(value);
  if (!text || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    return null;
  }

  return text;
}

export function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export async function fetchRawRecordsBySourceNames(
  supabase: SupabaseClient,
  sourceNames: string[]
): Promise<RawAppSheetRecord[]> {
  const uniqueSourceNames = [...new Set(sourceNames)].filter(Boolean).sort();
  const records: RawAppSheetRecord[] = [];

  for (const sourceChunk of chunkArray(uniqueSourceNames, 25)) {
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from("raw_appsheet_records")
        .select(RAW_RECORD_SELECT)
        .in("source_name", sourceChunk)
        .order("source_name", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw new Error(`Error leyendo raw_appsheet_records: ${error.message}`);
      }

      const page = (data ?? []) as RawAppSheetRecord[];
      records.push(...page);

      if (page.length < pageSize) {
        break;
      }

      from += pageSize;
    }
  }

  return records;
}

export function sourcePrimaryKey(record: RawAppSheetRecord): string {
  return record.source_primary_key ?? record.source_uid;
}

export function rawLineageMetadata(record: RawAppSheetRecord): JsonRecord {
  return {
    raw_record_id: record.id,
    source_uid: record.source_uid,
    source_name: record.source_name,
    app_name: record.app_name,
    spreadsheet_id: record.spreadsheet_id,
    sheet_name: record.sheet_name,
    source_primary_key: record.source_primary_key,
    source_updated_at: record.source_updated_at,
    raw_row_hash: record.row_hash
  };
}
