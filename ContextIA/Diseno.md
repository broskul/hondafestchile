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

## Hero Racing

- Poster desktop: `public/assets/racing/hfc-hero-desktop.png`.
- Poster movil: `public/assets/racing/hfc-hero-mobile.png`.
- Imagen editorial secundaria: `public/assets/racing/hfc-hero-solo.png`.
- Capa de movimiento local: `public/assets/racing/hfc-hero-motion.mp4`, preparada desde el banner aprobado para una transicion inmediata y reemplazable por metraje oficial cuando se incorpore al repositorio.
- En escritorio, hover o foco activa el video; salir devuelve el poster. El boton reproducir/detener permite fijar la decision.
- En movil se prioriza el crop vertical y la imagen estatica. `prefers-reduced-motion` impide la activacion automatica.

## Editorial Pistones

- Nombre publico de categoria: `Pases de Jornada`.
- Unidad de nivel: `Pistones`, disponibles en 1, 3, 5, 7 y 9.
- Relacion de producto: la entrada habilita el ingreso; el Pase de Jornada agrega credencial, experiencias especiales y participacion en premios anunciados.
- Limite obligatorio: el Pase de Jornada no reemplaza la entrada. Conservar `NO ES VALIDO COMO ENTRADA` en compra, enrolamiento, entrada digital y validacion.
- No inventar beneficios por nivel. Los beneficios adicionales se publican solo cuando esten confirmados.
- La reformulacion editorial no cambia la naturaleza pagada del producto, la logica de cobro, la elegibilidad ni los controles legales existentes.
