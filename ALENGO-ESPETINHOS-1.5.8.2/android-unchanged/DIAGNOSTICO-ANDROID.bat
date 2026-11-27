@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set EAS_NO_VCS=1
set EAS_PROJECT_ROOT=%CD%
echo =====================================================
echo ALENGO ESPETINHOS 1.3.1 - Diagnostico Android
 echo =====================================================
echo.
call npx expo config --type prebuild > "expo-config-diagnostico.txt" 2>&1
call npx expo-doctor >> "expo-config-diagnostico.txt" 2>&1
if exist android\ (
  echo Pasta android ja existe. Nao sera apagada ou alterada.
  echo Abra expo-config-diagnostico.txt e envie os erros.
  pause
  exit /b 0
)
call npx expo prebuild --platform android --clean --no-install >> "expo-config-diagnostico.txt" 2>&1
set PREBUILD_CODE=%ERRORLEVEL%
if exist android\ rmdir /s /q android
if not "%PREBUILD_CODE%"=="0" (
  echo O Prebuild falhou. Consulte expo-config-diagnostico.txt.
) else (
  echo O Prebuild local concluiu. Consulte expo-config-diagnostico.txt.
)
echo A pasta android gerada temporariamente foi removida para manter o projeto Expo gerenciado.
pause
endlocal
