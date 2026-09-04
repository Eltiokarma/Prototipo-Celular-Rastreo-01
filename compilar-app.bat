@echo off
setlocal
title Micros Tempo - Compilar la app del chofer
REM ============================================================
REM  Compila la app Android en la nube de Expo (EAS).
REM  Doble clic y seguir los pasos. Sirve para cada parche.
REM
REM  Necesita instalados en esta PC (una sola vez):
REM    - Git   : https://git-scm.com/download/win
REM    - Node  : https://nodejs.org  (version LTS)
REM  La primera vez, EAS pide iniciar sesion con la cuenta de Expo.
REM ============================================================

cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Falta Git. Instalalo desde https://git-scm.com/download/win
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Falta Node. Instalalo desde https://nodejs.org ^(version LTS^)
  pause
  exit /b 1
)

echo.
echo === 1 de 4: Traer lo ultimo del repositorio ===
git pull origin main
if errorlevel 1 (
  echo [ERROR] No se pudo actualizar el repositorio. Revisa tu internet
  echo         o si tenes cambios locales sin guardar, y proba de nuevo.
  pause
  exit /b 1
)

cd app

echo.
echo === 2 de 4: Dependencias de la app ===
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [ERROR] npm install fallo. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

echo.
echo === 3 de 4: Sesion de Expo ===
call npx eas-cli whoami >nul 2>nul
if errorlevel 1 (
  echo No hay sesion de Expo en esta PC. Inicia sesion:
  call npx eas-cli login
  if errorlevel 1 (
    echo [ERROR] No se pudo iniciar sesion en Expo.
    pause
    exit /b 1
  )
)

echo.
echo === 4 de 4: Que se compila? ===
echo.
echo   [1] APK de PRUEBA  - para instalar a mano en los telefonos (parches)
echo   [2] AAB PRODUCCION - para subir a Google Play
echo       OJO: el de produccion compila https://app.microstempo.com
echo       adentro. NO usarlo hasta que ese dominio responda.
echo.
set /p opcion="Eleccion [1]: "
if "%opcion%"=="2" (
  set perfil=production
) else (
  set perfil=apk
)

echo.
echo Compilando con el perfil "%perfil%" en la nube de Expo...
echo (tarda 10-20 min; al final aparece el enlace de descarga, y
echo  tambien queda en https://expo.dev, en el proyecto coop-r14)
echo.
call npx eas-cli build --platform android --profile %perfil%

echo.
echo Listo. Si fue el APK de prueba: abri el enlace de arriba en el
echo telefono para descargarlo. Como cambio el paquete de la app
echo (com.microstempo.chofer), la version vieja se DESINSTALA primero.
pause
