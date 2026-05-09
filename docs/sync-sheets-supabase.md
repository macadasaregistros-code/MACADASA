# Sincronizacion Google Sheets a Supabase

Esta capa consolida las hojas usadas por AppSheet en Supabase. La primera fase guarda todo en staging raw y registra trazabilidad. La segunda fase transforma esos datos hacia una base gerencial relacional para construir la app MACADASA.

## Principios

- La Service Account de Google debe tener solo lectura sobre los Google Sheets.
- El script usa el scope `https://www.googleapis.com/auth/spreadsheets.readonly`.
- El descubrimiento de carpetas usa el scope `https://www.googleapis.com/auth/drive.metadata.readonly`.
- Supabase recibe UPSERT por `source_uid`; no se duplican registros.
- Si una fila no cambia, se omite para mejorar rendimiento.
- No se borran registros de Supabase durante la sincronizacion.
- Los adjuntos de AppSheet se guardan como referencias, no como archivos descargados.

## Migraciones

Ejecuta estas migraciones en orden:

```text
supabase/migrations/20260507000000_create_sync_raw_appsheet.sql
supabase/migrations/20260507000500_create_raw_appsheet_attachments.sql
supabase/migrations/20260507001000_create_macadasa_management_schema.sql
```

La primera crea:

- `sync_sources`
- `sync_runs`
- `sync_run_items`
- `raw_appsheet_records`

La segunda crea:

- `raw_appsheet_attachments`

La tercera crea el primer modelo gerencial relacionado:

- unidades de negocio
- sedes y bodegas
- centros de costo
- terceros
- productos
- lotes productivos
- galpones
- movimientos de inventario
- produccion diaria
- ventas
- documentos financieros
- movimientos financieros
- adjuntos relacionados a entidades
- logs de transformacion

## Crear la Service Account de Google

1. Entra a Google Cloud Console.
2. Crea o selecciona un proyecto.
3. Activa Google Sheets API.
4. Activa Google Drive API si quieres inventariar carpetas compartidas.
5. Ve a IAM & Admin > Service Accounts.
6. Crea una Service Account, por ejemplo `macadasa-sheets-sync`.
7. Crea una key JSON.
8. Del JSON toma:
   - `client_email` para `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` para `GOOGLE_PRIVATE_KEY`

No subas el JSON al repositorio.

## Compartir los Google Sheets

Comparte cada archivo de Google Sheets con el email de la Service Account como lector.

Ejemplo:

```text
macadasa-sheets-sync@tu-proyecto.iam.gserviceaccount.com
```

No le des permiso de editor. La sincronizacion no necesita escribir nada en Google Sheets.

## Descubrir y mapear una carpeta

Si la carpeta de Drive esta compartida con la Service Account como lector, puedes generar un inventario automatico:

```bash
npm run discover:sheets -- --folder https://drive.google.com/drive/folders/DRIVE_FOLDER_ID
```

Tambien puedes guardar el ID en `.env`:

```bash
GOOGLE_DRIVE_FOLDER_ID=DRIVE_FOLDER_ID
```

Y ejecutar:

```bash
npm run discover:sheets
```

Esto genera:

```text
docs/google-sheets-discovery.md
docs/google-sheets-discovery.json
```

El reporte muestra archivos, `spreadsheetId`, pestanas, conteo aproximado de filas/columnas y encabezados detectados. Ese archivo sirve para ajustar `sources.config.ts` y disenar las transformaciones hacia la base gerencial.

## Adjuntos de AppSheet

Algunas tablas de AppSheet tienen fotos, PDFs o soportes. Con acceso solo a Google Sheets, el script puede leer lo que este guardado en la celda: ruta, nombre de archivo, URL o referencia.

Eso se guarda en `raw_appsheet_attachments` con:

- registro raw asociado
- columna de origen
- ruta o URL
- nombre de archivo
- extension
- tipo basico: imagen, PDF, documento, hoja de calculo u otro
- posible Google Drive file ID si la referencia lo contiene

Importante: con solo Google Sheets API no se descarga el archivo real. Para mostrar o migrar los archivos en MACADASA mas adelante hay dos caminos:

- mantener el enlace original si AppSheet/Drive lo permite;
- dar permiso de lectura de Drive a la Service Account y crear una sincronizacion separada hacia Supabase Storage.

Esa sincronizacion de archivos debe usar un scope de Drive de solo lectura y debe ser separada del proceso de lectura de tablas.

## Variables de entorno

Copia `.env.example` a `.env` y llena:

```bash
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_SERVICE_ACCOUNT_EMAIL=macadasa-sheets-sync@tu-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=
GOOGLE_DRIVE_FOLDER_ID=ID_DE_LA_CARPETA_OPCIONAL
```

`SUPABASE_SERVICE_ROLE_KEY` solo va en scripts o backend. Nunca la pongas en frontend ni en variables `NEXT_PUBLIC_*`.

## Configurar fuentes

Edita:

```text
src/sync/sources.config.ts
```

Para cada fuente:

1. Reemplaza `spreadsheetId` por el ID real.
2. Confirma `sheetName`.
3. Confirma `primaryKeyColumn`.
4. Confirma `updatedAtColumn`, si existe.
5. Ajusta `requiredColumns`.
6. Ajusta `attachmentColumns` si tiene fotos, PDFs o soportes.
7. Ajusta `columnMap` para nombres gerenciales consistentes.
8. Ajusta `typeMap` para fechas, numeros y booleanos.
9. Cambia `isActive` a `true`.

El `spreadsheetId` sale de la URL:

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

No uses `_RowNumber` como llave primaria si existe un ID real de AppSheet. `_RowNumber` cambia cuando se insertan, eliminan u ordenan filas.

## Dry-run

Prueba una fuente:

```bash
npm run sync:sheets -- --source planta_movimientos_inventario --dry-run
```

Prueba todas las fuentes activas:

```bash
npm run sync:sheets:dry
```

Dry-run lee Google Sheets y consulta Supabase para comparar, pero no escribe registros ni logs.

## Sincronizacion real

Una fuente:

```bash
npm run sync:sheets -- --source tienda_ventas
```

Todas las fuentes activas:

```bash
npm run sync:sheets
```

## Revisar logs

```sql
select *
from sync_runs
order by started_at desc
limit 20;

select *
from sync_run_items
where sync_run_id = 'PEGAR_SYNC_RUN_ID'
order by started_at;
```

Registros raw:

```sql
select source_name, app_name, sheet_name, source_primary_key, last_synced_at, raw_data
from raw_appsheet_records
where source_name = 'tienda_ventas'
order by last_synced_at desc
limit 50;
```

Adjuntos detectados:

```sql
select source_name, sheet_name, column_name, file_name, file_kind, file_ref
from raw_appsheet_attachments
where source_name = 'facturas_documentos'
order by last_seen_at desc
limit 50;
```

## Base gerencial MACADASA

La base gerencial no debe depender directamente de las hojas. Las hojas alimentan `raw_appsheet_records`; luego una fase de transformacion limpia y relaciona los datos hacia tablas como:

- `business_units`
- `locations`
- `warehouses`
- `cost_centers`
- `third_parties`
- `products`
- `production_lots`
- `poultry_houses`
- `inventory_movements`
- `daily_production_records`
- `sales_documents`
- `sales_document_lines`
- `financial_documents`
- `financial_movements`
- `record_attachments`

Ese modelo permite manejar gerencialmente planta de concentrado, granjas de postura, pollos de engorde, clasificadora, tienda, facturas, proveedores, inventarios, costos, ventas, clientes, lotes, galpones, alimento, mortalidad, produccion diaria, cuentas por pagar y cuentas por cobrar.

## Errores comunes

- `Missing required environment variable`: falta una variable en `.env`.
- `The caller does not have permission`: el Sheet no esta compartido como lector con la Service Account.
- `Unable to parse range`: `sheetName` no coincide con el nombre exacto de la pestana.
- `Missing required columns`: cambio un encabezado o `headerRow` no apunta a la fila correcta.
- `duplicate source_uid`: hay IDs duplicados en la hoja.
- Adjuntos vacios: la columna no existe, esta mal escrita en `attachmentColumns`, o AppSheet guarda el archivo en otra columna.

## Si una hoja cambia columnas

1. Ejecuta dry-run de esa fuente.
2. Ajusta `requiredColumns`.
3. Ajusta `attachmentColumns`.
4. Ajusta `columnMap` y `typeMap`.
5. Ejecuta sincronizacion real.

No cambies nombres normalizados sin revisar transformaciones, dashboards o reportes que dependan de esos campos.
