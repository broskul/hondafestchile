# Integraciones

## Objetivo

Centralizar los sistemas externos necesarios para ticketera, pagos, correo y boleta.

## Sistemas externos

- Mercado Pago Checkout Pro para pago online.
- OpenFactura/Haulmer para DTE y boleta electronica.
- SMTP para confirmacion de correo y envio de tickets.

## Variables de entorno

- `PUBLIC_BASE_URL`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `MERCADOPAGO_ACCESS_TOKEN`
- `OPENFACTURA_API_KEY`, `OPENFACTURA_ENDPOINT`, `OPENFACTURA_DTE_TYPE`, `OPENFACTURA_COMPANY_RUT`, `OPENFACTURA_COMPANY_NAME`

## Archivos clave

- `.env.example`
- `server/lib/mercadopago.js`
- `server/lib/openfactura.js`
- `server/lib/mailer.js`

## Pendientes

- Configurar credenciales reales y probar en ambientes sandbox antes de produccion.
- Definir dominios, correos transaccionales y politicas de rebote.
