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
- Pantalla de acceso unificada con selector Cliente/Dueño; registro e inicio de sesión por correo/contraseña para clientes y contraseña privada para el panel. Las compras requieren sesión activa. Google OAuth necesita credenciales reales y URL de retorno registrada.
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
- Los clientes pueden registrarse con correo y contraseña sin configurar Google. Para habilitar también Google OAuth, define `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALLBACK_URL` con credenciales reales y callback registrado. El sistema siempre exige que el cliente inicie sesión antes de confirmar un pedido.
- Los pagos en línea no se procesan todavía. Se requieren una cuenta comercial, credenciales reales y la implementación/verificación de los flujos y webhooks del proveedor; jamás se deben pedir datos de tarjeta directamente en un formulario propio. Aunque se añadan llaves en `.env`, el código mantiene esos medios deshabilitados hasta que se construya la integración real.
- Para publicar la tienda, contrata/configura alojamiento Node.js, MySQL gestionado y HTTPS. Cambia `BASE_URL`, `NODE_ENV=production`, `GOOGLE_CALLBACK_URL` y cookie segura. No uses una base de datos expuesta públicamente.
- Sube tus copias de seguridad y establece política de privacidad, términos, alérgenos, tratamiento de datos, cancelación y devoluciones adecuados al negocio.

## Seguridad

- `.env` contiene secretos y está ignorado por Git. No subas ese archivo a GitHub ni lo envíes a clientes.
- La cuenta del dueño no necesita verificación de correo, tal como pediste, pero siempre requiere la contraseña definida durante la instalación.
- La fecha `17/10/2026` es la fecha indicada para crear la cuenta en el proyecto; la app no simula una verificación de email.
- La PWA cachea archivos de la interfaz solamente. No guarda ni permite crear pedidos sin conexión.

## Comandos

```powershell
npm install
npm run setup:db
npm start
```

`npm run setup:db` crea tablas y datos de ejemplo la primera vez. Si la cuenta dueña ya existe, no reemplaza su contraseña actual. Al iniciar, el servidor aplica automáticamente el campo de cuentas de cliente si actualizas desde una base previa, sin borrar los pedidos ni clientes existentes.
