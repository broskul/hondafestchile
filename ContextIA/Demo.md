# Demo

## Objetivo

Permitir que la app funcione localmente sin credenciales externas.

## Comportamiento

- Sin SMTP, el registro devuelve un enlace local de confirmacion y tambien lo imprime en consola.
- Sin Mercado Pago, la orden se paga con `Confirmar pago` desde la UI.
- Sin OpenFactura, se crea un DTE demo con folio local no tributario.
- La persistencia se guarda en `data/app-state.json` si Supabase no esta configurado o si faltan tablas `hfc_*`.
- Con Supabase configurado pero sin schema, la app muestra warning y usa JSON local como fallback de desarrollo.

## Como ejecutar

```powershell
npm install
npm run dev
```

Abrir `http://localhost:3000`.

Verificar Supabase:

```powershell
npm run supabase:check
```

## Pendientes

- Sustituir modo demo por servicios reales para pruebas integrales.
- Agregar datos semilla solo si se requiere presentacion guiada.
