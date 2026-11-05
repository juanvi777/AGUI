# AGUI 1.5 — cambio seguro del correo administrador y configuración Google

## 1. Cambiar el correo de la cuenta administradora existente

En Railway > servicio AGUI > Variables, configura temporalmente estas dos variables:

- `ADMIN_EMAIL=g82794849@gmail.com`
- `ADMIN_EMAIL_MIGRATE_FROM=guillermo171026@gmail.com`

Al iniciar el servidor, AGUI actualizará el correo del mismo registro administrador. Conserva el hash de la contraseña, no crea una segunda cuenta y habilita una sola oportunidad para cambiar la contraseña inicial sin verificación por correo. Cuando termine correctamente, elimina `ADMIN_EMAIL_MIGRATE_FROM` de Railway para dejar cerrada la instrucción de migración. Conserva `ADMIN_EMAIL` con el nuevo correo.

Si el correo nuevo ya está registrado como otra cuenta administradora, el servidor se detendrá con un error explícito y no combinará ni borrará cuentas.

## 2. Configurar inicio de sesión con Google

El código OAuth está integrado, pero Google no puede activarse solo con cambiar el correo del administrador. Se necesitan credenciales propias de un proyecto de Google Cloud: `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

1. En Google Cloud Console, crea o selecciona un proyecto.
2. Configura la pantalla de consentimiento OAuth y agrega los datos de contacto requeridos. Si la aplicación queda en modo de prueba, agrega como usuarios de prueba las cuentas que deban iniciar sesión.
3. Crea un ID de cliente OAuth de tipo **Aplicación web**.
4. En **Orígenes autorizados de JavaScript**, agrega `https://agui-production-c6f6.up.railway.app`.
5. En **URI de redireccionamiento autorizados**, agrega exactamente `https://agui-production-c6f6.up.railway.app/auth/google/callback`.
6. Copia el ID y el secreto del cliente en Railway > servicio AGUI > Variables:
   - `GOOGLE_CLIENT_ID` = ID de cliente entregado por Google.
   - `GOOGLE_CLIENT_SECRET` = secreto de cliente entregado por Google.
   - `GOOGLE_CALLBACK_URL=https://agui-production-c6f6.up.railway.app/auth/google/callback`.
   - `BASE_URL=https://agui-production-c6f6.up.railway.app`.
7. Guarda las variables y espera a que Railway reinicie el servicio.

No compartas el secreto de Google en el chat, GitHub, capturas ni archivos públicos.

## 3. Recuperación de contraseña por correo

Para enviar el enlace de recuperación (un solo uso, válido 30 minutos), configura en Railway `RESEND_API_KEY` y `MAIL_FROM` con un remitente verificado en tu cuenta de Resend. No se envía la contraseña actual; el usuario establece una nueva mediante el enlace seguro.

## 4. Verificación

- Inicia sesión como administrador con `g82794849@gmail.com` y la contraseña actual.
- El sistema debe solicitar el cambio inicial una sola vez.
- Comprueba que el correo nuevo aparezca en el perfil/estado de sesión.
- Después de configurar OAuth, abre `/auth/google` y comprueba el acceso con una cuenta Google verificada.
- Solicita recuperación de contraseña y comprueba que llega el correo de Resend.

No ejecutes `npm run setup:db` en producción para aplicar este cambio: la migración de correo está incluida en el arranque normal del servidor y conserva los datos existentes.
