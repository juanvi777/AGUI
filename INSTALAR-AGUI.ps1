$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Instalación de AGUI Repostería y Arepas'

function Read-SecurePlain([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Escape-Env([string]$Value) {
    if ($null -eq $Value) { return '""' }
    $clean = $Value.Replace('\','\\').Replace('"','\"').Replace("`r",'').Replace("`n",'')
    return '"' + $clean + '"'
}
function New-Secret([int]$Bytes = 48) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer); return ([BitConverter]::ToString($buffer) -replace '-','').ToLowerInvariant() }
    finally { $rng.Dispose() }
}

Write-Host ''
Write-Host '  AGUI | Repostería y Arepas' -ForegroundColor Yellow
Write-Host '  Instalador local para Windows' -ForegroundColor DarkYellow
Write-Host '------------------------------------------------'
Write-Host 'Este asistente crea la configuración local. No publica aún la tienda en Internet.'
Write-Host ''

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'No encuentro Node.js. Instala Node.js 20 o superior y vuelve a ejecutar este archivo.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'No encuentro npm. Reinstala Node.js asegurándote de incluir npm.' }
Write-Host "Node: $(node --version)  |  npm: $(npm --version)" -ForegroundColor Green

$mysqlService = Get-Service -Name 'MySQL80' -ErrorAction SilentlyContinue
if ($mysqlService -and $mysqlService.Status -ne 'Running') {
    $start = Read-Host 'El servicio MySQL80 está detenido. ¿Intentar iniciarlo? (S/N)'
    if ($start -match '^[Ss]') {
        try { Start-Service -Name 'MySQL80'; Start-Sleep -Seconds 2 } catch { Write-Host 'No pude iniciar MySQL80; puede necesitar permisos de administrador.' -ForegroundColor Yellow }
    }
}

$dbHost = Read-Host 'Host MySQL [127.0.0.1]'; if ([string]::IsNullOrWhiteSpace($dbHost)) { $dbHost='127.0.0.1' }
$dbPort = Read-Host 'Puerto MySQL [3306]'; if ([string]::IsNullOrWhiteSpace($dbPort)) { $dbPort='3306' }
$dbName = Read-Host 'Nombre de base de datos [agui_store]'; if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName='agui_store' }
if ($dbName -notmatch '^[a-zA-Z0-9_]+$') { throw 'El nombre de la base solo puede contener letras, números y guion bajo.' }
$dbUser = Read-Host 'Usuario MySQL [root]'; if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser='root' }
$dbPassword = Read-SecurePlain 'Contraseña del usuario MySQL (puede quedar vacía si tu instalación no tiene contraseña)'

Write-Host ''
Write-Host 'Cuenta dueña de AGUI' -ForegroundColor Yellow
$adminEmail = Read-Host 'Correo administrador [guillermo171026@gmail.com]'; if ([string]::IsNullOrWhiteSpace($adminEmail)) { $adminEmail='guillermo171026@gmail.com' }
if ($adminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'El correo administrador no parece válido.' }
$adminName = Read-Host 'Nombre visible del dueño [Guillermo]'; if ([string]::IsNullOrWhiteSpace($adminName)) { $adminName='Guillermo' }
$adminPassword = Read-SecurePlain 'Crea una contraseña fuerte para el panel (mínimo 12 caracteres)'
if ($adminPassword.Length -lt 12) { throw 'La contraseña del dueño debe tener al menos 12 caracteres.' }
$confirmPassword = Read-SecurePlain 'Repite la contraseña del panel'
if ($adminPassword -cne $confirmPassword) { throw 'Las contraseñas no coinciden; vuelve a ejecutar el instalador.' }

Write-Host ''
Write-Host 'Datos públicos del negocio' -ForegroundColor Yellow
$whatsapp = Read-Host 'WhatsApp con indicativo, solo dígitos (opcional; ej. 573001112233)'
if ($whatsapp -and $whatsapp -notmatch '^\d{10,15}$') { throw 'Usa solo dígitos con indicativo. Ejemplo de formato: 573001112233.' }
$phone = Read-Host 'Teléfono de contacto (opcional)'
$emailPublic = Read-Host 'Correo público de contacto (opcional)'

Write-Host ''
Write-Host 'Google (opcional): si no tienes credenciales, los clientes pueden crear cuenta con correo y contraseña.' -ForegroundColor Yellow
$googleId = Read-Host 'Google OAuth Client ID (Enter para configurarlo más adelante)'
$googleSecret = ''
if (-not [string]::IsNullOrWhiteSpace($googleId)) { $googleSecret = Read-SecurePlain 'Google OAuth Client Secret' }
$googleCallback = Read-Host 'URL de callback de Google [http://localhost:3000/auth/google/callback]'; if ([string]::IsNullOrWhiteSpace($googleCallback)) { $googleCallback='http://localhost:3000/auth/google/callback' }
$requireGoogle = 'false' # Se exige sesión de cliente; Google es opcional porque hay acceso por correo/contraseña

$secret = New-Secret 48
$lines = @(
  'NODE_ENV=development', 'PORT=3000', 'BASE_URL=http://localhost:3000', '',
  "DB_HOST=$(Escape-Env $dbHost)", "DB_PORT=$(Escape-Env $dbPort)", "DB_NAME=$(Escape-Env $dbName)", "DB_USER=$(Escape-Env $dbUser)", "DB_PASSWORD=$(Escape-Env $dbPassword)", '',
  "ADMIN_EMAIL=$(Escape-Env $adminEmail)", "ADMIN_NAME=$(Escape-Env $adminName)", "ADMIN_INITIAL_PASSWORD=$(Escape-Env $adminPassword)", "SESSION_SECRET=$secret", '',
  "BUSINESS_WHATSAPP=$(Escape-Env $whatsapp)", "BUSINESS_PHONE=$(Escape-Env $phone)", "BUSINESS_EMAIL=$(Escape-Env $emailPublic)", 'BUSINESS_ADDRESS=Vegachí, Antioquia, Colombia', '',
  "GOOGLE_CLIENT_ID=$(Escape-Env $googleId)", "GOOGLE_CLIENT_SECRET=$(Escape-Env $googleSecret)", "GOOGLE_CALLBACK_URL=$(Escape-Env $googleCallback)", "REQUIRE_GOOGLE_LOGIN=$requireGoogle", '',
  'WOMPI_PUBLIC_KEY=', 'WOMPI_PRIVATE_KEY=', 'MERCADOPAGO_ACCESS_TOKEN=', 'EPAYCO_PUBLIC_KEY=', 'EPAYCO_PRIVATE_KEY='
)
$envPath = Join-Path $PSScriptRoot '.env'
[System.IO.File]::WriteAllText($envPath, ($lines -join "`n") + "`n", ([System.Text.UTF8Encoding]::new($false)))
Write-Host ''
Write-Host 'Instalando dependencias de la tienda…' -ForegroundColor Yellow
Push-Location $PSScriptRoot
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install falló. Revisa tu conexión a Internet e inténtalo de nuevo.' }
    Write-Host 'Creando tablas y cuenta del dueño…' -ForegroundColor Yellow
    npm run setup:db
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo inicializar MySQL. Comprueba usuario, contraseña y servicio MySQL.' }
    Write-Host ''
    Write-Host 'Instalación completada. Abriendo la tienda en el navegador…' -ForegroundColor Green
    Start-Process 'http://localhost:3000'
    npm start
} finally { Pop-Location }
