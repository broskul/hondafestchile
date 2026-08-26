# Pases de Pistones HFC 2026 y sorteo

## Estrategia vigente

Cada entrada de Galeria o Parque Cerrado incluye **1 Pistón**. Cada Pistón equivale a un boleto individual para el sorteo del automóvil. Los Pases son upgrades que agregan Pistones y prestaciones a una entrada HFC 2026 válida.

Cada compra corresponde a un nivel cerrado medido en **Pistones**:

| Producto | Neto | Final con IVA + cargo 8% | Pistones extra |
| --- | ---: | ---: | ---: |
| Pase de 1 Pistón | $5.000 | $6.426 | 1 |
| Pase de 3 Pistones | $10.000 | $12.852 | 3 |
| Pase de 5 Pistones | $15.000 | $19.278 | 5 |
| Pase de 7 Pistones | $20.000 | $25.704 | 7 |
| Pase de 9 Pistones | $25.000 | $32.130 | 9 |

El servidor reconstruye IVA, cargo y total desde el valor neto. Los Pases no descuentan ni alteran el cupo de entradas.

## Producto físico y comunicación

El Pase se materializa como un **lanyard con credencial impresa**, entregado en un porta credencial. El Pase de 1 y el de 3 Pistones comunican 1 refrigerio; el Pase de 5 Pistones comunica 2 refrigerios. El envase visual es genérico y no promete agua, bebida energética ni otra bebida específica. Los Pases de 7 y 9 mantienen sus prestaciones adicionales por definir.

La condición **“UPGRADE: REQUIERE UNA ENTRADA HFC 2026”** debe mostrarse en selección, aceptación previa al pago, enrolamiento, correo, Mi Pit Lane y consulta del QR.

La venta queda cerrada por `SPECIAL_PASSES_ENABLED=false` hasta enlazar el upgrade con una entrada, aplicar la migración remota, publicar las bases y confirmar la aceptación del procesador de pagos. La aceptación del requisito de entrada queda preparada para registrarse con fecha, orden, usuario, nivel y cantidad de Pistones.

## Retiro y acceso

- Retiro durante Honda Fest Chile, el 28 y 29 de noviembre de 2026, presentando QR e identificación del titular.
- Punto de retiro previo al evento: por confirmar.
- Un mismo QR identifica la credencial impresa.
- `pickupStatus` registra el retiro: `pending` o `picked_up`.
- `accessStatus` registra el acceso especial: `not_checked_in` o `checked_in`.
- Registrar retiro o acceso es una operación administrativa protegida; una consulta pública nunca modifica el estado.
- El acceso requiere retiro previo, salvo la operación explícita y auditable `pickup_and_checkin`.

## Pistones y premios

El QR representa el Pase, no cada Pistón. Las entradas y los Pases generan códigos individuales de participación dentro de `drawEntryCodes`. Las entradas antiguas sin ese arreglo obtienen un código determinístico `CODIGO-ENTRADA-P01` para que no queden fuera del padrón.

La exportación administrativa genera una fila por Pistón, tanto para entradas como para Pases, con origen, código, titular y orden. El padrón no debe deduplicarse por persona: cada Pistón emitido representa una unidad registrada. La definición final de elegibilidad, método de selección, presencia requerida, suplentes y entrega de premios debe quedar en las bases de PyR Eventos antes de la publicación definitiva.

## Flujo preparado y bloqueado para venta

1. La página `/pases-especiales` obtiene niveles y textos desde configuración persistente.
2. El comprador puede revisar niveles, valores netos, totales, refrigerios y prestaciones, pero los botones permanecen deshabilitados sin `SPECIAL_PASSES_ENABLED=true`.
3. El backend reconstruye nombre, Pistones y precio desde el `levelId`; nunca confía en el precio del navegador.
4. La ruta técnica crea una orden `kind: special_pass`; antes de habilitar producción debe vincularse con una entrada HFC 2026 válida.
5. Mercado Pago conserva la idempotencia existente y devuelve a `/pases-especiales`.
6. Con pago aprobado, si faltan nombre/RUT/teléfono se envía el correo HTML `special_pass_enrollment`.
7. Al completar datos se emite el pase, la boleta y el correo HTML `special_pass_issued` con QR, retiro y advertencia.
8. Mi Pit Lane muestra Pistones, QR y estados. `/validar-pase` permite consulta, retiro y acceso según autorización.
9. El backoffice permite actualizar niveles netos, beneficios y retiro, operar Pases y exportar un padrón que incluye Pistones de entradas y Pases.

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
- El automóvil es el atractivo principal de la landing: `public/assets/sorteo-auto/auto-hero-promocional-v2.webp` ocupa el hero a ancho completo, con el mensaje `Un automóvil. Más Pistones, más oportunidades.`
- El hero es una recreación promocional digital basada en la fotografía real del vehículo: conserva el coupé rojo, llantas grafito y postura baja, reemplaza el taller por un pabellón nocturno limpio, usa piso reflectante y muestra faros halógenos y neblineros encendidos. Se optimizó a WebP de aproximadamente 192 KB.
- Las fotografías originales siguen siendo la referencia documental. La recreación debe tratarse como pieza publicitaria y PyR Eventos debe confirmar que no atribuya al premio características o estado distintos del automóvil real antes de una publicación definitiva.
- La credencial dejó de competir visualmente con el premio y se presenta más abajo, dentro de `Lo que recibes`, usando `public/assets/pases-especiales/pase-especial-hero.png`.
- La pieza de la credencial es una representación conceptual sencilla; el diseño final de impresión debe reemplazarla cuando PyR entregue el arte definitivo.

## Estado técnico verificado al 26 de agosto de 2026

- `npm run check` validó sintaxis del servidor, frontend y scripts nuevos.
- `npm run passes:check` validó de extremo a extremo, en almacenamiento aislado y con `SPECIAL_PASSES_ENABLED=true`: catálogo, total con IVA y cargo de 8%, pago demo, enrolamiento, emisión, códigos por Pistón, correo, consulta pública, retiro, acceso, idempotencia, métricas y CSV.
- La revisión visual cubrió escritorio, móvil, enrolamiento, QR, validación operativa y backoffice.
- La imagen se corrigió por instrucción del usuario: no representa una credencial premium, metálica o rígida; muestra un lanyard corriente y una credencial impresa dentro de una funda plástica transparente.
- La portada de Pases de Pistones se verificó visualmente en escritorio y móvil de `390x844`: el automóvil ocupa todo el ancho, el texto y los CTA conservan contraste, queda explícito que la entrada base incluye 1 Pistón y que el Pase es un upgrade, y la consola no registra errores.
- La recreación promocional con luces encendidas se volvió a verificar en esos dos tamaños. En móvil el foco de la imagen se desplazó a `68%` para mantener visible el faro principal sin afectar la lectura del contenido.
- La migración remota de `hfc_special_passes` **no está aplicada**. El intento directo falló por autenticación PostgreSQL y el token de Supabase Management API inventariado no tiene privilegios sobre el proyecto Honda Fest. Ambos fallos ocurrieron antes de ejecutar DDL; no se modificó la base remota.
- La venta de Pases no se publica en producción. Permanece pendiente vincular el upgrade con una entrada, contar con acceso DDL válido, ejecutar la migración idempotente, publicar las bases y confirmar la aceptación del procesador de pagos.

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
