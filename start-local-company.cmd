@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_URL=http://127.0.0.1:8788/"

cd /d "%APP_DIR%"

echo Starting Local Company V2...
echo.

if not exist "package.json" (
  echo App files were not found.
  echo Current folder: %APP_DIR%
  echo Run this file from the Local Company V2 folder.
  echo.
  pause
  exit /b 1
)

where.exe npm.cmd > nul 2> nul
if errorlevel 1 (
  echo Node.js or npm was not found.
  echo Install Node.js LTS, then run this shortcut again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing required files. This may take a few minutes the first time.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo Install failed. Check the message above, then run this shortcut again.
    pause
    exit /b 1
  )
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -LocalPort 8788 -State Listen -ErrorAction SilentlyContinue; if ($listener) { exit 0 } exit 1"
if errorlevel 1 (
  echo Starting the local server.
  echo Keep the server window open while using the app.
  echo.
  start "Local Company V2 Server" /D "%APP_DIR%" cmd.exe /k "npm run dev"
) else (
  echo The local server is already running.
)

echo Opening the app in your browser...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3"

start "" "%APP_URL%"
exit /b 0
