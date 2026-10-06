[CmdletBinding()]
param([string]$HermesHome)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'path-safety.ps1')
if (-not $HermesHome) {
    if ($env:HERMES_HOME) { $HermesHome = $env:HERMES_HOME }
    elseif ($env:LOCALAPPDATA -and (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'hermes\desktop-plugins'))) { $HermesHome = Join-Path $env:LOCALAPPDATA 'hermes' }
    else { $HermesHome = Join-Path $env:USERPROFILE '.hermes' }
}
$resolvedHome = [IO.Path]::GetFullPath($HermesHome)
$pluginsRoot = [IO.Path]::GetFullPath((Join-Path $resolvedHome 'desktop-plugins'))
$destination = [IO.Path]::GetFullPath((Join-Path $pluginsRoot 'hermes-source-copy'))
# Verify the exact absolute target before the sole recursive delete.
if ([IO.Path]::GetDirectoryName($destination) -ne $pluginsRoot -or [IO.Path]::GetFileName($destination) -ne 'hermes-source-copy') { throw 'Refusing unexpected uninstall target.' }
Assert-NoReparsePath $destination -Tree
if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
    Write-Output "Uninstalled: $destination"
} else { Write-Output "Plugin is not installed at: $destination" }
Write-Output 'Reload desktop plugins if Hermes has not unloaded it yet. Backups and all chat data are preserved.'
