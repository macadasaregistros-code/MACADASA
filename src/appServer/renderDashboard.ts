import type {
  CashMonthly,
  DashboardData,
  DataQualityAlert,
  DailySales,
  EggGradingDaily,
  FeedCostMonthly,
  FeedProductionDaily,
  FinanceMonthly,
  InventoryBalance,
  LayerDailyKpi,
  LayerLotSummary,
  PlantActivity,
  ProcessHealth,
  StoreDaily,
  VaccinationTimeline
} from "./dashboardData";

export type DashboardModule = "resumen" | "planta" | "gallinas" | "macadasa" | "inventario";

type UiIcon =
  | "summary"
  | "plant"
  | "hens"
  | "macadasa"
  | "inventory"
  | "raw"
  | "in"
  | "production"
  | "out"
  | "cost";

const dashboardModules: Array<{
  id: DashboardModule;
  label: string;
  detail: string;
  icon: UiIcon;
}> = [
  { id: "resumen", label: "RESUMEN", detail: "Gerencia", icon: "summary" },
  { id: "planta", label: "PLANTA", detail: "Costo y movimientos", icon: "plant" },
  { id: "gallinas", label: "GALLINAS", detail: "Postura y clasificadora", icon: "hens" },
  { id: "macadasa", label: "MACADASA", detail: "Finanzas, caja y ventas", icon: "macadasa" },
  { id: "inventario", label: "INVENTARIO", detail: "Comida y huevo", icon: "inventory" }
];

export function resolveDashboardModule(value: string | null | undefined): DashboardModule {
  const normalized = String(value ?? "").toLowerCase();
  return dashboardModules.some((module) => module.id === normalized)
    ? (normalized as DashboardModule)
    : "resumen";
}

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

function formatPercent(value: number | null | undefined, digits = 1): string {
  const number = Number(value ?? 0);
  const normalized = Math.abs(number) <= 1 && number !== 0 ? number * 100 : number;

  return `${formatNumber(normalized, digits)}%`;
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

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function containsAny(value: string | null | undefined, words: string[]): boolean {
  const normalized = normalizeText(value);
  return words.some((word) => normalized.includes(word));
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

function renderUiIcon(name: UiIcon, className = "ui-icon"): string {
  const paths: Record<UiIcon, string> = {
    summary:
      '<path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z"></path>',
    plant:
      '<path d="M5 20V9l7-4 7 4v11"></path><path d="M8 20v-6h8v6"></path><path d="M10 9h4"></path>',
    hens:
      '<path d="M7 17c-2-1-3-3-3-5 0-4 3-7 7-7 3 0 6 2 7 5l2 1-2 2c0 4-3 7-7 7-2 0-3-1-4-3Z"></path><path d="M9 9h.01"></path><path d="M13 20v2"></path>',
    macadasa:
      '<path d="M4 19V5"></path><path d="M4 19h16"></path><path d="M8 15l3-4 3 2 4-7"></path>',
    inventory:
      '<path d="M4 7l8-4 8 4-8 4-8-4Z"></path><path d="M4 7v10l8 4 8-4V7"></path><path d="M12 11v10"></path>',
    raw:
      '<path d="M12 3c4 3 6 6 6 10a6 6 0 0 1-12 0c0-4 2-7 6-10Z"></path><path d="M12 8v9"></path>',
    in:
      '<path d="M12 3v12"></path><path d="M7 10l5 5 5-5"></path><path d="M5 21h14"></path>',
    production:
      '<path d="M4 20V9l5 3V9l5 3V7h6v13H4Z"></path><path d="M8 16h2"></path><path d="M13 16h2"></path>',
    out:
      '<path d="M12 21V9"></path><path d="M7 14l5-5 5 5"></path><path d="M5 3h14"></path>',
    cost:
      '<path d="M12 2v20"></path><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"></path>'
  };

  return `<svg class="${escapeHtml(className)}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
}

function renderItemIcon(params: {
  item_icon_url?: string | null;
  item_icon_label?: string | null;
  item_type?: string | null;
}): string {
  const label = escapeHtml(params.item_icon_label ?? "IT");
  const typeClass = params.item_type ? ` item-icon-${escapeHtml(params.item_type)}` : "";
  const iconByType: Record<string, UiIcon> = {
    raw_material: "raw",
    feed: "production",
    egg: "hens",
    medicine: "cost",
    packaging: "inventory"
  };
  const fallbackIcon = renderUiIcon(
    params.item_type ? iconByType[params.item_type] ?? "inventory" : "inventory",
    "ui-icon item-type-svg"
  );
  const image = params.item_icon_url
    ? `<img src="${escapeHtml(params.item_icon_url)}" alt="" loading="lazy" onerror="this.remove()" />`
    : "";

  return `
    <span class="item-icon${typeClass}" aria-hidden="true">
      <span class="item-icon-symbol">${fallbackIcon}</span>
      <span class="item-icon-label">${label}</span>
      ${image}
    </span>
  `;
}

function renderItemIdentity(row: {
  item_name?: string | null;
  item_code?: string | null;
  item_type?: string | null;
  item_icon_url?: string | null;
  item_icon_label?: string | null;
}): string {
  return `
    <span class="item-identity">
      ${renderItemIcon(row)}
      <span>
        <strong>${escapeHtml(row.item_name ?? row.item_code ?? "Item")}</strong>
        <small>${escapeHtml(row.item_code ?? row.item_type ?? "")}</small>
      </span>
    </span>
  `;
}

function renderSheetIntro(title: string, subtitle: string): string {
  return `
    <section class="sheet-intro">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(subtitle)}</p>
      </div>
    </section>
  `;
}

function renderRows<T>(rows: T[], emptyText: string, render: (row: T) => string): string {
  if (rows.length === 0) {
    return `<tr><td colspan="12" class="empty">${escapeHtml(emptyText)}</td></tr>`;
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
      <td class="number">${formatPercent(row.avg_reported_pp)}</td>
      <td class="number">${formatNumber(row.total_mortality_pct, 2)}%</td>
    </tr>
  `);
}

function renderInventoryRows(rows: InventoryBalance[]): string {
  return renderRows(rows, "Sin saldos para mostrar", (row) => `
    <tr>
      <td>${escapeHtml(row.warehouse_name)}</td>
      <td>${renderItemIdentity(row)}</td>
      <td>${escapeHtml(row.lot_code ?? "-")}</td>
      <td class="number">${formatNumber(row.total_in_quantity, 2)}</td>
      <td class="number">${formatNumber(row.total_out_quantity, 2)}</td>
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
      <td class="number">${formatNumber(row.output_quantity_kg, 1)}</td>
      <td class="number">${formatNumber(row.material_quantity_kg, 1)}</td>
      <td class="number">${formatNumber(materialKgPerBag(row), 2)}</td>
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

function materialKgPerBag(row: FeedProductionDaily): number {
  return Number(row.material_quantity_kg ?? 0) / Math.max(Number(row.practical_bags ?? 0), 1);
}

function costPerBag(cost: FeedCostMonthly | undefined): number {
  return Number(cost?.combined_cost_per_kg ?? 0) * 40;
}

function renderFeedCostRows(rows: FeedCostMonthly[]): string {
  return renderRows(rows, "Sin costos de planta", (row) => `
    <tr>
      <td>${formatDate(row.month_start)}</td>
      <td class="number">${formatCurrency(row.admin_cost_per_kg)}</td>
      <td class="number">${formatCurrency(row.maquila_cost_per_kg)}</td>
      <td class="number">${formatCurrency(row.combined_cost_per_kg)}</td>
      <td class="number">${formatCurrency(costPerBag(row))}</td>
      <td class="number">${formatCurrency(row.combined_total_amount)}</td>
    </tr>
  `);
}

function renderDailySalesRows(rows: DailySales[]): string {
  return renderRows(rows, "Sin ventas diarias", (row) => `
    <tr>
      <td>${formatDate(row.sales_date)}</td>
      <td class="number">${formatNumber(row.documents_count)}</td>
      <td class="number">${formatCurrency(row.total_amount)}</td>
      <td class="number">${formatNumber(row.open_documents_count)}</td>
      <td class="number">${formatCurrency(row.open_amount)}</td>
    </tr>
  `);
}

function relationName<T extends { name: string | null }>(
  value: T | T[] | null | undefined
): string | null {
  if (Array.isArray(value)) {
    return value[0]?.name ?? null;
  }

  return value?.name ?? null;
}

function farmNameForRow(data: DashboardData, row: LayerDailyKpi): string {
  const house = data.poultryHouseFarms.find((item) => item.name === row.poultry_house_name);
  return relationName(house?.locations) ?? row.business_unit_name ?? "Granja";
}

function curveForWeek(data: DashboardData, weekNumber: number | null | undefined): {
  gad: number | null;
  haa: number | null;
} {
  const curve = data.layerStandardCurves.find((item) => item.week_number === weekNumber);
  return {
    gad: curve?.gad ?? null,
    haa: curve?.haa ?? null
  };
}

function posturePct(row: LayerDailyKpi): number | null {
  return row.pp ?? row.calculated_daily_lay_rate_pct ?? null;
}

function latestLayerRows(rows: LayerDailyKpi[]): LayerDailyKpi[] {
  const byHouse = new Map<string, LayerDailyKpi>();

  for (const row of rows) {
    const key = `${row.poultry_house_name ?? ""}::${row.lot_code ?? ""}`;
    if (!byHouse.has(key)) {
      byHouse.set(key, row);
    }
  }

  return [...byHouse.values()];
}

function renderLayerCurrentRows(data: DashboardData): string {
  return renderRows(latestLayerRows(data.layerDaily), "Sin galpones actuales", (row) => {
    const curve = curveForWeek(data, row.week_number);

    return `
      <tr>
        <td>${escapeHtml(farmNameForRow(data, row))}</td>
        <td>${escapeHtml(row.poultry_house_name)}</td>
        <td>${escapeHtml(row.lot_name ?? row.lot_code)}</td>
        <td>${formatDate(row.record_date)}</td>
        <td class="number">${formatNumber(row.week_number)}</td>
        <td class="number">${formatNumber(row.egg_production_count)}</td>
        <td class="number">${formatPercent(posturePct(row))}</td>
        <td class="number">${formatNumber(curve.haa, 2)}</td>
        <td class="number">${formatNumber(curve.gad, 2)}</td>
      </tr>
    `;
  });
}

function renderVaccinationRows(rows: VaccinationTimeline[]): string {
  return renderRows(rows, "Sin vacunas o tratamientos recientes", (row) => `
    <tr>
      <td>${formatDate(row.vaccination_date)}</td>
      <td>${escapeHtml(row.poultry_houses?.name ?? "-")}</td>
      <td>${escapeHtml(row.production_lots?.name ?? row.production_lots?.lot_code ?? "-")}</td>
      <td>${escapeHtml(row.items?.name ?? row.commercial_name ?? row.categories?.name ?? "-")}</td>
      <td>${escapeHtml(row.administration_route ?? "-")}</td>
      <td>${escapeHtml(row.veterinarian ?? "-")}</td>
    </tr>
  `);
}

function renderPostureChart(rows: LayerDailyKpi[]): string {
  const byDate = new Map<string, { total: number; count: number }>();

  for (const row of rows) {
    const value = posturePct(row);

    if (!row.record_date || value === null) {
      continue;
    }

    const current = byDate.get(row.record_date) ?? { total: 0, count: 0 };
    current.total += Math.abs(value) <= 1 && value !== 0 ? value * 100 : value;
    current.count += 1;
    byDate.set(row.record_date, current);
  }

  const points = [...byDate.entries()]
    .map(([date, value]) => ({ date, value: value.total / Math.max(value.count, 1) }))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-30);

  if (points.length < 2) {
    return `<div class="empty chart-empty">Sin datos suficientes para graficar</div>`;
  }

  const width = 640;
  const height = 220;
  const padX = 28;
  const padY = 24;
  const values = points.map((point) => point.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 100);
  const span = Math.max(max - min, 1);
  const polyline = points
    .map((point, index) => {
      const x = padX + (index / Math.max(points.length - 1, 1)) * (width - padX * 2);
      const y = height - padY - ((point.value - min) / span) * (height - padY * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const last = points[points.length - 1];

  return `
    <div class="chart-shell">
      <svg role="img" aria-label="Grafica de porcentaje de postura" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" class="chart-axis"></line>
        <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" class="chart-axis"></line>
        <polyline points="${escapeHtml(polyline)}" class="chart-line"></polyline>
      </svg>
      <div class="chart-caption">
        <span>${formatDate(points[0].date)}</span>
        <strong>${formatPercent(last.value)}</strong>
        <span>${formatDate(last.date)}</span>
      </div>
    </div>
  `;
}

function renderSection(
  id: string,
  title: string,
  subtitle: string,
  table: string,
  actionHtml = "",
  icon?: UiIcon
): string {
  return `
    <section class="panel" id="${escapeHtml(id)}">
      <div class="panel-heading">
        <div>
          <h2>${icon ? renderUiIcon(icon, "heading-icon") : ""}${escapeHtml(title)}</h2>
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

function plantInventoryRows(rows: InventoryBalance[]): InventoryBalance[] {
  const rawMaterials = rows.filter((row) => row.item_type === "raw_material");
  const sourceRows = rawMaterials.length > 0 ? rawMaterials : rows;
  const filtered = sourceRows.filter((row) =>
    containsAny(`${row.warehouse_name ?? ""} ${row.item_name ?? ""} ${row.item_code ?? ""}`, [
      "planta",
      "materia prima",
      "maquila",
      "mp"
    ])
  );

  return (filtered.length > 0 ? filtered : sourceRows).slice(0, 30);
}

function feedInventoryRows(rows: InventoryBalance[]): InventoryBalance[] {
  return rows.filter((row) =>
    containsAny(`${row.item_name ?? ""} ${row.item_code ?? ""} ${row.warehouse_name ?? ""}`, [
      "alimento",
      "concentrado",
      "comida",
      "bulto",
      "btos",
      "bto"
    ])
  );
}

function eggInventoryRows(rows: InventoryBalance[]): InventoryBalance[] {
  return rows.filter((row) =>
    containsAny(`${row.item_name ?? ""} ${row.item_code ?? ""} ${row.warehouse_name ?? ""}`, [
      "huevo",
      "paca",
      "cubeta",
      "carton"
    ])
  );
}

function sumInventory(rows: InventoryBalance[], field: keyof InventoryBalance): number {
  return rows.reduce((total, row) => total + (Number(row[field] ?? 0) || 0), 0);
}

function sumFeedProduction(rows: FeedProductionDaily[], field: keyof FeedProductionDaily): number {
  return rows.reduce((total, row) => total + (Number(row[field] ?? 0) || 0), 0);
}

function averageLayer(rows: LayerDailyKpi[], getter: (row: LayerDailyKpi) => number | null): number {
  const values = rows.map(getter).filter((value): value is number => value !== null);
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);
}

function sumPlantActivity(rows: PlantActivity[]): number {
  return rows.reduce((total, row) => total + (Number(row.quantity ?? 0) || 0), 0);
}

function renderPlantCostCards(data: DashboardData): string {
  return `
    <section class="cost-strip" aria-label="Costo por bulto">
      <article class="cost-card">
        <span class="cost-card-icon">${renderUiIcon("raw")}</span>
        <div>
          <span>Costo materia prima</span>
          <strong>${formatCurrency(data.plantCost.material_cost_per_bag)}</strong>
          <small>${escapeHtml(data.plantCost.material_cost_basis)}</small>
        </div>
      </article>
      <article class="cost-card is-main">
        <span class="cost-card-icon">${renderUiIcon("cost")}</span>
        <div>
          <span>Costo bulto total</span>
          <strong>${formatCurrency(data.plantCost.total_cost_per_bag)}</strong>
          <small>Materia prima + maquila</small>
        </div>
      </article>
      <article class="cost-card">
        <span class="cost-card-icon">${renderUiIcon("plant")}</span>
        <div>
          <span>Costo maquila</span>
          <strong>${formatCurrency(data.plantCost.maquila_cost_per_bag)}</strong>
          <small>${escapeHtml(data.plantCost.maquila_cost_basis)}</small>
        </div>
      </article>
    </section>
  `;
}

function formatActivityQuantity(row: PlantActivity): string {
  const digits = row.unit.toLowerCase().includes("kg") ? 1 : 0;
  return `${formatNumber(row.quantity, digits)} ${escapeHtml(row.unit)}`;
}

function renderActivityItems(rows: PlantActivity[], emptyText: string): string {
  if (rows.length === 0) {
    return `<div class="activity-empty">${escapeHtml(emptyText)}</div>`;
  }

  return rows
    .map(
      (row) => `
        <article class="activity-item">
          ${renderItemIcon(row)}
          <div class="activity-copy">
            <strong>${escapeHtml(row.title)}</strong>
            <span>${escapeHtml(row.detail)}</span>
            <small>${formatDate(row.date)}</small>
          </div>
          <b>${formatActivityQuantity(row)}</b>
        </article>
      `
    )
    .join("");
}

function renderPlantActivityColumn(params: {
  title: string;
  subtitle: string;
  icon: UiIcon;
  rows: PlantActivity[];
  emptyText: string;
}): string {
  return `
    <section class="activity-column">
      <header>
        <span class="activity-column-icon">${renderUiIcon(params.icon)}</span>
        <div>
          <h2>${escapeHtml(params.title)}</h2>
          <p>${escapeHtml(params.subtitle)}</p>
        </div>
      </header>
      <div class="activity-list">
        ${renderActivityItems(params.rows, params.emptyText)}
      </div>
    </section>
  `;
}

function renderPlantActivityGrid(data: DashboardData): string {
  return `
    <section class="activity-grid" aria-label="Movimientos de planta">
      ${renderPlantActivityColumn({
        title: "Entradas",
        subtitle: "Materia prima, de ultimo a primero",
        icon: "in",
        rows: data.plantEntries,
        emptyText: "Sin entradas recientes"
      })}
      ${renderPlantActivityColumn({
        title: "Produccion",
        subtitle: "Bultos producidos, de ultimo a primero",
        icon: "production",
        rows: data.plantProductionActivities,
        emptyText: "Sin produccion reciente"
      })}
      ${renderPlantActivityColumn({
        title: "Salidas",
        subtitle: "Consumos y despachos MP, de ultimo a primero",
        icon: "out",
        rows: data.plantExits,
        emptyText: "Sin salidas recientes"
      })}
    </section>
  `;
}

function renderSummaryModule(data: DashboardData): string {
  const latestCashMonth = data.cash[0]?.month_start ? formatDate(data.cash[0].month_start) : "-";
  const latestStoreDate = data.store[0]?.summary_date ? formatDate(data.store[0].summary_date) : "-";
  const latestSales = data.dailySales[0];
  const currentLayerRows = latestLayerRows(data.layerDaily);
  const avgPosture = averageLayer(currentLayerRows, posturePct);

  return `
    ${renderSheetIntro("RESUMEN", "Vista ejecutiva de produccion, caja, ventas, inventario y alertas.")}
    <section class="metrics-grid" aria-label="Indicadores principales">
      ${renderMetric("Alertas activas", formatNumber(data.metrics.activeAlerts), `${formatNumber(data.metrics.highAlerts)} altas`, data.metrics.highAlerts > 0 ? "tone-danger" : "")}
      ${renderMetric("Aves estimadas", formatNumber(data.metrics.estimatedBirdsAlive), "Postura activa")}
      ${renderMetric("Postura actual", formatPercent(avgPosture), `${formatNumber(currentLayerRows.length)} galpones`)}
      ${renderMetric("Huevos acumulados", formatNumber(data.metrics.totalLayerEggs), "Registros de postura")}
      ${renderMetric("Inventario negativo", formatNumber(data.metrics.negativeInventoryItems), "Derivado de movimientos", data.metrics.negativeInventoryItems > 0 ? "tone-warn" : "")}
      ${renderMetric("Caja neta", formatCurrency(data.metrics.latestCashNet), latestCashMonth)}
      ${renderMetric("Ventas dia", formatCurrency(latestSales?.total_amount), latestSales ? formatDate(latestSales.sales_date) : "-")}
      ${renderMetric("Compras tienda", formatNumber(data.metrics.latestStorePurchaseQuantity), latestStoreDate)}
    </section>

    <section class="grid-two">
      ${renderSection(
        "resumen-planta",
        "Planta",
        "Produccion reciente por formula",
        `<table>
          <thead><tr><th>Fecha</th><th>Formula</th><th>Producto</th><th>Ordenes</th><th>Bultos</th><th>Kg prod.</th><th>Kg MP</th><th>Kg/Bto</th></tr></thead>
          <tbody>${renderFeedRows(data.feedProduction.slice(0, 6))}</tbody>
        </table>`,
        `<a class="ghost-button" href="/?modulo=planta">Abrir</a>`
      )}
      ${renderSection(
        "resumen-gallinas",
        "Gallinas",
        "Galpones actuales",
        `<table>
          <thead><tr><th>Granja</th><th>Galpon</th><th>Lote</th><th>Fecha</th><th>Semana</th><th>Produccion</th><th>% Postura</th><th>HAA</th><th>GAD</th></tr></thead>
          <tbody>${renderLayerCurrentRows(data)}</tbody>
        </table>`,
        `<a class="ghost-button" href="/?modulo=gallinas">Abrir</a>`
      )}
    </section>

    <section class="grid-two">
      ${renderSection(
        "resumen-macadasa",
        "MACADASA",
        "Ventas diarias y caja",
        `<table>
          <thead><tr><th>Fecha</th><th>Docs.</th><th>Ventas</th><th>Abiertos</th><th>Saldo</th></tr></thead>
          <tbody>${renderDailySalesRows(data.dailySales.slice(0, 7))}</tbody>
        </table>`,
        `<a class="ghost-button" href="/?modulo=macadasa">Abrir</a>`
      )}
      ${renderSection(
        "resumen-inventario",
        "Inventario",
        "Saldos recientes",
        `<table>
          <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Entradas</th><th>Salidas</th><th>Saldo</th><th>Ultimo mov.</th></tr></thead>
          <tbody>${renderInventoryRows((data.negativeInventory.length > 0 ? data.negativeInventory : data.inventory).slice(0, 8))}</tbody>
        </table>`,
        `<a class="ghost-button" href="/?modulo=inventario">Abrir</a>`
      )}
    </section>

    <section class="grid-two">
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
      ${renderSection(
        "salud",
        "Sincronizacion y transformaciones",
        "Ultima ejecucion por proceso",
        `<table>
          <thead><tr><th>Proceso</th><th>Estado</th><th>Fecha</th><th>Procesados</th><th>Fallos</th></tr></thead>
          <tbody>${renderHealthRows(data.health)}</tbody>
        </table>`
      )}
    </section>
  `;
}

function renderPlantModule(data: DashboardData): string {
  const inventoryRows = plantInventoryRows(data.inventory);

  return `
    ${renderSheetIntro("PLANTA", "Costo por bulto, entradas, produccion, salidas e inventario.")}
    ${renderPlantCostCards(data)}

    ${renderSection(
      "inventario-planta",
      "Inventario MP",
      `Materia prima en planta: ${formatNumber(sumInventory(inventoryRows, "current_quantity"), 2)} kg visibles`,
      `<table>
        <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Entradas</th><th>Salidas</th><th>Saldo</th><th>Ultimo mov.</th></tr></thead>
        <tbody>${renderInventoryRows(inventoryRows)}</tbody>
      </table>`,
      `<a class="ghost-button" href="/api/export/inventory_current.csv">CSV</a>`,
      "raw"
    )}

    ${renderPlantActivityGrid(data)}
  `;
}

function renderGallinasModule(data: DashboardData): string {
  const currentLayerRows = latestLayerRows(data.layerDaily);
  const avgPosture = averageLayer(currentLayerRows, posturePct);
  const latestEggs = currentLayerRows.reduce(
    (total, row) => total + (Number(row.egg_production_count ?? 0) || 0),
    0
  );

  return `
    ${renderSheetIntro("GALLINAS", "Galpones por granja, postura, clasificadora y linea sanitaria.")}
    <section class="metrics-grid compact" aria-label="Indicadores de gallinas">
      ${renderMetric("Aves actuales", formatNumber(data.metrics.estimatedBirdsAlive), "Estimadas")}
      ${renderMetric("Produccion", formatNumber(latestEggs), "Huevos ultimo registro")}
      ${renderMetric("% postura", formatPercent(avgPosture), `${formatNumber(currentLayerRows.length)} galpones`)}
      ${renderMetric("Clasificadora", formatNumber(data.eggGrading.reduce((total, row) => total + (Number(row.quantity ?? 0) || 0), 0)), "Cantidad reciente")}
    </section>

    <section class="grid-two">
      ${renderSection(
        "galpones",
        "Galpones actuales",
        "Produccion, postura, HAA y GAD",
        `<table>
          <thead><tr><th>Granja</th><th>Galpon</th><th>Lote</th><th>Fecha</th><th>Semana</th><th>Produccion</th><th>% Postura</th><th>HAA</th><th>GAD</th></tr></thead>
          <tbody>${renderLayerCurrentRows(data)}</tbody>
        </table>`
      )}
      ${renderSection(
        "postura-grafica",
        "% postura",
        "Promedio diario de los registros recientes",
        renderPostureChart(data.layerDaily)
      )}
    </section>

    <section class="grid-two">
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
      ${renderSection(
        "vacunas",
        "Vacunas y tratamientos",
        "Linea de tiempo reciente",
        `<table>
          <thead><tr><th>Fecha</th><th>Galpon</th><th>Lote</th><th>Producto</th><th>Via</th><th>Veterinario</th></tr></thead>
          <tbody>${renderVaccinationRows(data.vaccinations)}</tbody>
        </table>`
      )}
    </section>
  `;
}

function renderMacadasaModule(data: DashboardData): string {
  const latestCashMonth = data.cash[0]?.month_start ? formatDate(data.cash[0].month_start) : "-";
  const latestSales = data.dailySales[0];

  return `
    ${renderSheetIntro("MACADASA", "Ventas diarias, finanzas, caja y tienda.")}
    <section class="metrics-grid compact" aria-label="Indicadores MACADASA">
      ${renderMetric("Ventas dia", formatCurrency(latestSales?.total_amount), latestSales ? formatDate(latestSales.sales_date) : "-")}
      ${renderMetric("Docs venta", formatNumber(latestSales?.documents_count), "Ultimo dia")}
      ${renderMetric("Caja neta", formatCurrency(data.metrics.latestCashNet), latestCashMonth)}
      ${renderMetric("Documentos vencidos", formatNumber(data.metrics.openOverdueDocuments), "Finanzas", data.metrics.openOverdueDocuments > 0 ? "tone-warn" : "")}
    </section>

    ${renderSection(
      "ventas-diarias",
      "Ventas diarias",
      "Documentos por fecha",
      `<table>
        <thead><tr><th>Fecha</th><th>Docs.</th><th>Ventas</th><th>Abiertos</th><th>Saldo</th></tr></thead>
        <tbody>${renderDailySalesRows(data.dailySales)}</tbody>
      </table>`
    )}

    <section class="grid-two">
      ${renderSection(
        "finanzas",
        "Finanzas",
        "Documentos, pagos y saldo abierto",
        `<table>
          <thead><tr><th>Mes</th><th>Tipo</th><th>Doc.</th><th>Estado</th><th>Cant.</th><th>Total</th><th>Abierto</th></tr></thead>
          <tbody>${renderFinanceRows(data.financeDocuments)}</tbody>
        </table>`,
        `<a class="ghost-button" href="/api/export/finance_documents.csv">CSV</a>`
      )}
      ${renderSection(
        "caja",
        "Caja",
        "Ingresos, gastos y neto",
        `<table>
          <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Neto</th><th>Mov.</th></tr></thead>
          <tbody>${renderCashRows(data.cash)}</tbody>
        </table>`
      )}
    </section>

    ${renderSection(
      "tienda",
      "Tienda",
      "Compras, conteos y pesaje de pollo",
      `<table>
        <thead><tr><th>Fecha</th><th>Compras</th><th>Tiendas</th><th>Cantidad</th><th>Inventario</th><th>Kg pollo</th></tr></thead>
        <tbody>${renderStoreRows(data.store)}</tbody>
      </table>`,
      `<a class="ghost-button" href="/api/export/store_daily.csv">CSV</a>`
    )}
  `;
}

function renderInventoryModule(data: DashboardData): string {
  const feedRows = feedInventoryRows(data.inventory);
  const eggRows = eggInventoryRows(data.inventory);

  return `
    ${renderSheetIntro("INVENTARIO", "Comida en bultos, huevo en pacas y saldos actuales.")}
    <section class="metrics-grid compact" aria-label="Indicadores de inventario">
      ${renderMetric("Comida btos", formatNumber(sumInventory(feedRows, "current_quantity"), 2), `${formatNumber(feedRows.length)} saldos`)}
      ${renderMetric("Huevo pacas", formatNumber(sumInventory(eggRows, "current_quantity"), 2), `${formatNumber(eggRows.length)} saldos`)}
      ${renderMetric("Entradas", formatNumber(sumInventory(data.inventory, "total_in_quantity"), 2), "Total visible")}
      ${renderMetric("Salidas", formatNumber(sumInventory(data.inventory, "total_out_quantity"), 2), "Total visible")}
      ${renderMetric("Negativos", formatNumber(data.negativeInventory.length), "Saldos en alerta", data.negativeInventory.length > 0 ? "tone-warn" : "")}
    </section>

    <section class="grid-two">
      ${renderSection(
        "comida-bultos",
        "Comida btos",
        "Alimento y concentrado",
        `<table>
          <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Entradas</th><th>Salidas</th><th>Saldo</th><th>Ultimo mov.</th></tr></thead>
          <tbody>${renderInventoryRows(feedRows)}</tbody>
        </table>`
      )}
      ${renderSection(
        "huevo-pacas",
        "Huevo pacas",
        "Huevo clasificado y conteos",
        `<table>
          <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Entradas</th><th>Salidas</th><th>Saldo</th><th>Ultimo mov.</th></tr></thead>
          <tbody>${renderInventoryRows(eggRows)}</tbody>
        </table>`
      )}
    </section>

    ${renderSection(
      "inventario-general",
      "Inventario general",
      "Saldo derivado desde movimientos normalizados",
      `<table>
        <thead><tr><th>Bodega</th><th>Item</th><th>Lote</th><th>Entradas</th><th>Salidas</th><th>Saldo</th><th>Ultimo mov.</th></tr></thead>
        <tbody>${renderInventoryRows(data.negativeInventory.length > 0 ? data.negativeInventory : data.inventory)}</tbody>
      </table>`,
      `<a class="ghost-button" href="/api/export/inventory_current.csv">CSV</a>`
    )}
  `;
}

function renderModuleContent(data: DashboardData, activeModule: DashboardModule): string {
  if (activeModule === "planta") {
    return renderPlantModule(data);
  }

  if (activeModule === "gallinas") {
    return renderGallinasModule(data);
  }

  if (activeModule === "macadasa") {
    return renderMacadasaModule(data);
  }

  if (activeModule === "inventario") {
    return renderInventoryModule(data);
  }

  return renderSummaryModule(data);
}

export function renderDashboard(data: DashboardData, activeModule: DashboardModule = "resumen"): string {
  const active = resolveDashboardModule(activeModule);
  const activeMeta = dashboardModules.find((module) => module.id === active) ?? dashboardModules[0];

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
          ${dashboardModules
            .map((module) => `
              <a href="/?modulo=${escapeHtml(module.id)}" class="${module.id === active ? "active" : ""}">
                <span class="nav-icon">${renderUiIcon(module.icon)}</span>
                <span class="nav-copy">
                  <span>${escapeHtml(module.label)}</span>
                  <small>${escapeHtml(module.detail)}</small>
                </span>
              </a>
            `)
            .join("")}
        </nav>
      </aside>

      <main class="content">
        <header class="topbar">
          <div>
            <h1>${escapeHtml(activeMeta.label)}</h1>
            <p>Actualizado ${formatDateTime(data.generatedAt)}</p>
          </div>
          <div class="actions">
            <a class="ghost-button" href="/calidad">Calidad</a>
            <a class="ghost-button" href="/validacion">Validacion</a>
            <a class="ghost-button" href="/api/dashboard-data">JSON</a>
          </div>
        </header>

        ${renderModuleContent(data, active)}
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
