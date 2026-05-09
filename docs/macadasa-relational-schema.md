# Estructura relacional MACADASA

Esta migración deja la base en tres capas:

1. `raw_appsheet_records` y `raw_appsheet_attachments`: staging/auditoría de AppSheet y Google Sheets.
2. Tablas normalizadas: maestros y transacciones para la app gerencial MACADASA.
3. Vistas `v_*`: lecturas preparadas para dashboards, reportes, PDF y validación.

La app MACADASA debe leer de las tablas normalizadas o de vistas, no directamente de `raw_data`.

## Auditoría e integración

Tablas principales:

- `sync_runs`
- `sync_run_items`
- `transform_runs`
- `raw_appsheet_records`
- `raw_appsheet_attachments`
- `external_references`
- `attachments`

`external_references` conecta cada registro limpio con su origen:

- `entity_table`
- `entity_id`
- `source_name`
- `source_primary_key`
- `raw_record_id`
- `row_hash`
- `first_seen_at`
- `last_seen_at`

Regla: cada transformación debe hacer upsert usando `source_name + source_primary_key` y registrar la relación en `external_references`.

## Maestros compartidos

Tablas:

- `business_units`
- `locations`
- `warehouses`
- `cost_centers`
- `users`
- `categories`
- `items`
- `third_parties`
- `third_party_roles`
- `third_party_details`
- `production_lots`
- `poultry_houses`

Unificaciones importantes:

- `Productos`, `MateriasPrimas`, `Items`, `TamañoHuevo` y conceptos vendibles/inventariables deben ir a `items`.
- `Proveedores`, `Transportistas`, `RazonSocial`, `Tiendas` y `Beneficiario` deben ir a `third_parties`, con roles en `third_party_roles`.
- `InventarioBultos` e `InventarioHuevos` deben tratarse como balances/snapshots, no como fuente transaccional principal.

## Inventario

Tablas:

- `inventory_movements`
- `inventory_movement_lines`
- `inventory_balances`
- `inventory_transfer_types`

Regla: los saldos de inventario deben calcularse desde movimientos. `inventory_balances` sirve para snapshots o controles, no como verdad primaria si hay movimientos detallados.

## Finanzas, facturas y caja

Tablas:

- `financial_documents`
- `financial_document_lines`
- `payments`
- `payment_allocations`
- `cash_movements`
- `cost_transactions`
- `tax_periods`
- `fixed_assets`
- `depreciation_entries`

Regla crítica: `financial_documents`/`payments` son contabilidad documental; `cash_movements` es caja/tesorería. No se deben sumar ambas capas juntas sin conciliación, porque puede duplicar ingresos o gastos.

## Planta de concentrado

Tablas:

- `feed_formulas`
- `feed_formula_lines`
- `feed_production_orders`
- `feed_production_materials`
- `feed_production_outputs`
- `raw_material_receipts`
- `lab_samples`
- `admin_cost_periods`
- `maquila_cost_periods`
- `feed_sale_price_periods`

## Granjas de postura

Tablas:

- `layer_daily_records`
- `layer_standard_curves`
- `farm_entries`
- `vaccinations`
- `farm_adjustments`

`farm_adjustments` debe usarse para ajustes o correcciones. No debe duplicar producción diaria que ya exista en `layer_daily_records`.

## Clasificadora de huevo

Tablas:

- `egg_grading_records`
- `egg_grading_entries`
- `egg_grading_outputs`
- `egg_grading_output_lines`

## MCDS / tienda / ventas

Tablas:

- `store_egg_entries`
- `store_egg_inventory_counts`
- `chicken_weight_batches`
- `chicken_weight_lines`
- `store_expenses`
- `store_prices`
- `promotions`

## Mercadeo y clientes

Tablas:

- `sales_channels`
- `stores`
- `prospects`
- `price_research`
- `store_purchases`

`Tiendas` debe convertirse principalmente en clientes/establecimientos: `third_parties` + `stores`.

## Vistas iniciales

- `v_macadasa_raw_sync_summary`
- `v_macadasa_raw_records_by_source`
- `v_inventory_balance_latest`
- `v_financial_open_documents`
- `v_cash_movements_monthly`
- `v_layer_daily_kpis`
- `v_store_purchase_summary`
- `v_external_reference_coverage`

Estas vistas son punto de partida para dashboards. Se pueden reemplazar o ampliar cuando existan transformaciones con datos reales en las tablas limpias.

## Vistas KPI gerenciales

La app MACADASA debe consumir preferiblemente estas vistas para el primer dashboard gerencial:

Postura:

- `v_kpi_postura_lote_diario`
- `v_kpi_postura_lote_resumen`

Inventario:

- `v_kpi_inventario_movimientos_signed`
- `v_kpi_inventario_actual`

Planta de concentrado:

- `v_kpi_planta_produccion_diaria`
- `v_kpi_planta_costos_mensuales`

Clasificadora:

- `v_kpi_clasificadora_diaria`
- `v_kpi_clasificadora_salidas_diarias`

Finanzas:

- `v_kpi_finanzas_documentos_mensual`
- `v_kpi_finanzas_caja_mensual`

Tienda y mercadeo:

- `v_kpi_tienda_resumen_diario`

Control operativo:

- `v_kpi_sync_transform_health`
- `v_data_quality_alerts`

Notas:

- `v_kpi_inventario_actual` es un saldo derivado desde movimientos normalizados. Si una hoja historica no tiene todos los movimientos, puede mostrar saldos negativos; esos casos aparecen en `v_data_quality_alerts`.
- `v_kpi_finanzas_caja_mensual` es caja/tesoreria. No debe sumarse con `v_kpi_finanzas_documentos_mensual` sin conciliacion.
- `v_kpi_postura_lote_resumen` no descuenta `mdv` como salida adicional porque en los datos actuales parece duplicar la mortalidad diaria.
- `v_data_quality_alerts` debe aparecer en el dashboard como panel de pendientes de datos, no como error tecnico necesariamente.

## Acceso a la app gerencial

Si la app MACADASA corre solo en una red privada o en un computador interno, se puede empezar sin login.

Si se despliega en Vercel, el enlace queda expuesto a internet. En ese caso, aunque no haya usuarios por rol todavia, se recomienda al menos una de estas protecciones:

- Vercel Deployment Protection.
- Un password simple del lado servidor.
- Supabase Auth mas adelante, cuando existan usuarios y permisos por modulo.

La app nunca debe usar `SUPABASE_SERVICE_ROLE_KEY` en el navegador. El frontend debe leer con una key publica limitada o pedir datos a rutas server-side.

## Tablas que deben quedar como raw/auditoría

No usarlas como base final normalizada:

- `Copia de DB_AppPlanta`
- `DB_Entradas`
- `DB:AppPollo`, por ahora
- `Maquila x`
- `Produccion x`
- `ProduccionDetalle x`
- `Copia de CentrosCosto`
- `Hoja 4`
- `Hoja 7`
- `Hoja 10`
- calendarios duplicados por app

## Próxima fase

La siguiente fase es ampliar los scripts de transformación idempotentes:

1. Maestros: `items`, `third_parties`, `business_units`, `locations`, `warehouses`, `cost_centers`, `production_lots`, `poultry_houses`.
2. Transacciones: inventario, facturas, pagos, caja, producción de planta, postura, clasificadora, tienda y mercadeo.
3. Validaciones: totales de encabezado contra detalle, pagos contra facturas, inventario con item/cantidad/fecha y cobertura de `external_references`.

## Transformación de maestros

Ya existe el script:

```bash
npm run transform:masters:dry
npm run transform:masters
```

También se puede correr una o varias etapas:

```bash
npm run transform:masters -- --only items
npm run transform:masters -- --only categories,items,third_parties
```

Etapas disponibles:

- `categories`
- `sales_channels`
- `locations`
- `cost_centers`
- `warehouses`
- `poultry_houses`
- `items`
- `production_lots`
- `users`
- `third_parties`
- `third_party_roles`
- `stores`
- `third_party_details`
- `transfer_types`
- `attachments`

El script lee `raw_appsheet_records`, hace upsert en tablas limpias, registra trazabilidad en `external_references` y promueve referencias de archivos a `attachments`. La corrida es idempotente: si el hash transformado no cambia, el registro queda como `unchanged`.

## Transformación de inventario

Ya existe el script:

```bash
npm run transform:inventory:dry
npm run transform:inventory
```

También se puede ejecutar por etapas:

```bash
npm run transform:inventory -- --only inventory_movements,inventory_movement_lines
```

Etapas disponibles:

- `transfer_types`
- `inventory_movements`
- `inventory_movement_lines`
- `farm_entries`
- `egg_grading_entries`
- `store_egg_entries`
- `raw_material_receipts`
- `inventory_balances`
- `attachments`

Fuentes transformadas:

- `TraspasosInventarioBultos`
- `TraspasosInventarioHuevos`
- `TraspasosInventarioCC`
- `EntradasG`
- `EntradasC`
- `EntradasM`
- `Entrada` de planta
- `Salidas` de planta

`InventarioBultos` e `InventarioHuevos` se revisan pero no se cargan como saldos porque no traen cantidad. Quedan omitidos hasta calcular saldos desde movimientos o crear snapshots reales con cantidades.

## Transformación financiera

Ya existe el script:

```bash
npm run transform:finance:dry
npm run transform:finance
```

También se puede ejecutar por etapas:

```bash
npm run transform:finance -- --only financial_documents,financial_document_lines
```

Etapas disponibles:

- `third_party_stubs`
- `third_party_roles`
- `financial_documents`
- `financial_document_lines`
- `payments`
- `payment_allocations`
- `cash_movements`
- `store_expenses`
- `cost_transactions`
- `tax_periods`
- `fixed_assets`
- `depreciation_entries`
- `attachments`

Fuentes transformadas:

- `Facturas`
- `FacturasDetalle`
- `Pagos`
- `PagosDetalle`
- `FlujoEfectivo`
- `HojaDeGastos`
- `IvaBimestre`
- `Depreciaciones`
- `CostosTransacciones`, cuando tenga registros

Regla de lectura: `financial_documents`, `financial_document_lines`, `payments` y `payment_allocations` son la capa documental/contable. `cash_movements` y `store_expenses` son caja/tesorería. No se deben sumar ambas capas juntas sin conciliación.

Los detalles de factura sin encabezado en `Facturas` se omiten para no crear documentos incompletos artificiales.

## Transformacion de planta de concentrado

Ya existe el script:

```bash
npm run transform:feed:dry
npm run transform:feed
```

Tambien se puede ejecutar por etapas:

```bash
npm run transform:feed -- --only feed_formulas,feed_formula_lines
```

Etapas disponibles:

- `feed_item_stubs`
- `feed_formulas`
- `feed_formula_lines`
- `feed_production_orders`
- `feed_production_materials`
- `feed_production_outputs`
- `lab_samples`
- `plant_audits`
- `admin_cost_periods`
- `maquila_cost_periods`
- `feed_sale_price_periods`
- `attachments`

Fuentes transformadas:

- `Formulas`
- `FormulasDetalle`
- `Produccion`
- `ProduccionDetalle`
- `Entrada` de planta, ya cargada como `raw_material_receipts` desde inventario
- `Muestras`
- `Auditorias`
- `Administracion`
- `Maquila`
- `PrecioVentaComercial`

Notas de modelo:

- `feed_production_orders` es el encabezado de produccion.
- `feed_production_materials` contiene los consumos de materias primas.
- `feed_production_outputs` contiene el producto terminado en bultos.
- `raw_material_receipts` queda como entrada de materias primas y se conecta con inventario.
- `lab_samples` conserva referencias a fotos y PDF como adjuntos; la migracion real de archivos a Supabase Storage queda para otra fase.
- `plant_audits` conserva auditorias de materia prima y producto terminado; sus imagenes quedan promovidas en `attachments`.
- `admin_cost_periods`, `maquila_cost_periods` y `feed_sale_price_periods` permiten calcular costo por kg, precio comercial y comparativos contra proveedores.
- Si aparecen productos de alimento que no existen en `Productos`, `feed_item_stubs` crea un maestro minimo en `items` para no perder produccion. En esta carga aparecieron `F1M` y `F2M`.

## Transformacion de granjas de postura

Ya existe el script:

```bash
npm run transform:layer:dry
npm run transform:layer
```

Etapas disponibles:

- `layer_standard_curves`
- `layer_daily_records`
- `vaccinations`
- `farm_adjustments`
- `attachments`

Fuentes transformadas:

- `RegistroDiarioAMP`
- `Tabla`
- `GraficoPPTabla`
- `Vacunaciones`

Notas:

- `layer_daily_records` concentra produccion diaria, mortalidad, salidas de aves, alimento, calcio, cisco y PP.
- `layer_standard_curves` conserva tanto la tabla base como valores por galpon desde `GraficoPPTabla`; el galpon queda en metadata porque la tabla actual es de curva estandar.
- `vaccinations` queda conectada a lote, galpon, categoria e item cuando la hoja trae esos datos.
- No hay fuente sincronizada de `AjusteAdministradorAMP`; por eso `farm_adjustments` queda preparado, pero no se generan ajustes artificiales desde registros diarios.

## Transformacion de clasificadora de huevo

Ya existe el script:

```bash
npm run transform:egg:dry
npm run transform:egg
```

Etapas disponibles:

- `egg_grading_records`
- `egg_grading_entries`
- `egg_grading_outputs`
- `egg_grading_output_lines`
- `attachments`

Fuentes transformadas:

- `Clasificadora`
- `EntradasC`
- `SalidasC`
- `SalidaCDetalle`

Notas:

- `egg_grading_records` guarda la clasificacion por fecha, lote, galpon, item y cantidad.
- `egg_grading_outputs` es el encabezado de salida.
- `egg_grading_output_lines` exige encontrar su salida padre por `SalidaC`; si no existe encabezado, la linea se omite.
- `EntradasC` tambien participa en inventario; este transformador usa el mismo payload para evitar cambios repetidos entre scripts.

## Transformacion de tienda y mercadeo

Ya existe el script:

```bash
npm run transform:store:dry
npm run transform:store
```

Etapas disponibles:

- `store_egg_inventory_counts`
- `chicken_weight_batches`
- `chicken_weight_lines`
- `store_prices`
- `promotions`
- `store_purchases`
- `attachments`

Fuentes transformadas:

- `InventarioHuevoM`
- `PesoPollo`
- `PesoPolloDetalle`
- `PesoPolloMenudenciaDetalle`
- `Precios`
- `Z_Promociones`
- `TiendasCompras`
- `Tiendas`, solo como lookup para conectar compras con establecimientos

Notas:

- `store_egg_entries` y `store_expenses` ya se cargan desde inventario y finanzas.
- `store_egg_inventory_counts` son conteos/snapshots de tienda, no movimientos primarios.
- `chicken_weight_batches` es el encabezado de pesaje y `chicken_weight_lines` separa canal (`carcass`) y menudencia (`offal`).
- `store_prices` usa `1970-01-01` como `effective_date` cuando la hoja no trae fecha de vigencia; la fecha real debe agregarse a la hoja si se necesita historico exacto de precios.
- `store_purchases` queda conectado a `stores` por `tiendaid`.
