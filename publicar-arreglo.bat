@echo off
setlocal
title Micros Tempo - Publicar un arreglo de la app (sin reinstalar)
REM ============================================================
REM  Publica el JavaScript nuevo de la app del chofer con EAS Update:
REM  los telefonos lo bajan solos y lo aplican cuando el chofer NO
REM  esta en ruta (en la puerta o en la pantalla de entrada).
REM
REM  Sirve para arreglos de pantallas, chat, SOS, puerta... (JavaScript).
REM  NO sirve si cambio algo nativo: un permiso, un modulo nuevo, la
REM  version de Expo. Para eso: subir "version" en app\app.json y
REM  compilar una APK nueva con compilar-app.bat. La prueba
REM  "actualizacion" avisa si te olvidaste.
REM
REM  Doble clic y seguir los pasos.
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

REM La version de la APK a la que va el arreglo (runtimeVersion)
for /f "delims=" %%v in ('node -p "require('./app.json').expo.version"') do set version=%%v

REM La guardia: si cambio algo NATIVO sin subir la version, NO se publica
REM (el arreglo caeria en telefonos sin esa parte y la app se romperia)
echo.
call node ..\pruebas\actualizacion.js --guardia
if errorlevel 1 (
  echo.
  echo [NO SE PUBLICA] Lee el mensaje de arriba.
  pause
  exit /b 1
)

echo.
echo === 4 de 4: A quien? ===
echo.
echo   [1] PRUEBA  - solo los telefonos con la APK de prueba (el tuyo).
echo                 Empeza SIEMPRE por aca.
echo   [2] TODOS   - todos los choferes con la APK normal
echo   [3] PLAY    - los que la instalaron desde Google Play
echo   [4] VOLVER ATRAS - deshacer: los telefonos de un canal vuelven al
echo                 JavaScript que vino en su APK
echo.
echo   (Va a la version %version% de la app. Las APK de otra version no
echo    lo reciben.)
echo.
set /p opcion="Eleccion [1]: "

REM La direccion del servidor va ADENTRO del JavaScript: cada canal la suya
set canal=prueba
set EXPO_PUBLIC_SERVIDOR=https://prototipo-celular-rastreo-01-production.up.railway.app
if "%opcion%"=="2" set canal=apk
if "%opcion%"=="3" (
  set canal=produccion
  set EXPO_PUBLIC_SERVIDOR=https://app.microstempo.com
)

if "%opcion%"=="4" goto atras

goto publicar

:atras
echo.
echo   Que canal vuelve atras?  [1] PRUEBA   [2] TODOS   [3] PLAY
set /p cual="Eleccion [2]: "
set canalAtras=apk
if "%cual%"=="1" set canalAtras=prueba
if "%cual%"=="3" set canalAtras=produccion
echo.
echo Volviendo atras el canal "%canalAtras%", version %version%...
call npx eas-cli update:roll-back-to-embedded --channel %canalAtras% --runtime-version %version% --platform android --message "Vuelta atras"
if errorlevel 1 (
  echo [ERROR] No se pudo volver atras. Revisa el mensaje de arriba.
  pause
  exit /b 1
)
echo.
echo Listo. Los telefonos de ese canal vuelven al JavaScript de su APK la
echo proxima vez que se abra la app fuera de ruta.
pause
exit /b 0

:publicar

echo.
set "mensaje="
set /p mensaje="Que arregla (una linea, queda en el historial): "
REM Sin comillas: rompian el if de abajo y el comando de publicar
if defined mensaje set "mensaje=%mensaje:"=%"
if not defined mensaje set "mensaje=Arreglo"

echo.
echo Publicando en el canal "%canal%" con el servidor %EXPO_PUBLIC_SERVIDOR%...
call npx eas-cli update --channel %canal% --platform android --message "%mensaje%"
if errorlevel 1 (
  echo [ERROR] No se pudo publicar. Revisa el mensaje de arriba.
  pause
  exit /b 1
)

echo.
echo Listo. Los telefonos de ese canal lo bajan la proxima vez que se
echo abre la app, y lo aplican cuando no estan en ruta. En Despacho,
echo Gestion - Personas, al lado de "app" aparece "act." con la fecha:
echo asi ves quien ya lo tiene.
if "%canal%"=="prueba" (
  echo.
  echo Probalo en tu telefono: cerra la app del todo y abrila dos veces
  echo ^(la primera la baja, la segunda arranca con ella^). Si anda bien,
  echo volve a correr esto y elegi [2] TODOS.
)
pause
