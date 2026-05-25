# Supabase

## Objetivo

Persistir datos de ticketera en el proyecto Supabase `jxvvjshuxdtpndskcdbk.supabase.co`.

## Variables vigentes

- `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` para el backend
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `SUPABASE_ANON_KEY` como fallback no recomendado para escrituras server-side

## Flujo funcional

1. `server/lib/storage.js` detecta Supabase desde `.env.local`.
2. Si existen las tablas `hfc_*`, lee y escribe mediante Supabase REST.
3. Si Supabase esta configurado pero falta schema, registra warning y usa `data/app-state.json` como fallback local.
4. `npm run supabase:check` verifica modo, conteos y warning sin mostrar credenciales.

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

- Ejecutar `supabase/schema.sql` en SQL Editor del proyecto.
- Evaluar migrar desde payload JSONB a columnas normalizadas cuando se estabilice el modelo final.
- Agregar politicas RLS si se expone lectura directa desde frontend en el futuro.
