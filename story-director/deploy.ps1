# Deploy story-director to the local SillyTavern third-party directory.
param(
    [string]$Target = "F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-director"
)

# Derive the source directory from the script location.
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less
# files with the ANSI code page; UTF-8 Chinese comments corrupted parsing
# and silently swallowed the line that computed $Src.
$Src = $PSScriptRoot
Write-Host "Deploying $Src -> $Target"

if (Test-Path $Target) {
    Remove-Item $Target -Recurse -Force
}
New-Item -ItemType Directory -Path $Target -Force | Out-Null

# Only copy runtime files; exclude test/, README.md, deploy.ps1 etc.
$Items = @('manifest.json', 'index.js', 'settings.html', 'style.css', 'src')
foreach ($Item in $Items) {
    Copy-Item -Path (Join-Path $Src $Item) -Destination $Target -Recurse -Force
}

Write-Host "Done. Restart SillyTavern (or hard-refresh with Ctrl+Shift+R) and check the Extensions panel."
