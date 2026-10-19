# Publicar AGUI en GitHub y Railway

## 1. Antes de publicar

- No subas `.env` a GitHub. El archivo ya está excluido mediante `.gitignore`.
- Conserva los valores secretos en un lugar seguro: contraseña de MySQL, contraseña inicial del dueño, `SESSION_SECRET` y credenciales Google.
- La aplicación necesita una base de datos MySQL accesible desde Railway. `127.0.0.1` sirve en tu computador, pero dentro de Railway apunta al propio contenedor; no es tu MySQL local.

## 2. GitHub

Sube el contenido de esta carpeta como raíz del repositorio (incluidos `server.js`, `package.json`, `schema.sql`, `init-db.js` y `public/`). No subas `node_modules`, `.env` ni fotos de clientes a Git.

Si Railway ya está conectado al repositorio, un push a la rama configurada iniciará un nuevo despliegue. El comando de inicio es `npm start` y el proyecto usa la versión de Node definida en `package.json`.

## 3. Variables en Railway

En el servicio web, abre **Variables** y configura valores equivalentes a estos (sin copiar el archivo `.env` al repositorio):

- `NODE_ENV=production`
- `BASE_URL=https://TU-DOMINIO-PUBLICO`
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` y `DB_PASSWORD` con los datos de un servicio MySQL alojado y accesible desde Railway
- `ADMIN_EMAIL`, `ADMIN_NAME` y `ADMIN_INITIAL_PASSWORD` para inicializar el acceso del dueño
- `SESSION_SECRET` con un secreto aleatorio largo (mínimo 32 caracteres)
- `BUSINESS_WHATSAPP` con el número del negocio en formato internacional, solo dígitos

No uses `DB_HOST=127.0.0.1` en producción salvo que MySQL estuviera en el mismo contenedor, que no es el despliegue recomendado.

## 4. Crear tablas

Después de enlazar la base MySQL y configurar las variables, ejecuta una vez `npm run setup:db` en el entorno con acceso a esa base, por ejemplo desde una terminal de Railway CLI conectada al proyecto. El script crea las tablas y la cuenta administradora si aún no existe. Si la cuenta del dueño ya existe, conserva la contraseña actual.

Verifica después el despliegue en `https://TU-DOMINIO-PUBLICO/health`; la respuesta debería indicar que la base de datos está conectada.

## 5. Google

Google no se activa solamente con cambiar el botón. Para habilitarlo, configura las variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_CALLBACK_URL` en Railway. El callback debe ser exactamente:

`https://TU-DOMINIO-PUBLICO/auth/google/callback`

Registra esa misma URL como **Authorized redirect URI** en el cliente OAuth de Google Cloud. Protocolo, dominio, ruta y barra final tienen que coincidir exactamente. Luego vuelve a desplegar. Mientras Google no esté configurado, los clientes pueden registrarse y entrar mediante correo y contraseña.

## 6. Fotos y almacenamiento

Las fotos cargadas desde el panel se convierten a WebP, se limitan a 1400 × 1400 píxeles y calidad 80. Los archivos que empiezan por `/uploads/` no se incluyen en Git porque `.gitignore` los excluye.

Para comenzar en Railway, agrega un **Volume** al servicio web con la ruta de montaje `/app/public/uploads`, si el proyecto se ejecuta desde `/app`. Las imágenes que ya están en tu computador no aparecerán automáticamente en ese volumen: después del despliegue vuelve a subirlas desde el panel del dueño.

El volumen es una solución sencilla para una instancia. Si en el futuro ejecutas varias instancias o necesitas distribuir las imágenes por CDN, migra las fotos a almacenamiento de objetos como Cloudinary o Cloudflare R2. No necesitas Redis para guardar productos ni fotos; los productos y pedidos van en MySQL.

## 7. Prueba mínima antes de anunciar la tienda

1. Abre la tienda desde una ventana privada.
2. Crea una cuenta de cliente, cierra sesión e inicia de nuevo.
3. Intenta registrar un pedido y confirma que la sesión sea obligatoria.
4. Accede con la cuenta del dueño desde el selector de acceso, crea un producto con una foto y comprueba que se muestre.
5. Oculta, vuelve a mostrar y elimina un producto de prueba.
6. Comprueba que los pedidos se guarden en MySQL y que el enlace de WhatsApp use el número correcto.
7. Prueba Google solo después de configurar sus credenciales y callback.

La tienda registra pedidos para que AGUI confirme disponibilidad y pago por WhatsApp; esta versión no procesa cobros reales con tarjeta.
