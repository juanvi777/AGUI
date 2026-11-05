# Publicar AGUI 1.7 en GitHub y Railway

## 1. Archivos y seguridad

- Extrae el contenido de AGUI 1.7 sobre la carpeta del proyecto que ya tiene `.git`.
- Conserva tu `.env` local; no lo copies a GitHub ni al ZIP.
- No cambies las variables actuales de MySQL ni `SESSION_SECRET`.
- No se requieren `RESEND_API_KEY`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` ni Turnstile para cuentas y solicitudes.

## 2. Subir el código

En PowerShell, desde la carpeta del repositorio:

```powershell
npm install
npm run check
git add -A
git commit -m "Actualizar AGUI a 1.7 - autorizacion manual de cuentas"
git push origin main
```

Si Railway no despliega automáticamente desde GitHub, ejecuta `railway up` dentro de la misma carpeta.

## 3. Qué ocurre al iniciar

AGUI 1.7 aplica migraciones aditivas para agregar la autorización de domicilios, el contador de cambios de contraseña del administrador y la cola de solicitudes. No borra clientes, pedidos, productos, direcciones ni sesiones. No ejecutes `npm run setup:db` en producción para publicar esta actualización.

## 4. Flujo de uso

1. El cliente crea una cuenta con nombre, correo y contraseña, y entra inmediatamente.
2. Para pedir domicilio, debe enviar una solicitud de autorización desde su perfil. También puede avisar a Guillermo por WhatsApp.
3. Guillermo inicia sesión en el panel y abre **Solicitudes**. Desde allí puede aprobar o rechazar cada petición.
4. Al aprobar una solicitud de domicilio, la cuenta queda autorizada. El backend verifica esa autorización al crear el pedido; no depende del navegador.
5. Si un cliente olvida su contraseña, envía una solicitud desde “¿Olvidaste tu contraseña?”. Guillermo la aprueba en **Solicitudes** y el panel muestra un enlace seguro de 30 minutos, de un solo uso, para compartirlo manualmente por WhatsApp.
6. Los pedidos desde mesa mediante QR continúan sin exigir cuenta.

## 5. Comprobación

Después del despliegue, abre `https://TU-DOMINIO-PUBLICO/health` y confirma que MySQL aparece conectado. Prueba un registro, un inicio de sesión, una solicitud de verificación, su aprobación desde el panel, un pedido a domicilio autorizado y un pedido desde QR de mesa. Comprueba también la recuperación manual de contraseña.
