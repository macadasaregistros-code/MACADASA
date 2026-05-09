import { getSupabaseAdminClient } from "../lib/supabaseAdmin";

export type QualityNegativeInventory = {
  warehouse_name: string | null;
  item_code: string | null;
  item_name: string | null;
  lot_code: string | null;
  last_movement_date: string | null;
  current_quantity: number | null;
  total_in_quantity: number | null;
  total_out_quantity: number | null;
};

export type QualityOverdueDocument = {
  document_type: string | null;
  document_subtype: string | null;
  document_number: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string | null;
  total_amount: number | null;
  paid_amount: number | null;
  open_amount: number | null;
  currency: string | null;
  third_party_name: string | null;
  business_unit_name: string | null;
  cost_center_name: string | null;
};

export type QualityMissingVaccinationItem = {
  source_uid: string | null;
  vaccination_date: string | null;
  lot_code: string | null;
  poultry_house_name: string | null;
  category_code: string | null;
  category_name: string | null;
  laboratory: string | null;
  strains: string | null;
  commercial_name: string | null;
  notes: string | null;
};

export type QualityUnpromotedAttachment = {
  raw_record_source_uid: string | null;
  source_name: string | null;
  source_primary_key: string | null;
  column_name: string | null;
  file_ref: string | null;
  file_name: string | null;
  file_kind: string | null;
  mime_type: string | null;
  created_at: string | null;
};

export type QualityData = {
  generatedAt: string;
  negativeInventory: QualityNegativeInventory[];
  overdueDocuments: QualityOverdueDocument[];
  missingVaccinationItems: QualityMissingVaccinationItem[];
  unpromotedAttachments: QualityUnpromotedAttachment[];
};

export const exportDefinitions = {
  dashboard_alerts: {
    fileName: "macadasa_alertas.csv",
    label: "Alertas",
    viewName: "v_data_quality_alerts"
  },
  negative_inventory: {
    fileName: "macadasa_inventario_negativo.csv",
    label: "Inventario negativo",
    viewName: "v_quality_negative_inventory_details"
  },
  negative_inventory_movements: {
    fileName: "macadasa_inventario_negativo_movimientos.csv",
    label: "Movimientos de inventario negativo",
    viewName: "v_quality_negative_inventory_movements"
  },
  overdue_documents: {
    fileName: "macadasa_documentos_vencidos.csv",
    label: "Documentos vencidos",
    viewName: "v_quality_overdue_financial_documents"
  },
  missing_vaccination_items: {
    fileName: "macadasa_vacunas_sin_item.csv",
    label: "Vacunas sin item",
    viewName: "v_quality_vaccinations_missing_item"
  },
  unpromoted_attachments: {
    fileName: "macadasa_adjuntos_no_promovidos.csv",
    label: "Adjuntos no promovidos",
    viewName: "v_quality_raw_attachments_not_promoted"
  },
  layer_lot_summary: {
    fileName: "macadasa_postura_lotes.csv",
    label: "Postura por lote",
    viewName: "v_kpi_postura_lote_resumen"
  },
  inventory_current: {
    fileName: "macadasa_inventario_actual.csv",
    label: "Inventario actual",
    viewName: "v_kpi_inventario_actual"
  },
  feed_production: {
    fileName: "macadasa_planta_produccion.csv",
    label: "Planta produccion",
    viewName: "v_kpi_planta_produccion_diaria"
  },
  egg_grading: {
    fileName: "macadasa_clasificadora.csv",
    label: "Clasificadora",
    viewName: "v_kpi_clasificadora_diaria"
  },
  finance_documents: {
    fileName: "macadasa_finanzas_documentos.csv",
    label: "Finanzas documentos",
    viewName: "v_kpi_finanzas_documentos_mensual"
  },
  store_daily: {
    fileName: "macadasa_tienda_resumen.csv",
    label: "Tienda resumen",
    viewName: "v_kpi_tienda_resumen_diario"
  }
} as const;

export type ExportKey = keyof typeof exportDefinitions;

async function selectRows<T>(viewName: string, orderColumn?: string): Promise<T[]> {
  const supabase = getSupabaseAdminClient();
  let query = supabase.from(viewName).select("*").limit(5000);

  if (orderColumn) {
    query = query.order(orderColumn, { ascending: false });
  }

  const { data, error } = (await query) as {
    data: T[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`Error leyendo ${viewName}: ${error.message}`);
  }

  return data ?? [];
}

export async function getQualityData(): Promise<QualityData> {
  const [
    negativeInventory,
    overdueDocuments,
    missingVaccinationItems,
    unpromotedAttachments
  ] = await Promise.all([
    selectRows<QualityNegativeInventory>("v_quality_negative_inventory_details"),
    selectRows<QualityOverdueDocument>("v_quality_overdue_financial_documents"),
    selectRows<QualityMissingVaccinationItem>("v_quality_vaccinations_missing_item"),
    selectRows<QualityUnpromotedAttachment>("v_quality_raw_attachments_not_promoted")
  ]);

  return {
    generatedAt: new Date().toISOString(),
    negativeInventory,
    overdueDocuments,
    missingVaccinationItems,
    unpromotedAttachments
  };
}

export async function getExportRows(exportKey: string): Promise<{
  fileName: string;
  label: string;
  rows: Array<Record<string, unknown>>;
}> {
  if (!Object.prototype.hasOwnProperty.call(exportDefinitions, exportKey)) {
    throw new Error(`Exportacion no permitida: ${exportKey}`);
  }

  const definition = exportDefinitions[exportKey as ExportKey];
  const rows = await selectRows<Record<string, unknown>>(definition.viewName);

  return {
    fileName: definition.fileName,
    label: definition.label,
    rows
  };
}
