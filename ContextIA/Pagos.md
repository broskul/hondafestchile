# Pagos

## Objetivo

Crear ordenes de ticketera y conectar el checkout con Mercado Pago.

## Flujo funcional

1. `POST /api/orders` valida usuario enrolado, correo confirmado, evento, entrada y cantidad.
2. Si existe `MERCADOPAGO_ACCESS_TOKEN`, se crea preferencia en Mercado Pago Checkout Pro.
3. Si no hay token, se usa modo demo con `POST /api/orders/:orderId/simulate-payment`.
4. Al aprobarse el pago, `completeOrderPayment` marca la orden como pagada, crea tickets y solicita boleta.
5. `POST /api/webhooks/mercadopago` consulta el pago y completa la orden si viene aprobado.

## Archivos clave

- `server/index.js`
- `server/lib/mercadopago.js`
- `server/config/catalog.js`
- `public/app.js`

## Decisiones vigentes

- Los precios estan centralizados en `server/config/catalog.js`.
- Las entradas actuales son valores de demo/configuracion: General, Club, Piloto Track Day y Stand Emprendedor.
- `PUBLIC_BASE_URL` debe apuntar al dominio HTTPS real para que Mercado Pago pueda usar `notification_url`.

## Pendientes

- Confirmar precios oficiales, stock por categoria y politica de devoluciones.
- Agregar validacion antifraude y control de aforo por evento.
