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

1. El asistente agrega entradas al carrito lateral o al carrito completo.
2. Para pagar ingresa correo y telefono, acepta el uso de datos personales y, si no esta activo Checkout Bricks, tambien RUT.
3. La app crea o reutiliza un usuario de checkout rapido; si hay sesion de Mi Pit Lane, la compra queda asociada a esa cuenta.
4. Mercado Pago JS tokeniza la tarjeta y el backend crea el pago con Checkout API. En modo Brick, el RUT del pago se toma desde `payer.identification` para no duplicarlo en el formulario propio.
5. Si faltan nombre real u otros datos de perfil, el asistente completa esos datos despues del pago.
6. Con perfil completo y pago aprobado, se emiten tickets y se llama al adaptador de OpenFactura.
7. El asistente recibe correo con tickets, QR y datos de boleta.
8. En `/mi-pit-lane` puede iniciar con RUT y correo o telefono para ver compras, entradas historicas y enrolamientos pendientes.
9. En `validar` se consulta o marca ingreso usando el codigo QR.

## Supabase

La app usa Supabase cuando encuentra `SUPABASE_DB_URL` para conexion server-side a Postgres. Si no existe, mantiene fallback por REST con `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL` mas una llave server-side.

1. Abre Supabase SQL Editor en el proyecto `jvmibnyiinzpkahbkyec`.
2. Ejecuta el contenido de `supabase/schema.sql`.
3. Verifica:

```powershell
npm run supabase:check
```

En produccion, el checkout real exige base persistente disponible. En desarrollo, si las tablas `hfc_*` aun no existen, la app cae a JSON local para no romper el trabajo y muestra una advertencia.

## Integraciones

- Mercado Pago: por defecto usa Card Payment Brick y `POST https://api.mercadopago.com/v1/payments`; Checkout Pro queda como fallback.
- Webhook Mercado Pago: `POST /api/webhooks/mercadopago`. Si configuras `MERCADOPAGO_WEBHOOK_SECRET`, la app valida `x-signature` y `x-request-id` antes de consultar el pago.
- OpenFactura: `server/lib/openfactura.js` centraliza la llamada. Requiere `OPENFACTURA_API_KEY` y `OPENFACTURA_ENDPOINT`; el payload puede requerir ajuste segun la documentacion entregada por la cuenta OpenFactura/Haulmer.
- Email: Microsoft Graph con `MS_TENANT_ID`, `MS_CLIENT_ID` y `MS_CLIENT_SECRET`; SMTP queda como fallback. Sin proveedor, los enlaces se muestran en consola para desarrollo.
- Backoffice: entra con la contraseña `123hfc`, o define `BACKOFFICE_PASSWORD`/`BACKOFFICE_TOKEN` para sobreescribirla.
- Backoffice de ticketera: en `/backoffice-hfc` se crean eventos y entradas propias, se asignan entradas por evento, se editan valores/cupos de preventa, venta general y puerta, invitados gratis, contactos CSV, plantillas, correos masivos/unitarios y BI para organizadores.

### Mercado Pago

Completa estas variables en `.env.local` para activar el pago interno:

```env
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_WEBHOOK_SECRET=
MERCADOPAGO_INTERNAL_CHECKOUT=true
```

`PUBLIC_BASE_URL` debe ser el dominio HTTPS publico. Si el webhook vive en otra URL, define `MERCADOPAGO_NOTIFICATION_URL`. Puedes revisar el estado sin secretos en `GET /api/health`.

### Microsoft Graph Email

La app registrada en Microsoft Entra debe tener permiso Application `Mail.Send` con admin consent. El remitente se toma de `MS_SENDER_EMAIL`; si queda vacio, usa `SMTP_USER` o el correo dentro de `SMTP_FROM`.

## Referencias consultadas

- Sitio de referencia: https://www.hondafestchile.cl/
- Mercado Pago Checkout API: https://www.mercadopago.cl/developers/es/docs/checkout-api-v2/overview
- Mercado Pago Card Payment Brick: https://www.mercadopago.cl/developers/es/docs/checkout-api-v2/payment-integration/cards
- Webhooks Mercado Pago: https://www.mercadopago.cl/developers/es/docs/checkout-api-payments/additional-content/your-integrations/notifications/webhooks
- OpenFactura API: https://www.openfactura.cl/factura-electronica/api/
- Documentacion OpenFactura: https://docs.openfactura.cl/
