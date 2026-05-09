# Auth

## Objetivo

Gestionar registro, enrolamiento con RUT, password y confirmacion de correo para compradores y participantes.

## Flujo funcional

1. `POST /api/auth/register` recibe nombre, RUT, correo, telefono, vehiculo, club, intereses y password.
2. Se valida formato de correo, largo minimo de password y digito verificador del RUT chileno.
3. Se guarda el usuario en `data/app-state.json` con hash PBKDF2 y token de verificacion.
4. Se envia correo de confirmacion por SMTP si esta configurado; en demo se imprime/loguea enlace.
5. `GET /api/auth/verify?token=...` marca `emailVerified=true` y redirige al sitio.
6. La compra exige correo y RUT existentes con correo confirmado.

## Archivos clave

- `server/index.js`
- `server/lib/rut.js`
- `server/lib/mailer.js`
- `server/lib/storage.js`
- `public/app.js`

## Riesgos y proximos pasos

- La persistencia JSON sirve para demo local; produccion debe migrar a base de datos transaccional.
- Falta recuperacion de password y expiracion formal de sesiones.
- Para produccion se debe activar HTTPS, rate limiting y politicas de privacidad visibles.
