# Reportes operativos

## Informe breve por correo

- Para informes simples de Ventas, Pagos y Entradas, tomar el corte desde `/api/backoffice/summary` usando el header `x-admin-token` con `BACKOFFICE_TOKEN`.
- Redactar el informe en lenguaje ejecutivo y breve: totales, desglose por evento, pagos aprobados/fallidos/expirados, entradas emitidas/validas/usadas, casos importantes y avances relevantes.
- Cuando el usuario pida "redacta" o "genera informe" sin pedir envio explicito, dejarlo como borrador y no enviarlo automaticamente.
- El conector Outlook puede responder `ErrorAccessDenied` para escrituras. En ese caso, se puede crear el borrador con Microsoft Graph en el buzon operativo `ticketera@hondafestchile.cl`.
- El borrador de reporte debe quedar dirigido a `contacto@hondafestchile.cl` con copia a `hondafestchile@gmail.com`, salvo que el usuario indique otros destinatarios.
