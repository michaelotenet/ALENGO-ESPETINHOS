@echo off
setlocal
cd /d "%~dp0"
set EAS_NO_VCS=1
set EAS_PROJECT_ROOT=%CD%
echo =============================================
echo ALENGO ESPETINHOS 1.3.4 - EAS iOS
 echo =============================================
echo Certifique-se de ter registrado o iPhone com: eas device:create
echo Requer Apple Developer Program ativo para instalacao em iPhone real.
echo.
call eas build --platform ios --profile preview --clear-cache
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Falha na compilacao EAS: verifique o link dos logs apresentado acima.
if "%RESULT%"=="0" echo Build submetida/concluida. Verifique o link EAS acima para instalar no iPhone.
pause
exit /b %RESULT%
