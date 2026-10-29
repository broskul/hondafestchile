# Cancelaciones y reembolsos

## Japon Fest Chile 2026

- Fecha de baja operativa: 2026-07-08.
- Evento removido de la ticketera productiva mediante `/api/backoffice/ticketing`.
- El catalogo base del repo mantiene `japon-fest-chile-2026` con `active: false` para evitar que reaparezca si no existe configuracion persistente.
- Corte de calculo productivo: 2026-07-08 15:55 hrs. Chile aprox.

### Cierre de accesos y comunicaciones

- Japon Fest Chile 2026 es un evento cancelado y reembolsado: ninguna orden asociada puede volver a completar pago, emitir entradas, emitir DTE ni recibir un enlace de enrolamiento.
- La carga de `/api/backoffice/summary` es exclusivamente de lectura. No puede enviar recordatorios de enrolamiento ni otro correo como efecto secundario.
- La auditoria administrativa de este caso esta disponible en `GET /api/backoffice/japon-fest-cancellation/audit`; `POST /api/backoffice/japon-fest-cancellation/repair` solo aplica cambios con `{ "apply": true }`.
- La reparacion marca las ordenes como `cancelled_refunded`, anula las entradas, revoca y elimina tokens de enrolamiento y suprime nuevos envios. No crea reembolsos, notas de credito ni correos; esos movimientos tienen su propio respaldo operativo.

### Aplicacion productiva 2026-08-27

- Auditoria previa: 35 ordenes JFC (`11 paid`, `21 payment_expired`, `3 payment_failed`), 26 con perfil pendiente, 2 tokens de enrolamiento activos y 15 entradas emitidas (`14 valid`, `1 checked_in`).
- Se registraron 29 correos historicos asociados: 22 `enrollment_invitation` enviados (el ultimo el 2026-08-26), 3 `dte_reissued`, 3 `payment_failed_retry` y 1 `resend_order` historico.
- Reparacion aplicada una vez: 35 ordenes cambiadas a `cancelled_refunded`, 2 tokens revocados y 15 entradas anuladas. Resultado verificado: 0 perfiles pendientes, 0 tokens activos y 15 tickets con estado `cancelled`.
- Prueba de no-regresion: cargar `/api/backoffice/summary` no altero los 29 logs historicos y devolvio `enrollmentRemindersSent: 0`.

### Corte verificado 2026-07-29

- Fuente Supabase productiva: `/api/backoffice/summary`, storage `postgres`. Desde el cierre de accesos, esa ruta es estrictamente de lectura y no envía recordatorios.
- Supabase local directo no fue fuente valida en este corte porque la URL Postgres local respondio `password authentication failed`; la app productiva si reporta Supabase activo.
- Mercado Pago API confirma 10 ordenes Japon Fest con reembolso aprobado por total `$183.392`.
- Haulmer/OpenFactura directo confirma 6 boletas reales con estado `Aceptado`, folios `15351` a `15356`, por total registrado `$126.082`.
- DTE demo reembolsados: 3 ordenes por `$45.848`; no corresponden a nota de credito tributaria real mientras sigan siendo documentos demo.
- Reembolso sin DTE registrado: 1 orden por `$11.462`; corresponde reembolso operativo, no nota de credito tributaria mientras no exista boleta emitida.
- Orden excluida del monto confirmado: `order_e9f81040230f71604973` por `$9.330`, marcada `paid` en Supabase pero Mercado Pago responde `Payment not found` con las credenciales productivas actuales; no tiene boleta ni tickets.
- Contraste banco/MP wallet: el export local `Mercado Pago > Actividades` del 2026-07-27 tiene 463 movimientos, pero no contiene referencias directas a orden, pago, comprador ni coincidencias por monto+fecha de estos reembolsos. No sirve como cartola bancaria concluyente para este corte.
- Respaldo de auditoria generado en `.codex-logs/jfc-credit-note-audit.json`, `.codex-logs/jfc-credit-note-audit.csv` y `.codex-logs/jfc-haulmer-status-2026-07-29.json`.

### Reembolso

- Total reembolsado confirmado por Mercado Pago: `$183.392`.
- No usar el total preliminar `$192.722` para nota de credito ni reembolso final sin respaldo externo; incluia la orden smoke/test/unmatched de `$9.330`.

### Nota de credito

- Monto recomendado para nota de credito tributaria real: `$126.082`.
- Boletas reales OpenFactura a referenciar: folios `15351`, `15352`, `15353`, `15354`, `15355` y `15356`.
- Diferencia contra reembolso Mercado Pago: `$57.310`, compuesta por `$45.848` en DTE demo y `$11.462` en venta sin DTE registrado.
- Criterio operativo: la nota de credito electronica de anulacion debe referenciar un documento tributario electronico especifico; preparar una nota de credito por cada folio real emitido.

### Intento de emision API 2026-07-29

- Se preparo emision API de 6 notas de credito tipo DTE `61`, una por cada boleta real, total `$126.082`.
- El `dry-run` productivo tomo candidatos desde `/api/backoffice/summary`, porque Supabase REST local/vault para `https://jvmibnyiinzpkahbkyec.supabase.co` devuelve tablas `hfc_*` vacias.
- La app productiva reporta storage `postgres`, Supabase activo y sin warning, por lo que el backoffice productivo sigue siendo la fuente de lectura valida para este corte.
- Se ejecuto modo `--issue`, pero el script aborto antes de llamar a `POST /v2/dte/document`: `organization/document` de Haulmer solo informa DTE `39` y `41`; no informa DTE `61` ni folios disponibles para nota de credito.
- Resultado: no se emitio ninguna nota de credito (`issued: []`). Bloqueo: `missing_dte_61_folios`, disponibles `0`, necesarios `6`.
- Respaldo local: `.codex-logs/issue-jfc-credit-notes.js`, `.codex-logs/jfc-credit-notes-dry-run.json` y `.codex-logs/jfc-credit-notes-issued.json`.

### Caso Benjamin Saez

- Orden revisada: `order_eb195b20b512cdae165f`.
- Cliente informado por captura: Benjamin Saez, RUT `20.162.010-4`, correo `bsaezrivera6@gmail.com`.
- La ticketera productiva mantiene la orden como `paid`, con 2 entradas validas JFC y boleta OpenFactura folio `15353`.
- Mercado Pago consultado por `paymentId` `166900295398` muestra estado `refunded/refunded` y un reembolso aprobado por `$22.924` el `2026-07-15 16:14:56 -04:00`.
- Aprendizaje operativo: para reclamos de reembolso no basta revisar el estado interno de orden; siempre consultar Mercado Pago por `paymentId` y revisar el array `refunds`, porque la app puede no haber sincronizado el estado `refunded`.

### Caso Consuelo Mancilla

- Caso revisado el 2026-07-28 por reclamo de una segunda entrada/comprobante no recibido.
- Cliente informado por captura: Consuelo Mancilla, RUT `23.257.749-5`.
- Se encontraron 2 compras asociadas al mismo RUT y correo `c.mancillavalencia@icloud.com`:
  - `order_e3ae886becd7ebcf6446`, 1 entrada JFC, total `$11.462`, boleta folio `15351`, pago Mercado Pago `164693570347`, reembolso aprobado por `$11.462` el `2026-07-15 16:16 -04:00`.
  - `order_c53309f755c5fca73dd0`, 1 entrada JFC, total `$11.462`, boleta folio `15356`, pago Mercado Pago `166892030085`, reembolso aprobado por `$11.462` el `2026-07-15 16:12 -04:00`.
- Se envio correo desde `ticketera@hondafestchile.cl` a `c.mancillavalencia@icloud.com`, con copia a `contacto@hondafestchile.cl`, usando el tono breve del correo anterior de status de devolucion.
