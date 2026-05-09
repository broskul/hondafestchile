# Demo

## Objetivo

Permitir que la app funcione localmente sin credenciales externas.

## Comportamiento

- Sin SMTP, el registro devuelve un enlace local de confirmacion y tambien lo imprime en consola.
- Sin Mercado Pago, la orden se paga con `Confirmar pago` desde la UI.
- Sin OpenFactura, se crea un DTE demo con folio local no tributario.
- La persistencia se guarda en `data/app-state.json`.

## Como ejecutar

```powershell
npm install
npm run dev
```

Abrir `http://localhost:3000`.

## Pendientes

- Sustituir modo demo por servicios reales para pruebas integrales.
- Agregar datos semilla solo si se requiere presentacion guiada.
