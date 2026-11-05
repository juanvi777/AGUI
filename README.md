# AGUI Repostería y Arepas — tienda online

Primera versión full-stack basada en los bocetos acordados: naranja, crema y marrón; marca AGUI y su lema; portada destacada; catálogo con fotos/precios; carrito persistente; captura de datos de entrega solo al comprar; WhatsApp; zonas de Vegachí, Yalí y El Tigre; panel del dueño; y base de datos MySQL.

## Funciones implementadas

- Diseño responsive para celular, tableta y escritorio.
- Catálogo público, categorías, búsqueda y productos destacados.
- Carrito que conserva el contenido en el navegador.
- Creación real de pedidos en MySQL y detalle de cada pedido.
- Enlace de confirmación a WhatsApp con resumen del pedido.
- Panel privado: resumen, crear/editar/ocultar/mostrar/eliminar productos, subir fotos, revisar pedidos y actualizar su estado. Al eliminar un producto, los detalles históricos de pedidos se conservan.
- Configuración administrativa de tarifas y tiempos de entrega por zona.
- Cuenta del dueño actual: `g82794849@gmail.com` (sin verificación de correo; acceso protegido por contraseña).
- Contraseña de administrador cifrada con hash; cookie de sesión HttpOnly/SameSite; límite de intentos de acceso; cierre de la sesión del dueño tras 10 minutos de inactividad en el panel.
- Manifiesto y service worker para instalación tipo aplicación (PWA básica).
- Pantalla de acceso unificada para clientes y dueño. Los clientes crean cuenta con nombre, correo y contraseña; Guillermo autoriza manualmente los domicilios desde el panel. Los pedidos desde QR de mesa no requieren registro.
- Métodos de pago contra entrega y transferencia como opciones pendientes de confirmación comercial; Wompi, Mercado Pago y ePayco aparecen como integraciones pendientes: no se activan solamente con agregar llaves; falta implementar y probar el flujo de pago y sus webhooks con credenciales comerciales reales.

## Instalar en Windows

1. Instala Node.js 20 o superior y MySQL Server. Comprueba que el servicio MySQL esté iniciado.
2. Extrae el ZIP en una carpeta que tengas permisos de editar.
3. Abre la carpeta y ejecuta `INSTALAR-AGUI.ps1` con PowerShell. El instalador pedirá la contraseña de MySQL, una contraseña propia para el dueño y datos opcionales del negocio.
4. Si Windows bloquea los scripts, abre PowerShell dentro de la carpeta y ejecuta `Set-ExecutionPolicy -Scope Process Bypass` y luego `./INSTALAR-AGUI.ps1`.
5. La tienda se abre en `http://localhost:3000`. Mantén abierta la consola mientras la usas. Para iniciarla más tarde, abre PowerShell en la carpeta y ejecuta `npm start`.

El instalador conserva la contraseña de una cuenta administradora que ya exista; si vuelves a ejecutarlo y quieres cambiarla, cambia la contraseña desde la base de datos con un procedimiento de restablecimiento. No compartas `.env`.

## Imágenes en producción

La app valida fotos JPG, PNG y WebP de hasta 5 MB y conserva el formato original al guardarlas. En Railway, configura un volumen en `/app/public/uploads` si la app se ejecuta desde `/app`; no uses el disco efímero para fotos que deban sobrevivir a los despliegues. Para varias instancias, usa almacenamiento de objetos/CDN como Cloudinary o Cloudflare R2 en vez de un volumen local. No almacenes imágenes en Redis.

## Configuraciones que faltan para operar públicamente

- Reemplaza productos y precios de muestra por el catálogo real de AGUI y confirma los derechos/uso de las fotografías.
- Configura el número real de WhatsApp y las tarifas/tiempos de entrega desde el panel.
- Los clientes se registran e inician sesión sin verificación de correo. Para domicilios, deben solicitar autorización manual de Guillermo desde su perfil.
- Los pagos en línea no se procesan todavía. Se requieren una cuenta comercial, credenciales reales y la implementación/verificación de los flujos y webhooks del proveedor; jamás se deben pedir datos de tarjeta directamente en un formulario propio. Aunque se añadan llaves en `.env`, el código mantiene esos medios deshabilitados hasta que se construya la integración real.
- Para publicar la tienda, contrata/configura alojamiento Node.js, MySQL gestionado y HTTPS. Cambia `BASE_URL` y `NODE_ENV=production`. No uses una base de datos expuesta públicamente.
- Sube tus copias de seguridad y establece política de privacidad, términos, alérgenos, tratamiento de datos, cancelación y devoluciones adecuados al negocio.

## Seguridad

- `.env` contiene secretos y está ignorado por Git. No subas ese archivo a GitHub ni lo envíes a clientes.
- La cuenta del dueño permanece separada de las cuentas de clientes y requiere su contraseña administrativa.
- La cuenta del dueño no depende de Google ni de verificación por correo; sus cambios de contraseña están limitados a dos desde AGUI 1.7.
- La PWA cachea archivos de la interfaz solamente. No guarda ni permite crear pedidos sin conexión.

## Comandos

```powershell
npm install
npm run setup:db
npm start
```

`npm run setup:db` crea tablas y datos de ejemplo la primera vez. Si la cuenta dueña ya existe, no reemplaza su contraseña actual. Al iniciar, el servidor aplica automáticamente el campo de cuentas de cliente si actualizas desde una base previa, sin borrar los pedidos ni clientes existentes.


## Actualización 1.3 — pedidos en mesa, QR y avisos

- Panel del dueño: administrar mesas, agregar/renombrar/eliminar, imprimir y descargar un QR único para cada mesa. Al eliminar una mesa su QR queda invalidado y los pedidos históricos conservan la etiqueta de la mesa.
- Pedidos desde mesa: el QR abre la tienda identificada; no exige registro. El cliente solo debe escribir su nombre y enviar el pedido.
- Domicilios: requieren sesión de cliente y autorización manual de Guillermo.
- Seguimiento: cada pedido recibe un token aleatorio de seguimiento; la pantalla de confirmación consulta el estado cada 12 segundos y muestra avisos cuando cambia.
- Avisos del dueño: el panel consulta pedidos nuevos cada 18 segundos, muestra alertas dentro de AGUI y puede emitir notificaciones del navegador si el usuario pulsa “Activar avisos” y concede permiso.
- Mensajes al cliente: desde el detalle del pedido, Guillermo puede abrir WhatsApp con un mensaje contextual sobre el estado actual. Los pedidos de mesa no solicitan teléfono para no frenar el pedido; por eso su aviso es en pantalla mientras el cliente mantiene abierta la confirmación.
- Estados disponibles: pendiente, confirmado, preparando, listo para recoger, en camino, entregado y cancelado.
- Después de un pedido en mesa se muestra un triqui básico contra el bot y una invitación opcional para crear cuenta con correo.

### Configuración necesaria en Railway

AGUI 1.7 no requiere Resend, Google OAuth, códigos por correo ni llaves de verificación de terceros. Las solicitudes de autorización de domicilios y recuperación de contraseña quedan en una cola interna visible para Guillermo en el panel, y el cliente puede avisar por WhatsApp.

### Alcance de los avisos

Los avisos de estado se muestran en tiempo real aproximado mientras la pantalla de seguimiento permanece abierta. Los avisos del dueño se muestran mientras el panel está abierto. Para avisos por correo o notificaciones push cuando la página está cerrada hace falta configurar un proveedor de correo o Web Push; esta actualización no finge que esos canales estén activos.


## Historial de acceso y cuentas de cliente (1.4; reemplazado en 1.7)

- Dueño y cliente usan el mismo formulario de correo/contraseña; el servidor determina el rol desde la base de datos. El acceso del dueño no se publica como botón separado.
- En la versión 1.4 se ofrecía acceso local y verificación por correo; ese flujo fue retirado en AGUI 1.7 y no debe configurarse para esta versión.
- El cliente puede guardar perfil, nombre de usuario, teléfono, varias direcciones con etiquetas, dirección principal e historial con detalle y resumen de compra.
- Los resúmenes de compra no son facturas electrónicas tributarias. Para emitir factura electrónica se requiere integración con un proveedor autorizado y la DIAN.

## Acceso, autorización y recuperación manual (1.7)

- El registro solo solicita nombre, correo y contraseña. La cuenta se crea inmediatamente y puede iniciar sesión sin confirmar el correo.
- En el perfil del cliente aparece el estado de autorización para domicilios. La solicitud se registra en MySQL y se muestra en la pestaña **Solicitudes** del panel de Guillermo.
- Guillermo aprueba o rechaza la autorización. Solo las cuentas con `delivery_verified_at` podrán crear pedidos a domicilio; los pedidos desde QR de mesa siguen sin exigir cuenta.
- El cliente también puede abrir WhatsApp con un mensaje preparado para Guillermo. AGUI no envía mensajes automáticamente por WhatsApp: el cliente confirma el envío desde su aplicación.
- La recuperación de contraseña también genera una solicitud interna. Cuando Guillermo la aprueba, AGUI crea un enlace de un solo uso válido durante 30 minutos para que él lo copie y comparta manualmente con el cliente por WhatsApp. El enlace se muestra una sola vez en el panel; debe copiarse antes de salir o actualizar la página.
- La cuenta de Guillermo dispone de dos cambios de contraseña sin verificación a partir de esta versión, desde una sesión administrativa activa. Si el primer cambio inicial está pendiente, contará como el primero; el segundo se administra en **Datos del negocio**. Tras consumirlos, una recuperación administrativa deberá hacerse manualmente.
- La migración es aditiva y conserva pedidos y clientes existentes. Las cuentas antiguas con `email_verified_at` conservan su autorización histórica para domicilios. No ejecutes `npm run setup:db` para esta actualización de producción.
