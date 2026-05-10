# Integraciones

## Objetivo

Centralizar los sistemas externos necesarios para ticketera, pagos, correo y boleta.

## Sistemas externos

- Mercado Pago Checkout Pro para pago online.
- OpenFactura/Haulmer para DTE y boleta electronica.
- SMTP para confirmacion de correo y envio de tickets.
- Supabase para persistencia de usuarios, ordenes, tickets, pagos, DTE y auditoria.

## Variables de entorno

- `PUBLIC_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL` o `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `SUPABASE_ANON_KEY`
- `BACKOFFICE_TOKEN`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `MERCADOPAGO_ACCESS_TOKEN`
- `OPENFACTURA_API_KEY`, `OPENFACTURA_ENDPOINT`, `OPENFACTURA_DTE_TYPE`, `OPENFACTURA_COMPANY_RUT`, `OPENFACTURA_COMPANY_NAME`

## Archivos clave

- `.env.example`
- `server/lib/mercadopago.js`
- `server/lib/openfactura.js`
- `server/lib/mailer.js`
- `server/lib/storage.js`
- `supabase/schema.sql`

## Pendientes

- Configurar credenciales reales y probar en ambientes sandbox antes de produccion.
- Ejecutar `supabase/schema.sql` en SQL Editor antes de usar Supabase como almacenamiento principal.
- Definir dominios, correos transaccionales y politicas de rebote.
