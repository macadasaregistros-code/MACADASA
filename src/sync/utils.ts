import { createHash } from "node:crypto";
import type { SheetColumnType } from "./sources.config";

export type ParsedSheetRow = {
  rowNumber: number;
  rawData: Record<string, unknown>;
};

export type ParsedSheetRows = {
  headers: string[];
  rows: ParsedSheetRow[];
};

export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRawCell(value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  return value;
}

function isEmptyCell(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim().length === 0;
}

export function parseSheetRows(values: unknown[][], headerRow = 1): ParsedSheetRows {
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new Error(`headerRow must be a positive 1-based row number. Received ${headerRow}.`);
  }

  const headerIndex = headerRow - 1;
  const headerValues = values[headerIndex];

  if (!headerValues) {
    throw new Error(`Header row ${headerRow} was not found in the sheet response.`);
  }

  const headers = headerValues.map((cell) => String(cell ?? "").trim());
  const rows: ParsedSheetRow[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex] ?? [];

    if (row.every(isEmptyCell)) {
      continue;
    }

    const rawData: Record<string, unknown> = {};

    headers.forEach((header, cellIndex) => {
      if (!header) {
        return;
      }

      rawData[header] = normalizeRawCell(row[cellIndex]);
    });

    rows.push({
      rowNumber: rowIndex + 1,
      rawData
    });
  }

  return { headers: headers.filter((header) => header.length > 0), rows };
}

export function safeNumberParser(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const cleaned = raw.replace(/[^\d,.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === ",") {
    return null;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized = cleaned;

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    const decimals = cleaned.length - lastComma - 1;
    normalized = decimals > 0 && decimals <= 2 ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (lastDot > -1) {
    const decimals = cleaned.length - lastDot - 1;
    normalized = decimals === 3 ? cleaned.replace(/\./g, "") : cleaned;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateFromSerialNumber(serialNumber: number): Date | null {
  if (!Number.isFinite(serialNumber) || serialNumber < 1 || serialNumber > 100000) {
    return null;
  }

  const utcDays = Math.floor(serialNumber - 25569);
  const utcValue = utcDays * 86400;
  const fractionalDay = serialNumber - Math.floor(serialNumber);
  const totalSeconds = Math.round(utcValue + fractionalDay * 86400);
  const date = new Date(totalSeconds * 1000);

  return Number.isNaN(date.getTime()) ? null : date;
}

function buildUtcDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date | null {
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function safeDateParser(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "number") {
    return dateFromSerialNumber(value)?.toISOString() ?? null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.length <= 8) {
    const serialDate = dateFromSerialNumber(numeric);
    if (serialDate) {
      return serialDate.toISOString();
    }
  }

  const ymdMatch = raw.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (ymdMatch) {
    const [, year, month, day, hour, minute, second] = ymdMatch;
    const parsed = buildUtcDate(
      Number(year),
      Number(month),
      Number(day),
      Number(hour ?? 0),
      Number(minute ?? 0),
      Number(second ?? 0)
    );
    return parsed?.toISOString() ?? null;
  }

  const dmyMatch = raw.match(
    /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (dmyMatch) {
    const [, day, month, yearRaw, hour, minute, second] = dmyMatch;
    const yearNumber = Number(yearRaw);
    const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
    const parsed = buildUtcDate(
      year,
      Number(month),
      Number(day),
      Number(hour ?? 0),
      Number(minute ?? 0),
      Number(second ?? 0)
    );
    return parsed?.toISOString() ?? null;
  }

  const parsedByRuntime = new Date(raw);
  return Number.isNaN(parsedByRuntime.getTime()) ? null : parsedByRuntime.toISOString();
}

function safeBooleanParser(value: unknown): boolean | null {
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
    return null;
  }

  const normalized = normalizeHeader(String(value));

  if (["true", "yes", "y", "si", "s", "1", "activo", "activa", "x"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "n", "0", "inactivo", "inactiva"].includes(normalized)) {
    return false;
  }

  return null;
}

export function normalizeValueByType(value: unknown, type: SheetColumnType = "text"): unknown {
  if (value === undefined || value === null || String(value).trim().length === 0) {
    return null;
  }

  switch (type) {
    case "number":
      return safeNumberParser(value);
    case "date": {
      const parsed = safeDateParser(value);
      return parsed ? parsed.slice(0, 10) : null;
    }
    case "datetime":
      return safeDateParser(value);
    case "boolean":
      return safeBooleanParser(value);
    case "json":
      if (typeof value !== "string") {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch {
        return value.trim();
      }
    case "string":
    case "text":
    default:
      return String(value).trim();
  }
}

export function normalizeRow(
  row: Record<string, unknown>,
  columnMap: Record<string, string> = {},
  typeMap: Partial<Record<string, SheetColumnType>> = {}
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [sourceColumn, value] of Object.entries(row)) {
    const targetColumn = columnMap[sourceColumn] ?? normalizeHeader(sourceColumn);
    const columnType = typeMap[sourceColumn] ?? "text";
    normalized[targetColumn] = normalizeValueByType(value, columnType);
  }

  return normalized;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function createRowHash(row: unknown): string {
  return createHash("sha256").update(stableStringify(row)).digest("hex");
}

export function buildSourceUid(params: {
  appName: string;
  spreadsheetId: string;
  sheetName: string;
  primaryKeyValue?: unknown;
  rowNumber?: number;
}): string {
  const primaryKey =
    params.primaryKeyValue === undefined ||
    params.primaryKeyValue === null ||
    String(params.primaryKeyValue).trim().length === 0
      ? `row:${params.rowNumber ?? "unknown"}`
      : `pk:${String(params.primaryKeyValue).trim()}`;

  return [params.appName, params.spreadsheetId, params.sheetName, primaryKey]
    .map((value) => String(value).trim())
    .join("::");
}

export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer. Received ${chunkSize}.`);
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}
