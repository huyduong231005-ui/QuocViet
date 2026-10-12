$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot '.data\agent.pid'
if (-not (Test-Path -LiteralPath $pidFile)) { return }
$serverId = [int](Get-Content -LiteralPath $pidFile)
$server = Get-CimInstance Win32_Process -Filter "ProcessId=$serverId"
if ($server) {
    $agentDirectory = Join-Path $projectRoot 'services\agent'
    if ($server.Name -ne 'python.exe' -or -not $server.CommandLine.Contains('uvicorn app:app') -or -not $server.CommandLine.Contains($agentDirectory)) { throw 'Agent PID belongs to another process; refusing to stop it.' }
    Stop-Process -Id $serverId
}
Remove-Item -LiteralPath $pidFile
Write-Host 'Agent stopped.'
