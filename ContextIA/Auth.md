# Auth

## Objetivo

Gestionar acceso de compradores, enrolamiento post-pago con RUT y portal privado para completar datos pendientes.

## Flujo funcional

1. La compra pública de entradas no muestra registro previo. El Upgrade pide además nombre y RUT antes del pago para asociar cada Pistón a su titular.
2. Al confirmar pago, la orden queda `profile_pending` si faltan datos del asistente.
3. El backend genera `enrollmentToken`, lo envia por correo en boton y QR, y permite abrir `/enrolamiento?token=...`.
4. `/enrolamiento` tambien tiene portal privado con usuario/password para gestionar ordenes pagadas pendientes.
5. Al completar nombre, RUT, telefono, vehiculo y club, la orden emite tickets y envia correo de confirmacion. El token se consume solo despues de completar esta entrega.
6. `POST /api/auth/register` queda como ruta tecnica heredada, no visible en el flujo publico de compra.
7. `GET /api/orders/:orderId`, retorno, sincronización y pago exigen sesión de cuenta, token de enrolamiento vigente o credencial administrativa. El identificador aleatorio de la orden no se considera autorización.
8. `POST /api/orders/:orderId/simulate-payment` responde 404 en Vercel/producción salvo habilitación explícita exclusiva de QA.
9. La recuperación de `Mi Pit Lane` valida RUT+contacto sólo para localizar la cuenta: nunca devuelve el bearer. Envía al correo registrado un enlace con token en el fragmento URL, aplica una espera mínima de 60 segundos y la sesión dura 30 días.
10. `GET /api/users/purchases` exige bearer de cuenta. Ya no entrega compras ni QR a partir de RUT/correo/teléfono en query string.
11. La consulta pública de un QR de entrada enmascara al titular. Marcar check-in y ver RUT/contacto exige la clave administrativa del equipo HFC.
12. Si una orden pagada quedo marcada como perfil completo durante una incidencia, backoffice permite `Reabrir enrolamiento`: invalida el acceso anterior, crea un token nuevo y reenvia la invitacion sin duplicar entradas ni DTE.

## Archivos clave

- `server/index.js`
- `server/lib/rut.js`
- `server/lib/mailer.js`
- `server/lib/storage.js`
- `public/enrolamiento.js`
- `public/shared.js`

## Riesgos y proximos pasos

- La persistencia JSON sirve para demo local; produccion debe migrar a base de datos transaccional.
- Agregar rate limiting persistente o perimetral a login, recuperación, consulta de QR y checkout antes de aumentar volumen; hoy la recuperación aplica sólo un enfriamiento de 60 segundos por usuario.
- Para produccion se debe activar HTTPS, rate limiting y politicas de privacidad visibles.
- Una falla de OpenFactura/Haulmer no invalida el enlace ni deja al comprador sin entradas: se guarda el error tributario para reintento y se mantiene la entrega de tickets.
- La recuperacion administrativa de enrolamiento reinicia solamente el token, el estado de perfil y el correo final de la orden afectada; las entradas existentes se reutilizan de forma idempotente.
