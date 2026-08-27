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
- Hero con poster bitmap local y secuencia `canvas` de 28 frames servida desde Cloudflare R2.
- La secuencia usa carga diferida, decodificacion completa antes de reproducir, interpolacion entre frames y fallback de formato/resolucion.
- En movil el canvas conserva `cover` centrado horizontalmente, sin desborde; `prefers-reduced-motion` mantiene el poster sin descargar frames.
- Paleta principal: rojo Honda, negro, blanco, cian y dorado como acentos.
- Tarjetas con radio maximo de 8px y layouts responsivos por grillas CSS.
- La ticketera es pagina propia; el carrito existe como lightbox lateral compartido y como pagina completa.
- `mis-compras`, `validar` y `backoffice-hfc` comparten lenguaje visual operativo mas denso.
- No se ingresa contexto tecnico en la interfaz; la UI solo muestra copy orientado al asistente.

## Pendientes

- Reemplazar fechas genericas por calendario oficial cuando produccion lo confirme.
- Agregar imagenes reales del evento con autorizacion de uso.
