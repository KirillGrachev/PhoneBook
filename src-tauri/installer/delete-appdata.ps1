$ErrorActionPreference = 'SilentlyContinue'

$logPath = Join-Path $env:TEMP 'kmaruda-phonebook-uninstall.log'

function Write-CleanupLog([string]$message) {
    try {
        Add-Content -LiteralPath $logPath -Value ('{0:o} {1}' -f (Get-Date), $message) -Encoding UTF8
    } catch {
        # Logging must never fail the uninstall.
    }
}

Write-CleanupLog 'starting application data cleanup'

# Stop the application so its database and WebView2 cache are not locked.
Get-Process -Name 'kmaruda-phonebook' -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        $_.Kill()
        $_.WaitForExit(5000)
    } catch {
        # The process may already have exited.
    }
}
Start-Sleep -Milliseconds 800

$paths = @(
    (Join-Path $env:APPDATA 'KMAruda PhoneBook'),
    (Join-Path $env:LOCALAPPDATA 'KMAruda PhoneBook'),
    # Older builds stored data under the reverse-DNS identifier.
    (Join-Path $env:APPDATA 'com.kmaruda.phonebook'),
    (Join-Path $env:LOCALAPPDATA 'com.kmaruda.phonebook')
)

foreach ($path in $paths) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if (-not (Test-Path -LiteralPath $path)) { break }
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
        if (-not (Test-Path -LiteralPath $path)) { break }
        Start-Sleep -Milliseconds 700
    }
    if (Test-Path -LiteralPath $path) {
        Write-CleanupLog "failed to remove $path"
    } else {
        Write-CleanupLog "removed $path"
    }
}

# Remove the application's Windows Credential Manager entries:
# database keys (primary + backup) and every saved LDAP bind secret.
$targets = New-Object 'System.Collections.Generic.HashSet[string]'
[void]$targets.Add('db-key.kmaruda-phonebook')
[void]$targets.Add('db-key-backup.kmaruda-phonebook')

foreach ($line in (& cmdkey.exe /list 2>$null)) {
    if ($line -match '([^\s]+\.kmaruda-phonebook)\s*$') {
        $target = $matches[1] -replace '^.*=', ''
        if ($target) { [void]$targets.Add($target) }
    }
}

foreach ($target in $targets) {
    & cmdkey.exe "/delete:$target" 2>$null | Out-Null
    Write-CleanupLog "credential $target"
}

$left = @($paths | Where-Object { Test-Path -LiteralPath $_ })
if ($left.Count -gt 0) {
    Write-CleanupLog ('cleanup incomplete: ' + ($left -join '; '))
    exit 1
}

Write-CleanupLog 'cleanup complete'
exit 0
