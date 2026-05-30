# Supabase

## Objetivo

Persistir datos de ticketera en el proyecto Supabase `jvmibnyiinzpkahbkyec.supabase.co`.

## Variables vigentes

- `SUPABASE_DB_URL` para conexion server-side directa al pooler Postgres. Es el modo recomendado para produccion.
- `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL` como URL REST publica.
- `SUPABASE_REST_URL` como alternativa explicita si `SUPABASE_URL` no debe usarse para REST.
- `SUPABASE_SERVICE_ROLE_KEY` para backend REST cuando exista una llave real `service_role`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `SUPABASE_ANON_KEY` solo para lectura/fallback REST; no se usa para escrituras server-side en produccion.

## Flujo funcional

1. `server/lib/storage.js` detecta Supabase desde `.env.local`.
2. Si existe `SUPABASE_DB_URL`, lee y escribe por Postgres (`pg`) contra las tablas `hfc_*`.
3. Si no existe `SUPABASE_DB_URL`, intenta REST con llave server-side.
4. Si Supabase esta configurado pero falta schema, registra warning y usa `data/app-state.json` como fallback local solo fuera de produccion.
5. `npm run supabase:check` verifica modo, conteos y warning sin mostrar credenciales.

## Schema

El SQL vigente esta en `supabase/schema.sql`.

Tablas:

- `hfc_users`
- `hfc_sessions`
- `hfc_orders`
- `hfc_tickets`
- `hfc_invoices`
- `hfc_payments`
- `hfc_settings`
- `hfc_contacts`
- `hfc_email_templates`
- `hfc_email_logs`
- `hfc_audit`

Cada tabla guarda columnas indice utiles y un `payload jsonb` con el documento completo de la app.

## Pendientes

- Evaluar migrar desde payload JSONB a columnas normalizadas cuando se estabilice el modelo final.
- Agregar politicas RLS si se expone lectura directa desde frontend en el futuro.
