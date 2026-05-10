# Ticketera

## Objetivo

Gestionar venta online de entradas para Japon Fest Chile y Honda Fest Chile con carrito lateral, carrito completo, recuperacion de compras y validacion QR.

## Rutas

- `/ticketera`: productos por evento y registro/enrolamiento.
- `/carrito`: pagina completa para revisar carrito y finalizar compra.
- `/mis-compras`: recupera ordenes por correo y RUT, muestra entradas y QR.
- `/validar`: consulta QR/codigo y marca ingreso.

## Flujo funcional

1. El visitante se registra con RUT y confirma correo.
2. Desde `/ticketera` agrega entradas al carrito en `localStorage`.
3. El carrito lateral se abre como lightbox desde cualquier pagina con `shared.js`.
4. `/carrito` permite revisar cantidades y finalizar compra con correo/RUT.
5. `POST /api/orders/from-cart` crea orden multiproducto.
6. Al pagar, `completeOrderPayment` emite tickets con codigo y QR.
7. `/mis-compras` recupera tickets y boleta por correo/RUT.
8. `/validar` usa `BarcodeDetector` si el navegador lo soporta, o ingreso manual de codigo.

## Archivos clave

- `public/shared.js`
- `public/ticketera.html`
- `public/ticketera.js`
- `public/carrito.html`
- `public/carrito.js`
- `public/mis-compras.html`
- `public/mis-compras.js`
- `public/validar.html`
- `public/validar.js`
- `server/index.js`

## Pendientes

- Migrar catalogo desde CSV/Supabase en vez de `server/config/catalog.js`.
- Agregar stock por evento y producto.
- Mejorar escaneo QR con libreria fallback para navegadores sin `BarcodeDetector`.
