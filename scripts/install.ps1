[CmdletBinding()]
param([string]$HermesHome)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'path-safety.ps1')
$pluginId = 'hermes-source-copy'
function Get-Sha256([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

if (-not $HermesHome) {
    if ($env:HERMES_HOME) { $HermesHome = $env:HERMES_HOME }
    elseif ($env:LOCALAPPDATA -and (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'hermes\desktop-plugins'))) { $HermesHome = Join-Path $env:LOCALAPPDATA 'hermes' }
    else { $HermesHome = Join-Path $env:USERPROFILE '.hermes' }
}
$resolvedHome = [IO.Path]::GetFullPath($HermesHome)
$pluginsRoot = [IO.Path]::GetFullPath((Join-Path $resolvedHome 'desktop-plugins'))
$destination = [IO.Path]::GetFullPath((Join-Path $pluginsRoot $pluginId))
if ([IO.Path]::GetDirectoryName($destination) -ne $pluginsRoot) { throw 'Plugin path escaped the specified Hermes home.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'dist\hermes-source-copy'
Assert-NoReparsePath $source -Tree
Assert-NoReparsePath (Join-Path $projectRoot 'LICENSE')
Assert-NoReparsePath $destination -Tree
if (-not (Test-Path -LiteralPath (Join-Path $source 'plugin.js'))) { throw 'Built plugin missing. Extract the full release ZIP, or run npm ci and npm run build in the project first.' }
$expectedHash = ((Get-Content -LiteralPath (Join-Path $source 'SHA256.txt') -Raw).Trim() -split '\s+')[0]
$actualHash = Get-Sha256 (Join-Path $source 'plugin.js')
if ($actualHash.ToLowerInvariant() -ne $expectedHash.ToLowerInvariant()) { throw 'Plugin SHA256 verification failed.' }
$backup = $null
if (Test-Path -LiteralPath $destination) {
    $backupRoot = Join-Path $resolvedHome 'desktop-plugin-backups'
    Assert-NoReparsePath $backupRoot
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    $backup = Join-Path $backupRoot ("$pluginId-" + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
    Assert-NoReparsePath $backup -Tree
    Copy-Item -LiteralPath $destination -Destination $backup -Recurse
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
# Copy all sidecars first and plugin.js last: the watched JS is the reload trigger.
foreach ($fileName in @('SHA256.txt', 'build-info.json', 'THIRD_PARTY_NOTICES.txt')) {
    $sidecar = Join-Path $source $fileName
    if (Test-Path -LiteralPath $sidecar) { Copy-Item -LiteralPath $sidecar -Destination (Join-Path $destination $fileName) -Force }
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $destination 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $source 'plugin.js') -Destination (Join-Path $destination 'plugin.js') -Force
if ((Get-Sha256 (Join-Path $destination 'plugin.js')) -ne $actualHash) { throw 'Installed plugin hash does not match release.' }
Write-Output "Installed: $destination"
if ($backup) { Write-Output "Previous installation backup: $backup" }
Write-Output 'Hermes loads the plugin automatically. Enable it in Capabilities > Plugins, or use Reload desktop plugins in the command palette.'
