@echo off
setlocal
cd /d "%~dp0"
where adb >nul 2>&1
if errorlevel 1 (
  echo ERRO: adb nao encontrado. Instale Android SDK Platform Tools e adicione ao PATH.
  echo https://developer.android.com/tools/releases/platform-tools
  pause
  exit /b 1
)
echo Conecte o celular via USB, habilite Depuracao USB e aceite a autorizacao.
adb devices
pause
adb logcat -c
adb shell am force-stop br.alengo.pedidos
adb shell monkey -p br.alengo.pedidos -c android.intent.category.LAUNCHER 1
echo Aguarde o fechamento do aplicativo ou 15 segundos...
timeout /t 15 /nobreak >nul
adb logcat -d -v time > "%~dp0ERRO-ANDROID-COMPLETO.txt"
findstr /i /c:"FATAL EXCEPTION" /c:"AndroidRuntime" /c:"ReactNativeJS" /c:"Caused by:" /c:"ALENGO_MOBILE_RENDER_ERROR" "%~dp0ERRO-ANDROID-COMPLETO.txt" > "%~dp0ERRO-ANDROID-RESUMO.txt"
echo Logs salvos: ERRO-ANDROID-COMPLETO.txt e ERRO-ANDROID-RESUMO.txt
 echo ATENCAO: logs podem conter dados pessoais. Revise antes de compartilhar.
pause
endlocal
