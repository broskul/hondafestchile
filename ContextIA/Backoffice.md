# Backoffice

## Objetivo

Permitir revision operativa de ventas, entradas, usuarios enrolados, DTE y reenvio de comprobantes.

## Ruta

- `/backoffice-hfc`

La ruta no aparece en la navegacion publica principal. Usa `BACKOFFICE_TOKEN` en produccion. En desarrollo local puede cargar sin token para facilitar pruebas.

## Funcionalidades vigentes

- KPIs de ventas, ventas pagadas, ingresos, entradas emitidas, entradas validadas y usuarios enrolados.
- Tabla de ventas con cliente, total, estado, tickets, DTE y accion de reenvio.
- Tabla de entradas en detalle con codigo, evento, asistente, RUT y estado.
- Tabla de usuarios enrolados.
- `POST /api/backoffice/orders/:orderId/resend` reenvia correo de entradas/comprobante.

## Archivos clave

- `public/backoffice.html`
- `public/backoffice.js`
- `server/index.js`
- `server/lib/mailer.js`

## Pendientes

- Agregar filtros por evento, estado de pago, fecha y busqueda por RUT/codigo.
- Agregar exportacion CSV/XLSX para cierres operativos.
- Agregar roles reales si se implementa autenticacion administrativa.
