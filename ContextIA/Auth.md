# Auth

## Objetivo

Gestionar acceso de compradores, enrolamiento post-pago con RUT y portal privado para completar datos pendientes.

## Flujo funcional

1. La compra publica no muestra registro previo: solo correo y terminos.
2. Al confirmar pago, la orden queda `profile_pending` si faltan datos del asistente.
3. El backend genera `enrollmentToken`, lo envia por correo en boton y QR, y permite abrir `/enrolamiento?token=...`.
4. `/enrolamiento` tambien tiene portal privado con usuario/password para gestionar ordenes pagadas pendientes.
5. Al completar nombre, RUT, telefono, vehiculo y club, la orden emite tickets y envia correo de confirmacion.
6. `POST /api/auth/register` queda como ruta tecnica heredada, no visible en el flujo publico de compra.

## Archivos clave

- `server/index.js`
- `server/lib/rut.js`
- `server/lib/mailer.js`
- `server/lib/storage.js`
- `public/enrolamiento.js`
- `public/shared.js`

## Riesgos y proximos pasos

- La persistencia JSON sirve para demo local; produccion debe migrar a base de datos transaccional.
- Falta recuperacion de password y expiracion formal de sesiones.
- Para produccion se debe activar HTTPS, rate limiting y politicas de privacidad visibles.
