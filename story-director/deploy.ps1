# 拷贝 story-director 到本地酒馆 third-party 目录
param(
    [string]$Target = "F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-director"
)

# 源目录从脚本所在位置推导，不再硬编码
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "Deploying $Src -> $Target"

if (Test-Path $Target) {
    Remove-Item $Target -Recurse -Force
}
New-Item -ItemType Directory -Path $Target -Force | Out-Null

# 只拷贝运行所需文件，排除 test/、README.md、deploy.ps1 等开发文件
$Items = @('manifest.json', 'index.js', 'settings.html', 'style.css', 'src')
foreach ($Item in $Items) {
    Copy-Item -Path (Join-Path $Src $Item) -Destination $Target -Recurse -Force
}

Write-Host "Done. Restart SillyTavern (or hard-refresh with Ctrl+Shift+R) and check the Extensions panel."
