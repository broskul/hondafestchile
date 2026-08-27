# DTE

## Objetivo

Registrar la boleta pendiente de cada orden pagada sin bloquear la entrega de entradas. La emision real se realiza despues, desde backoffice, cuando Haulmer este operativo.

## Flujo funcional

1. `completeOrderPayment` crea tickets y envia el correo de confirmacion sin depender de Haulmer.
2. `OPENFACTURA_AUTO_ISSUE=false` es el valor seguro por defecto, incluso cuando hay API key y endpoint configurados.
3. Cada venta queda con `invoiceStatus = pending`, `invoicePendingReason = automatic_issue_disabled` y auditoria `invoice_queued`.
4. La emision se hace expresamente desde el backoffice mediante `reissueOrderDte` cuando Haulmer este operativo; esa accion conserva los controles contra DTE demo y duplicados.
5. El correo de tickets muestra la boleta como en proceso hasta que exista un folio/PDF real.

## Archivos clave

- `server/lib/openfactura.js`
- `server/index.js`
- `server/lib/mailer.js`

## Riesgos y proximos pasos

- Mantener la emision automatica desactivada mientras Haulmer no este operativo. No habilitar `OPENFACTURA_AUTO_ISSUE=true` hasta validar cuenta, folios, emisor y una emision controlada.
- Al reactivar Haulmer, emitir los pendientes desde backoffice en lotes controlados y contrastar los folios resultantes antes de reenviar los correos con PDF.

## Nota de credito por API

- OpenFactura usa `POST /v2/dte/document` tambien para Nota de Credito Electronica, con `Encabezado.IdDoc.TipoDTE = 61`.
- Para anulacion total se prepara una nota de credito por boleta original, con `Referencia` a `TpoDocRef = 39`, `FolioRef`, `FchRef` y `CodRef = 1`.
- Antes de emitir se debe consultar `GET /v2/dte/organization/document`; si no aparecen folios disponibles para DTE `61`, no disparar emision real.
- En el corte Japon Fest 2026 del 2026-07-29, Haulmer informo solo DTE `39` y `41`, por lo que la emision API de notas de credito quedo bloqueada sin documentos emitidos.
