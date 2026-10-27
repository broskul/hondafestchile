# CI en el Dell

Configuracion preparada el 2026-10-26 por solicitud de Carlos. GitHub conserva
workflows, resultados y gates. El ejecutor usa la VM dedicada VM-GHA-CI-01:
4 vCPU, 8 GiB, 80 GiB, con una sola ejecucion global entre repositorios.

Cada job utiliza etiquetas ligadas al run y su intento, registro efimero y un
disco diferencial nuevo desde imagen limpia. No se comparten espacios de trabajo,
sesiones, claves SSH de administracion ni credenciales productivas entre jobs.
La cola se administra desde Mi Servidor en USUARIO01; esa sesion Windows debe
permanecer iniciada. El runner ejecuta las pruebas dentro de Linux en el Dell.

Las contribuciones de forks no se asignan automaticamente a este ejecutor.
Permanecen pendientes de revision; no hay fallback de pago ni gates omitidos.
No confundir CI aprobada con aceptacion de integraciones o publicacion Vercel.
