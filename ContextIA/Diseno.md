# Diseno visual

## Direccion aprobada

El landing de Honda Fest Chile usara una estetica de motorsport editorial de alto rendimiento. La referencia aprobada combina una portada cinematografica de competicion con una interfaz tecnica inspirada en telemetria.

Esta direccion fue formalizada el 26 de agosto de 2026 como el estilo predefinido `Racing` (`Technical Motorsport Editorial`) en `Cerebro/ContextIA/Estilos-CSS-Predefinidos.md`. Honda Fest Chile es su primera adopcion.

## Lenguaje visual

- Hero oscuro y full width con un auto rojo y blanco como protagonista absoluto.
- Negro tecnico, rojo de competicion y blanco; dorado del logo oficial y cian solo para datos de telemetria.
- Titulares grandes, condensados y ligeramente inclinados; cuerpo sans serif limpio.
- Navegacion compacta, precisa y operativa.
- Overlays discretos de pista, vueltas, temperaturas, coordenadas y tiempos.
- Calendario de eventos en una banda blanca inmediatamente visible bajo el hero.
- Botones rectangulares de radio bajo, con CTA rojo primario.
- Logo oficial `public/logo-hfc.avif` en el header y aplicaciones de marca sobre vehiculos cuando corresponda.

## Concepto IA aprobado

El usuario aprobo expresamente el mockup generado el 26 de agosto de 2026, con logo oficial en el header y decal sobre el auto. La composicion debe orientar el futuro rediseño del landing sin copiar literalmente plantillas externas.

## Criterios de implementacion

- Mantener la ticketera y la navegacion como producto usable, no convertir la pagina en un poster.
- Preservar legibilidad sobre la fotografia y evitar saturar la interfaz con datos decorativos.
- Mantener visible el inicio del calendario de eventos en el primer viewport.
- Aplicar la identidad visual tambien a ticketera, Mi Pit Lane y entradas, con menor densidad cinematografica.
- No repetir la misma imagen, escena o sujeto protagonista en secciones consecutivas. El hero presenta la accion del evento y el siguiente bloque debe revelar producto, personas, detalle o una perspectiva distinta.

## Hero Racing

- Poster desktop: `public/assets/racing/hfc-hero-desktop.png`.
- Poster movil: `public/assets/racing/hfc-hero-mobile.png`.
- Imagen editorial secundaria: `public/assets/racing/hfc-hero-solo.png`.
- Capa de movimiento local: `public/assets/racing/hfc-hero-motion.mp4`, preparada desde el banner aprobado para una transicion inmediata y reemplazable por metraje oficial cuando se incorpore al repositorio.
- En escritorio, hover o foco activa el video; salir devuelve el poster. El boton reproducir/detener permite fijar la decision.
- En movil se prioriza el crop vertical y la imagen estatica. `prefers-reduced-motion` impide la activacion automatica.

## Editorial Upgrade de experiencia

- Concepto comercial general: `Upgrade de experiencia`.
- Producto: `Pase`. No usar `Pase de Jornada`, `Pase Especial` ni `Pase + Pistones` en la comunicacion publica.
- Variantes: `Pase de 1 Piston`, `Pase de 3 Pistones`, `Pase de 5 Pistones`, `Pase de 7 Pistones` y `Pase de 9 Pistones`.
- Unidad de nivel: `Pistones`. Cada Piston representa una posibilidad registrada en el sorteo, sujeta a las bases oficiales.
- Mensaje comercial principal: `¡Ganate este Honda con tu Upgrade de experiencia! Mientras mas Pistones, mas posibilidades tienes de ganar.`
- Beneficio comun confirmado: cada Pase incluye un refresco extra durante la jornada.
- Relacion de producto: la entrada habilita el ingreso; el Pase agrega credencial, experiencias, refresco y Pistones registrados.
- Limite obligatorio: el Pase no reemplaza la entrada. Conservar `NO ES VALIDO COMO ENTRADA` en compra, enrolamiento, correo, Mi Pit Lane y validacion.
- La reformulacion editorial no cambia la naturaleza pagada del producto, la logica de cobro, la elegibilidad ni los controles legales existentes.

## Segunda pasada Racing

- El hero general conserva el Honda blanco en pista y su video al hover.
- El calendario recupera un motor tecnico a la izquierda mediante `public/assets/racing/hfc-calendar-engine-v2.webp`.
- La campaña de Upgrade usa `public/assets/racing/hfc-upgrade-car-cinematic-v4.webp`: recreacion promocional del Honda real, con humo lateral, reflectores fuera de cuadro y tratamiento nocturno racing.
- La imagen del premio es protagonista en portada y en `/pases-especiales`; la credencial aparece despues en `Lo que recibes` y no compite con el automovil.
- Dentro de una pagina no se repite una imagen en secciones consecutivas. Evento, calendario, premio y credencial deben usar escenas o sujetos distintos.
- La recreacion del Honda no acredita su estado documental. Las fotografias originales permanecen como referencia y la pagina de bases informa que la ficha del vehiculo sigue pendiente de publicacion por PyR Eventos.
