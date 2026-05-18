#Requires -Version 5.1
<#
.SYNOPSIS
  One-shot migration: replace console.{log,info,warn,error,debug} with logger.* across src/.
  Adds `import { logger } from '<relative>/utils/logger';` to each modified file.
  Skips: utils/logger.ts, __tests__/**, *.test.ts, *.test.tsx, vite-env.d.ts
#>

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

$repoRoot = (Get-Location).Path
$srcRoot = Join-Path $repoRoot 'src'

function Get-RelativeLoggerImport([string]$filePath) {
    $fileDir = Split-Path -Parent $filePath
    $loggerPath = Join-Path $srcRoot 'utils\logger.ts'
    $loggerNoExt = $loggerPath -replace '\.ts$',''
    Push-Location $fileDir
    try {
        # Compute relative path using URI math
        $fromUri = New-Object System.Uri(($fileDir + [IO.Path]::DirectorySeparatorChar))
        $toUri = New-Object System.Uri($loggerNoExt)
        $rel = [Uri]::UnescapeDataString($fromUri.MakeRelativeUri($toUri).ToString())
        if (-not $rel.StartsWith('.')) { $rel = './' + $rel }
        return $rel -replace '\\','/'
    } finally { Pop-Location }
}

$files = Get-ChildItem -Path $srcRoot -Recurse -Include *.ts,*.tsx -File |
    Where-Object {
        $_.FullName -notmatch '\\__tests__\\' -and
        $_.Name -notmatch '\.(test|spec)\.(ts|tsx)$' -and
        $_.Name -ne 'logger.ts' -and
        $_.Name -ne 'vite-env.d.ts'
    }

$changedCount = 0
foreach ($file in $files) {
    $original = Get-Content -Raw -LiteralPath $file.FullName
    if ($null -eq $original) { continue }
    if ($original -notmatch 'console\.(log|info|warn|error|debug)\b') { continue }

    $updated = $original `
        -replace 'console\.log\b', 'logger.info' `
        -replace 'console\.info\b', 'logger.info' `
        -replace 'console\.debug\b', 'logger.debug' `
        -replace 'console\.warn\b', 'logger.warn' `
        -replace 'console\.error\b', 'logger.error'

    if ($updated -eq $original) { continue }

    # Add logger import if not already present
    if ($updated -notmatch "from\s+['""][^'""]*utils/logger['""]") {
        $relImport = Get-RelativeLoggerImport -filePath $file.FullName
        $importLine = "import { logger } from '$relImport';"

        # Insert after the last existing import statement (handles multi-line imports).
        # Strategy: walk lines, track when inside a multi-line import (open `{` without
        # matching `}`). An import "ends" at the line containing the closing `}` or, for
        # single-line imports, at the line itself.
        $lines = $updated -split "`r?`n"
        $lastImportEndIdx = -1
        $inImport = $false
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $line = $lines[$i]
            if (-not $inImport) {
                if ($line -match '^\s*import\b') {
                    $inImport = $true
                }
            }
            if ($inImport) {
                # Import ends when line contains `from '...'` followed by optional `;`
                # OR when it's a side-effect import like `import './foo.css';`
                if ($line -match "from\s+['""][^'""]+['""]\s*;?\s*$" -or
                    $line -match "^\s*import\s+['""][^'""]+['""]\s*;?\s*$") {
                    $lastImportEndIdx = $i
                    $inImport = $false
                }
            } elseif ($lastImportEndIdx -ge 0 -and $line.Trim() -ne '' -and $line -notmatch '^\s*(//|/\*|\*)') {
                break
            }
        }
        if ($lastImportEndIdx -ge 0) {
            $lines = $lines[0..$lastImportEndIdx] + @($importLine) + $lines[($lastImportEndIdx + 1)..($lines.Count - 1)]
        } else {
            $lines = @($importLine, '') + $lines
        }
        $updated = ($lines -join "`n")
    }

    Set-Content -LiteralPath $file.FullName -Value $updated -NoNewline
    $changedCount++
    Write-Host "  modified: $($file.FullName.Substring($repoRoot.Length + 1))"
}

Write-Host ""
Write-Host "Updated $changedCount files."
