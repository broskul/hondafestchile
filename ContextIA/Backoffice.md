# Backoffice

## Objetivo

Permitir revision operativa de ventas, entradas, usuarios enrolados, DTE y reenvio de comprobantes.

## Ruta

- `/backoffice-hfc`

La ruta no aparece en la navegacion publica principal. Usa `BACKOFFICE_TOKEN` en produccion. En desarrollo local puede cargar sin token para facilitar pruebas.

## Funcionalidades vigentes

- KPIs de ventas, ventas pagadas, ingresos, entradas emitidas, entradas validadas y usuarios enrolados.
- Modulo BI con desglose por evento, tipo de entrada y etapa de venta.
- Configuracion editable de entradas: preventa, venta general y puerta con valor, cupos, fecha desde/hasta y maximo por compra.
- Creacion de invitados con entrada gratis, orden comp y ticket QR validable en puerta.
- Importacion de contactos por CSV pegado en pantalla.
- Correccion de correos de enrolados/contactos y reenvio de verificacion.
- Envio unitario o masivo usando plantillas para pago, invitacion a enrolarse, entrada contra enrolamiento y campanas libres.
- Edicion de plantillas de correo desde backoffice.
- Tabla de ventas con cliente, total, estado, tickets, DTE y accion de reenvio.
- Tabla de entradas en detalle con codigo, evento, asistente, RUT y estado.
- Tabla de usuarios enrolados.
- `POST /api/backoffice/orders/:orderId/resend` reenvia correo de entradas/comprobante.

## Archivos clave

- `public/backoffice.html`
- `public/backoffice.js`
- `server/index.js`
- `server/lib/emailTemplates.js`
- `server/lib/mailer.js`
- `supabase/schema.sql`

## Pendientes

- Agregar filtros por evento, estado de pago, fecha y busqueda por RUT/codigo.
- Agregar exportacion CSV/XLSX para cierres operativos.
- Agregar roles reales si se implementa autenticacion administrativa.
