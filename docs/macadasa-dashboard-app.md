# App gerencial MACADASA

Esta es la primera version local del panel gerencial MACADASA. Lee solamente vistas KPI y tablas normalizadas en Supabase; no lee Google Sheets ni `raw_data` directamente.

La excepcion controlada es `/validacion`, una seccion protegida para revisar los registros raw tal como llegaron desde AppSheet/Google Sheets.

## Ejecutar

```bash
npm run app:dev
```

Abrir:

```text
http://127.0.0.1:3100
```

JSON del dashboard:

```text
http://127.0.0.1:3100/api/dashboard-data
```

Pagina de calidad de datos:

```text
http://127.0.0.1:3100/calidad
```

Pagina de validacion raw:

```text
http://127.0.0.1:3100/validacion
```

Usuario: `gerencia`. Contrasena: variable `MACADASA_VALIDATION_PASSWORD`.

JSON de calidad de datos:

```text
http://127.0.0.1:3100/api/quality-data
```

## Exportaciones CSV

La app tiene exportaciones CSV server-side para revisar datos en Excel sin abrir Supabase:

```text
http://127.0.0.1:3100/api/export/dashboard_alerts.csv
http://127.0.0.1:3100/api/export/negative_inventory.csv
http://127.0.0.1:3100/api/export/negative_inventory_movements.csv
http://127.0.0.1:3100/api/export/overdue_documents.csv
http://127.0.0.1:3100/api/export/missing_vaccination_items.csv
http://127.0.0.1:3100/api/export/unpromoted_attachments.csv
http://127.0.0.1:3100/api/export/layer_lot_summary.csv
http://127.0.0.1:3100/api/export/inventory_current.csv
http://127.0.0.1:3100/api/export/feed_production.csv
http://127.0.0.1:3100/api/export/egg_grading.csv
http://127.0.0.1:3100/api/export/finance_documents.csv
http://127.0.0.1:3100/api/export/store_daily.csv
```

La validacion raw tambien permite exportar por fuente desde:

```text
http://127.0.0.1:3100/api/validation/export.csv?source=FUENTE
```

El limite es 25,000 filas por exportacion. Si una fuente supera ese limite, usar el filtro `q`.

## Vistas usadas

- `v_kpi_postura_lote_resumen`
- `v_kpi_inventario_actual`
- `v_kpi_planta_produccion_diaria`
- `v_kpi_clasificadora_diaria`
- `v_kpi_finanzas_documentos_mensual`
- `v_kpi_finanzas_caja_mensual`
- `v_kpi_tienda_resumen_diario`
- `v_kpi_sync_transform_health`
- `v_data_quality_alerts`
- `v_quality_negative_inventory_details`
- `v_quality_negative_inventory_movements`
- `v_quality_overdue_financial_documents`
- `v_quality_vaccinations_missing_item`
- `v_quality_raw_attachments_not_promoted`
- `v_raw_validation_sources`
- `v_raw_validation_records`

## Seguridad

El servidor usa `SUPABASE_SERVICE_ROLE_KEY` solo del lado servidor. Esa clave no se envia al navegador.

`/validacion`, `/validacion/fuente` y `/api/validation/*` usan HTTP Basic Auth. El usuario fijo es `gerencia`; la contrasena se configura con `MACADASA_VALIDATION_PASSWORD`. Si esa variable falta, esas rutas responden `503` y no entregan datos raw.

El panel principal puede seguir sin login mientras sea uso gerencial controlado, pero la validacion raw queda protegida porque muestra los datos originales.

## PWA

Incluye:

- `public/manifest.webmanifest`
- `public/sw.js`
- `public/icon.svg`

Esto permite instalarla como app cuando se sirva por un origen compatible.

## Siguiente paso

Cuando npm permita instalar dependencias nuevas sin bloquearse, se puede portar esta pantalla a Next.js usando la misma capa de datos y vistas. El bloqueo actual ocurrio durante `npm install next react react-dom lucide-react`; no se cambiaron secretos ni se expusieron llaves.
