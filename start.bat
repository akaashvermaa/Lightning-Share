@echo off
title LightningShare Dev Server
echo.
echo  ==========================================
echo   LightningShare - Development Mode
echo  ==========================================
echo.

cd /d "%~dp0"

echo  [INSTALL] Installing dependencies...
call npm install
if errorlevel 1 (
  echo  [ERROR] NPM install failed!
  pause
  exit /b 1
)

echo.
echo  [START] Starting development server...
echo  [INFO]  Browser will open automatically.
echo  [INFO]  Vite runs on port 5173, Server on port 51236.
echo.
echo  Press Ctrl+C to stop the server.
echo  ------------------------------------------
echo.

call npm run dev

if errorlevel 1 (
  echo.
  echo  [ERROR] Dev server crashed! Press any key to exit.
  pause >nul
)
