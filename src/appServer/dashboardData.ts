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
  first_record_date: string | null;
  last_record_date: string | null;
  latest_week_number: number | null;
  records_count: number | null;
  total_feed_bags: number | null;
  total_egg_production_count: number | null;
  total_mortality_count: number | null;
  total_other_exits_count: number | null;
  estimated_birds_alive: number | null;
  total_mortality_pct: number | null;
  avg_reported_pp: number | null;
  avg_guide_pp: number | null;
};

export type InventoryBalance = {
  warehouse_id: string | null;
  item_id: string | null;
  warehouse_name: string | null;
  warehouse_icon_url?: string | null;
  warehouse_icon_label?: string | null;
  item_code: string | null;
  item_name: string | null;
  item_type?: string | null;
  item_icon_url?: string | null;
  item_icon_label?: string | null;
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
  output_item_code: string | null;
  output_item_name: string | null;
  production_orders_count: number | null;
  total_batches: number | null;
  theoretical_bags: number | null;
  practical_bags: number | null;
  output_quantity_bags: number | null;
  output_quantity_kg: number | null;
  material_quantity_kg: number | null;
  material_lines_count: number | null;
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
  inventory_count_records: number | null;
  inventory_count_quantity: number | null;
  chicken_weight_batches: number | null;
  chicken_weight_lines: number | null;
  chicken_units: number | null;
  chicken_weight_kg: number | null;
};

export type LayerDailyKpi = {
  record_date: string | null;
  business_unit_name: string | null;
  lot_code: string | null;
  lot_name: string | null;
  poultry_house_name: string | null;
  week_number: number | null;
  day_number: number | null;
  feed_bags: number | null;
  egg_production_count: number | null;
  guide_pp: number | null;
  pp: number | null;
  estimated_birds_alive: number | null;
  calculated_daily_lay_rate_pct: number | null;
};

export type LayerStandardCurve = {
  week_number: number | null;
  gad: number | null;
  haa: number | null;
  pp: number | null;
  weight_gr: number | null;
};

export type PoultryHouseFarm = {
  name: string | null;
  locations: { name: string | null } | { name: string | null }[] | null;
};

export type VaccinationTimeline = {
  vaccination_date: string | null;
  laboratory: string | null;
  strains: string | null;
  commercial_name: string | null;
  administration_route: string | null;
  veterinarian: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  production_lots: { lot_code: string | null; name: string | null } | null;
  poultry_houses: { name: string | null } | null;
  items: { code: string | null; name: string | null } | null;
  categories: { code: string | null; name: string | null } | null;
};

export type FeedCostMonthly = {
  month_start: string | null;
  admin_total_amount: number | null;
  admin_budgeted_kg: number | null;
  admin_cost_per_kg: number | null;
  maquila_total_amount: number | null;
  maquila_budgeted_kg: number | null;
  maquila_cost_per_kg: number | null;
  combined_total_amount: number | null;
  combined_cost_per_kg: number | null;
};

export type ItemCatalog = {
  id: string;
  code: string | null;
  name: string | null;
  category_id: string | null;
  item_type: string | null;
  metadata: Record<string, unknown> | null;
};

export type EntityAttachment = {
  id: string;
  entity_table: string;
  entity_id: string;
  file_kind: string | null;
  file_name: string | null;
  file_ref: string | null;
  mime_type: string | null;
};

export type WarehouseCatalog = {
  id: string;
  code: string | null;
  name: string | null;
  warehouse_type: string | null;
  category_id: string | null;
  metadata: Record<string, unknown> | null;
};

type ItemRelation = {
  id: string | null;
  code: string | null;
  name: string | null;
  item_type: string | null;
};

export type RawMaterialReceipt = {
  receipt_date: string | null;
  item_id: string | null;
  quantity_kg: number | null;
  unit_price_without_tax: number | null;
  unit_price_with_tax: number | null;
  items: ItemRelation | ItemRelation[] | null;
  item_icon_url?: string | null;
  item_icon_label?: string | null;
};

export type PlantActivity = {
  date: string | null;
  title: string;
  detail: string;
  quantity: number | null;
  unit: string;
  item_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_type: string | null;
  item_icon_url: string | null;
  item_icon_label: string | null;
};

export type PlantCostSummary = {
  material_cost_per_bag: number;
  maquila_cost_per_bag: number;
  total_cost_per_bag: number;
  material_cost_basis: string;
  maquila_cost_basis: string;
};

export type DailySales = {
  sales_date: string;
  documents_count: number;
  open_documents_count: number;
  total_amount: number;
  open_amount: number;
};

type FinancialDocumentForDailySales = {
  issue_date: string | null;
  total_amount: number | null;
  balance_amount: number | null;
  status: string | null;
};

type FeedProductionMaterialForCost = {
  item_id: string | null;
  quantity_kg: number | null;
  unit_cost: number | null;
  total_cost: number | null;
  items?: ItemRelation | ItemRelation[] | null;
};

type FeedProductionOrderForCost = {
  id: string;
  production_date: string | null;
  practical_bags: number | null;
  feed_production_materials: FeedProductionMaterialForCost[] | null;
};

type InventoryMovementLineForActivity = {
  quantity: number | null;
  unit: string | null;
  items: ItemRelation | ItemRelation[] | null;
};

type InventoryMovementForActivity = {
  id: string;
  movement_date: string | null;
  movement_type: string | null;
  reference: string | null;
  notes: string | null;
  inventory_movement_lines: InventoryMovementLineForActivity[] | null;
};

export type DashboardData = {
  generatedAt: string;
  alerts: DataQualityAlert[];
  health: ProcessHealth[];
  posture: LayerLotSummary[];
  layerDaily: LayerDailyKpi[];
  layerStandardCurves: LayerStandardCurve[];
  poultryHouseFarms: PoultryHouseFarm[];
  vaccinations: VaccinationTimeline[];
  negativeInventory: InventoryBalance[];
  inventory: InventoryBalance[];
  feedProduction: FeedProductionDaily[];
  feedCosts: FeedCostMonthly[];
  plantCost: PlantCostSummary;
  plantEntries: PlantActivity[];
  plantProductionActivities: PlantActivity[];
  plantExits: PlantActivity[];
  eggGrading: EggGradingDaily[];
  financeDocuments: FinanceMonthly[];
  cash: CashMonthly[];
  store: StoreDaily[];
  dailySales: DailySales[];
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

async function selectOptionalRows<T>(
  viewName: string,
  query: (view: ReturnType<ReturnType<typeof getSupabaseAdminClient>["from"]>) => unknown
): Promise<T[]> {
  try {
    return await selectView<T>(viewName, query);
  } catch {
    return [];
  }
}

function sumNumbers<T>(rows: T[], getter: (row: T) => number | null | undefined): number {
  return rows.reduce((total, row) => total + (Number(getter(row) ?? 0) || 0), 0);
}

function issueCount(alerts: DataQualityAlert[], code: string): number {
  return Number(alerts.find((alert) => alert.alert_code === code)?.issue_count ?? 0);
}

function groupDailySales(rows: FinancialDocumentForDailySales[]): DailySales[] {
  const byDate = new Map<string, DailySales>();

  for (const row of rows) {
    if (!row.issue_date) {
      continue;
    }

    const current = byDate.get(row.issue_date) ?? {
      sales_date: row.issue_date,
      documents_count: 0,
      open_documents_count: 0,
      total_amount: 0,
      open_amount: 0
    };

    current.documents_count += 1;
    current.total_amount += Number(row.total_amount ?? 0) || 0;
    current.open_amount += Number(row.balance_amount ?? 0) || 0;

    if (row.status !== "paid" && row.status !== "void") {
      current.open_documents_count += 1;
    }

    byDate.set(row.issue_date, current);
  }

  return [...byDate.values()]
    .sort((left, right) => right.sales_date.localeCompare(left.sales_date))
    .slice(0, 14);
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function itemIconLabel(item: {
  code?: string | null;
  name?: string | null;
  item_type?: string | null;
}): string {
  const typeLabels: Record<string, string> = {
    raw_material: "MP",
    feed: "BT",
    egg: "HV",
    chicken: "PO",
    packaging: "EM",
    medicine: "RX"
  };

  if (item.item_type && typeLabels[item.item_type]) {
    return typeLabels[item.item_type];
  }

  const code = String(item.code ?? "").split(":").pop()?.replace(/[^a-z0-9]/gi, "") ?? "";
  if (code.length > 0) {
    return code.slice(0, 2).toUpperCase();
  }

  return String(item.name ?? "IT").slice(0, 2).toUpperCase();
}

function entityIconLabel(entity: { code?: string | null; name?: string | null }, fallback: string): string {
  const code = String(entity.code ?? "").split(":").pop()?.replace(/[^a-z0-9]/gi, "") ?? "";
  if (code.length > 0) {
    return code.slice(0, 2).toUpperCase();
  }

  return String(entity.name ?? fallback).slice(0, 2).toUpperCase();
}

function attachmentImageUrl(attachmentId: string): string {
  return `/api/attachment-image?id=${encodeURIComponent(attachmentId)}`;
}

function attachmentsByTableAndEntity(
  attachments: EntityAttachment[],
  tableName: string
): Map<string, EntityAttachment> {
  const byEntityId = new Map<string, EntityAttachment>();

  for (const attachment of attachments) {
    if (attachment.entity_table !== tableName || byEntityId.has(attachment.entity_id)) {
      continue;
    }

    byEntityId.set(attachment.entity_id, attachment);
  }

  return byEntityId;
}

function buildItemLookup(
  items: ItemCatalog[],
  attachments: EntityAttachment[]
): {
  byId: Map<string, ItemCatalog & { item_icon_url: string | null; item_icon_label: string }>;
  byCode: Map<string, ItemCatalog & { item_icon_url: string | null; item_icon_label: string }>;
} {
  const attachmentByItemId = attachmentsByTableAndEntity(attachments, "items");
  const attachmentByCategoryId = attachmentsByTableAndEntity(attachments, "categories");

  const byId = new Map<
    string,
    ItemCatalog & { item_icon_url: string | null; item_icon_label: string }
  >();
  const byCode = new Map<
    string,
    ItemCatalog & { item_icon_url: string | null; item_icon_label: string }
  >();

  for (const item of items) {
    const attachment = attachmentByItemId.get(item.id) ??
      (item.category_id ? attachmentByCategoryId.get(item.category_id) : undefined);
    const decorated = {
      ...item,
      item_icon_url: attachment ? attachmentImageUrl(attachment.id) : null,
      item_icon_label: itemIconLabel(item)
    };

    byId.set(item.id, decorated);
    if (item.code) {
      byCode.set(item.code, decorated);
    }
  }

  return { byId, byCode };
}

function buildWarehouseLookup(
  warehouses: WarehouseCatalog[],
  attachments: EntityAttachment[]
): {
  byId: Map<
    string,
    WarehouseCatalog & { warehouse_icon_url: string | null; warehouse_icon_label: string }
  >;
  byName: Map<
    string,
    WarehouseCatalog & { warehouse_icon_url: string | null; warehouse_icon_label: string }
  >;
} {
  const attachmentByWarehouseId = attachmentsByTableAndEntity(attachments, "warehouses");
  const attachmentByCategoryId = attachmentsByTableAndEntity(attachments, "categories");
  const byId = new Map<
    string,
    WarehouseCatalog & { warehouse_icon_url: string | null; warehouse_icon_label: string }
  >();
  const byName = new Map<
    string,
    WarehouseCatalog & { warehouse_icon_url: string | null; warehouse_icon_label: string }
  >();

  for (const warehouse of warehouses) {
    const attachment =
      attachmentByWarehouseId.get(warehouse.id) ??
      (warehouse.category_id ? attachmentByCategoryId.get(warehouse.category_id) : undefined);
    const decorated = {
      ...warehouse,
      warehouse_icon_url: attachment ? attachmentImageUrl(attachment.id) : null,
      warehouse_icon_label: entityIconLabel(warehouse, "BD")
    };

    byId.set(warehouse.id, decorated);
    if (warehouse.name) {
      byName.set(warehouse.name, decorated);
    }
  }

  return { byId, byName };
}

function decorateInventoryRows(
  rows: InventoryBalance[],
  itemLookup: ReturnType<typeof buildItemLookup>,
  warehouseLookup: ReturnType<typeof buildWarehouseLookup>
): InventoryBalance[] {
  return rows.map((row) => {
    const item = row.item_id
      ? itemLookup.byId.get(row.item_id)
      : row.item_code
        ? itemLookup.byCode.get(row.item_code)
        : undefined;
    const warehouse = row.warehouse_id
      ? warehouseLookup.byId.get(row.warehouse_id)
      : row.warehouse_name
        ? warehouseLookup.byName.get(row.warehouse_name)
        : undefined;

    return {
      ...row,
      warehouse_icon_url: warehouse?.warehouse_icon_url ?? null,
      warehouse_icon_label: warehouse?.warehouse_icon_label ?? entityIconLabel({
        name: row.warehouse_name
      }, "BD"),
      item_type: item?.item_type ?? row.item_type ?? null,
      item_icon_url: item?.item_icon_url ?? null,
      item_icon_label: item?.item_icon_label ?? itemIconLabel(row)
    };
  });
}

function unitPriceForReceipt(row: RawMaterialReceipt): number {
  return Number(row.unit_price_with_tax ?? row.unit_price_without_tax ?? 0) || 0;
}

function latestUnitPriceByItem(receipts: RawMaterialReceipt[]): Map<string, number> {
  const prices = new Map<string, number>();
  const sorted = [...receipts].sort((left, right) =>
    String(right.receipt_date ?? "").localeCompare(String(left.receipt_date ?? ""))
  );

  for (const receipt of sorted) {
    if (!receipt.item_id || prices.has(receipt.item_id)) {
      continue;
    }

    const unitPrice = unitPriceForReceipt(receipt);
    if (unitPrice > 0) {
      prices.set(receipt.item_id, unitPrice);
    }
  }

  return prices;
}

function computePlantCost(
  feedCosts: FeedCostMonthly[],
  orders: FeedProductionOrderForCost[],
  receipts: RawMaterialReceipt[]
): PlantCostSummary {
  const latestPrices = latestUnitPriceByItem(receipts);
  const latestMaquila = feedCosts[0];
  const selectedOrders = [...orders]
    .filter((order) => Number(order.practical_bags ?? 0) > 0)
    .sort((left, right) =>
      String(right.production_date ?? "").localeCompare(String(left.production_date ?? ""))
    )
    .slice(0, 12);

  let materialCost = 0;
  let bagsWithCost = 0;
  let pricedLines = 0;
  let totalLines = 0;

  for (const order of selectedOrders) {
    const materials = order.feed_production_materials ?? [];
    let orderCost = 0;
    let orderHasCost = false;

    for (const line of materials) {
      totalLines += 1;
      const quantityKg = Number(line.quantity_kg ?? 0) || 0;
      const lineTotal = Number(line.total_cost ?? 0) || 0;
      const unitCost = Number(line.unit_cost ?? 0) || 0;
      const estimatedCost = line.item_id ? quantityKg * (latestPrices.get(line.item_id) ?? 0) : 0;
      const cost = lineTotal > 0 ? lineTotal : unitCost > 0 ? quantityKg * unitCost : estimatedCost;

      if (cost > 0) {
        pricedLines += 1;
        orderHasCost = true;
        orderCost += cost;
      }
    }

    if (orderHasCost) {
      materialCost += orderCost;
      bagsWithCost += Number(order.practical_bags ?? 0) || 0;
    }
  }

  const materialCostPerBag = bagsWithCost > 0 ? materialCost / bagsWithCost : 0;
  const maquilaCostPerBag = Number(latestMaquila?.maquila_cost_per_kg ?? 0) * 40;

  return {
    material_cost_per_bag: materialCostPerBag,
    maquila_cost_per_bag: maquilaCostPerBag,
    total_cost_per_bag: materialCostPerBag + maquilaCostPerBag,
    material_cost_basis:
      totalLines > 0
        ? `${pricedLines}/${totalLines} lineas valorizadas`
        : "Sin consumos valorizados",
    maquila_cost_basis: latestMaquila?.month_start
      ? `Maquila ${latestMaquila.month_start.slice(0, 7)}`
      : "Sin periodo de maquila"
  };
}

function decorateReceipt(
  receipt: RawMaterialReceipt,
  lookup: ReturnType<typeof buildItemLookup>
): RawMaterialReceipt {
  const relation = firstRelation(receipt.items);
  const item = receipt.item_id
    ? lookup.byId.get(receipt.item_id)
    : relation?.code
      ? lookup.byCode.get(relation.code)
      : undefined;

  return {
    ...receipt,
    item_icon_url: item?.item_icon_url ?? null,
    item_icon_label: item?.item_icon_label ?? itemIconLabel(relation ?? {})
  };
}

function buildPlantEntries(
  receipts: RawMaterialReceipt[],
  lookup: ReturnType<typeof buildItemLookup>
): PlantActivity[] {
  return receipts
    .map((receipt) => decorateReceipt(receipt, lookup))
    .filter((receipt) => Number(receipt.quantity_kg ?? 0) > 0)
    .map((receipt) => {
      const relation = firstRelation(receipt.items);

      return {
        date: receipt.receipt_date,
        title: relation?.name ?? relation?.code ?? "Materia prima",
        detail: unitPriceForReceipt(receipt) > 0 ? "Entrada valorizada" : "Entrada sin precio",
        quantity: receipt.quantity_kg,
        unit: "kg",
        item_id: receipt.item_id,
        item_code: relation?.code ?? null,
        item_name: relation?.name ?? null,
        item_type: relation?.item_type ?? "raw_material",
        item_icon_url: receipt.item_icon_url ?? null,
        item_icon_label: receipt.item_icon_label ?? itemIconLabel(relation ?? {})
      };
    })
    .slice(0, 12);
}

function buildPlantProductionActivities(
  feedProduction: FeedProductionDaily[],
  lookup: ReturnType<typeof buildItemLookup>
): PlantActivity[] {
  return feedProduction.slice(0, 12).map((row) => {
    const item = row.output_item_code ? lookup.byCode.get(row.output_item_code) : undefined;

    return {
      date: row.production_date,
      title: row.output_item_name ?? row.formula_name ?? "Produccion",
      detail: row.formula_name ?? row.formula_code ?? "Formula",
      quantity: row.practical_bags ?? row.output_quantity_bags,
      unit: "btos",
      item_id: item?.id ?? null,
      item_code: row.output_item_code,
      item_name: row.output_item_name,
      item_type: item?.item_type ?? "feed",
      item_icon_url: item?.item_icon_url ?? null,
      item_icon_label: item?.item_icon_label ?? itemIconLabel({
        code: row.output_item_code,
        name: row.output_item_name,
        item_type: "feed"
      })
    };
  });
}

function buildPlantMaterialExits(
  orders: FeedProductionOrderForCost[],
  lookup: ReturnType<typeof buildItemLookup>
): PlantActivity[] {
  const activities: PlantActivity[] = [];
  const sortedOrders = [...orders].sort((left, right) =>
    String(right.production_date ?? "").localeCompare(String(left.production_date ?? ""))
  );

  for (const order of sortedOrders) {
    for (const line of order.feed_production_materials ?? []) {
      const relation = firstRelation(line.items);
      const item = line.item_id
        ? lookup.byId.get(line.item_id)
        : relation?.code
          ? lookup.byCode.get(relation.code)
          : undefined;

      activities.push({
        date: order.production_date,
        title: item?.name ?? relation?.name ?? relation?.code ?? "Materia prima",
        detail: "Consumo en produccion",
        quantity: line.quantity_kg,
        unit: "kg",
        item_id: line.item_id,
        item_code: item?.code ?? relation?.code ?? null,
        item_name: item?.name ?? relation?.name ?? null,
        item_type: item?.item_type ?? relation?.item_type ?? "raw_material",
        item_icon_url: item?.item_icon_url ?? null,
        item_icon_label: item?.item_icon_label ?? itemIconLabel(relation ?? {})
      });
    }
  }

  return activities.filter((activity) => Number(activity.quantity ?? 0) > 0).slice(0, 12);
}

function buildPlantExits(
  movements: InventoryMovementForActivity[],
  lookup: ReturnType<typeof buildItemLookup>
): PlantActivity[] {
  const activities: PlantActivity[] = [];

  for (const movement of movements) {
    for (const line of movement.inventory_movement_lines ?? []) {
      const relation = firstRelation(line.items);
      const item = relation?.id
        ? lookup.byId.get(relation.id)
        : relation?.code
          ? lookup.byCode.get(relation.code)
          : undefined;
      const itemType = item?.item_type ?? relation?.item_type ?? null;

      if (itemType !== "raw_material" && movement.movement_type !== "consumption") {
        continue;
      }

      activities.push({
        date: movement.movement_date,
        title: item?.name ?? relation?.name ?? relation?.code ?? "Salida",
        detail: movement.reference ? `Ref. ${movement.reference}` : movement.movement_type ?? "Salida",
        quantity: line.quantity,
        unit: line.unit ?? "kg",
        item_id: item?.id ?? relation?.id ?? null,
        item_code: item?.code ?? relation?.code ?? null,
        item_name: item?.name ?? relation?.name ?? null,
        item_type: itemType,
        item_icon_url: item?.item_icon_url ?? null,
        item_icon_label: item?.item_icon_label ?? itemIconLabel(relation ?? {})
      });
    }
  }

  return activities.slice(0, 12);
}

export async function getDashboardData(): Promise<DashboardData> {
  const [
    alerts,
    health,
    posture,
    layerDaily,
    layerStandardCurves,
    poultryHouseFarms,
    vaccinations,
    negativeInventory,
    inventory,
    feedProduction,
    feedCosts,
    itemCatalog,
    warehouses,
    entityAttachments,
    rawMaterialReceipts,
    feedProductionOrders,
    plantExitMovements,
    eggGrading,
    financeDocuments,
    cash,
    store,
    salesDocuments
  ] = await Promise.all([
    selectView<DataQualityAlert>("gold_data_quality_alerts", (view) =>
      view.select("*").order("severity").order("area")
    ),
    selectView<ProcessHealth>("gold_kpi_sync_transform_health", (view) =>
      view.select("*").order("process_type").order("process_name")
    ),
    selectView<LayerLotSummary>("gold_kpi_postura_lote_resumen", (view) =>
      view.select("*").order("lot_code")
    ),
    selectOptionalRows<LayerDailyKpi>("v_kpi_postura_lote_diario", (view) =>
      view.select("*").order("record_date", { ascending: false }).limit(120)
    ),
    selectOptionalRows<LayerStandardCurve>("layer_standard_curves", (view) =>
      view.select("week_number,gad,haa,pp,weight_gr").order("week_number").limit(120)
    ),
    selectOptionalRows<PoultryHouseFarm>("poultry_houses", (view) =>
      view.select("name,locations(name)").limit(500)
    ),
    selectOptionalRows<VaccinationTimeline>("vaccinations", (view) =>
      view
        .select(
          "vaccination_date,laboratory,strains,commercial_name,administration_route,veterinarian,notes,metadata,production_lots(lot_code,name),poultry_houses(name),items(code,name),categories(code,name)"
        )
        .order("vaccination_date", { ascending: false })
        .limit(20)
    ),
    selectView<InventoryBalance>("gold_kpi_inventario_actual", (view) =>
      view.select("*").lt("current_quantity", 0).order("current_quantity").limit(12)
    ),
    selectView<InventoryBalance>("gold_kpi_inventario_actual", (view) =>
      view.select("*").order("last_movement_date", { ascending: false }).limit(500)
    ),
    selectView<FeedProductionDaily>("gold_kpi_planta_produccion_diaria", (view) =>
      view.select("*").order("production_date", { ascending: false }).limit(30)
    ),
    selectOptionalRows<FeedCostMonthly>("v_kpi_planta_costos_mensuales", (view) =>
      view.select("*").order("month_start", { ascending: false }).limit(12)
    ),
    selectOptionalRows<ItemCatalog>("items", (view) =>
      view.select("id,code,name,category_id,item_type,metadata").limit(2000)
    ),
    selectOptionalRows<WarehouseCatalog>("warehouses", (view) =>
      view.select("id,code,name,warehouse_type,category_id,metadata").limit(1000)
    ),
    selectOptionalRows<EntityAttachment>("attachments", (view) =>
      view
        .select("id,entity_table,entity_id,file_kind,file_name,file_ref,mime_type")
        .in("entity_table", ["items", "categories", "warehouses"])
        .eq("file_kind", "image")
        .limit(2000)
    ),
    selectOptionalRows<RawMaterialReceipt>("raw_material_receipts", (view) =>
      view
        .select(
          "receipt_date,item_id,quantity_kg,unit_price_without_tax,unit_price_with_tax,items(id,code,name,item_type)"
        )
        .order("receipt_date", { ascending: false })
        .limit(500)
    ),
    selectOptionalRows<FeedProductionOrderForCost>("feed_production_orders", (view) =>
      view
        .select(
          "id,production_date,practical_bags,feed_production_materials(item_id,quantity_kg,unit_cost,total_cost,items(id,code,name,item_type))"
        )
        .order("production_date", { ascending: false })
        .limit(40)
    ),
    selectOptionalRows<InventoryMovementForActivity>("inventory_movements", (view) =>
      view
        .select(
          "id,movement_date,movement_type,reference,notes,inventory_movement_lines(quantity,unit,items(id,code,name,item_type))"
        )
        .in("movement_type", ["out", "consumption", "transfer"])
        .order("movement_date", { ascending: false })
        .limit(80)
    ),
    selectView<EggGradingDaily>("gold_kpi_clasificadora_diaria", (view) =>
      view.select("*").order("grading_date", { ascending: false }).limit(30)
    ),
    selectView<FinanceMonthly>("gold_kpi_finanzas_documentos_mensual", (view) =>
      view.select("*").order("month_start", { ascending: false }).limit(24)
    ),
    selectView<CashMonthly>("gold_kpi_finanzas_caja_mensual", (view) =>
      view.select("*").order("month_start", { ascending: false }).limit(8)
    ),
    selectView<StoreDaily>("gold_kpi_tienda_resumen_diario", (view) =>
      view.select("*").order("summary_date", { ascending: false }).limit(30)
    ),
    selectOptionalRows<FinancialDocumentForDailySales>("financial_documents", (view) =>
      view
        .select("issue_date,total_amount,balance_amount,status")
        .eq("direction", "receivable")
        .order("issue_date", { ascending: false })
        .limit(250)
    )
  ]);

  const latestCash = cash[0];
  const latestStore = store[0];
  const itemLookup = buildItemLookup(itemCatalog, entityAttachments);
  const warehouseLookup = buildWarehouseLookup(warehouses, entityAttachments);
  const decoratedInventory = decorateInventoryRows(inventory, itemLookup, warehouseLookup);
  const decoratedNegativeInventory = decorateInventoryRows(
    negativeInventory,
    itemLookup,
    warehouseLookup
  );
  const plantMaterialExits = buildPlantMaterialExits(feedProductionOrders, itemLookup);
  const plantMovementExits = buildPlantExits(plantExitMovements, itemLookup);

  return {
    generatedAt: new Date().toISOString(),
    alerts,
    health,
    posture,
    layerDaily,
    layerStandardCurves,
    poultryHouseFarms,
    vaccinations,
    negativeInventory: decoratedNegativeInventory,
    inventory: decoratedInventory,
    feedProduction,
    feedCosts,
    plantCost: computePlantCost(feedCosts, feedProductionOrders, rawMaterialReceipts),
    plantEntries: buildPlantEntries(rawMaterialReceipts, itemLookup),
    plantProductionActivities: buildPlantProductionActivities(feedProduction, itemLookup),
    plantExits: plantMaterialExits.length > 0 ? plantMaterialExits : plantMovementExits,
    eggGrading,
    financeDocuments,
    cash,
    store,
    dailySales: groupDailySales(salesDocuments),
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
