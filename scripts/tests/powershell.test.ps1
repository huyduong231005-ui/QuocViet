$ErrorActionPreference = 'Stop'
$scriptsDirectory = Split-Path -Parent $PSScriptRoot
$failures = @()
foreach ($file in Get-ChildItem -LiteralPath $scriptsDirectory -Filter '*.ps1') {
    $tokens = $null
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors) | Out-Null
    if ($parseErrors.Count) {
        $failures += $file.Name
        Write-Output ('FAIL: Windows PowerShell cannot parse ' + $file.Name)
    }
    else { Write-Output ('PASS: Windows PowerShell parses ' + $file.Name) }
}
if ($failures.Count) { throw ('PowerShell script parsing failed: ' + ($failures -join ', ')) }
