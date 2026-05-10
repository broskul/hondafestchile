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
5. Al confirmar pago por webhook o simulacion local, se emiten tickets y se llama al adaptador de OpenFactura.
6. El asistente recibe correo con tickets, QR y datos de boleta.
7. En `mis-compras` puede recuperar compras por correo y RUT.
8. En `validar` se consulta o marca ingreso usando el codigo QR.

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
- Webhook Mercado Pago: `POST /api/webhooks/mercadopago`.
- OpenFactura: `server/lib/openfactura.js` centraliza la llamada. Requiere `OPENFACTURA_API_KEY` y `OPENFACTURA_ENDPOINT`; el payload puede requerir ajuste segun la documentacion entregada por la cuenta OpenFactura/Haulmer.
- Email: SMTP con Nodemailer. Sin SMTP, los enlaces se muestran en consola para desarrollo.
- Backoffice: usa `BACKOFFICE_TOKEN`. En desarrollo local puede abrir sin token si `NODE_ENV` no es `production`.

## Referencias consultadas

- Sitio de referencia: https://www.hondafestchile.cl/
- Mercado Pago Checkout Pro: https://www.mercadopago.cl/developers/
- OpenFactura API: https://www.openfactura.cl/factura-electronica/api/
- Documentacion OpenFactura: https://docs.openfactura.cl/
