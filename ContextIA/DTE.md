# DTE

## Objetivo

Emitir boleta electronica automaticamente al confirmarse el pago de una orden.

## Flujo funcional

1. `completeOrderPayment` crea tickets y llama a `issueBoleta`.
2. `server/lib/openfactura.js` arma un payload base con tipo DTE 39, receptor, detalle y total.
3. Si `OPENFACTURA_API_KEY` y `OPENFACTURA_ENDPOINT` estan configurados, se hace POST al proveedor.
4. Si faltan credenciales, se crea una boleta demo asociada a la orden.
5. El correo de tickets incluye folio, identificador o URL PDF cuando el proveedor la devuelva.

## Archivos clave

- `server/lib/openfactura.js`
- `server/index.js`
- `server/lib/mailer.js`

## Riesgos y proximos pasos

- OpenFactura/Haulmer puede entregar endpoint y contrato de payload especifico por cuenta; ajustar `buildOpenFacturaPayload` contra esa documentacion antes de produccion.
- Validar giro, razon social, RUT emisor, folios y certificacion SII antes de emitir documentos reales.
- Agregar reintentos e idempotencia persistente para fallas temporales del proveedor.
