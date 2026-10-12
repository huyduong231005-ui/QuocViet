param(
    [string]$Model = 'gpt-4.1-mini',
    [string]$BaseUrl = 'https://api.openai.com/v1',
    [switch]$PrepareOnly,
    [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
$envText = if (Test-Path -LiteralPath $envFile) { [IO.File]::ReadAllText($envFile) } else { '' }

function Set-LocalSetting([string]$Name, [string]$Value, [bool]$OnlyIfMissing = $false) {
    if ($Value -match '[\r\n]') { throw 'Configuration values must be on one line.' }
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=([^\r\n]*)'
    if ([regex]::IsMatch($script:envText, $pattern)) {
        if (-not $OnlyIfMissing) {
            $replacement = $Name + '=' + $Value
            $script:envText = [regex]::Replace($script:envText, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
        }
    } else { $script:envText = $script:envText.TrimEnd() + [Environment]::NewLine + $Name + '=' + $Value + [Environment]::NewLine }
}

Set-LocalSetting 'AGENT_EXTRACTION_ENABLED' 'true'
Set-LocalSetting 'AGENT_ENABLED' 'false' $true
Set-LocalSetting 'AGENT_URL' 'http://127.0.0.1:8001' $true
$keyMatch = [regex]::Match($envText, '(?m)^AGENT_API_KEY=([^\r\n]*)')
if (-not $keyMatch.Success -or [string]::IsNullOrWhiteSpace($keyMatch.Groups[1].Value) -or $keyMatch.Groups[1].Value -eq 'local-demo-agent-key') {
    $keyBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($keyBytes) } finally { $generator.Dispose() }
    Set-LocalSetting 'AGENT_API_KEY' ([Convert]::ToBase64String($keyBytes))
}
Set-LocalSetting 'LLM_MODEL' $Model $PrepareOnly.IsPresent
Set-LocalSetting 'LLM_BASE_URL' $BaseUrl $PrepareOnly.IsPresent
if (-not $PrepareOnly) {
    $secureKey = Read-Host 'API key (hidden input; never paste it into chat)' -AsSecureString
    if ($secureKey.Length -eq 0) { throw 'No API key entered; configuration was not saved.' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try { Set-LocalSetting 'LLM_API_KEY' ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureKey.Dispose() }
    Set-LocalSetting 'LLM_PROVIDER' 'openai'
}
[IO.File]::WriteAllText($envFile, $envText.TrimStart("`r", "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host 'Local AI configuration saved in .env. No key was printed.'
if ($Restart) {
    & (Join-Path $PSScriptRoot 'stop.ps1')
    & (Join-Path $PSScriptRoot 'start.ps1')
}
