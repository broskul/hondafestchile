# Pases Especiales HFC 2026 y premios

## Estrategia vigente

La estrategia anterior de venta de boletos, números o packs con unidades de regalo queda reemplazada por un producto físico y operativo: **Pase Especial HFC 2026**.

Cada compra corresponde a un nivel cerrado medido en **Pistones**:

| Producto | Precio final | Pistones |
| --- | ---: | ---: |
| Pase de 1 Pistón | $5.000 | 1 |
| Pase de 3 Pistones | $10.000 | 3 |
| Pase de 5 Pistones | $15.000 | 5 |
| Pase de 7 Pistones | $20.000 | 7 |
| Pase de 9 Pistones | $25.000 | 9 |

No se presenta como “compra X y lleva Y”, no existen Pistones de regalo y no se usa la palabra boleto en la experiencia comercial.

## Producto físico y comunicación

El Pase Especial se materializa como un **lanyard con credencial impresa**, entregado en un porta credencial. Da acceso a experiencias especiales el día del evento y participa en premios especiales, entre ellos un automóvil. PyR Eventos publicará progresivamente nuevos beneficios por nivel.

La condición **“NO ES VÁLIDO COMO ENTRADA”** debe mostrarse de forma destacada en la portada, niveles, selección, aceptación previa al pago, enrolamiento, correo, Mi Pit Lane y consulta del QR.

La web permite comprar sin acreditar una entrada previa y el sistema no intenta buscarla, vincularla ni bloquear la compra por su ausencia. El comprador acepta expresamente que necesita una entrada válida independiente para ingresar a Honda Fest Chile. La aceptación queda registrada con fecha, orden, usuario, nivel y cantidad de Pistones.

## Retiro y acceso

- Retiro confirmado: el 29 de noviembre de 2026 durante Honda Fest Chile, presentando QR e identificación del titular.
- Punto de retiro previo al evento: por confirmar.
- Un mismo QR identifica la credencial impresa.
- `pickupStatus` registra el retiro: `pending` o `picked_up`.
- `accessStatus` registra el acceso especial: `not_checked_in` o `checked_in`.
- Registrar retiro o acceso es una operación administrativa protegida; una consulta pública nunca modifica el estado.
- El acceso requiere retiro previo, salvo la operación explícita y auditable `pickup_and_checkin`.

## Pistones y premios

El QR representa el pase, no cada Pistón. Tras el pago aprobado y el enrolamiento se crea un único pase por orden y se generan códigos opacos individuales de participación, uno por Pistón, dentro de `drawEntryCodes`.

La exportación administrativa genera una fila por Pistón con código de pase, código individual, nivel, titular, orden y estados de retiro/acceso. El padrón no debe deduplicarse por persona: cada Pistón comprado y emitido representa una unidad registrada. La definición final de elegibilidad, método de selección, presencia requerida, suplentes y entrega de premios debe quedar en las bases de PyR Eventos antes de la publicación definitiva.

## Flujo implementado

1. La página `/pases-especiales` obtiene niveles y textos desde configuración persistente.
2. El comprador elige un nivel, informa correo y teléfono y acepta privacidad y el aviso de no entrada.
3. El backend reconstruye nombre, Pistones y precio desde el `levelId`; nunca confía en el precio del navegador.
4. La orden queda con `kind: special_pass`, una unidad física y ruta de retorno propia.
5. Mercado Pago conserva la idempotencia existente y devuelve a `/pases-especiales`.
6. Con pago aprobado, si faltan nombre/RUT/teléfono se envía el correo HTML `special_pass_enrollment`.
7. Al completar datos se emite el pase, la boleta y el correo HTML `special_pass_issued` con QR, retiro y advertencia.
8. Mi Pit Lane muestra Pistones, QR y estados. `/validar-pase` permite consulta, retiro y acceso según autorización.
9. El backoffice permite actualizar niveles, precios, beneficios y retiro, operar pases y exportar Pistones.

## Persistencia

- Colección de aplicación: `specialPasses`.
- Tabla Supabase: `public.hfc_special_passes`.
- Migración: `supabase/migrations/20260809090000_special_passes.sql`.
- Restricciones únicas: un pase por orden y un código único por pase.
- Índices por código, orden y usuario.
- RLS activado; la aplicación escribe mediante sus credenciales de servidor.
- Estados y acciones quedan registrados en `hfc_audit`.

## Correos transaccionales

- `special_pass_enrollment`: pago confirmado, nivel/Pistones, enlace y QR de enrolamiento, retiro y aviso destacado.
- `special_pass_issued`: código y QR del pase, Pistones, retiro, acceso y aviso destacado.
- Las plantillas quedan disponibles en el editor de correos del backoffice.

## Responsabilidades

PyR Eventos es el organizador y responsable de definir, acreditar y mantener la legalidad de la actividad, las bases, premios, método, padrón, sorteo, entrega y comunicaciones. Prof3sional Chile SpA presta desarrollo y soporte tecnológico; la implementación del software no constituye revisión ni aprobación jurídica.

Antes de publicar definitivamente el premio se mantienen pendientes, bajo responsabilidad de PyR Eventos:

- razón social, RUT, representante y domicilio;
- bases revisadas y versión publicada;
- método, hora, ubicación, ministro de fe o mecanismo de transparencia;
- regla de presencia, suplencia y retiro de premios;
- antecedentes documentales del automóvil, propiedad, gravámenes, estado y transferencia;
- política de cancelación, devolución y contracargos;
- aceptación de la actividad por el procesador de pagos cuando corresponda.

## Recursos visuales

- Cinco fotografías originales del automóvil se mantienen sin retoque en `public/assets/sorteo-auto/`.
- El automóvil es el atractivo principal de la landing: `public/assets/sorteo-auto/auto-hero-promocional-v2.webp` ocupa el hero a ancho completo, con el mensaje `Un automóvil. Entre los premios especiales.`
- El hero es una recreación promocional digital basada en la fotografía real del vehículo: conserva el coupé rojo, llantas grafito y postura baja, reemplaza el taller por un pabellón nocturno limpio, usa piso reflectante y muestra faros halógenos y neblineros encendidos. Se optimizó a WebP de aproximadamente 192 KB.
- Las fotografías originales siguen siendo la referencia documental. La recreación debe tratarse como pieza publicitaria y PyR Eventos debe confirmar que no atribuya al premio características o estado distintos del automóvil real antes de una publicación definitiva.
- La credencial dejó de competir visualmente con el premio y se presenta más abajo, dentro de `Lo que recibes`, usando `public/assets/pases-especiales/pase-especial-hero.png`.
- La pieza de la credencial es una representación conceptual sencilla; el diseño final de impresión debe reemplazarla cuando PyR entregue el arte definitivo.

## Estado técnico verificado al 10 de agosto de 2026

- `npm run check` validó sintaxis del servidor, frontend y scripts nuevos.
- `npm run passes:check` validó de extremo a extremo, en almacenamiento aislado: catálogo, compra, aceptación de no entrada, pago demo, enrolamiento, emisión de un pase sin tickets, códigos por Pistón, correo, consulta pública, retiro, acceso, idempotencia, métricas y CSV.
- La revisión visual cubrió escritorio, móvil, enrolamiento, QR, validación operativa y backoffice.
- La imagen se corrigió por instrucción del usuario: no representa una credencial premium, metálica o rígida; muestra un lanyard corriente y una credencial impresa dentro de una funda plástica transparente.
- La portada del Pase Especial se verificó visualmente en escritorio de `1440x1000` y móvil de `390x844`: el automóvil ocupa todo el ancho, el texto y los CTA conservan contraste, el aviso `NO ES VÁLIDO COMO ENTRADA` queda visible y la consola no registra errores.
- La recreación promocional con luces encendidas se volvió a verificar en esos dos tamaños. En móvil el foco de la imagen se desplazó a `68%` para mantener visible el faro principal sin afectar la lectura del contenido.
- La migración remota de `hfc_special_passes` **no está aplicada**. El intento directo falló por autenticación PostgreSQL y el token de Supabase Management API inventariado no tiene privilegios sobre el proyecto Honda Fest. Ambos fallos ocurrieron antes de ejecutar DDL; no se modificó la base remota.
- La publicación o despliegue a producción no forma parte de esta verificación local y permanece pendiente hasta contar con acceso DDL válido y ejecutar la migración idempotente.

### Preview para revisión de Pablo

- Deployment Vercel vigente: `dpl_6TGxuXywBvZoVHGs9XyUcvNekbvb`.
- Estado comprobado: `READY`, target Preview; no se usó `--prod` ni se promovió un alias de producción.
- URL técnica: `https://hondafestchile-kapvl6u26-prof3sionalcl-2961s-projects.vercel.app`.
- Alias Preview estable: `https://hondafestchile-prof3sionalcl-2961-prof3sionalcl-2961s-projects.vercel.app`.
- El proyecto mantiene Vercel Authentication. `Anyone with the link` está habilitado sobre el alias Preview y se regeneró un enlace compartible temporal por aproximadamente 23 horas. El parámetro de acceso no se guarda en ContextIA.
- Verificación externa en navegador limpio: `/pases-especiales` cargó sin login mediante el enlace compartible, `GET /api/catalog` y `GET /api/special-passes/catalog` respondieron 200, y no hubo errores ni advertencias de consola.
- La inspección visual remota confirmó el hero promocional del automóvil con luces encendidas a ancho completo en escritorio. La versión móvil se validó localmente a `390x844` con el faro principal visible y el aviso de entrada libre de superposición.
- El escaneo de runtime del deployment no encontró eventos `error` ni `fatal` durante la ventana de verificación.
- La preview no contiene variables Supabase ni Mercado Pago. Es apta para revisión visual y funcional básica, no para probar cobros, persistencia ni emisión real.
- `.vercelignore` excluye `ContextIA/`, `output/`, `.playwright-cli/`, `scripts/` y `supabase/` del paquete publicado, además de los secretos y logs ya excluidos.
- Aprendizaje operativo: con Vercel CLI autenticado, `vercel deploy --yes` puede responder `Not authorized` si no se fija el equipo. El comando validado para este proyecto es `vercel deploy --yes --scope prof3sionalcl-2961s-projects`; sigue creando Preview mientras no se agregue `--prod`.
