$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'stop-agent.ps1')
$pidFile = Join-Path $projectRoot '.data\api.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'Không có API do start.ps1 quản lý.'; exit 0 }
$serverId = [int](Get-Content -LiteralPath $pidFile)
$server = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId"
if ($server) {
  $entryFile = Join-Path $projectRoot 'apps\api\dist\main.js'
  if ($server.Name -ne 'node.exe' -or -not $server.CommandLine.Contains($entryFile)) { throw 'PID thuộc tiến trình khác; không dừng.' }
  Stop-Process -Id $serverId
}
Remove-Item -LiteralPath $pidFile
Write-Host 'Đã dừng API. Dữ liệu được giữ nguyên.'
