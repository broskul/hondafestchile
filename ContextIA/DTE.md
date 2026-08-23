# DTE

## Objetivo

Emitir boleta electronica automaticamente al confirmarse el pago de una orden.

## Flujo funcional

1. `completeOrderPayment` crea tickets y solo llama a `issueBoleta` cuando `OPENFACTURA_AUTO_ISSUE=true`.
2. `server/lib/openfactura.js` arma un payload base con tipo DTE 39, receptor, detalle y total.
3. Si `OPENFACTURA_API_KEY` y `OPENFACTURA_ENDPOINT` estan configurados, se hace POST al proveedor.
4. La emision automatica queda desactivada por defecto mientras Haulmer no este operativo. La orden conserva `invoiceStatus = pending`, `invoicePendingReason = automatic_issue_disabled` y auditoria `invoice_queued`.
5. El correo de tickets incluye folio, identificador o URL PDF cuando el proveedor la devuelva; con DTE pendiente informa que sigue en proceso.
6. Si se habilita la emision automatica y el proveedor rechaza o no esta activo, las entradas y su correo igualmente se entregan; la orden queda con `invoiceStatus = failed`, el detalle del error y una auditoria `invoice_issue_failed` para reemitir el DTE desde backoffice cuando Haulmer este disponible.

## Archivos clave

- `server/lib/openfactura.js`
- `server/index.js`
- `server/lib/mailer.js`

## Riesgos y proximos pasos

- Mantener `OPENFACTURA_AUTO_ISSUE=false` hasta contar con Haulmer operativo y validar una emision real controlada; las ordenes pendientes se emiten desde backoffice.
- OpenFactura/Haulmer puede entregar endpoint y contrato de payload especifico por cuenta; ajustar `buildOpenFacturaPayload` contra esa documentacion antes de produccion.
- Validar giro, razon social, RUT emisor, folios y certificacion SII antes de emitir documentos reales.
- Agregar reintentos e idempotencia persistente para fallas temporales del proveedor.
