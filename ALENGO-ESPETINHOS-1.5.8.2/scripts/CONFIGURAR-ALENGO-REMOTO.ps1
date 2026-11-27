$ErrorActionPreference = 'Stop'
$projectUrl = 'https://cqjorvhkiaqbpalizzvf.supabase.co'
$publishableKey = 'sb_publishable_sHxw8vjb3oiXJFO-mNNONQ_E-jAZ2En'
$userData = Join-Path $env:APPDATA 'ALENGO-ESPETOS'
New-Item -ItemType Directory -Force -Path $userData | Out-Null
Write-Host 'ALENGO ESPETINHOS - Configuração segura do acesso remoto' -ForegroundColor Cyan
Write-Host 'A Secret Key será protegida pelo Windows DPAPI para este usuário.'
$secure = Read-Host 'Cole a Secret Key sb_secret_ exclusiva do ALENGO' -AsSecureString
if ($secure.Length -lt 20) { throw 'Secret Key vazia ou inválida.' }
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr); if (-not $plain.StartsWith('sb_secret_')) { throw 'A chave deve começar com sb_secret_.' } } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$protected = ConvertFrom-SecureString $secure
$config = [ordered]@{
  enabled = $true
  projectUrl = $projectUrl
  publishableKey = $publishableKey
  secretKeyProtected = $protected
  pollIntervalMs = 3000
  snapshotIntervalMs = 10000
}
$target = Join-Path $userData 'alengo-remote.json'
$json = $config | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($target, $json, $utf8NoBom)
Write-Host "Configuração salva em: $target" -ForegroundColor Green
Write-Host 'Feche e abra o ALENGO ESPETINHOS para iniciar a sincronização remota.' -ForegroundColor Yellow
