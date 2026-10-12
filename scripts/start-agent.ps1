param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$agentDirectory = Join-Path $projectRoot 'services\agent'
$pythonFile = Join-Path $agentDirectory '.venv\Scripts\python.exe'
if ($Install) {
    if (-not (Test-Path -LiteralPath $pythonFile)) {
        & python -m venv (Join-Path $agentDirectory '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment.' }
    }
    & $pythonFile -m pip install -r (Join-Path $agentDirectory 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Could not install Agent dependencies.' }
}
if (-not (Test-Path -LiteralPath $pythonFile)) { throw 'Run scripts/start-agent.ps1 -Install first.' }
$envFile = Join-Path $projectRoot '.env'
$agentUrl = 'http://127.0.0.1:8001'
if (Test-Path -LiteralPath $envFile) {
    $urlLine = Get-Content -LiteralPath $envFile -Encoding UTF8 | Where-Object { $_ -match '^AGENT_URL=' } | Select-Object -Last 1
    if ($urlLine) { $agentUrl = ($urlLine -replace '^AGENT_URL=', '').Trim().TrimEnd('/') }
}
$agentUri = [uri]$agentUrl
if ($agentUri.Host -notin @('127.0.0.1','localhost')) { throw 'This script starts a local Agent only.' }
try { $health = Invoke-RestMethod ($agentUrl + '/health') -TimeoutSec 2 } catch { $health = $null }
if ($health.service -eq 'procureiq-agent') { Write-Host ('Agent already running: ' + $agentUrl); exit 0 }
$dataFolder = Join-Path $projectRoot '.data'
New-Item -ItemType Directory -Path $dataFolder -Force | Out-Null
$arguments = '-u -m uvicorn app:app --app-dir "' + $agentDirectory + '" --host 127.0.0.1 --port ' + $agentUri.Port
if (Test-Path -LiteralPath $envFile) { $arguments += ' --env-file "' + $envFile + '"' }
$server = Start-Process -FilePath $pythonFile -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataFolder 'agent.stdout.log') -RedirectStandardError (Join-Path $dataFolder 'agent.stderr.log') -PassThru
$server.Id | Set-Content -LiteralPath (Join-Path $dataFolder 'agent.pid')
$watch = [Diagnostics.Stopwatch]::StartNew()
while ($watch.Elapsed.TotalSeconds -lt 55) {
    Start-Sleep -Milliseconds 500
    $server.Refresh()
    if ($server.HasExited) { throw 'Agent stopped. See .data/agent.stderr.log.' }
    try {
        $health = Invoke-RestMethod ($agentUrl + '/health') -TimeoutSec 1
        if ($health.service -eq 'procureiq-agent') { Write-Host ('Agent ready: ' + $agentUrl); exit 0 }
    } catch {}
}
throw 'Agent is still starting. See .data/agent.stdout.log and agent.stderr.log.'
