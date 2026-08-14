# 拷贝 story-director 到本地酒馆 third-party 目录
param(
    [string]$Target = "F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-director"
)
$Src = "F:\deepseek\plugins\story-director"
Write-Host "Deploying $Src -> $Target"
if (Test-Path $Target) { Remove-Item $Target -Recurse -Force }
New-Item -ItemType Directory -Path $Target -Force | Out-Null
Copy-Item -Path (Join-Path $Src '*') -Destination $Target -Recurse -Force
Write-Host "Done. Restart SillyTavern and check Extensions panel."
