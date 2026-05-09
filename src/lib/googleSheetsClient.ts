import { google, type sheets_v4 } from "googleapis";
import { config } from "dotenv";

config();

let cachedSheetsClient: sheets_v4.Sheets | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Configure it in .env or in the server runtime.`
    );
  }

  return value;
}

export function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

export function getGoogleSheetsClient(): sheets_v4.Sheets {
  if (cachedSheetsClient) {
    return cachedSheetsClient;
  }

  const email = getRequiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = getRequiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  cachedSheetsClient = google.sheets({ version: "v4", auth });
  return cachedSheetsClient;
}

export async function readSheetValues(params: {
  spreadsheetId: string;
  sheetName: string;
}): Promise<unknown[][]> {
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: params.spreadsheetId,
    range: quoteSheetName(params.sheetName),
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  return (response.data.values ?? []) as unknown[][];
}

export async function getSpreadsheetMetadata(params: {
  spreadsheetId: string;
}): Promise<sheets_v4.Schema$Spreadsheet> {
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: params.spreadsheetId,
    fields:
      "spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))"
  });

  return response.data;
}

export async function readSheetSampleValues(params: {
  spreadsheetId: string;
  sheetName: string;
  rows?: number;
}): Promise<unknown[][]> {
  const sheets = getGoogleSheetsClient();
  const rows = params.rows ?? 5;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: params.spreadsheetId,
    range: `${quoteSheetName(params.sheetName)}!1:${rows}`,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  return (response.data.values ?? []) as unknown[][];
}

export async function readSpreadsheetSampleValuesBatch(params: {
  spreadsheetId: string;
  sheetNames: string[];
  rows?: number;
}): Promise<Map<string, unknown[][]>> {
  const sheets = getGoogleSheetsClient();
  const rows = params.rows ?? 5;
  const ranges = params.sheetNames.map((sheetName) => `${quoteSheetName(sheetName)}!1:${rows}`);
  const samples = new Map<string, unknown[][]>();

  if (ranges.length === 0) {
    return samples;
  }

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: params.spreadsheetId,
    ranges,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  for (const valueRange of response.data.valueRanges ?? []) {
    const range = valueRange.range ?? "";
    const sheetName = range.startsWith("'")
      ? range.slice(1, range.indexOf("'!"))
      : range.split("!")[0] ?? "";
    const unescapedSheetName = sheetName.replace(/''/g, "'");
    samples.set(unescapedSheetName, (valueRange.values ?? []) as unknown[][]);
  }

  return samples;
}
