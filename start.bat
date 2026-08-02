@echo off
setlocal EnableDelayedExpansion
title LightningShare Dev Server
echo.
echo  ==========================================
echo   LightningShare - Development Mode
echo  ==========================================
echo.

cd /d "%~dp0"

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [INFO] Node.js not found in PATH. Checking local portable Node.js...
    if not exist ".\.node\node.exe" (
        echo  [INSTALL] Downloading portable Node.js ^(this may take a minute^)...
        if not exist ".\.node" mkdir ".\.node"
        powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-win-x64.zip' -OutFile '.\.node\node.zip'"
        echo  [INSTALL] Extracting Node.js...
        powershell -Command "Expand-Archive -Path '.\.node\node.zip' -DestinationPath '.\.node\extract' -Force"
        xcopy /s /e /y ".\.node\extract\node-v20.11.1-win-x64\*" ".\.node\" >nul
        rmdir /s /q ".\.node\extract"
        del ".\.node\node.zip"
    )
    echo  [INFO] Setting PATH to use local Node.js...
    set "PATH=%~dp0.node;%PATH%"
)

:: Verify Node
node -v >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Failed to setup Node.js.
    pause
    exit /b 1
)

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
