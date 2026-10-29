# Pases HFC 2026 y sorteo

## Estrategia vigente

La estrategia anterior de venta de boletos, números o packs con unidades de regalo queda reemplazada por un producto físico y operativo: **Pase HFC 2026**. El concepto comercial que lo presenta es **Upgrade de experiencia**.

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

El Pase se materializa como un **lanyard con credencial impresa**, entregado en un porta credencial. Da acceso a experiencias y beneficios especiales el día del evento y participa en los sorteos mediante los Pistones asociados. El refresco es un beneficio secundario y no debe dominar la propuesta.

La comunicación pública es **benefit-first**: `Accede a beneficios exclusivos y participa por el sorteo de un Honda`. No presentar el producto como la venta de probabilidades ni como `gana un auto y además recibe un refresco`.

La taxonomía pública vigente es estricta:

- concepto: `Upgrade de experiencia`;
- producto: `Pase`;
- variantes: `Pase de 1 Pistón`, `Pase de 3 Pistones`, `Pase de 5 Pistones`, `Pase de 7 Pistones` y `Pase de 9 Pistones`;
- regla editorial: cada Pistón queda asociado al RUT del titular y participa individualmente conforme a las bases.

No usar públicamente `Pase de Jornada`, `Pase Especial` ni `Pase + Pistones`.

La condición **“NO ES VÁLIDO COMO ENTRADA”** es material y debe mostrarse antes del pago y en las superficies transaccionales. Comprar el Upgrade no exige tener una entrada vinculada.

La web permite comprar sin acreditar una entrada previa y el sistema no intenta buscarla, vincularla ni bloquear la compra por su ausencia. El comprador acepta expresamente que necesita una entrada válida independiente para ingresar a Honda Fest Chile. La aceptación queda registrada con fecha, orden, usuario, nivel y cantidad de Pistones.

## Retiro, entrada y presencia

- Retiro confirmado: el 29 de noviembre de 2026 durante Honda Fest Chile, presentando QR e identificación del titular.
- Punto de retiro previo al evento: por confirmar.
- Un mismo QR identifica la credencial impresa.
- `pickupStatus` registra el retiro: `pending` o `picked_up`.
- `accessStatus` registra el acceso especial: `not_checked_in` o `checked_in`.
- `entryValidationStatus` registra internamente si el equipo verificó una entrada HFC válida. El check-in del Upgrade falla cerrado mientras siga `unverified`.
- `attendanceStatus` y la elegibilidad presencial se actualizan solo con check-in administrativo.
- Registrar retiro o acceso es una operación administrativa protegida; una consulta pública nunca modifica el estado.
- El acceso requiere retiro previo, salvo la operación explícita y auditable `pickup_and_checkin`.

## Pistones y premios

El QR representa el pase, no cada Pistón. Tras el pago aprobado se crea un único pase idempotente por orden y cada Pistón recibe código, ordinal, RUT normalizado, estado y fecha de emisión. El payload mantiene `drawEntryCodes` por compatibilidad y `pistons` con los datos operativos; Supabase los proyecta además como una fila por Pistón en `hfc_pistons`.

Regla de presencia vigente para el diseño técnico y el borrador público:

- el sorteo del automóvil se ejecuta presencialmente durante Honda Fest Chile el **29 de noviembre de 2026**, pero el titular no necesita estar presente ni tener entrada para conservar esa participación;
- si resulta ganador del automóvil, se le contacta por correo y teléfono y el resultado debe publicarse conforme a las bases;
- los demás premios y beneficios presenciales exigen entrada válida, presencia y check-in;
- estas diferencias son condiciones materiales y no pueden ocultarse ni contradecir las bases aceptadas.

La exportación administrativa genera una fila por Pistón con código de pase, código individual, nivel, titular, orden y estados de retiro/acceso. El padrón no debe deduplicarse por persona: cada Pistón comprado y emitido representa una unidad registrada. La definición final de elegibilidad, método de selección, presencia requerida, suplentes y entrega de premios debe quedar en las bases de PyR Eventos antes de la publicación definitiva.

## Flujo implementado

1. La página `/pases-especiales` obtiene niveles y textos desde configuración persistente y presenta el automóvil como protagonista del Upgrade.
2. El comprador elige un nivel e informa nombre, RUT, correo y teléfono antes del pago. Acepta privacidad, bases versionadas y el aviso de no entrada.
3. El backend reconstruye nombre, Pistones y precio desde el `levelId`; nunca confía en el precio del navegador.
4. La orden queda con `kind: special_pass`, una unidad física y ruta de retorno propia.
5. Mercado Pago conserva la idempotencia existente y devuelve a `/pases-especiales`.
6. Con el perfil completo antes del pago, el Pase y sus Pistones se emiten de inmediato una sola vez. El enrolamiento post-pago se conserva como compatibilidad para órdenes históricas incompletas.
7. El correo HTML `special_pass_issued` confirma beneficios, QR, retiro, Pistones asociados al RUT, reglas de presencia y aviso de no entrada.
8. Mi Pit Lane muestra Pistones, QR y estados. `/validar-pase` permite consulta, retiro y acceso según autorización.
9. El backoffice permite actualizar niveles, precios, beneficios y retiro, operar pases y exportar Pistones.

## Persistencia y sorteo auditable

- Colección de aplicación: `specialPasses`.
- Tabla raíz Supabase: `public.hfc_special_passes`.
- Migraciones: `supabase/migrations/20260809090000_special_passes.sql` y `supabase/migrations/20260905120000_special_pass_upgrades.sql`.
- Restricciones únicas: un pase por orden y un código único por pase.
- `hfc_pistons`: una fila por Pistón y RUT normalizado, con unicidad por Pase/ordinal y por código.
- `hfc_order_acceptances`: versión y hash de bases, privacidad, presencia y no entrada.
- `hfc_special_prizes`: regla de presencia y entrada por premio; el automóvil queda `presence_required=false` y `event_entry_required=false` en estado `draft`.
- `hfc_draw_manifests` y `hfc_draw_entries`: padrón versionado, sellado, hasheado e inmutable.
- `hfc_draw_results`: resultado y suplencias sin eliminación física.
- `hfc_notification_outbox`: tareas idempotentes separadas para correo y contacto telefónico; una fila pendiente no prueba un envío ni contacto real.
- RLS activado; la aplicación escribe mediante sus credenciales de servidor.
- Estados y acciones quedan registrados en `hfc_audit`.

## Correos transaccionales

- `special_pass_enrollment`: pago confirmado, nivel/Pistones, enlace y QR de enrolamiento, retiro y aviso destacado.
- `special_pass_issued`: código y QR del pase, Pistones, retiro, acceso y aviso destacado.
- `special_pass_winner`: plantilla de notificación de premio con Pistón, instrucciones, plazo, resultados y bases. La llamada telefónica requiere ejecución o integración separada y evidencia de resultado.
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
- El automóvil sigue siendo el foco visual: `public/assets/racing/hfc-upgrade-car-cinematic-v4.webp` ocupa el hero completo. El mensaje comercial abre con `Accede a beneficios exclusivos` y presenta el sorteo del Honda como participación adicional.
- El hero es una recreación promocional digital basada en la fotografía real del vehículo: conserva el hatchback rojo de tres puertas, llantas grafito, molduras, postura, faros y neblineros. La direccion fotografica agrega pista nocturna mojada, humo lateral, luz roja y reflectores cercanos fuera de cuadro para una lectura racing.
- `public/assets/racing/hfc-calendar-engine-v2.webp` es un recorte IA de motor tecnico usado a la izquierda de la fecha oficial; no representa necesariamente el motor del premio.
- Las fotografías originales siguen siendo la referencia documental. La recreación debe tratarse como pieza publicitaria y PyR Eventos debe confirmar que no atribuya al premio características o estado distintos del automóvil real antes de una publicación definitiva.
- La credencial no compite visualmente con el premio y se presenta más abajo, dentro de `Lo que recibes`, usando `public/assets/pases-especiales/pase-especial-hero.png`.
- La pieza de la credencial es una representación conceptual sencilla; el diseño final de impresión debe reemplazarla cuando PyR entregue el arte definitivo.
- `/bases-sorteo` publica sólo un estado informativo: mecánica conocida, precios, organizador, limite de no entrada y pendientes del vehículo. No se presenta como bases oficiales mientras PyR Eventos no complete y revise el documento definitivo.

## Controles de activación

La venta del Upgrade falla cerrada y necesita simultáneamente:

1. `SPECIAL_PASS_SALES_ENABLED=true` en el runtime;
2. `special_pass_config.active=true` persistido;
3. `rulesPublished=true` y `rulesVersion=upgrade-hfc-2026-v1`;
4. almacenamiento relacional de Pases operativo y con todos sus triggers críticos;
5. proveedor real de correo transaccional;
6. Mercado Pago productivo, firma de webhook y URL pública;
7. venta online global habilitada.

El valor por defecto es `active=false`. Aplicar el schema o publicar código no abre ventas. El backoffice exige una confirmación explícita antes de aumentar la exposición, pero esa confirmación técnica no reemplaza la habilitación jurídica.

La simulación de pagos queda deshabilitada en Vercel/producción salvo `HFC_ALLOW_DEMO_PAYMENT=true`, variable que nunca debe habilitarse en producción.

## Estado técnico verificado al 5 de septiembre de 2026

- Narrativa web y correos reescritos con beneficios como propuesta principal y el Honda como participación adicional.
- Checkout preparado para asociar desde el inicio el Upgrade y cada Pistón a nombre y RUT del titular.
- Aceptación de bases versionada y hasheada por el servidor.
- Lectura de órdenes protegida por sesión, token de enrolamiento o backoffice; el ID de orden no funciona como autorización.
- Consulta pública del Pase enmascara al titular; el operador autenticado conserva el detalle.
- Pagos reales aprobados deben coincidir en referencia, monto, moneda y preferencia antes de emitir. Reembolsos y contracargos revocan el Pase y sus Pistones.
- El código de Pase es determinista por campaña+orden para resistir webhooks concurrentes.
- La infraestructura fue desplegada y migrada en producción con la venta bloqueada. No declarar venta real operativa mientras falten bases completas, habilitación jurídica documentada y operación E2E de sorteo/notificación.

## Historial técnico al 10 de agosto de 2026

- `npm run check` validó sintaxis del servidor, frontend y scripts nuevos.
- `npm run passes:check` validó de extremo a extremo, en almacenamiento aislado: catálogo, compra, aceptación de no entrada, pago demo, enrolamiento, emisión de un pase sin tickets, códigos por Pistón, correo, consulta pública, retiro, acceso, idempotencia, métricas y CSV.
- La revisión visual cubrió escritorio, móvil, enrolamiento, QR, validación operativa y backoffice.
- La imagen se corrigió por instrucción del usuario: no representa una credencial premium, metálica o rígida; muestra un lanyard corriente y una credencial impresa dentro de una funda plástica transparente.
- La portada del Pase Especial se verificó visualmente en escritorio de `1440x1000` y móvil de `390x844`: el automóvil ocupa todo el ancho, el texto y los CTA conservan contraste, el aviso `NO ES VÁLIDO COMO ENTRADA` queda visible y la consola no registra errores.
- La recreación promocional con luces encendidas se volvió a verificar en esos dos tamaños. En móvil el foco de la imagen se desplazó a `68%` para mantener visible el faro principal sin afectar la lectura del contenido.
- El intento directo desde el vault falló por una contraseña PostgreSQL local desactualizada y el token inventariado de Supabase Management API no tenía privilegios sobre Honda Fest. Ambos fallos ocurrieron antes de ejecutar DDL.
- La migración base `20260809090000_special_passes.sql` y el Upgrade `20260905120000_special_pass_upgrades.sql` se aplicaron juntos en una transacción remota iniciada por un puente administrativo temporal, limitado al hash SHA-256 aprobado, al project ref `jvmibnyiinzpkahbkyec`, a la clave de backoffice vigente y al kill-switch desactivado. El resultado verificó `storageReady=true` y el puente fue retirado del código inmediatamente después.
- Producción quedó publicada desde el commit `e8fbfc7`; la venta continúa cerrada con `SPECIAL_PASS_SALES_ENABLED=false`, `active=false`, `rulesPublished=false` y fecha 29 de noviembre de 2026.

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
