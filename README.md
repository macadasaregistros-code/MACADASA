# MACADASA

Base gerencial MACADASA para consolidar datos de AppSheet/Google Sheets en Supabase y servir un panel PWA server-side.

## App local

```bash
npm install
npm run app:dev
```

Abrir:

```text
http://127.0.0.1:3100
```

Calidad de datos:

```text
http://127.0.0.1:3100/calidad
```

## Variables

Crear `.env` desde `.env.example`. No subir secretos al repositorio.

```text
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
SUPABASE_DB_URL=
GOOGLE_DRIVE_FOLDER_ID=
```

`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PRIVATE_KEY` y `SUPABASE_DB_URL` son solo para servidor, scripts y despliegue seguro.

## Scripts principales

```bash
npm run db:migrate
npm run sync:sheets:dry
npm run sync:sheets
npm run transform:masters
npm run transform:inventory
npm run transform:finance
npm run transform:feed
npm run transform:layer
npm run transform:egg
npm run transform:store
npm run typecheck
```

## Vercel

El proyecto incluye funciones serverless en `api/` y `vercel.json` para servir:

- `/`
- `/calidad`
- `/health`
- `/api/dashboard-data`
- `/api/quality-data`
- `/api/export/*.csv`

En Vercel se deben configurar como Environment Variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Las credenciales de Google solo son necesarias en Vercel si se van a correr sincronizaciones desde funciones/cron. Para despliegue inicial del panel gerencial, basta con Supabase.
