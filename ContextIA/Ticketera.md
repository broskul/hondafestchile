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
2. En checkout ingresa correo, RUT, telefono y acepta terminos de uso de datos personales; los datos especificos del asistente se completan despues del pago cuando corresponda.
3. El carrito lateral se abre como lightbox desde cualquier pagina con `shared.js`.
4. `/carrito` permite revisar cantidades y finalizar compra con correo.
5. `POST /api/orders/from-cart` crea orden multiproducto.
6. El backend resuelve la etapa activa por evento y entrada: preventa si tiene cupos, venta general cuando preventa se agota, o puerta solo el dia real del evento.
7. Al pagar, si falta perfil, `completeOrderPayment` marca `profile_pending`, genera `enrollmentToken` y envia correo con boton y QR a `/enrolamiento?token=...`.
8. Al completar datos desde token o portal privado, se emiten tickets con codigo y QR.
9. `/mis-compras` recupera tickets y boleta por correo/RUT.
10. `/validar` usa `BarcodeDetector` si el navegador lo soporta, o ingreso manual de codigo.

## Honda Fest Chile 2026

- Evento: 28 y 29 de noviembre de 2026, Autodromo Huachalalume, La Serena.
- `Entrada Galeria`: sector exterior del autodromo. Preventa a $7.000 neto, sin cupo total; con IVA y cargo de servicio de 8% el total online es $8.996. En puerta se vende a $10.000 neto y es la unica entrada disponible en esa etapa.
- `Entrada Parque Cerrado`: sector de pilotos y experiencia principal. Preventa a $10.000 neto, limitada a 100 entradas; con IVA y cargo de servicio de 8% el total online es $12.852. No se vende en puerta.
- El cargo de servicio vigente es 8% sobre el total afecto de entradas y futuros upgrades. El backend reconstruye IVA, cargo y total desde el valor neto.
- Las tarjetas de entradas muestran el valor neto como ancla principal, el IVA en menor jerarquia y el total con IVA como cierre. El carrito repite el desglose y agrega el cargo de servicio antes del total pagable.
- Estacionamiento galeria: gratis. Estacionamiento parque cerrado: $15.000, se paga directamente en el recinto y nunca se agrega al carrito.
- Inicio, ticketera y carrito presentan Pistones como un upgrade visible bajo el mensaje `Mejora tu experiencia` y `Suma Pistones. Gana premios.`. La promesa se acota a mas oportunidades y beneficios; no se presenta como garantia de premio, entrada independiente ni producto cobrable hasta que PyR habilite producto, bases y persistencia en produccion.
- La configuracion heredada con una sola entrada `ticket-honda-fest-preventa-2026` se reemplaza en runtime por este catalogo 2026. Es un puente acotado: al guardar una configuracion desde backoffice deja de aplicar.

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

- Mejorar escaneo QR con libreria fallback para navegadores sin `BarcodeDetector`.
