@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALAR-AGUI.ps1"
if errorlevel 1 (
  echo.
  echo La instalacion se detuvo. Lee el mensaje de error y vuelve a intentarlo.
  pause
)
