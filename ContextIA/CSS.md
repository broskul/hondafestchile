# CSS

## Objetivo

Definir la interfaz publica de Honda Fest Chile y Japon Fest Chile con un estilo automotriz, sobrio y participativo.

## Archivos clave

- `public/index.html`
- `public/ticketera.html`
- `public/carrito.html`
- `public/mis-compras.html`
- `public/validar.html`
- `public/backoffice.html`
- `public/styles.css`
- `public/shared.js`
- `public/app.js`
- `public/assets/hero-motorsport.png`

## Decisiones vigentes

- Sitio estatico servido por Express.
- Hero con poster bitmap local y video cinematografico derivado de los 28 frames; el `canvas` servido desde Cloudflare R2 queda como fallback.
- El video conserva ritmo de 10 keyframes/s, entrega 30 cuadros/s mediante flujo optico dentro de cada toma y usa shutter fades en los cortes 16→17, 20→21 y 23→24. No mezclar perspectivas mediante crossfade porque crea siluetas dobles y movimiento erratico.
- En movil video y canvas conservan `cover` centrado horizontalmente, sin desborde; `prefers-reduced-motion` mantiene el poster sin descargar movimiento.
- La tira de miniaturas de galeria centra la foto activa con su propio scroll horizontal; nunca usa `scrollIntoView` para evitar que la carga lleve el documento fuera del hero.
- Paleta principal: rojo Honda, negro, blanco, cian y dorado como acentos.
- Tarjetas con radio maximo de 8px y layouts responsivos por grillas CSS.
- La ticketera es pagina propia; el carrito existe como lightbox lateral compartido y como pagina completa.
- `mis-compras`, `validar` y `backoffice-hfc` comparten lenguaje visual operativo mas denso.
- No se ingresa contexto tecnico en la interfaz; la UI solo muestra copy orientado al asistente.

## Pendientes

- Reemplazar fechas genericas por calendario oficial cuando produccion lo confirme.
- Agregar imagenes reales del evento con autorizacion de uso.
