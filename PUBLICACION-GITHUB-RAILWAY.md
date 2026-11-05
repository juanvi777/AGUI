# Publicar AGUI 1.6 en GitHub y Railway

## 1. Antes de publicar

- No subas `.env` a GitHub. Está excluido mediante `.gitignore`.
- No compartas `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`, contraseñas ni `SESSION_SECRET`.
- Mantén conectada la base MySQL actual de Railway. No cambies `DB_HOST`, `DB_NAME`, `DB_USER` ni `DB_PASSWORD` si ya funcionan.

## 2. GitHub y Railway

Antes de publicar, ejecuta `npm install` en la carpeta del proyecto para sincronizar `package-lock.json` con las dependencias de AGUI 1.6 y después `npm run check`. Luego sube el contenido de esta carpeta al repositorio que ya usa AGUI. Si Railway está conectado al repositorio, el `git push` inicia el despliegue automáticamente. El comando de inicio sigue siendo `npm start`.

## 3. Variables de Railway

Conserva las variables actuales de MySQL, `BASE_URL`, `ADMIN_EMAIL`, `ADMIN_NAME` y `SESSION_SECRET`. Para que AGUI envíe códigos de verificación y enlaces de recuperación, configura también:

- `RESEND_API_KEY`: clave privada de tu cuenta de Resend.
- `MAIL_FROM`: remitente con un dominio que hayas verificado en Resend, por ejemplo `AGUI <no-reply@tudominio.com>`.

No uses un remitente inventado. Si Resend no reconoce el dominio o la dirección de envío, rechazará los mensajes. El registro se puede crear, pero el cliente no podrá verificar la cuenta hasta que el envío quede funcionando.

### Protección opcional contra bots

Puedes activar Cloudflare Turnstile creando un widget para el dominio público de AGUI y configurando:

- `TURNSTILE_SITE_KEY`: clave pública del widget.
- `TURNSTILE_SECRET_KEY`: clave privada del widget.

Si configuras la clave secreta, el servidor exigirá que el desafío se valide antes de aceptar registros. Si dejas ambas variables vacías, seguirá funcionando la verificación por correo y los límites de solicitudes.

## 4. Base de datos

AGUI 1.6 crea automáticamente la tabla `pending_customer_registrations` si no existe. La contraseña no se guarda hasta que el cliente confirma el código recibido en su correo. La migración es aditiva: no borra ni reemplaza clientes, pedidos, productos, sesiones ni información de la tienda. Para esta actualización normal no ejecutes `npm run setup:db` en producción.

Verifica el despliegue en `https://TU-DOMINIO-PUBLICO/health`; debe responder que MySQL está conectado.

## 5. Comprobaciones

1. Abre AGUI en una ventana privada.
2. Crea una cuenta con un correo al que tengas acceso.
3. Confirma que llega el código de 6 dígitos y revisa también spam/promociones.
4. Introduce el código y crea tu contraseña en ese segundo paso; la cuenta se crea o activa y se inicia sesión.
5. Cierra sesión e inicia nuevamente con correo y contraseña.
6. Prueba una solicitud de domicilio.
7. Escanea un QR de mesa y confirma que sigue permitiendo pedir sin registrarse.
8. Comprueba el acceso de administrador y el panel.

Los pedidos y comprobantes históricos se mantienen. Los pedidos por QR de mesa continúan sin exigir una cuenta.
