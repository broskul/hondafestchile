# Instrucciones ContextIA

## Objetivo

Mantener contexto vivo por modulo dentro de `ContextIA/` para que cualquier cambio futuro sea mas facil de entender, ejecutar, presentar y documentar sin reanalizar todo el codigo desde cero.

## Regla principal

Todo cambio funcional, tecnico o estrategico en el codigo debe reflejarse tambien en el archivo `.md` de su modulo dentro de `ContextIA/`.

## Estructura mínima esperada

- `ContextIA/CSS.md`
- `ContextIA/Informes.md`
- `ContextIA/Integraciones.md`
- `ContextIA/Pagos.md` (si aplica)- `ContextIA/DTE.md` (si aplica)
- `ContextIA/Demo.md`
- `ContextIA/Supabase.md`
- `ContextIA/Auth.md`
- `ContextIA/R2.md` (si aplica)
- `ContextIA/Sharepoint.md` (si aplica)

## Como mantener estos contextos

- No solo agregar entradas nuevas.
- Leer el archivo del modulo antes de actualizarlo.
- Reescribir y ordenar el contenido cuando haga falta.
- Eliminar estrategias antiguas, descartadas o engañosas.
- Mantener solo decisiones vigentes, hallazgos utiles, flujos reales y pendientes activos.

## Que registrar en el contexto de cada modulo

- Objetivo del modulo.
- Fuentes de verdad y sistemas externos involucrados.
- Flujo funcional real.
- Archivos clave del codigo.
- Decisiones tecnicas vigentes.
- Riesgos, bugs conocidos y workaround si existen.
- Pendientes reales y proximos pasos.
- Notas utiles para presentaciones, onboarding y manuales.

## Criterio de calidad

- Si una explicacion ya no representa el comportamiento actual, se corrige o se elimina.
- Si un bug ya fue resuelto, el contexto debe quedar actualizado con la solucion real.
- Si una decision fue reemplazada por otra, debe quedar solo la decision vigente y, si aporta, una nota breve de por que cambio.
- El contexto debe servir tanto para desarrollo como para documentacion funcional.

## Regla operativa para futuras sesiones

Antes de modificar un modulo:

- revisar su archivo en `ContextIA/`.

Despues de modificar un modulo:

- actualizar su archivo en `ContextIA/` con el estado vigente.

Si un cambio afecta varios modulos:

- actualizar cada `.md` correspondiente, no centralizar todo en un solo archivo.## Criterio de producción
  Nunca ingreses contexto en la interfaz de usuario
