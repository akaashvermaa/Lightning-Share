@echo off
title LightningShare
echo.
echo  ==========================================
echo   LightningShare - LAN File Transfer
echo  ==========================================
echo.

cd /d "%~dp0"

echo  [BUILD] Building the latest server and UI sources...
call npm run build
if errorlevel 1 (
  echo  [ERROR] Build failed! The server was not started.
  pause
  exit /b 1
)

echo  [START] Server starting on port 51236...
echo  [INFO]  Browser will open automatically.
echo  [INFO]  Share this URL with other devices on your LAN:
echo.
echo     http://YOUR_IP_ADDRESS:51236
echo.
echo  Press Ctrl+C to stop the server.
echo  ------------------------------------------
echo.

set NODE_ENV=production
node dist/server/server/index.js

if errorlevel 1 (
  echo.
  echo  [ERROR] Server crashed! Press any key to exit.
  pause >nul
)
