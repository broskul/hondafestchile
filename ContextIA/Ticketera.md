# Ticketera

## Objetivo

Gestionar venta online de entradas para Japon Fest Chile y Honda Fest Chile con carrito lateral, carrito completo, recuperacion de compras y validacion QR.

## Rutas

- `/ticketera`: productos por evento sin enrolamiento previo visible.
- `/carrito`: pagina completa para revisar carrito y finalizar compra.
- `/mis-compras`: recupera ordenes por correo y RUT, muestra entradas y QR.
- `/validar`: consulta QR/codigo y marca ingreso.
- `/enrolamiento`: portal privado o acceso directo por token post-pago.

## Flujo funcional

1. Desde `/ticketera` agrega entradas al carrito en `localStorage`; los valores vienen del backoffice si existe `ticketing_config`.
2. En checkout ingresa correo, RUT, teléfono y acepta términos de uso de datos personales; los datos específicos del asistente se completan después del pago cuando corresponda.
3. El carrito lateral se abre como lightbox desde cualquier pagina con `shared.js`.
4. `/carrito` permite revisar cantidades y finalizar compra con correo.
5. `POST /api/orders/from-cart` crea orden multiproducto.
6. El backend resuelve la etapa activa por evento y entrada: preventa si tiene cupos, venta general cuando preventa se agota, o puerta solo el dia real del evento.
7. Al pagar, si falta perfil, `completeOrderPayment` marca `profile_pending`, genera `enrollmentToken` y envia correo con boton y QR a `/enrolamiento?token=...`.
8. Al completar datos desde token o portal privado, se emiten tickets con codigo y QR.
9. `/mis-compras` recupera tickets y boleta por correo/RUT.
10. `/validar` usa `BarcodeDetector` si el navegador lo soporta, o ingreso manual de codigo.

## Uso correcto de WhatsApp

- Soporte de compra/entradas: `+56 9 7293 4950`. Usar para problemas de pago, orden, QR, boleta, reintento de pago, compra no finalizada o "no me llego la entrada".
- Preguntas del evento: Pablo `+56 9 7576 6596`. Usar para horarios, ubicacion, programa, pilotos, foodtrucks, stands, participacion y cualquier duda operativa del evento.
- Los botones transaccionales del carrito, emails de compra y recuperacion de pago deben ir al soporte de compra/entradas.
- Los botones publicos de comunidad, participacion o preguntas generales del evento deben ir a Pablo.

## Honda Fest Chile 2026

- La configuracion persistida de produccion sigue siendo una preventa heredada unica para `28 y 29 de noviembre`, no separa sabado y domingo: `ticket-honda-fest-preventa-2026`, $8.600 neto, IVA 19%, cargo 12%, cupo 200 y maximo 5 por compra.
- Al 2026-08-26 el catalogo publico reporta 192 cupos disponibles de esos 200. Esa cifra incluye ordenes pagadas y reservas aun vigentes; no se debe usar como total tributario ni como confirmacion exclusiva de pagos.
- La siguiente migracion debe vender por jornada y conservar las compras heredadas sin reasignarlas: sabado `Drag Day` (28 de noviembre) y domingo `Track Day` (29 de noviembre). Antes de aplicarla debe confirmarse si el cupo de Parque Cerrado de 100 es por jornada o compartido entre ambas.
- El precio objetivo de preventa acordado es Galeria $7.000 neto y Parque Cerrado $10.000 neto, mas IVA y cargo de servicio 8%; Galeria en puerta sera $10.000 neto. No basta cambiar `server/config/catalog.js`: mientras exista `ticketing_config` en la base, ese registro es la fuente del catalogo publico.
- Estacionamiento Galeria: gratis. El estacionamiento de Parque Cerrado esta incluido con la entrada y nunca se cobra por separado.
- La ticketera y el carrito invitan a elegir un Pase como Upgrade de experiencia. Sus Pistones definen las posibilidades registradas en el sorteo y cada Pase incluye un refresco extra, siempre con el aviso visible de que no reemplaza la entrada al evento.

## Archivos clave

- `public/shared.js`
- `public/ticketera.html`
- `public/ticketera.js`
- `public/carrito.html`
- `public/carrito.js`
- `public/mis-compras.html`
- `public/mis-compras.js`
- `public/enrolamiento.html`
- `public/enrolamiento.js`
- `public/validar.html`
- `public/validar.js`
- `server/index.js`

## Pendientes

- Migrar el catalogo persistido de Honda Fest a dos jornadas sin alterar ordenes, QR ni montos historicos.
- Mejorar escaneo QR con libreria fallback para navegadores sin `BarcodeDetector`.
