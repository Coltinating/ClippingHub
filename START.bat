@echo off
setlocal
title ClippingHub
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Installing...
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed. Aborting.
    pause
    exit /b 1
  )
)

call npm start
endlocal
exit /b
