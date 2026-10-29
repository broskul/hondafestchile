# Compra de Pistones y accesos publicos

## Alcance vigente

- Los llamados de Upgrade o de mejorar la experiencia llevan a `/pases-especiales#niveles`, nunca a WhatsApp.
- `public/piston-storefront.js` agrega acceso visible a Comprar Pistones en navegacion, boton flotante y pie de las paginas de compradores. Ticketera y paginas sin promocion propia tienen una banda de Upgrade con el aviso de que el Pase no reemplaza la entrada.
- El script se carga desde `public/test-mode.js`, compartido por las paginas. Su CSS esta aislado en `public/piston-storefront.css`; no modifica los precios ni el checkout.
- WhatsApp conserva sus funciones separadas: soporte de compras y contacto del evento. El acceso de Pistones es un enlace interno de compra y no reemplaza la ayuda.
- Los controles operativos de backoffice y validacion QR no reciben la promocion. Las llamadas de compra que el carrito renderiza mas tarde se corrigen tambien al activar el enlace.

## Incidente observado el 2026-10-29

- El dominio productivo sirve `dpl_EFyJJGJRB4Xdm6PSpeNELsYhaoQy`, origen Git `main`, SHA `2c385fe7f76cdecff73355e2d0b7298578831683`.
- En esa version, el llamado Mejorar mi experiencia apunta a WhatsApp de soporte. `/pases-especiales` y `/api/special-passes/catalog` devuelven la portada HTML con HTTP 200, no la tienda ni JSON. Un estado Ready o un HTTP 200 por si solo no comprueba este flujo.
- El workspace actual de `codex/hfc-special-passes-pricing` contiene las rutas, catalogo, niveles y checkout de Pases. No se debe publicar otra version de `main` sin incorporar esa funcionalidad y comprobar su contrato publico.
- Este lote no autoriza cambiar precios, activar controles de venta que esten cerrados, modificar bases ni hacer cobros de prueba.

## Verificacion y publicacion

- Responsable: este hilo, por la solicitud de Carlos del 2026-10-29. Repo `broskul/hondafestchile`, carpeta canonica `C:/Users/Usuario/Documents/Desarrollos/Honda Fest Chile`, rama actual `codex/hfc-special-passes-pricing`. No se autorizaron push ni merge en esta solicitud.
- `node scripts/check-piston-storefront.js` paso: pagina real de Pases, formulario, catalogo JSON de cinco niveles y assets compartidos. La prueba usa JSON temporal, no carga `.env.local` y bloquea peticiones externas del servidor. `HFC_STOREFRONT_BASE_URL` permite usar el mismo smoke de solo lectura al verificar una publicacion autorizada.
- Navegador interno local: el enlace heredado de WhatsApp Quiero mejorar mi experiencia navega a los niveles; Ayuda con mi compra conserva WhatsApp. Se selecciono Pase de 3 Pistones y se verifico Pagar $10.000 habilitado, sin completar datos, aceptar bases, crear una orden ni pagar.
- Vista de escritorio 1440 px y moviles 390/320 px sin desbordamiento ni superposicion de acciones. Imagen de Pistones cargada, texto de los botones completo y consola sin errores. Captura de preview guardada en `R:/Entregables-Codex/HFC-Compra-Pistones-Preview-2026-10-29.jpg`.
- El backend de Pases ya esta presente en el indice actual de esta rama. La publicacion que elimino esos endpoints es otra version de `main`; integrar el lote funcional antes de anunciar la recuperacion productiva. No se tocan controles de activacion ni se usa un redirect para disimular un catalogo ausente.
- Alcance propio: `public/piston-storefront.js`, `public/piston-storefront.css`, cargador en `public/test-mode.js`, `scripts/check-piston-storefront.js` y este documento. Todos los otros cambios y archivos no registrados que ya estaban en el workspace quedan excluidos.
- Estado al cerrar validacion: codigo preparado y comprobado localmente; push, CI remota y deployment de este arreglo no ejecutados. El recibo del commit se registra desde la salida del comando, sin auditoria de historial.
- Se conserva el WIP previo del workspace. La consulta e importacion central de conocimiento sigue pendiente durante la transicion de Cerebro; este es el registro local del modulo.
