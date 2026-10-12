function ConvertTo-GeminiKeys([string]$InputText) {
    $wrappers = [char[]]@([char]34, [char]39, [char]96, [char]91, [char]93)
    $value = $InputText.Trim().Trim($wrappers) -replace '^(?i:GEMINI_API_KEYS?)\s*=\s*', ''
    $keys = [Collections.Generic.List[string]]::new()
    foreach ($item in ($value -split '[,;]')) {
        $key = $item.Trim().Trim($wrappers).Trim()
        if (-not $key) { continue }
        if ($key.Length -gt 512 -or $key -notmatch '^[\x21-\x7e]+$') {
            throw 'Paste a Gemini API key or comma-separated keys without spaces inside a key; configuration was not saved.'
        }
        if (-not $keys.Contains($key)) { $keys.Add($key) }
    }
    return $keys.ToArray()
}
