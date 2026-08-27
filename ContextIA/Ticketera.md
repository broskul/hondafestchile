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
11. Japon Fest Chile 2026 esta permanentemente excluido del flujo: sus enlaces de enrolamiento son invalidos, no aparece en el portal privado y no se puede completar o reemitir desde backoffice.

## Uso correcto de WhatsApp

- Soporte de compra/entradas: `+56 9 7293 4950`. Usar para problemas de pago, orden, QR, boleta, reintento de pago, compra no finalizada o "no me llego la entrada".
- Preguntas del evento: Pablo `+56 9 7576 6596`. Usar para horarios, ubicacion, programa, pilotos, foodtrucks, stands, participacion y cualquier duda operativa del evento.
- Los botones transaccionales del carrito, emails de compra y recuperacion de pago deben ir al soporte de compra/entradas.
- Los botones publicos de comunidad, participacion o preguntas generales del evento deben ir a Pablo.

## Honda Fest Chile 2026

- La configuracion heredada de produccion mantiene una preventa unica para `28 y 29 de noviembre`: `ticket-honda-fest-preventa-2026`, $8.600 neto, IVA 19%, cargo 12%, cupo 200 y maximo 5 por compra. Se conserva oculta despues de migrar para que sus compras, QR y montos historicos sigan resolviendo correctamente.
- Al 2026-08-26 el catalogo publico reporta 192 cupos disponibles de esos 200. Esa cifra incluye ordenes pagadas y reservas aun vigentes; no se debe usar como total tributario ni como confirmacion exclusiva de pagos.
- Las nuevas ventas se separan por jornada: Sabado 28 de noviembre, `Drag Day` (aceleracion en recta, potencia y duelos), y Domingo 29 de noviembre, `Track Day` (autos en pista, curvas y tandas). La ticketera debe explicar ambas experiencias antes de los precios, reiterar junto a cada jornada que la entrada sirve exclusivamente para ese dia y nombrar el dia en el boton de compra. El landing muestra la fecha doble `28-29 de noviembre de 2026`.
- Cada jornada publica Galeria y Parque Cerrado: preventa Galeria $7.000 neto sin limite; preventa Parque Cerrado $10.000 neto, cupo 100 por dia; Galeria en puerta $10.000 neto. Todas aplican IVA y cargo de servicio 8%.
- El resumen del carrito obtiene el porcentaje de cargo desde el precio resuelto de cada linea; no se debe fijar un texto de `12%`, porque las entradas historicas conservan su cargo anterior y las nuevas usan 8%.
- No basta cambiar `server/config/catalog.js`: mientras exista `ticketing_config` en la base, ese registro es la fuente del catalogo publico. `scripts/migrate-hfc-two-day-catalog.js --apply` migra el registro conservando el catalogo heredado oculto y verifica las dos jornadas publicas.
- La correccion de fecha de la configuracion ya persistida se aplica con `scripts/update-hfc-event-dates.js --apply`; actualiza solo las dos jornadas HFC, sus cortes de preventa y la configuracion de Pases, sin tocar ventas ni entradas historicas.
- Estacionamiento Galeria: gratis. El estacionamiento de Parque Cerrado esta incluido con la entrada y nunca se cobra por separado.
- `/ticketera` prioriza la decision de jornada y entrada: cada producto expone valor neto, IVA, cargo y total online, con control de cantidad `- / +`. El upgrade de Pistones queda como opcion secundaria y nunca bloquea ni distrae de la compra de la entrada.
- No usar cintas, franjas ni avisos rojos para comunicar la validez por dia: el rojo se reserva para acciones principales o estados de error. La vigencia se explica con texto editorial y contraste neutro.
- Desde el 27 de agosto de 2026 la venta online queda temporalmente pausada mientras se actualizan los datos de cobro. El backend no permite crear ordenes ni iniciar pagos antes del sábado 29 de agosto de 2026 a las 12:00 de Chile (`2026-08-29T12:00:00-04:00`); la ticketera muestra una cuenta regresiva y se reactiva sola al llegar a esa hora. La pausa también cubre Pases, pero no impide sincronizar pagos ya iniciados ni procesar webhooks para conservar la conciliación.

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
