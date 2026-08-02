#!/bin/bash

echo ""
echo " =========================================="
echo "  LightningShare - Development Mode"
echo " =========================================="
echo ""

# Change to the directory of the script
cd "$(dirname "$0")" || exit 1

echo " [INSTALL] Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
  echo " [ERROR] NPM install failed!"
  read -p "Press any key to exit..."
  exit 1
fi

echo ""
echo " [START] Starting development server..."
echo " [INFO]  Browser will open automatically."
echo " [INFO]  Vite runs on port 5173, Server on port 51236."
echo ""
echo " Press Ctrl+C to stop the server."
echo " ------------------------------------------"
echo ""

npm run dev

if [ $? -ne 0 ]; then
  echo ""
  echo " [ERROR] Dev server crashed!"
  read -p "Press any key to exit..."
  exit 1
fi
