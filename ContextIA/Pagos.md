# Pagos

## Objetivo

Crear ordenes de ticketera y conectar el checkout con Mercado Pago.

## Flujo funcional

1. `POST /api/orders` valida usuario enrolado, correo confirmado, evento, entrada y cantidad para compra simple.
2. `POST /api/orders/from-cart` recibe multiples items desde carrito lateral o pagina de carrito.
3. Si existe `MERCADOPAGO_ACCESS_TOKEN`, se crea preferencia en Mercado Pago Checkout Pro.
4. Si no hay token, se usa modo demo con `POST /api/orders/:orderId/simulate-payment`.
5. Mercado Pago vuelve a `/?payment=success|failure|pending&order=<orderId>` y el frontend consulta la orden.
6. `POST /api/webhooks/mercadopago` valida firma si `MERCADOPAGO_WEBHOOK_SECRET` esta configurado, consulta el pago y sincroniza la orden.
7. Al aprobarse el pago, `completeOrderPayment` marca la orden como pagada, crea tickets con codigo QR y solicita boleta.

## Archivos clave

- `server/index.js`
- `server/lib/mercadopago.js`
- `server/config/catalog.js`
- `public/shared.js`
- `public/ticketera.js`
- `public/carrito.js`

## Decisiones vigentes

- Los precios estan centralizados en `server/config/catalog.js`.
- Las entradas actuales son valores de demo/configuracion: General, Club, Piloto Track Day y Stand Emprendedor.
- `PUBLIC_BASE_URL` debe apuntar al dominio HTTPS real para que Mercado Pago pueda usar `notification_url`.
- `MERCADOPAGO_NOTIFICATION_URL` permite sobrescribir el webhook publico si el dominio del backend no coincide con `PUBLIC_BASE_URL`.
- Las credenciales minimas son `MERCADOPAGO_ACCESS_TOKEN` y, para produccion, `MERCADOPAGO_WEBHOOK_SECRET`.
- `hfc_payments` guarda el estado normalizado del pago; el payload crudo solo se guarda si `MERCADOPAGO_STORE_RAW_PAYLOADS=true`.
- El carrito vive en `localStorage` y la orden final se persiste cuando el usuario confirma datos de correo y RUT.

## Pendientes

- Confirmar precios oficiales, stock por categoria y politica de devoluciones.
- Agregar validacion antifraude y control de aforo por evento.
