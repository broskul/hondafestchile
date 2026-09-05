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
- `hfc_special_passes`
- `hfc_order_acceptances`
- `hfc_pistons`
- `hfc_special_prizes`
- `hfc_draw_manifests`
- `hfc_draw_entries`
- `hfc_draw_results`
- `hfc_notification_outbox`

Las tablas históricas conservan columnas índice y un `payload jsonb`. El Upgrade agrega un contrato relacional: una fila por Pistón/RUT, aceptaciones versionadas, premios con elegibilidad por presencia, manifiestos inmutables, resultados y una cola idempotente de notificaciones.

## Upgrade de experiencia

- `20260809090000_special_passes.sql` crea la tabla raíz de Pases.
- `20260905120000_special_pass_upgrades.sql` amplía el contrato sin activar ventas.
- Un trigger proyecta los campos esenciales del payload del Pase y sincroniza exactamente `piston_count` filas vigentes en `hfc_pistons`.
- Invalidar o revocar un Pase revoca sus Pistones; no los elimina.
- El automóvil queda como premio `draft`, sorteo presencial el 29 de noviembre de 2026 y sin requisito de entrada o presencia.
- Los premios presenciales pueden filtrar padrón por entrada validada y check-in.
- `hfc_create_draw_manifest` congela un padrón, calcula SHA-256 y lo sella. Pistones y entradas incluidos en un manifiesto sellado no pueden cambiar de identidad.
- Insertar un resultado genera tareas separadas de email y teléfono. La cola no demuestra que hayan sido despachadas: el procesador debe registrar intentos y `sent_at`.
- Todas las tablas nuevas tienen RLS y no se entregan políticas a `anon`/`authenticated`; el backend usa `service_role` o Postgres server-side.
- `npm run passes:migration:contract` valida el contrato estático. `npm run passes:migrate` aplica las migraciones en una sola transacción con advisory lock y verifica tablas, RLS, triggers, premio, configuración y Pistones.

## Producción 2026-09-05

- Proyecto verificado: `jvmibnyiinzpkahbkyec`.
- Se instalaron en una sola transacción `20260809090000_special_passes.sql` y `20260905120000_special_pass_upgrades.sql`.
- La verificación remota devolvió `storageReady=true`; la migración dejó `special_pass_config.active=false` y `rulesPublished=false`.
- La contraseña `SUPABASE_DB_URL` de la fuente local Honda Fest del vault está desactualizada y falla autenticación. No sustituirla ni copiar la de Vercel: actualizarla mediante una migración segura de credenciales cuando corresponda.
- El `SUPABASE_ACCESS_TOKEN` inventariado en la fuente FacturaElectronica no tiene privilegios sobre Honda Fest; no volver a usarlo para este proyecto.
- Para esta instalación se usó un puente administrativo efímero desplegado en Vercel: aceptaba sólo el SQL combinado con hash aprobado, comprobaba el project ref, exigía backoffice y ventas desactivadas, ejecutaba transacción+advisory lock y verificaba el contrato. El endpoint se eliminó y se volvió a desplegar inmediatamente; no es una interfaz permanente de migración.

## Pendientes

- Ejecutar el procesador de `hfc_notification_outbox` cuando se defina el proveedor de contacto telefónico y la política de reintentos.
- No exponer lectura directa desde frontend. Si se necesitara, diseñar políticas RLS mínimas y específicas; nunca abrir las tablas de padrón o ganadores.
- Incorporar al vault una credencial DDL vigente y específica para Honda Fest antes de la próxima migración; no depender nuevamente de un endpoint temporal.
