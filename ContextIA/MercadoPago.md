# Mercado Pago

## Objetivo

Mantener el checkout dentro de Honda Fest Chile usando Checkout API y Card Payment Brick, sin exponer datos sensibles de tarjeta al backend.

## Fuente oficial

- Overview Checkout API: https://www.mercadopago.cl/developers/es/docs/checkout-api-v2/overview
- Tarjetas con Checkout API: https://www.mercadopago.cl/developers/es/docs/checkout-api-v2/payment-integration/cards
- Envio de pagos con Brick: https://www.mercadopago.cl/developers/es/docs/checkout-bricks/payment-brick/payment-submission/cards

## Flujo implementado

1. El comprador ingresa correo y acepta terminos.
2. `POST /api/orders/from-cart` crea la orden y devuelve `paymentMode=mercadopago_api`.
3. `public/shared.js` carga `https://sdk.mercadopago.com/js/v2` y monta `cardPayment`.
4. Mercado Pago JS tokeniza los datos de tarjeta.
5. `POST /api/orders/:orderId/pay` recibe `token`, `installments`, `payment_method_id`, `issuer_id` y `payer.email`.
6. El backend recalcula el monto desde la orden, agrega `external_reference=order.id`, `notification_url` y llama `POST /v1/payments`.
7. Si el pago queda `approved`, `completeOrderPayment` deja la orden pagada.
8. Si el perfil esta incompleto, la orden queda pagada con `profileRequired=true`; tickets y boleta se emiten al completar datos.
9. Si el pago queda `pending`, `in_process` o rechazado, se guarda el estado normalizado y la UI informa el resultado.
10. El webhook `POST /api/webhooks/mercadopago` sigue activo para reconciliar pagos asincronos.

## Reglas de seguridad

- El backend nunca recibe numero de tarjeta ni CVV, solo el token generado por Mercado Pago JS.
- El monto enviado a Mercado Pago se toma de la orden persistida, no del frontend.
- Cada pago usa `X-Idempotency-Key` para evitar duplicar cobros por reintentos.
- `MERCADOPAGO_ACCESS_TOKEN` es server-only.
- `MERCADOPAGO_PUBLIC_KEY` puede llegar al navegador.
- En Vercel, no se permite checkout real sin Supabase salvo que `ALLOW_VOLATILE_CHECKOUT=true`.

## Variables

```env
MERCADOPAGO_ACCESS_TOKEN=
MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_NOTIFICATION_URL=https://www.hondafestchile.cl/api/webhooks/mercadopago
PUBLIC_BASE_URL=https://www.hondafestchile.cl
MERCADOPAGO_WEBHOOK_SECRET=
MERCADOPAGO_INTERNAL_CHECKOUT=true
```

`MERCADOPAGO_INTERNAL_CHECKOUT=false` fuerza Checkout Pro como fallback.
