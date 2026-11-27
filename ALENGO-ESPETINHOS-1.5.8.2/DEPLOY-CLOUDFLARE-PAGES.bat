@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo ALENGO ESPETINHOS - Publicar Web remoto HTTPS
echo ================================================
where node >nul 2>&1 || (echo Node.js nao encontrado.& pause & exit /b 1)
call npx wrangler login
if errorlevel 1 (echo Falha na autenticacao Cloudflare.& pause & exit /b 1)
echo.
echo Criando projeto Pages (se ja existir, esta etapa pode retornar aviso/erro; o deploy sera tentado em seguida)...
call npx wrangler pages project create alengo-atendimento --production-branch main
echo.
call npx wrangler pages deploy cloudflare-pages --project-name alengo-atendimento
if errorlevel 1 (echo Falha ao publicar. Confira o nome do projeto e a autenticacao Cloudflare.& pause & exit /b 1)
echo.
echo Publicacao concluida. Copie o endereco pages.dev exibido acima.
pause
