import { getSupabaseAdminClient } from "../lib/supabaseAdmin";

export type DataQualityAlert = {
  severity: string;
  area: string;
  alert_code: string;
  entity_table: string;
  issue_count: number;
  detail: string;
};

export type ProcessHealth = {
  process_type: string;
  process_name: string;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  records_processed: number | null;
  records_inserted: number | null;
  records_updated: number | null;
  records_failed: number | null;
};

export type LayerLotSummary = {
  lot_code: string | null;
  lot_name: string | null;
  poultry_house_name: string | null;
  initial_birds: number | null;
  latest_week_number: number | null;
  total_feed_bags: number | null;
  total_egg_production_count: number | null;
  total_mortality_count: number | null;
  estimated_birds_alive: number | null;
  total_mortality_pct: number | null;
};

export type InventoryBalance = {
  warehouse_name: string | null;
  item_code: string | null;
  item_name: string | null;
  lot_code: string | null;
  last_movement_date: string | null;
  current_quantity: number | null;
  total_in_quantity: number | null;
  total_out_quantity: number | null;
};

export type FeedProductionDaily = {
  production_date: string | null;
  formula_code: string | null;
  formula_name: string | null;
  output_item_name: string | null;
  production_orders_count: number | null;
  total_batches: number | null;
  practical_bags: number | null;
  material_quantity_kg: number | null;
};

export type EggGradingDaily = {
  grading_date: string | null;
  lot_code: string | null;
  poultry_house_name: string | null;
  item_code: string | null;
  item_name: string | null;
  quantity: number | null;
};

export type FinanceMonthly = {
  month_start: string | null;
  direction: string | null;
  document_type: string | null;
  status: string | null;
  documents_count: number | null;
  total_amount: number | null;
  paid_amount: number | null;
  open_amount: number | null;
};

export type CashMonthly = {
  month_start: string | null;
  income_amount: number | null;
  expense_amount: number | null;
  net_cash_amount: number | null;
  movements_count: number | null;
};

export type StoreDaily = {
  summary_date: string | null;
  store_purchase_records: number | null;
  stores_with_purchase_records: number | null;
  store_purchase_quantity: number | null;
  inventory_count_quantity: number | null;
  chicken_units: number | null;
  chicken_weight_kg: number | null;
};

export type DashboardData = {
  generatedAt: string;
  alerts: DataQualityAlert[];
  health: ProcessHealth[];
  posture: LayerLotSummary[];
  negativeInventory: InventoryBalance[];
  inventory: InventoryBalance[];
  feedProduction: FeedProductionDaily[];
  eggGrading: EggGradingDaily[];
  financeDocuments: FinanceMonthly[];
  cash: CashMonthly[];
  store: StoreDaily[];
  metrics: {
    activeAlerts: number;
    highAlerts: number;
    openOverdueDocuments: number;
    negativeInventoryItems: number;
    estimatedBirdsAlive: number;
    totalLayerEggs: number;
    latestCashNet: number;
    latestStorePurchaseQuantity: number;
  };
};

async function selectView<T>(
  viewName: string,
  query: (view: ReturnType<ReturnType<typeof getSupabaseAdminClient>["from"]>) => unknown
): Promise<T[]> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = (await query(supabase.from(viewName))) as {
    data: T[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`Error leyendo ${viewName}: ${error.message}`);
  }

  return data ?? [];
}

function sumNumbers<T>(rows: T[], getter: (row: T) => number | null | undefined): number {
  return rows.reduce((total, row) => total + (Number(getter(row) ?? 0) || 0), 0);
}

function issueCount(alerts: DataQualityAlert[], code: string): number {
  return Number(alerts.find((alert) => alert.alert_code === code)?.issue_count ?? 0);
}

export async function getDashboardData(): Promise<DashboardData> {
  const [
    alerts,
    health,
    posture,
    negativeInventory,
    inventory,
    feedProduction,
    eggGrading,
    financeDocuments,
    cash,
    store
  ] = await Promise.all([
    selectView<DataQualityAlert>("v_data_quality_alerts", (view) =>
      view.select("*").order("severity").order("area")
    ),
    selectView<ProcessHealth>("v_kpi_sync_transform_health", (view) =>
      view.select("*").order("process_type").order("process_name")
    ),
    selectView<LayerLotSummary>("v_kpi_postura_lote_resumen", (view) =>
      view.select("*").order("lot_code")
    ),
    selectView<InventoryBalance>("v_kpi_inventario_actual", (view) =>
      view.select("*").lt("current_quantity", 0).order("current_quantity").limit(12)
    ),
    selectView<InventoryBalance>("v_kpi_inventario_actual", (view) =>
      view.select("*").order("last_movement_date", { ascending: false }).limit(12)
    ),
    selectView<FeedProductionDaily>("v_kpi_planta_produccion_diaria", (view) =>
      view.select("*").order("production_date", { ascending: false }).limit(12)
    ),
    selectView<EggGradingDaily>("v_kpi_clasificadora_diaria", (view) =>
      view.select("*").order("grading_date", { ascending: false }).limit(12)
    ),
    selectView<FinanceMonthly>("v_kpi_finanzas_documentos_mensual", (view) =>
      view.select("*").order("month_start", { ascending: false }).limit(24)
    ),
    selectView<CashMonthly>("v_kpi_finanzas_caja_mensual", (view) =>
      view.select("*").order("month_start", { ascending: false }).limit(8)
    ),
    selectView<StoreDaily>("v_kpi_tienda_resumen_diario", (view) =>
      view.select("*").order("summary_date", { ascending: false }).limit(14)
    )
  ]);

  const latestCash = cash[0];
  const latestStore = store[0];

  return {
    generatedAt: new Date().toISOString(),
    alerts,
    health,
    posture,
    negativeInventory,
    inventory,
    feedProduction,
    eggGrading,
    financeDocuments,
    cash,
    store,
    metrics: {
      activeAlerts: alerts.length,
      highAlerts: alerts.filter((alert) => alert.severity === "high").length,
      openOverdueDocuments: issueCount(alerts, "overdue_open_financial_documents"),
      negativeInventoryItems: issueCount(alerts, "negative_inventory_from_movements"),
      estimatedBirdsAlive: sumNumbers(posture, (row) => row.estimated_birds_alive),
      totalLayerEggs: sumNumbers(posture, (row) => row.total_egg_production_count),
      latestCashNet: Number(latestCash?.net_cash_amount ?? 0),
      latestStorePurchaseQuantity: Number(latestStore?.store_purchase_quantity ?? 0)
    }
  };
}
