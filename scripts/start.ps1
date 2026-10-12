param([switch]$Build)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$entryFile = Join-Path $projectRoot 'apps\api\dist\main.js'
if ($Build -or -not (Test-Path -LiteralPath $entryFile)) {
  Push-Location $projectRoot
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build thất bại.' }
  } finally { Pop-Location }
}
$port = 3000
if (Test-Path -LiteralPath (Join-Path $projectRoot '.env')) {
  $portLine = Get-Content -LiteralPath (Join-Path $projectRoot '.env') | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -Last 1
  if ($portLine) { $port = [int]($portLine -replace '^PORT=', '') }
}
try { $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2 } catch { $health = $null }
if ($health.service -eq 'procureiq-api') {
  Write-Host "Ứng dụng đã chạy: http://localhost:$port"
  exit 0
}
$dataFolder = Join-Path $projectRoot '.data'
New-Item -ItemType Directory -Path $dataFolder -Force | Out-Null
$nodePath = (Get-Command node.exe).Source
$server = Start-Process -FilePath $nodePath -ArgumentList ('"' + $entryFile + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataFolder 'api.stdout.log') -RedirectStandardError (Join-Path $dataFolder 'api.stderr.log') -PassThru
$server.Id | Set-Content -LiteralPath (Join-Path $dataFolder 'api.pid')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  if ($server.HasExited) { throw 'API dừng. Xem .data/api.stderr.log.' }
  try {
    $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 1
    if ($health.service -eq 'procureiq-api') { Write-Host "Đã chạy: http://localhost:$port"; exit 0 }
  } catch {}
}
throw 'API chưa sẵn sàng. Xem .data/api.stdout.log và api.stderr.log.'
