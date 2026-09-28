<#
.SYNOPSIS
    Builds, packages, installs and launches the Nodecast TV app on a
    connected Samsung TV, using classic Tizen Studio's `tizen` CLI.

.PARAMETER SigningProfile
    The Tizen signing profile name (created via Certificate Manager -
    see README.md). Defaults to "nodecast".

.PARAMETER Device
    The TV's identifier as shown by `sdb devices` after `sdb connect
    <TV_IP>` (the IP:port, e.g. 192.168.1.50:26101). Required.

.EXAMPLE
    .\deploy.ps1 -Device 192.168.1.50:26101
#>
param(
    [string]$SigningProfile = 'nodecast',
    [Parameter(Mandatory = $true)]
    [string]$Device
)

$ErrorActionPreference = 'Stop'
$projDir = $PSScriptRoot
$buildDir = Join-Path $projDir '.buildResult'
$appId = 'NdCstTV001.NodecastTV'

# Resolve tizen.bat without relying on PATH (a fresh shell may not have
# picked up the PATH change yet - see README.md "One-time setup").
$tizen = 'C:\tizen-studio\tools\ide\bin\tizen.bat'
if (-not (Test-Path $tizen)) {
    $tizen = (Get-Command tizen.bat -ErrorAction SilentlyContinue).Source
}
if (-not $tizen) {
    throw "Couldn't find tizen.bat. See README.md's 'One-time setup' section."
}

function Run($exe, $exeArgs) {
    Write-Host "> $exe $($exeArgs -join ' ')" -ForegroundColor Cyan
    & $exe @exeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$exe exited with code $LASTEXITCODE"
    }
}

Write-Host "== Build ==" -ForegroundColor Green
Remove-Item -Recurse -Force $buildDir -ErrorAction SilentlyContinue
Run $tizen @('build-web', '--', $projDir)

Write-Host "== Package + sign ==" -ForegroundColor Green
Run $tizen @('package', '-t', 'wgt', '-s', $SigningProfile, '--', $buildDir)

$wgt = Get-ChildItem -Path $buildDir -Filter '*.wgt' | Select-Object -First 1
if (-not $wgt) {
    throw "package reported success but no .wgt was found under $buildDir"
}

Write-Host "== Installing $($wgt.Name) ==" -ForegroundColor Green
Run $tizen @('install', '-n', $wgt.FullName, '-s', $Device)

Write-Host "== Launching ==" -ForegroundColor Green
Run $tizen @('run', '-p', $appId, '-s', $Device)

Write-Host "Done. Use the TV remote, or Chrome DevTools (see README) to inspect logs." -ForegroundColor Green
