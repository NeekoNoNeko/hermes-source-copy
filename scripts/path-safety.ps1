# Check parents first, and walk children without ever traversing a reparse point.
# Reject links for files as well as directories before copying or deleting trees.
function Assert-NoReparsePath([string]$TargetPath, [switch]$Tree) {
    $absolute = [IO.Path]::GetFullPath($TargetPath)
    $ancestor = $absolute
    while ($ancestor) {
        $item = Get-Item -LiteralPath $ancestor -Force -ErrorAction SilentlyContinue
        if ($item) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse point: $ancestor" }
        }
        $parent = [IO.Path]::GetDirectoryName($ancestor)
        if ($parent -eq $ancestor) { break }
        $ancestor = $parent
    }
    if ($Tree -and (Test-Path -LiteralPath $absolute)) {
        $pending = New-Object 'Collections.Generic.Stack[string]'
        $pending.Push($absolute)
        while ($pending.Count -gt 0) {
            $current = $pending.Pop()
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse point: $current" }
            if ($item.PSIsContainer) {
                foreach ($child in (Get-ChildItem -LiteralPath $current -Force)) { $pending.Push($child.FullName) }
            }
        }
    }
}
