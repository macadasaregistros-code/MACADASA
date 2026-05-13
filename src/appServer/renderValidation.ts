import {
  recordToDisplayRow,
  type RawValidationRecordsResult,
  type RawValidationSource
} from "./rawValidationData";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("es-CO").format(Number(value ?? 0));
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

function sourceUrl(sourceName: string): string {
  return `/validacion/fuente?source=${encodeURIComponent(sourceName)}`;
}

function queryUrl(params: {
  page?: number;
  pageSize: number;
  query: string | null;
  sourceName: string;
}): string {
  const searchParams = new URLSearchParams({
    pageSize: String(params.pageSize),
    source: params.sourceName
  });

  if (params.page) {
    searchParams.set("page", String(params.page));
  }

  if (params.query) {
    searchParams.set("q", params.query);
  }

  return `/validacion/fuente?${searchParams.toString()}`;
}

function exportUrl(data: RawValidationRecordsResult): string {
  const searchParams = new URLSearchParams({
    source: data.source.source_name
  });

  if (data.query) {
    searchParams.set("q", data.query);
  }

  return `/api/validation/export.csv?${searchParams.toString()}`;
}

function renderShell(params: { body: string; subtitle: string; title: string }): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#101820" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/assets/app.css" />
    <title>MACADASA ${escapeHtml(params.title)}</title>
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <strong>MACADASA</strong>
            <small>Validacion</small>
          </div>
        </div>
        <nav aria-label="Modulos">
          <a href="/">Panel</a>
          <a href="/calidad">Calidad</a>
          <a href="/validacion">Validacion</a>
        </nav>
      </aside>

      <main class="content">
        <header class="topbar">
          <div>
            <h1>${escapeHtml(params.title)}</h1>
            <p>${escapeHtml(params.subtitle)}</p>
          </div>
          <div class="actions">
            <a class="ghost-button" href="/">Panel</a>
            <a class="ghost-button" href="/validacion">Fuentes</a>
          </div>
        </header>
        ${params.body}
      </main>
    </div>
  </body>
</html>`;
}

function renderSourceRows(sources: RawValidationSource[]): string {
  if (sources.length === 0) {
    return `<tr><td colspan="7" class="empty">Sin fuentes raw sincronizadas</td></tr>`;
  }

  return sources.map((source) => `
    <tr>
      <td>${escapeHtml(source.app_name)}</td>
      <td><a href="${sourceUrl(source.source_name)}">${escapeHtml(source.sheet_name)}</a></td>
      <td>${escapeHtml(source.source_name)}</td>
      <td class="number">${formatNumber(source.rows_count)}</td>
      <td class="number">${escapeHtml(source.first_source_row_number ?? "-")} - ${escapeHtml(source.last_source_row_number ?? "-")}</td>
      <td>${formatDateTime(source.latest_source_updated_at)}</td>
      <td>${formatDateTime(source.last_synced_at)}</td>
    </tr>
  `).join("");
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return escapeHtml(JSON.stringify(value));
  }

  return escapeHtml(value);
}

function renderRecordRows(data: RawValidationRecordsResult): string {
  if (data.records.length === 0) {
    return `<tr><td colspan="${data.fixedColumns.length + Math.max(data.columns.length, 1)}" class="empty">Sin filas para mostrar</td></tr>`;
  }

  return data.records.map((record) => {
    const row = recordToDisplayRow(record, data.columns);
    return `
      <tr>
        ${data.fixedColumns.map((column) => `<td>${renderValue(row[column])}</td>`).join("")}
        ${data.columns.map((column) => `<td>${renderValue(row[column])}</td>`).join("")}
      </tr>
    `;
  }).join("");
}

function renderPagination(data: RawValidationRecordsResult): string {
  const previousPage = data.page > 1 ? data.page - 1 : null;
  const nextPage = data.page < data.totalPages ? data.page + 1 : null;

  return `
    <div class="pagination">
      <span>Pagina ${formatNumber(data.page)} de ${formatNumber(data.totalPages)} - ${formatNumber(data.totalRows)} filas</span>
      <div class="actions">
        ${previousPage ? `<a class="ghost-button" href="${queryUrl({ page: previousPage, pageSize: data.pageSize, query: data.query, sourceName: data.source.source_name })}">Anterior</a>` : ""}
        ${nextPage ? `<a class="ghost-button" href="${queryUrl({ page: nextPage, pageSize: data.pageSize, query: data.query, sourceName: data.source.source_name })}">Siguiente</a>` : ""}
      </div>
    </div>
  `;
}

export function renderRawValidationSources(sources: RawValidationSource[]): string {
  const rowsCount = sources.reduce((total, source) => total + Number(source.rows_count ?? 0), 0);

  return renderShell({
    title: "Validacion raw",
    subtitle: `${formatNumber(sources.length)} fuentes - ${formatNumber(rowsCount)} filas`,
    body: `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Fuentes sincronizadas</h2>
            <p>Datos originales recibidos desde Google Sheets y AppSheet</p>
          </div>
        </div>
        <div class="table-shell">
          <table>
            <thead>
              <tr>
                <th>App</th>
                <th>Hoja</th>
                <th>Fuente</th>
                <th>Filas</th>
                <th>Rango</th>
                <th>Actualizado origen</th>
                <th>Sincronizado</th>
              </tr>
            </thead>
            <tbody>${renderSourceRows(sources)}</tbody>
          </table>
        </div>
      </section>
    `
  });
}

export function renderRawValidationRecords(data: RawValidationRecordsResult): string {
  return renderShell({
    title: data.source.sheet_name,
    subtitle: `${data.source.app_name} - ${data.source.source_name}`,
    body: `
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>Registros originales</h2>
            <p>${formatNumber(data.totalRows)} filas filtradas - actualizado ${formatDateTime(data.generatedAt)}</p>
          </div>
          <div class="actions">
            <a class="ghost-button" href="${exportUrl(data)}">CSV</a>
          </div>
        </div>
        <form class="filter-bar" method="get" action="/validacion/fuente">
          <input type="hidden" name="source" value="${escapeHtml(data.source.source_name)}" />
          <input name="q" value="${escapeHtml(data.query ?? "")}" placeholder="Buscar" />
          <select name="pageSize">
            ${[100, 250, 500].map((size) => `
              <option value="${size}" ${size === data.pageSize ? "selected" : ""}>${size}</option>
            `).join("")}
          </select>
          <button type="submit">Filtrar</button>
        </form>
        ${renderPagination(data)}
        <div class="table-shell raw-table-shell">
          <table>
            <thead>
              <tr>
                ${data.fixedColumns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
                ${data.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
              </tr>
            </thead>
            <tbody>${renderRecordRows(data)}</tbody>
          </table>
        </div>
        ${renderPagination(data)}
      </section>
    `
  });
}
