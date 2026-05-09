const fs = require("node:fs");
const path = require("node:path");

const discovery = require("../docs/google-sheets-discovery.json");

const appByFile = {
  DB_AppPlanta: { appName: "Planta de Concentrado", prefix: "planta", active: true },
  DB_AppClasificadora: {
    appName: "Clasificadora de Huevo",
    prefix: "clasificadora",
    active: true
  },
  DB_AppFacturas: { appName: "Facturas", prefix: "facturas", active: true },
  DB_AppGallinas: { appName: "Granjas de Postura", prefix: "gallinas", active: true },
  DB_AppGerencia: { appName: "Gerencia", prefix: "gerencia", active: true },
  DB_AppInventario: { appName: "Inventario General", prefix: "inventario", active: true },
  DB_AppMcds: { appName: "MCDS", prefix: "mcds", active: true },
  DB_AppMercadeo: { appName: "Mercadeo y Clientes", prefix: "mercadeo", active: true },
  "DB:AppPollo": { appName: "Pollos de Engorde", prefix: "pollo", active: false }
};

const excludedSpreadsheetNames = new Set(["Copia de DB_AppPlanta", "DB_Entradas"]);

const excludedSheetNames = new Set([
  "Hoja 2",
  "Hoja 4",
  "Hoja 7",
  "Hoja 10",
  "Traspasos",
  "EntradasHormiga",
  "OtrosGastos"
]);

function normalizeHeader(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sourceName(prefix, sheetName) {
  return `${prefix}_${normalizeHeader(sheetName)}`.replace(/_+/g, "_");
}

function detectPrimaryKey(headers) {
  return headers.find((header) => /id$/i.test(header)) || undefined;
}

function detectUpdatedAt(headers) {
  return (
    headers.find((header) => /^updatedat$/i.test(header)) ||
    headers.find((header) => /^marca\s*tiempo$/i.test(header)) ||
    headers.find((header) => /fecha/i.test(header)) ||
    undefined
  );
}

function isAttachmentColumn(header) {
  return /(foto|firma|pdf|imagen|rut|qr|archivo|certificado|guia|soporte|recibo|comprobante|ruta)/i.test(
    header
  );
}

function detectType(header) {
  if (/^marca\s*tiempo$/i.test(header)) return "datetime";
  if (/fecha/i.test(header)) return "date";
  if (/^(aceptablecondicion|autoriza|compraen|nosagregaron|contactado)$/i.test(header)) {
    return "boolean";
  }
  if (/id$/i.test(header)) return "text";
  if (/numero.*factura/i.test(header)) return "text";
  if (
    /(cantidad|valor|precio|total|kg|kgs|bulto|bultos|huevo|huevos|mortalidad|produccion|alimento|calcio|cisco|pago|iva|rete|retencion|saldo|costo|depreciacion|vida|paca|pacas|baches|bto|semana|dia|peso|mdv|gasto|compra|descuento|unidades|transporte|descargue|contador|utilidad|ingreso)/i.test(
      header
    )
  ) {
    return "number";
  }
  return "text";
}

const sources = [];

for (const spreadsheet of discovery.spreadsheets) {
  if (excludedSpreadsheetNames.has(spreadsheet.name)) {
    continue;
  }

  const app = appByFile[spreadsheet.name];
  if (!app) {
    continue;
  }

  for (const tab of spreadsheet.tabs || []) {
    const headers = (tab.headers || []).map((header) => String(header || "").trim()).filter(Boolean);
    if (headers.length === 0) continue;
    if (excludedSheetNames.has(tab.title)) continue;

    const primaryKeyColumn = detectPrimaryKey(headers);
    if (!primaryKeyColumn) continue;

    const sheetName = tab.title.toLowerCase();
    const isDraftOrCopySheet = sheetName.startsWith("copia de ") || sheetName.endsWith(" x");
    const columnMap = Object.fromEntries(headers.map((header) => [header, normalizeHeader(header)]));
    const typeMap = Object.fromEntries(headers.map((header) => [header, detectType(header)]));
    const attachmentColumns = headers.filter(isAttachmentColumn);
    const updatedAtColumn = detectUpdatedAt(headers);

    sources.push({
      sourceName: sourceName(app.prefix, tab.title),
      appName: app.appName,
      spreadsheetId: spreadsheet.id,
      sheetName: tab.title,
      targetTable: "raw_appsheet_records",
      primaryKeyColumn,
      ...(updatedAtColumn ? { updatedAtColumn } : {}),
      headerRow: 1,
      requiredColumns: [primaryKeyColumn],
      attachmentColumns,
      columnMap,
      typeMap,
      isActive: app.active && !isDraftOrCopySheet
    });
  }
}

sources.sort((a, b) => a.sourceName.localeCompare(b.sourceName));

const outPath = path.resolve(__dirname, "../src/sync/sources.generated.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");

console.log(`Generated ${sources.length} sources at ${outPath}`);
console.log(`Active sources: ${sources.filter((source) => source.isActive).length}`);
