@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo ================================================
echo ALENGO ESPETINHOS 1.5.7 - Instalador Windows x64
echo ================================================
where nvm >nul 2>&1
if %ERRORLEVEL% EQU 0 call nvm use 24 || exit /b 1
node -v || exit /b 1
call npm install || exit /b 1
call npm run dist:win || exit /b 1
echo.
echo Instalador na pasta release\
pause
