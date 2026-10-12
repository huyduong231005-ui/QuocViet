param(
    [string]$Model = 'gemini-3.5-flash-lite',
    [switch]$PrepareOnly,
    [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
. (Join-Path $PSScriptRoot 'parse-gemini-keys.ps1')
& (Join-Path $PSScriptRoot 'configure-ai.ps1') -PrepareOnly
$envText = [IO.File]::ReadAllText($envFile)

function Set-LocalSetting([string]$Name, [string]$Value) {
    if ($Value -match '[\r\n]') { throw 'Configuration values must be on one line.' }
    $pattern = '(?m)^' + [regex]::Escape($Name) + '=([^\r\n]*)'
    if ([regex]::IsMatch($script:envText, $pattern)) {
        $replacement = $Name + '=' + $Value
        $script:envText = [regex]::Replace($script:envText, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) $replacement })
    } else { $script:envText = $script:envText.TrimEnd() + [Environment]::NewLine + $Name + '=' + $Value + [Environment]::NewLine }
}

if ($Model -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid Gemini model name.' }
Set-LocalSetting 'LLM_PROVIDER' 'gemini'
Set-LocalSetting 'GEMINI_MODEL' $Model

if (-not $PrepareOnly) {
    Write-Host 'Enter your Gemini API keys in the hidden prompt. Press Enter on an empty key to finish.'
    $keys = [Collections.Generic.List[string]]::new()
    for ($index = 1; $index -le 20; $index++) {
        $secureKey = Read-Host ('Gemini API key ' + $index + ' (hidden)') -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim() }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secureKey.Dispose() }
        if (-not $key) { break }
        foreach ($parsed in (ConvertTo-GeminiKeys $key)) {
            if (-not $keys.Contains($parsed)) { $keys.Add($parsed) }
        }
    }
    if ($keys.Count -gt 0) { Set-LocalSetting 'GEMINI_API_KEYS' ($keys -join ',') }
    elseif ($envText -notmatch '(?m)^GEMINI_API_KEYS=\S+' -and $envText -notmatch '(?m)^GEMINI_API_KEY=\S+') {
        throw 'No Gemini key was entered and none is already configured.'
    }
}

[IO.File]::WriteAllText($envFile, $envText.TrimStart("`r", "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host 'Gemini configuration saved locally. API keys were not printed.'
if ($Restart) {
    & (Join-Path $PSScriptRoot 'stop.ps1')
    & (Join-Path $PSScriptRoot 'start.ps1')
}
