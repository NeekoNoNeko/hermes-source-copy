[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $projectRoot 'artifacts'
$stage = Join-Path $artifactRoot ('release-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage 'dist') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\hermes-source-copy') -Destination (Join-Path $stage 'dist\hermes-source-copy') -Recurse
foreach ($name in @('README.md', 'README.zh-CN.md', 'LICENSE', 'VERIFICATION.md', 'SECURITY.md', 'plugin.js', 'THIRD_PARTY_NOTICES.txt')) { Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $stage $name) }
foreach ($name in @('install.ps1', 'uninstall.ps1', 'path-safety.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage "scripts\$name") }
$zip = Join-Path $artifactRoot 'hermes-source-copy-1.0.0.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in (Get-ChildItem -LiteralPath $stage -Recurse -File)) {
        $entryName = $file.FullName.Substring($stage.Length + 1).Replace('\', '/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$stream = [IO.File]::OpenRead($zip)
$algorithm = [Security.Cryptography.SHA256]::Create()
try { $hash = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
finally { $algorithm.Dispose(); $stream.Dispose() }
Set-Content -LiteralPath (Join-Path $artifactRoot 'hermes-source-copy-1.0.0.sha256') -Value "$hash  hermes-source-copy-1.0.0.zip" -Encoding ASCII
$resolvedStage = (Resolve-Path -LiteralPath $stage).Path
$resolvedArtifacts = (Resolve-Path -LiteralPath $artifactRoot).Path
if ([IO.Path]::GetDirectoryName($resolvedStage) -ne $resolvedArtifacts -or -not [IO.Path]::GetFileName($resolvedStage).StartsWith('release-')) { throw 'Refusing to remove unexpected package staging path.' }
Remove-Item -LiteralPath $resolvedStage -Recurse -Force
Write-Output "Release ZIP: $zip"
Write-Output "SHA256: $hash"
