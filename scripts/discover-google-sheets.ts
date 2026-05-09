import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config } from "dotenv";
import {
  findDriveFoldersByName,
  listDriveFolderItems,
  listVisibleGoogleSheets,
  type DriveFile
} from "../src/lib/googleDriveClient";
import {
  getSpreadsheetMetadata,
  readSpreadsheetSampleValuesBatch
} from "../src/lib/googleSheetsClient";

config();

const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const GOOGLE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

type CliOptions = {
  folderId?: string;
  folderPath?: string;
  recursive: boolean;
  sampleRows: number;
  outputMarkdown: string;
  outputJson: string;
  help: boolean;
};

type DiscoveredSheetTab = {
  sheetId: number | null;
  title: string;
  index: number | null;
  rowCount: number | null;
  columnCount: number | null;
  headers: string[];
  sampleRows: unknown[][];
};

type DiscoveredSpreadsheet = {
  id: string;
  name: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  tabs: DiscoveredSheetTab[];
  error?: string;
};

type DiscoveryReport = {
  generatedAt: string;
  folderId: string | null;
  recursive: boolean;
  spreadsheetsFound: number;
  spreadsheets: DiscoveredSpreadsheet[];
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    folderPath: process.env.GOOGLE_DRIVE_FOLDER_PATH,
    recursive: true,
    sampleRows: 5,
    outputMarkdown: "docs/google-sheets-discovery.md",
    outputJson: "docs/google-sheets-discovery.json",
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--no-recursive") {
      options.recursive = false;
      continue;
    }

    if (arg === "--folder") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --folder.");
      }
      options.folderId = extractDriveFolderId(value);
      index += 1;
      continue;
    }

    if (arg === "--folder-path") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --folder-path.");
      }
      options.folderPath = normalizeFolderPath(value);
      index += 1;
      continue;
    }

    if (arg?.startsWith("--folder-path=")) {
      options.folderPath = normalizeFolderPath(arg.slice("--folder-path=".length));
      continue;
    }

    if (arg?.startsWith("--folder=")) {
      options.folderId = extractDriveFolderId(arg.slice("--folder=".length));
      continue;
    }

    if (arg === "--sample-rows") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --sample-rows.");
      }
      options.sampleRows = Number(value);
      index += 1;
      continue;
    }

    if (arg?.startsWith("--sample-rows=")) {
      options.sampleRows = Number(arg.slice("--sample-rows=".length));
      continue;
    }

    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --out.");
      }
      options.outputMarkdown = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--out=")) {
      options.outputMarkdown = arg.slice("--out=".length);
      continue;
    }

    if (arg === "--json") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --json.");
      }
      options.outputJson = value;
      index += 1;
      continue;
    }

    if (arg?.startsWith("--json=")) {
      options.outputJson = arg.slice("--json=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.sampleRows) || options.sampleRows < 1) {
    throw new Error("--sample-rows must be a positive integer.");
  }

  return options;
}

function printHelp(): void {
  console.log(`
Usage:
  npm run discover:sheets
  npm run discover:sheets -- --folder DRIVE_FOLDER_ID
  npm run discover:sheets -- --folder https://drive.google.com/drive/folders/DRIVE_FOLDER_ID
  npm run discover:sheets -- --folder-path "Appsheet/Mcds-Apps"
  npm run discover:sheets -- --folder DRIVE_FOLDER_ID --sample-rows 10
`);
}

function normalizeFolderPath(value: string): string {
  return value
    .replace(/^mi\s+unidad\s*[\\/]/i, "")
    .replace(/^my\s+drive\s*[\\/]/i, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

function extractDriveFolderId(value: string): string {
  const trimmedValue = value.trim();
  const folderMatch = trimmedValue.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) {
    return folderMatch[1];
  }

  return trimmedValue;
}

async function resolveFolderPath(folderPath: string): Promise<string> {
  const parts = normalizeFolderPath(folderPath)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error(`Invalid folder path: ${folderPath}`);
  }

  const leafName = parts[parts.length - 1];
  const candidates = await findDriveFoldersByName(leafName);

  if (candidates.length === 0) {
    throw new Error(
      `Could not find a shared Drive folder named "${leafName}". Share the folder with the Service Account or pass the folder URL/ID.`
    );
  }

  if (candidates.length > 1) {
    const candidateList = candidates.map((folder) => `${folder.name} (${folder.id})`).join(", ");
    throw new Error(
      `Found multiple folders named "${leafName}". Pass the exact folder URL/ID. Candidates: ${candidateList}`
    );
  }

  return candidates[0].id;
}

async function collectFolderSheets(params: {
  folderId: string;
  recursive: boolean;
  visitedFolderIds?: Set<string>;
}): Promise<DriveFile[]> {
  const visitedFolderIds = params.visitedFolderIds ?? new Set<string>();

  if (visitedFolderIds.has(params.folderId)) {
    return [];
  }

  visitedFolderIds.add(params.folderId);

  const items = await listDriveFolderItems(params.folderId);
  const spreadsheets = items.filter((item) => item.mimeType === GOOGLE_SHEET_MIME_TYPE);

  if (!params.recursive) {
    return spreadsheets;
  }

  const folders = items.filter((item) => item.mimeType === GOOGLE_FOLDER_MIME_TYPE);
  const nestedSpreadsheets = (
    await Promise.all(
      folders.map((folder) =>
        collectFolderSheets({
          folderId: folder.id,
          recursive: params.recursive,
          visitedFolderIds
        })
      )
    )
  ).flat();

  return [...spreadsheets, ...nestedSpreadsheets];
}

function uniqueFilesById(files: DriveFile[]): DriveFile[] {
  const map = new Map<string, DriveFile>();

  for (const file of files) {
    map.set(file.id, file);
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverSpreadsheet(
  file: DriveFile,
  sampleRows: number
): Promise<DiscoveredSpreadsheet> {
  try {
    const metadata = await getSpreadsheetMetadata({ spreadsheetId: file.id });
    const sheetNames = (metadata.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title));
    const sampleValuesBySheetName = await readSpreadsheetSampleValuesBatch({
      spreadsheetId: file.id,
      sheetNames,
      rows: sampleRows
    });
    const tabs = (metadata.sheets ?? []).map((sheet) => {
        const properties = sheet.properties;
        const title = properties?.title ?? "Untitled";
        const sampleValues = sampleValuesBySheetName.get(title) ?? [];

        return {
          sheetId: properties?.sheetId ?? null,
          title,
          index: properties?.index ?? null,
          rowCount: properties?.gridProperties?.rowCount ?? null,
          columnCount: properties?.gridProperties?.columnCount ?? null,
          headers: (sampleValues[0] ?? []).map((header) => String(header ?? "").trim()),
          sampleRows: sampleValues.slice(1)
        };
      });

    return {
      id: file.id,
      name: metadata.properties?.title ?? file.name,
      webViewLink: file.webViewLink ?? metadata.spreadsheetUrl ?? null,
      modifiedTime: file.modifiedTime ?? null,
      tabs
    };
  } catch (error) {
    return {
      id: file.id,
      name: file.name,
      webViewLink: file.webViewLink ?? null,
      modifiedTime: file.modifiedTime ?? null,
      tabs: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function formatMarkdown(report: DiscoveryReport): string {
  const lines: string[] = [
    "# Google Sheets Discovery",
    "",
    `Generated at: ${report.generatedAt}`,
    `Folder ID: ${report.folderId ?? "all visible spreadsheets"}`,
    `Recursive: ${report.recursive ? "yes" : "no"}`,
    `Spreadsheets found: ${report.spreadsheetsFound}`,
    ""
  ];

  for (const spreadsheet of report.spreadsheets) {
    lines.push(`## ${spreadsheet.name}`, "");
    lines.push(`- Spreadsheet ID: \`${spreadsheet.id}\``);
    if (spreadsheet.webViewLink) {
      lines.push(`- URL: ${spreadsheet.webViewLink}`);
    }
    if (spreadsheet.modifiedTime) {
      lines.push(`- Modified: ${spreadsheet.modifiedTime}`);
    }
    if (spreadsheet.error) {
      lines.push(`- Error: ${spreadsheet.error}`, "");
      continue;
    }

    lines.push(`- Tabs: ${spreadsheet.tabs.length}`, "");

    for (const tab of spreadsheet.tabs) {
      lines.push(`### ${tab.title}`, "");
      lines.push(`- Sheet ID: ${tab.sheetId ?? "unknown"}`);
      lines.push(`- Rows: ${tab.rowCount ?? "unknown"}`);
      lines.push(`- Columns: ${tab.columnCount ?? "unknown"}`);
      lines.push(
        `- Headers: ${
          tab.headers.length > 0
            ? tab.headers.map((header) => `\`${header || "(blank)"}\``).join(", ")
            : "none detected"
        }`
      );
      lines.push("");
    }
  }

  return `${lines.join("\n")}\n`;
}

async function writeTextFile(path: string, contents: string): Promise<void> {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const folderId = options.folderId ?? (options.folderPath ? await resolveFolderPath(options.folderPath) : undefined);

  const files = folderId
    ? await collectFolderSheets({
        folderId,
        recursive: options.recursive
      })
    : await listVisibleGoogleSheets();

  const spreadsheets = await Promise.all(
    uniqueFilesById(files).map((file) => discoverSpreadsheet(file, options.sampleRows))
  );

  const report: DiscoveryReport = {
    generatedAt: new Date().toISOString(),
    folderId: folderId ?? null,
    recursive: options.recursive,
    spreadsheetsFound: spreadsheets.length,
    spreadsheets
  };

  await writeTextFile(options.outputMarkdown, formatMarkdown(report));
  await writeTextFile(options.outputJson, JSON.stringify(report, null, 2));

  console.log(`Discovered ${spreadsheets.length} Google Sheets.`);
  console.log(`Markdown report: ${resolve(options.outputMarkdown)}`);
  console.log(`JSON report: ${resolve(options.outputJson)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
