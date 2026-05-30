# Pagos

## Objetivo

Crear ordenes de ticketera y conectar el checkout con Mercado Pago.

## Flujo funcional

1. `POST /api/orders` y `POST /api/orders/from-cart` piden solo correo, terminos aceptados, evento, entrada y cantidad.
2. Si el correo tiene formato valido, la app crea o reutiliza un usuario de checkout rapido con perfil pendiente.
3. Si existen `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_PUBLIC_KEY`, el frontend monta Card Payment Brick dentro del sitio.
4. El Brick tokeniza los datos de tarjeta con Mercado Pago JS; la app envia el token a `POST /api/orders/:orderId/pay`.
5. El backend crea el pago en `POST https://api.mercadopago.com/v1/payments` con `X-Idempotency-Key` y monto recalculado desde la orden.
6. Si no hay public key o se desactiva `MERCADOPAGO_INTERNAL_CHECKOUT`, se mantiene fallback Checkout Pro.
7. Si no hay token, se usa modo demo con `POST /api/orders/:orderId/simulate-payment`.
8. Si el pago fue aprobado y faltan nombre, RUT o telefono, la app muestra el formulario de perfil post-pago.
9. `POST /api/orders/:orderId/profile` completa datos, emite tickets con QR, solicita boleta y envia correo.
10. `POST /api/webhooks/mercadopago` valida firma si `MERCADOPAGO_WEBHOOK_SECRET` esta configurado, consulta el pago y sincroniza la orden.

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
- Las credenciales minimas para pago interno son `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_PUBLIC_KEY`; para produccion se recomienda `MERCADOPAGO_WEBHOOK_SECRET`.
- `MERCADOPAGO_INTERNAL_CHECKOUT=false` fuerza fallback por Checkout Pro.
- En Vercel, checkout real exige Supabase configurado; sin persistencia, la app bloquea la venta para evitar cobrar sin guardar orden.
- `hfc_payments` guarda el estado normalizado del pago; el payload crudo solo se guarda si `MERCADOPAGO_STORE_RAW_PAYLOADS=true`.
- El carrito vive en `localStorage` y la orden final se persiste antes del pago con correo y terminos aceptados.
- Los datos completos del asistente quedan despues del pago para reducir friccion y no enfriar la venta.

## Pendientes

- Confirmar precios oficiales, stock por categoria y politica de devoluciones.
- Agregar validacion antifraude y control de aforo por evento.
