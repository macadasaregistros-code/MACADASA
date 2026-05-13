import type {
  CashMonthly,
  DashboardData,
  DataQualityAlert,
  EggGradingDaily,
  FeedProductionDaily,
  FinanceMonthly,
  InventoryBalance,
  LayerLotSummary,
  ProcessHealth,
  StoreDaily
} from "./dashboardData";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(number);
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

function statusClass(status: string | null | undefined): string {
  if (status === "success") {
    return "is-ok";
  }

  if (status === "partial_success" || status === "running") {
    return "is-warn";
  }

  return "is-danger";
}

function renderMetric(label: string, value: string, detail: string, tone = ""): string {
  return `
    <section class="metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </section>
  `;
}

function renderRows<T>(rows: T[], emptyText: string, render: (row: T) => string): string {
  if (rows.length === 0) {
    return `<tr><td colspan="8" class="empty">${escapeHtml(emptyText)}</td></tr>`;
  }

  return rows.map(render).join("");
}

function renderAlertRows(alerts: DataQualityAlert[]): string {
  return renderRows(alerts, "Sin alertas activas", (alert) => `
    <tr>
      <td><span class="badge ${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span></td>
      <td>${escapeHtml(alert.area)}</td>
      <td>${escapeHtml(alert.alert_code)}</td>
      <td class="number">${formatNumber(alert.issue_count)}</td>
      <td>${escapeHtml(alert.detail)}</td>
    </tr>
  `);
}

function renderHealthRows(rows: ProcessHealth[]): string {
  return renderRows(rows, "Sin ejecuciones registradas", (row) => `
    <tr>
      <td>${escapeHtml(row.process_name)}</td>
      <td><span class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
      <td>${formatDateTime(row.finished_at ?? row.started_at)}</td>
      <td class="number">${formatNumber(row.records_processed)}</td>
      <td class="number">${formatNumber(row.records_failed)}</td>
    </tr>
  `);
}

function renderPostureRows(rows: LayerLotSummary[]): string {
  return renderRows(rows, "Sin lotes de postura", (row) => `
    <tr>
      <td>${escapeHtml(row.lot_name ?? row.lot_code)}</td>
      <td>${escapeHtml(row.poultry_house_name)}</td>
      <td class="number">${formatNumber(row.latest_week_number)}</td>
      <td class="number">${formatNumber(row.estimated_birds_alive)}</td>
      <td class="number">${formatNumber(row.total_egg_production_count)}</td>
      <td class="number">${formatNumber(row.total_mortality_pct, 2)}%</td>
    </tr>
  `);
}

function renderInventoryRows(rows: InventoryBalance[]): string {
  return renderRows(rows, "Sin saldos para mostrar", (row) => `
    <tr>
      <td>${escapeHtml(row.warehouse_name)}</td>
      <td>${escapeHtml(row.item_name ?? row.item_code)}</td>
      <td>${escapeHtml(row.lot_code ?? "-")}</td>
      <td class="number">${formatNumber(row.current_quantity, 2)}</td>
      <td>${formatDate(row.last_movement_date)}</td>
    </tr>
  `);
}

function renderFeedRows(rows: FeedProductionDaily[]): string {
  return renderRows(rows, "Sin produccion de planta", (row) => `
    <tr>
      <td>${formatDate(row.production_date)}</td>
      <td>${escapeHtml(row.formula_name ?? row.formula_code)}</td>
      <td>${escapeHtml(row.output_item_name)}</td>
      <td class="number">${formatNumber(row.production_orders_count)}</td>
      <td class="number">${formatNumber(row.practical_bags)}</td>
      <td class="number">${formatNumber(row.material_quantity_kg, 1)}</td>
    </tr>
  `);
}

function renderEggRows(rows: EggGradingDaily[]): string {
  return renderRows(rows, "Sin clasificacion de huevo", (row) => `
    <tr>
      <td>${formatDate(row.grading_date)}</td>
      <td>${escapeHtml(row.poultry_house_name)}</td>
      <td>${escapeHtml(row.item_name ?? row.item_code)}</td>
      <td>${escapeHtml(row.lot_code)}</td>
      <td class="number">${formatNumber(row.quantity)}</td>
    </tr>
  `);
}

function renderFinanceRows(rows: FinanceMonthly[]): string {
  return renderRows(rows, "Sin documentos financieros", (row) => `
    <tr>
      <td>${formatDate(row.month_start)}</td>
      <td>${escapeHtml(row.direction)}</td>
      <td>${escapeHtml(row.document_type)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td class="number">${formatNumber(row.documents_count)}</td>
      <td class="number">${formatCurrency(row.total_amount)}</td>
      <td class="number">${formatCurrency(row.open_amount)}</td>
    </tr>
  `);
}

function renderCashRows(rows: CashMonthly[]): string {
  return renderRows(rows, "Sin caja registrada", (row) => `
    <tr>
      <td>${formatDate(row.month_start)}</td>
      <td class="number">${formatCurrency(row.income_amount)}</td>
      <td class="number">${formatCurrency(row.expense_amount)}</td>
      <td class="number">${formatCurrency(row.net_cash_amount)}</td>
      <td class="number">${formatNumber(row.movements_count)}</td>
    </tr>
  `);
}

function renderStoreRows(rows: StoreDaily[]): string {
  return renderRows(rows, "Sin resumen de tienda", (row) => `
    <tr>
      <td>${formatDate(row.summary_date)}</td>
      <td class="number">${formatNumber(row.store_purchase_records)}</td>
      <td class="number">${formatNumber(row.stores_with_purchase_records)}</td>
      <td class="number">${formatNumber(row.store_purchase_quantity)}</td>
      <td class="number">${formatNumber(row.inventory_count_quantity)}</td>
      <td class="number">${formatNumber(row.chicken_weight_kg, 1)}</td>
    </tr>
  `);
}

function renderSection(id: string, title: string, subtitle: string, table: string, actionHtml = ""): string {
  return `
    <section class="panel" id="${escapeHtml(id)}">
      <div class="panel-heading">
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        ${actionHtml}
      </div>
      <div class="table-shell">
        ${table}
      </div>
    </section>
  `;
}

export function renderDashboard(data: DashboardData): string {
  const latestCashMonth = data.cash[0]?.month_start ? formatDate(data.cash[0].month_start) : "-";
  const latestStoreDate = data.store[0]?.summary_date ? formatDate(data.store[0].summary_date) : "-";

  const navItems = [
    ["Resumen", "top"],
    ["Postura", "postura"],
    ["Inventario", "inventario"],
    ["Planta", "planta"],
    ["Clasificadora", "clasificadora"],
    ["Finanzas", "finanzas"],
    ["Tienda", "tienda"],
    ["Alertas", "alertas"],
    ["Calidad", "/calidad"],
    ["Validacion", "/validacion"]
  ];

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#101820" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/assets/app.css" />
    <title>MACADASA Gerencia</title>
  </head>
  <body>
    <div class="app-shell" id="top">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <strong>MACADASA</strong>
            <small>Gerencia</small>
          </div>
        </div>
        <nav aria-label="Modulos">
          ${navItems
            .map(([label, href]) =>
              href.startsWith("/")
                ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
                : `<a href="#${escapeHtml(href)}">${escapeHtml(label)}</a>`
            )
            .join("")}
        </nav>
      </aside>

      <main class="content">
        <header class="topbar">
          <div>
            <h1>Panel gerencial</h1>
            <p>Actualizado ${formatDateTime(data.generatedAt)}</p>
          </div>
          <div class="actions">
            <a class="ghost-button" href="/calidad">Calidad</a>
            <a class="ghost-button" href="/validacion">Validacion</a>
            <a class="ghost-button" href="/api/dashboard-data">JSON</a>
          </div>
        </header>

        <section class="metrics-grid" aria-label="Indicadores principales">
          ${renderMetric("Alertas activas", formatNumber(data.metrics.activeAlerts), `${formatNumber(data.metrics.highAlerts)} altas`, data.metrics.highAlerts > 0 ? "tone-danger" : "")}
          ${renderMetric("Aves estimadas", formatNumber(data.metrics.estimatedBirdsAlive), "Postura activa")}
          ${renderMetric("Huevos acumulados", formatNumber(data.metrics.totalLayerEggs), "Registros de postura")}
          ${renderMetric("Inventario negativo", formatNumber(data.metrics.negativeInventoryItems), "Derivado de movimientos", data.metrics.negativeInventoryItems > 0 ? "tone-warn" : "")}
          ${renderMetric("Documentos vencidos", formatNumber(data.metrics.openOverdueDocuments), "Finanzas", data.metrics.openOverdueDocuments > 0 ? "tone-warn" : "")}
          ${renderMetric("Caja neta", formatCurrency(data.metrics.latestCashNet), latestCashMonth)}
          ${renderMetric("Compras tienda", formatNumber(data.metrics.latestStorePurchaseQuantity), latestStoreDate)}
        </section>

        <section class="grid-two">
          ${renderSection(
            "postura",
            "Postura por lote",
            "Aves, produccion y mortalidad acumulada",
            `<table>
              <thead><tr><th>Lote</th><th>Galpon</th><th>Semana</th><th>Aves</th><th>Huevos</th><th>Mortalidad</th></tr></thead>
              <tbody>${renderPostureRows(data.posture)}</tbody>
            </table>`,
            `<a class="ghost-button" href="/api/export/layer_lot_summary.csv">CSV</a>`
          )}
          ${renderSection(
            "alertas",
            "Alertas de datos",
            "Pendientes que afectan lectura gerencial",
            `<table>
              <thead><tr><th>Nivel</th><th>Area</th><th>Codigo</th><th>Cant.</th><th>Detalle</th></tr></thead>
              <tbody>${renderAlertRows(data.alerts)}</tbody>
            </table>`,
            `<div class="actions"><a class="ghost-button" href="/calidad">Ver</a><a class="ghost-button" href="/api/export/dashboard_alerts.csv">CSV</a></div>`
          )}
        </section>

        ${renderSection(
          "inventario",
          "Inventario actual",
          "Saldo derivado desde movimientos normalizados",
          `<table>
            <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Saldo</th><th>Ultimo mov.</th></tr></thead>
            <tbody>${renderInventoryRows(data.negativeInventory.length > 0 ? data.negativeInventory : data.inventory)}</tbody>
          </table>`,
          `<a class="ghost-button" href="/api/export/inventory_current.csv">CSV</a>`
        )}

        <section class="grid-two">
          ${renderSection(
            "planta",
            "Planta de concentrado",
            "Produccion diaria por formula",
            `<table>
              <thead><tr><th>Fecha</th><th>Formula</th><th>Producto</th><th>Ordenes</th><th>Bultos</th><th>Kg MP</th></tr></thead>
              <tbody>${renderFeedRows(data.feedProduction)}</tbody>
            </table>`,
            `<a class="ghost-button" href="/api/export/feed_production.csv">CSV</a>`
          )}
          ${renderSection(
            "clasificadora",
            "Clasificadora",
            "Clasificacion reciente por item",
            `<table>
              <thead><tr><th>Fecha</th><th>Galpon</th><th>Item</th><th>Lote</th><th>Cantidad</th></tr></thead>
              <tbody>${renderEggRows(data.eggGrading)}</tbody>
            </table>`,
            `<a class="ghost-button" href="/api/export/egg_grading.csv">CSV</a>`
          )}
        </section>

        <section class="grid-two">
          ${renderSection(
            "finanzas",
            "Finanzas documentales",
            "Documentos, pagos y saldo abierto",
            `<table>
              <thead><tr><th>Mes</th><th>Tipo</th><th>Doc.</th><th>Estado</th><th>Cant.</th><th>Total</th><th>Abierto</th></tr></thead>
              <tbody>${renderFinanceRows(data.financeDocuments)}</tbody>
            </table>`,
            `<a class="ghost-button" href="/api/export/finance_documents.csv">CSV</a>`
          )}
          ${renderSection(
            "caja",
            "Caja mensual",
            "Ingresos, gastos y neto",
            `<table>
              <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Neto</th><th>Mov.</th></tr></thead>
              <tbody>${renderCashRows(data.cash)}</tbody>
            </table>`
          )}
        </section>

        ${renderSection(
          "tienda",
          "Tienda y mercadeo",
          "Compras, conteos y pesaje de pollo",
          `<table>
            <thead><tr><th>Fecha</th><th>Compras</th><th>Tiendas</th><th>Cantidad</th><th>Inventario</th><th>Kg pollo</th></tr></thead>
            <tbody>${renderStoreRows(data.store)}</tbody>
          </table>`,
          `<a class="ghost-button" href="/api/export/store_daily.csv">CSV</a>`
        )}

        ${renderSection(
          "salud",
          "Sincronizacion y transformaciones",
          "Ultima ejecucion por proceso",
          `<table>
            <thead><tr><th>Proceso</th><th>Estado</th><th>Fecha</th><th>Procesados</th><th>Fallos</th></tr></thead>
            <tbody>${renderHealthRows(data.health)}</tbody>
          </table>`
        )}
      </main>
    </div>
    <script>
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/sw.js").catch(function () {});
      }
    </script>
  </body>
</html>`;
}

export function renderError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/assets/app.css" />
    <title>MACADASA Error</title>
  </head>
  <body>
    <main class="error-page">
      <h1>No se pudo cargar MACADASA</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}
