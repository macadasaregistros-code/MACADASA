import type {
  QualityData,
  QualityMissingVaccinationItem,
  QualityNegativeInventory,
  QualityOverdueDocument,
  QualityUnpromotedAttachment
} from "./qualityData";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(Number(value ?? 0));
}

function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO", {
    currency: "COP",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(Number(value ?? 0));
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota"
  }).format(new Date(value));
}

function renderRows<T>(rows: T[], emptyText: string, render: (row: T) => string): string {
  if (rows.length === 0) {
    return `<tr><td colspan="10" class="empty">${escapeHtml(emptyText)}</td></tr>`;
  }

  return rows.map(render).join("");
}

function renderSection(
  title: string,
  subtitle: string,
  exportKey: string,
  table: string,
  extraActionHtml = ""
): string {
  return `
    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <div class="actions">
          ${extraActionHtml}
          <a class="ghost-button" href="/api/export/${escapeHtml(exportKey)}.csv">CSV</a>
        </div>
      </div>
      <div class="table-shell">${table}</div>
    </section>
  `;
}

function renderNegativeInventoryRows(rows: QualityNegativeInventory[]): string {
  return renderRows(rows, "Sin saldos negativos", (row) => `
    <tr>
      <td>${escapeHtml(row.warehouse_name)}</td>
      <td>${escapeHtml(row.item_name ?? row.item_code)}</td>
      <td>${escapeHtml(row.lot_code ?? "-")}</td>
      <td class="number">${formatNumber(row.current_quantity, 2)}</td>
      <td class="number">${formatNumber(row.total_in_quantity, 2)}</td>
      <td class="number">${formatNumber(row.total_out_quantity, 2)}</td>
      <td>${formatDate(row.last_movement_date)}</td>
    </tr>
  `);
}

function renderOverdueRows(rows: QualityOverdueDocument[]): string {
  return renderRows(rows, "Sin documentos vencidos", (row) => `
    <tr>
      <td>${formatDate(row.due_date)}</td>
      <td>${escapeHtml(row.third_party_name)}</td>
      <td>${escapeHtml(row.document_number)}</td>
      <td>${escapeHtml(row.document_type)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td class="number">${formatCurrency(row.total_amount)}</td>
      <td class="number">${formatCurrency(row.open_amount)}</td>
    </tr>
  `);
}

function renderMissingVaccinationRows(rows: QualityMissingVaccinationItem[]): string {
  return renderRows(rows, "Sin vacunaciones pendientes de item", (row) => `
    <tr>
      <td>${formatDate(row.vaccination_date)}</td>
      <td>${escapeHtml(row.lot_code)}</td>
      <td>${escapeHtml(row.poultry_house_name)}</td>
      <td>${escapeHtml(row.category_name ?? row.category_code)}</td>
      <td>${escapeHtml(row.commercial_name ?? row.notes)}</td>
      <td>${escapeHtml(row.source_uid)}</td>
    </tr>
  `);
}

function renderAttachmentRows(rows: QualityUnpromotedAttachment[]): string {
  return renderRows(rows, "Sin adjuntos raw pendientes", (row) => `
    <tr>
      <td>${escapeHtml(row.source_name)}</td>
      <td>${escapeHtml(row.source_primary_key)}</td>
      <td>${escapeHtml(row.column_name)}</td>
      <td>${escapeHtml(row.file_ref)}</td>
      <td>${escapeHtml(row.file_kind)}</td>
      <td>${formatDateTime(row.created_at)}</td>
    </tr>
  `);
}

export function renderQuality(data: QualityData): string {
  const totalIssues =
    data.negativeInventory.length +
    data.overdueDocuments.length +
    data.missingVaccinationItems.length +
    data.unpromotedAttachments.length;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#101820" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/assets/app.css" />
    <title>MACADASA Calidad de datos</title>
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <strong>MACADASA</strong>
            <small>Calidad</small>
          </div>
        </div>
        <nav aria-label="Modulos">
          <a href="/">Panel</a>
          <a href="#inventario">Inventario</a>
          <a href="#finanzas">Finanzas</a>
          <a href="#postura">Postura</a>
          <a href="#adjuntos">Adjuntos</a>
        </nav>
      </aside>

      <main class="content">
        <header class="topbar">
          <div>
            <h1>Calidad de datos</h1>
            <p>${formatNumber(totalIssues)} pendientes detectados. Actualizado ${formatDateTime(data.generatedAt)}</p>
          </div>
          <a class="ghost-button" href="/api/quality-data">JSON</a>
        </header>

        <section class="metrics-grid compact">
          <section class="metric tone-warn">
            <span>Inventario negativo</span>
            <strong>${formatNumber(data.negativeInventory.length)}</strong>
            <small>Items por bodega</small>
          </section>
          <section class="metric tone-warn">
            <span>Documentos vencidos</span>
            <strong>${formatNumber(data.overdueDocuments.length)}</strong>
            <small>Saldo abierto</small>
          </section>
          <section class="metric">
            <span>Vacunas sin item</span>
            <strong>${formatNumber(data.missingVaccinationItems.length)}</strong>
            <small>Completar maestro</small>
          </section>
          <section class="metric">
            <span>Adjuntos pendientes</span>
            <strong>${formatNumber(data.unpromotedAttachments.length)}</strong>
            <small>Revisar trazabilidad</small>
          </section>
        </section>

        <div id="inventario">
          ${renderSection(
            "Inventario negativo",
            "Saldos derivados desde movimientos normalizados",
            "negative_inventory",
            `<table>
              <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Saldo</th><th>Entradas</th><th>Salidas</th><th>Ultimo mov.</th></tr></thead>
              <tbody>${renderNegativeInventoryRows(data.negativeInventory)}</tbody>
            </table>`,
            `<a class="ghost-button" href="/api/export/negative_inventory_movements.csv">Movimientos</a>`
          )}
        </div>

        <div id="finanzas">
          ${renderSection(
            "Documentos financieros vencidos",
            "Facturas abiertas con fecha vencida",
            "overdue_documents",
            `<table>
              <thead><tr><th>Vence</th><th>Tercero</th><th>Documento</th><th>Tipo</th><th>Estado</th><th>Total</th><th>Abierto</th></tr></thead>
              <tbody>${renderOverdueRows(data.overdueDocuments)}</tbody>
            </table>`
          )}
        </div>

        <div id="postura">
          ${renderSection(
            "Vacunaciones sin item",
            "Registros que necesitan asociar vacuna o item",
            "missing_vaccination_items",
            `<table>
              <thead><tr><th>Fecha</th><th>Lote</th><th>Galpon</th><th>Categoria</th><th>Detalle</th><th>Origen</th></tr></thead>
              <tbody>${renderMissingVaccinationRows(data.missingVaccinationItems)}</tbody>
            </table>`
          )}
        </div>

        <div id="adjuntos">
          ${renderSection(
            "Adjuntos raw no promovidos",
            "Archivos detectados sin referencia limpia",
            "unpromoted_attachments",
            `<table>
              <thead><tr><th>Fuente</th><th>PK</th><th>Columna</th><th>Archivo</th><th>Tipo</th><th>Creado</th></tr></thead>
              <tbody>${renderAttachmentRows(data.unpromotedAttachments)}</tbody>
            </table>`
          )}
        </div>
      </main>
    </div>
  </body>
</html>`;
}
