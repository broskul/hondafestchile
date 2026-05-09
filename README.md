# Honda Fest Chile

App web para Honda Fest Chile y Japon Fest Chile con landing, enrolamiento con RUT, confirmacion de correo, ticketera y adaptadores para Mercado Pago y OpenFactura.

## Ejecutar

```powershell
npm install
npm run dev
```

Luego abre `http://localhost:3000`.

## Flujo principal

1. El asistente se registra con nombre, RUT, correo, telefono, vehiculo/club y password.
2. El sistema valida el RUT chileno y envia un correo de confirmacion.
3. Con el correo confirmado, el asistente compra una entrada.
4. La app crea una preferencia de Mercado Pago si `MERCADOPAGO_ACCESS_TOKEN` existe; si no, usa modo demo.
5. Al confirmar pago por webhook o simulacion local, se emiten tickets y se llama al adaptador de OpenFactura.
6. El asistente recibe correo con tickets y datos de boleta.

## Integraciones

- Mercado Pago: se crea una preferencia usando `POST https://api.mercadopago.com/checkout/preferences`.
- Webhook Mercado Pago: `POST /api/webhooks/mercadopago`.
- OpenFactura: `server/lib/openfactura.js` centraliza la llamada. Requiere `OPENFACTURA_API_KEY` y `OPENFACTURA_ENDPOINT`; el payload puede requerir ajuste segun la documentacion entregada por la cuenta OpenFactura/Haulmer.
- Email: SMTP con Nodemailer. Sin SMTP, los enlaces se muestran en consola para desarrollo.

## Referencias consultadas

- Sitio de referencia: https://www.hondafestchile.cl/
- Mercado Pago Checkout Pro: https://www.mercadopago.cl/developers/
- OpenFactura API: https://www.openfactura.cl/factura-electronica/api/
- Documentacion OpenFactura: https://docs.openfactura.cl/
