@echo off
setlocal enabledelayedexpansion
title ClippingHub Launcher
cd /d "%~dp0"

:menu
cls
echo.
echo  ============================================
echo            ClippingHub Launcher
echo  ============================================
echo.
echo    [1]  Run server + app
echo    [2]  Run server only
echo    [3]  Run app only
echo    [4]  Quit
echo.
echo  ============================================
choice /c 1234 /n /m "   Choose an option [1-4]: "

if errorlevel 4 goto end
if errorlevel 3 goto app
if errorlevel 2 goto server_only
if errorlevel 1 goto both

:both
echo.
echo  Starting server in a new window...
start "ClippingHub Server" cmd /k "cd /d "%~dp0server" && npm run dev"
echo  Waiting for server to come up...
timeout /t 3 /nobreak >nul
echo  Starting app...
echo.
call npm start
goto end

:server_only
echo.
echo  Starting server (Ctrl+C to stop)...
echo.
cd /d "%~dp0server"
call npm run dev
goto end

:app
echo.
echo  Starting app (Ctrl+C to stop)...
echo.
call npm start
goto end

:end
endlocal
exit /b
