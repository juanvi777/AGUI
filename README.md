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
- Cuenta del dueño inicial: `guillermo171026@gmail.com` (sin verificación de correo; acceso protegido por contraseña).
- Contraseña de administrador cifrada con hash; cookie de sesión HttpOnly/SameSite; límite de intentos de acceso; cierre de la sesión del dueño tras 10 minutos de inactividad en el panel.
- Manifiesto y service worker para instalación tipo aplicación (PWA básica).
- Pantalla de acceso unificada para clientes y dueño; los clientes usan correo, contraseña y verificación mediante código. Los domicilios requieren una cuenta verificada; los pedidos en mesa mediante QR no requieren registro.
- Métodos de pago contra entrega y transferencia como opciones pendientes de confirmación comercial; Wompi, Mercado Pago y ePayco aparecen como integraciones pendientes: no se activan solamente con agregar llaves; falta implementar y probar el flujo de pago y sus webhooks con credenciales comerciales reales.

## Instalar en Windows

1. Instala Node.js 20 o superior y MySQL Server. Comprueba que el servicio MySQL esté iniciado.
2. Extrae el ZIP en una carpeta que tengas permisos de editar.
3. Abre la carpeta y ejecuta `INSTALAR-AGUI.ps1` con PowerShell. El instalador pedirá la contraseña de MySQL, una contraseña propia para el dueño y datos opcionales del negocio.
4. Si Windows bloquea los scripts, abre PowerShell dentro de la carpeta y ejecuta `Set-ExecutionPolicy -Scope Process Bypass` y luego `./INSTALAR-AGUI.ps1`.
5. La tienda se abre en `http://localhost:3000`. Mantén abierta la consola mientras la usas. Para iniciarla más tarde, abre PowerShell en la carpeta y ejecuta `npm start`.

El instalador conserva la contraseña de una cuenta administradora que ya exista; si vuelves a ejecutarlo y quieres cambiarla, cambia la contraseña desde la base de datos con un procedimiento de restablecimiento. No compartas `.env`.

## Imágenes en producción

La app convierte las fotos subidas a WebP optimizado, con un máximo de 1400 × 1400 px. En Railway, configura un volumen en `/app/public/uploads` si la app se ejecuta desde `/app`; no uses el disco efímero para fotos que deban sobrevivir a los despliegues. Para varias instancias, usa almacenamiento de objetos/CDN como Cloudinary o Cloudflare R2 en vez de un volumen local. No almacenes imágenes en Redis.

## Configuraciones que faltan para operar públicamente

- Reemplaza productos y precios de muestra por el catálogo real de AGUI y confirma los derechos/uso de las fotografías.
- Configura el número real de WhatsApp y las tarifas/tiempos de entrega desde el panel.
- Los clientes se registran con correo y contraseña; antes de entrar deben verificar la dirección con el código de 6 dígitos enviado por AGUI.
- Los pagos en línea no se procesan todavía. Se requieren una cuenta comercial, credenciales reales y la implementación/verificación de los flujos y webhooks del proveedor; jamás se deben pedir datos de tarjeta directamente en un formulario propio. Aunque se añadan llaves en `.env`, el código mantiene esos medios deshabilitados hasta que se construya la integración real.
- Para publicar la tienda, contrata/configura alojamiento Node.js, MySQL gestionado y HTTPS. Cambia `BASE_URL` y `NODE_ENV=production`. No uses una base de datos expuesta públicamente.
- Sube tus copias de seguridad y establece política de privacidad, términos, alérgenos, tratamiento de datos, cancelación y devoluciones adecuados al negocio.

## Seguridad

- `.env` contiene secretos y está ignorado por Git. No subas ese archivo a GitHub ni lo envíes a clientes.
- La cuenta del dueño permanece separada de las cuentas de clientes y requiere su contraseña administrativa.
- La fecha `17/10/2026` es la fecha indicada para crear la cuenta en el proyecto; la app no simula una verificación de email.
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
- Domicilios: requieren una sesión de cliente con correo verificado.
- Seguimiento: cada pedido recibe un token aleatorio de seguimiento; la pantalla de confirmación consulta el estado cada 12 segundos y muestra avisos cuando cambia.
- Avisos del dueño: el panel consulta pedidos nuevos cada 18 segundos, muestra alertas dentro de AGUI y puede emitir notificaciones del navegador si el usuario pulsa “Activar avisos” y concede permiso.
- Mensajes al cliente: desde el detalle del pedido, Guillermo puede abrir WhatsApp con un mensaje contextual sobre el estado actual. Los pedidos de mesa no solicitan teléfono para no frenar el pedido; por eso su aviso es en pantalla mientras el cliente mantiene abierta la confirmación.
- Estados disponibles: pendiente, confirmado, preparando, listo para recoger, en camino, entregado y cancelado.
- Después de un pedido en mesa se muestra un triqui básico contra el bot y una invitación opcional para crear cuenta con correo.

### Configuración necesaria en Railway

Para los códigos de verificación y enlaces de recuperación configura `RESEND_API_KEY` y `MAIL_FROM` con una dirección que pertenezca a un dominio verificado en Resend. Para activar la protección opcional contra bots, configura `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` de Cloudflare Turnstile. La migración crea las tablas que faltan al iniciar, sin borrar pedidos ni clientes.

### Recuperación de contraseña del dueño

La recuperación por correo utiliza el mismo proveedor transaccional Resend. Configura `RESEND_API_KEY` y `MAIL_FROM` verificado en Railway para que lleguen los enlaces de un solo uso.

### Alcance de los avisos

Los avisos de estado se muestran en tiempo real aproximado mientras la pantalla de seguimiento permanece abierta. Los avisos del dueño se muestran mientras el panel está abierto. Para avisos por correo o notificaciones push cuando la página está cerrada hace falta configurar un proveedor de correo o Web Push; esta actualización no finge que esos canales estén activos.


## Acceso unificado y cuentas de cliente (1.4)

- Dueño y cliente usan el mismo formulario de correo/contraseña; el servidor determina el rol desde la base de datos. El acceso del dueño no se publica como botón separado.
- El formulario único distingue la cuenta del dueño y la de cliente desde la base de datos; los clientes verifican su correo antes de entrar.
- El primer inicio del administrador solicita un único cambio inicial de contraseña. Después, la recuperación requiere un enlace de un solo uso enviado por correo.
- Para habilitar recuperación por correo configura `RESEND_API_KEY` y `MAIL_FROM` en Railway. El dominio remitente debe estar verificado en Resend.
- El cliente puede guardar perfil, nombre de usuario, teléfono, varias direcciones con etiquetas, dirección principal e historial con detalle y resumen de compra.
- Los resúmenes de compra no son facturas electrónicas tributarias. Para emitir factura electrónica se requiere integración con un proveedor autorizado y la DIAN.

## Acceso y verificación por correo (1.6)

- Se eliminó el inicio y registro con Google.
- El cliente inicia el registro con nombre y correo. AGUI envía un código de 6 dígitos; después de validarlo, el cliente crea su contraseña y la cuenta queda activa.
- El código vence en 10 minutos, se usa una sola vez y permite hasta 5 intentos. La contraseña no se guarda antes de confirmar el correo.
- Se limita el reenvío a un código por minuto y se aplican límites de solicitudes.
- Las cuentas pendientes no pueden iniciar sesión ni realizar domicilios.
- Los pedidos por QR de mesa siguen sin exigir registro.
- Para enviar los códigos y recuperar contraseñas, configura `RESEND_API_KEY` y `MAIL_FROM` con un dominio verificado en Resend.
- Turnstile es opcional: configura `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY` para añadir un desafío contra registros automáticos.
- La migración crea la tabla de registros pendientes automáticamente y no borra datos. Las cuentas antiguas cuyo acceso se confirmó con Google conservan ese estado de verificación y pueden crear contraseña mediante recuperación por correo. No ejecutes `npm run setup:db` para esta actualización de producción.
