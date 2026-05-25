# Honda Fest Chile

App web para Honda Fest Chile y Japon Fest Chile con landing, enrolamiento con RUT, confirmacion de correo, ticketera y adaptadores para Mercado Pago y OpenFactura.

## Ejecutar

```powershell
npm install
npm run dev
```

Luego abre `http://localhost:3000`.

## Paginas

- Inicio: `http://localhost:3000/`
- Ticketera: `http://localhost:3000/ticketera`
- Carrito completo: `http://localhost:3000/carrito`
- Mis compras y entradas: `http://localhost:3000/mis-compras`
- Validacion QR: `http://localhost:3000/validar`
- Backoffice oculto: `http://localhost:3000/backoffice-hfc`

## Flujo principal

1. El asistente se registra con nombre, RUT, correo, telefono, vehiculo/club y password.
2. El sistema valida el RUT chileno y envia un correo de confirmacion.
3. Con el correo confirmado, el asistente agrega entradas al carrito lateral o al carrito completo.
4. La app crea una preferencia de Mercado Pago si `MERCADOPAGO_ACCESS_TOKEN` existe; si no, usa modo demo.
5. Al volver desde Mercado Pago, el sitio consulta el estado de la orden; el webhook confirma el pago real.
6. Al confirmar pago por webhook o simulacion local, se emiten tickets y se llama al adaptador de OpenFactura.
7. El asistente recibe correo con tickets, QR y datos de boleta.
8. En `mis-compras` puede recuperar compras por correo y RUT.
9. En `validar` se consulta o marca ingreso usando el codigo QR.

## Supabase

La app usa Supabase cuando encuentra `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL` y una llave server-side en `.env.local`.

1. Abre Supabase SQL Editor en el proyecto `jxvvjshuxdtpndskcdbk`.
2. Ejecuta el contenido de `supabase/schema.sql`.
3. Verifica:

```powershell
npm run supabase:check
```

Si las tablas `hfc_*` aun no existen, la app cae a JSON local para no romper el desarrollo y muestra una advertencia.

## Integraciones

- Mercado Pago: se crea una preferencia usando `POST https://api.mercadopago.com/checkout/preferences`.
- Webhook Mercado Pago: `POST /api/webhooks/mercadopago`. Si configuras `MERCADOPAGO_WEBHOOK_SECRET`, la app valida `x-signature` y `x-request-id` antes de consultar el pago.
- OpenFactura: `server/lib/openfactura.js` centraliza la llamada. Requiere `OPENFACTURA_API_KEY` y `OPENFACTURA_ENDPOINT`; el payload puede requerir ajuste segun la documentacion entregada por la cuenta OpenFactura/Haulmer.
- Email: Microsoft Graph con `MS_TENANT_ID`, `MS_CLIENT_ID` y `MS_CLIENT_SECRET`; SMTP queda como fallback. Sin proveedor, los enlaces se muestran en consola para desarrollo.
- Backoffice: usa `BACKOFFICE_TOKEN`. En desarrollo local puede abrir sin token si `NODE_ENV` no es `production`.
- Backoffice de ticketera: en `/backoffice-hfc` se editan eventos, preventa, venta general, puerta, cupos, invitados gratis, contactos CSV, plantillas, correos masivos/unitarios y BI para organizadores.

### Mercado Pago

Completa estas variables en `.env.local` para activar Checkout Pro:

```env
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_WEBHOOK_SECRET=
```

`PUBLIC_BASE_URL` debe ser el dominio HTTPS publico. Si el webhook vive en otra URL, define `MERCADOPAGO_NOTIFICATION_URL`. Puedes revisar el estado sin secretos en `GET /api/health`.

### Microsoft Graph Email

La app registrada en Microsoft Entra debe tener permiso Application `Mail.Send` con admin consent. El remitente se toma de `MS_SENDER_EMAIL`; si queda vacio, usa `SMTP_USER` o el correo dentro de `SMTP_FROM`.

## Referencias consultadas

- Sitio de referencia: https://www.hondafestchile.cl/
- Mercado Pago Checkout Pro: https://www.mercadopago.cl/developers/
- Crear preferencia Checkout Pro: https://www.mercadopago.cl/developers/es/reference/online-payments/checkout-pro/preferences/create-preference/post
- Webhooks Mercado Pago: https://www.mercadopago.cl/developers/es/docs/checkout-api-payments/additional-content/your-integrations/notifications/webhooks
- OpenFactura API: https://www.openfactura.cl/factura-electronica/api/
- Documentacion OpenFactura: https://docs.openfactura.cl/
