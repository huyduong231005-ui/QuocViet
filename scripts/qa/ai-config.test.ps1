$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sandboxRoot = Join-Path $projectRoot ('.data\ai-config-test-' + [guid]::NewGuid().ToString('N'))
$sandboxScripts = Join-Path $sandboxRoot 'scripts'
New-Item -ItemType Directory -Path $sandboxScripts -Force | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\configure-ai.ps1') -Destination $sandboxScripts
    Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\configure-gemini.ps1') -Destination $sandboxScripts
    Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\parse-gemini-keys.ps1') -Destination $sandboxScripts
    . (Join-Path $sandboxScripts 'parse-gemini-keys.ps1')
    $normalized = @(ConvertTo-GeminiKeys 'GEMINI_API_KEYS="demo.key=1", AQ_test+2;`AQ_test+2`')
    if ($normalized.Count -ne 2 -or $normalized[0] -ne 'demo.key=1' -or $normalized[1] -ne 'AQ_test+2') { throw 'Pasted Gemini keys were not normalized correctly.' }
    $configScript = Join-Path $sandboxScripts 'configure-ai.ps1'
    $envFile = Join-Path $sandboxRoot '.env'
    $fixture = @'
DATABASE_URL=postgres://fixture:fake$1@localhost/test
LLM_API_KEY=fake-existing-model-key$1
AGENT_API_KEY=fake-existing-agent-key$2
LLM_MODEL=existing-model
LLM_BASE_URL=https://example.invalid/v1
DEMO_MODE=false
'@
    [IO.File]::WriteAllText($envFile, $fixture)
    & $configScript -PrepareOnly
    & $configScript -PrepareOnly
    $configured = [IO.File]::ReadAllText($envFile)
    foreach ($line in ($fixture -split '\r?\n')) {
        if (-not $configured.Contains($line)) { throw 'Existing configuration was changed.' }
    }
    foreach ($entry in @('AGENT_EXTRACTION_ENABLED=true', 'AGENT_ENABLED=false', 'AGENT_URL=http://127.0.0.1:8001')) {
        if ([regex]::Matches($configured, '(?m)^' + [regex]::Escape($entry) + '\r?$').Count -ne 1) { throw 'Configuration is missing or duplicated.' }
    }
    [IO.File]::AppendAllText($envFile, [Environment]::NewLine + 'GEMINI_API_KEYS=fake-gemini-key$1,fake-gemini-key$2' + [Environment]::NewLine)
    & (Join-Path $sandboxScripts 'configure-gemini.ps1') -PrepareOnly
    & (Join-Path $sandboxScripts 'configure-gemini.ps1') -PrepareOnly
    $geminiConfigured = [IO.File]::ReadAllText($envFile)
    if ($geminiConfigured -notmatch '(?m)^LLM_PROVIDER=gemini\r?$' -or $geminiConfigured -notmatch '(?m)^GEMINI_MODEL=gemini-3\.5-flash-lite\r?$') { throw 'Gemini provider or model is missing.' }
    if ([regex]::Matches($geminiConfigured, '(?m)^GEMINI_API_KEYS=fake-gemini-key\$1,fake-gemini-key\$2\r?$').Count -ne 1) { throw 'Gemini keys were changed or duplicated.' }
    if (-not $geminiConfigured.Contains('DATABASE_URL=postgres://fixture:fake$1@localhost/test')) { throw 'Existing database URL was changed.' }
    [IO.File]::WriteAllText($envFile, 'AGENT_API_KEY=local-demo-agent-key')
    & $configScript -PrepareOnly
    $prepared = [IO.File]::ReadAllText($envFile)
    $match = [regex]::Match($prepared, '(?m)^AGENT_API_KEY=([^\r\n]+)')
    if (-not $match.Success -or [Convert]::FromBase64String($match.Groups[1].Value).Length -ne 32) { throw 'Private Agent key was not generated.' }
    if ($prepared -match '(?m)^LLM_API_KEY=') { throw 'Preparation must not invent a model key.' }
    Write-Host 'PASS: provider configuration preserves existing settings and keys, is repeatable, and generates only the private Agent key.'
} finally {
    $resolvedSandbox = [IO.Path]::GetFullPath($sandboxRoot)
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.data')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedSandbox.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside project .data.' }
    Remove-Item -LiteralPath $resolvedSandbox -Recurse -Force
}
