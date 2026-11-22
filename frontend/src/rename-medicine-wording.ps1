<#
.SYNOPSIS
  Changes the user-visible WORD "medicine(s)" to "product(s)" without touching code.

.DESCRIPTION
  Only text that people read is changed:
    * JSX text between tags         <th>Medicine</th>
    * label/placeholder/title/... attributes
    * quoted sentences (must contain a space)   "No medicines found"
    * template strings (text parts only; ${...} code is never touched)
    * comment lines

  Never touched:
    * identifiers and imports   (Medicine, MedicineSearch, searchMedicines, medicine.name, medicine_id ...)
    * API URLs and keys         ("/medicines/", { medicine: id }, "medicine" as a single token)
    * anything inside ${ ... }
    * className / id / name / key / type / to / href / src / value attributes
    * migrations, node_modules, dist, build, .git, venv

  Files already made business-aware (they pick their wording from the shop settings)
  are skipped by default, so pharmacy shops keep saying "medicine".

  DRY RUN by default: it only shows what WOULD change. Nothing is written until you add -Apply.

.PARAMETER Path          Project root (default: current folder).
.PARAMETER Apply         Actually write the changes (a backup copy is made first).
.PARAMETER Backend       Also process .py files (help_text, messages...). Run makemigrations afterwards.
.PARAMETER SkipComments  Leave comment lines alone.
.PARAMETER ExcludeFiles  File names to skip.

.EXAMPLE
  .\rename-medicine-wording.ps1                 # preview only
  .\rename-medicine-wording.ps1 -Apply          # frontend files
  .\rename-medicine-wording.ps1 -Apply -Backend # frontend + backend
#>
[CmdletBinding()]
param(
  [string]$Path = ".",
  [switch]$Apply,
  [switch]$Backend,
  [switch]$SkipComments,
  [string[]]$ExcludeFiles = @(
    "shopProfile.js", "MedicineSearch.jsx", "WalkInSale.jsx", "Inventory.jsx",
    "Sidebar.jsx", "Login.jsx", "Register.jsx"
  )
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path $Path).Path
$IgnoreCase = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---------------------------------------------------------------------------
# The word itself: standalone "medicine" / "medicines" only (any capitalisation).
# Not matched when glued to code: Medicine.Search, medicine.name, medicine(, {medicine},
# /medicines/, medicine_id, medicine-card, @medicine, #medicine ...
# ---------------------------------------------------------------------------
$wordPattern = '(?<![\w./\\$@#{-])medicines?(?![\w/@#}-]|\??\.[A-Za-z_]|\()'

$wordEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  $w = $m.Value
  $plural = ($w[-1] -eq 's' -or $w[-1] -eq 'S')
  if ($w -ceq $w.ToUpper())            { $r = 'PRODUCT'; if ($plural) { $r += 'S' } }
  elseif ([char]::IsUpper($w[0]))      { $r = 'Product'; if ($plural) { $r += 's' } }
  else                                 { $r = 'product'; if ($plural) { $r += 's' } }
  return $r
}

# Replaces the word in a piece of text, skipping every ${ ... } expression.
function Fix-Text([string]$s) {
  if ($s -notmatch '(?i)medicine') { return $s }
  $parts = [regex]::Split($s, '(\$\{[^}]*\})')
  for ($i = 0; $i -lt $parts.Length; $i++) {
    if ($parts[$i].StartsWith('${')) { continue }
    $parts[$i] = [regex]::Replace($parts[$i], $wordPattern, $wordEval, $IgnoreCase)
  }
  return ($parts -join '')
}

# label="..." style attributes: single words allowed (label="Medicine")
$attrEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  return $m.Groups[1].Value + (Fix-Text $m.Groups[2].Value) + $m.Groups[3].Value
}
# JSX text between tags
$textEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  return '>' + (Fix-Text $m.Groups[1].Value) + '<'
}
# Quoted strings: only sentences (must contain a space), never single tokens like "medicine"
$dqEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  $c = $m.Groups[1].Value
  if ($c.Trim() -notmatch '\s') { return $m.Value }
  return '"' + (Fix-Text $c) + '"'
}
$sqEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  $c = $m.Groups[1].Value
  if ($c.Trim() -notmatch '\s') { return $m.Value }
  return "'" + (Fix-Text $c) + "'"
}
$btEval = [System.Text.RegularExpressions.MatchEvaluator]{
  param($m)
  $c = $m.Groups[1].Value
  if ($c.Trim() -notmatch '\s') { return $m.Value }
  return '`' + (Fix-Text $c) + '`'
}

$codeStarters = '^(return|const|let|var|import|export|else|await|throw|new|typeof|case|default|yield|if|for|while|do|from|async|function|class|in|of|delete|void)\b'

function Fix-Line([string]$line, [bool]$markup) {
  $trim = $line.TrimStart()

  # Comment-only lines
  if ($trim.StartsWith('//') -or $trim.StartsWith('/*') -or $trim.StartsWith('*') -or $trim.StartsWith('#')) {
    if ($SkipComments) { return $line }
    return (Fix-Text $line)
  }

  $out = $line

  # 1) label / placeholder / title / alt / aria-label / hint / description attributes
  $out = [regex]::Replace($out, '\b((?:label|placeholder|title|alt|aria-label|hint|description)=")([^"\r\n]*)(")', $attrEval)

  if ($markup) {
    # 2) JSX text between tags
    $out = [regex]::Replace($out, '>((?:(?!&&|\|\|)[^<>{}=;\r\n])*)<', $textEval)

    # 3) a line that is plain text only (multi-line JSX text)
    $t = $out.Trim()
    if ($t -match "^[A-Za-z][A-Za-z ,.'&;!?-]*$" -and $t -match '\s' -and $t -notmatch $codeStarters) {
      $out = $out.Replace($t, (Fix-Text $t))
    }
  }

  # 4) quoted sentences (not for className / id / name / key / type / to / href / src / value / role)
  $out = [regex]::Replace($out, '(?<!(?:className|class|id|name|htmlFor|key|type|to|href|src|value|role)=)"([^"<>=;\r\n]*)"', $dqEval)
  $out = [regex]::Replace($out, "(?<![\w])'([^'<>={};\r\n]*)'", $sqEval)
  $out = [regex]::Replace($out, '`([^`\r\n]*)`', $btEval)

  return $out
}

# ---------------------------------------------------------------------------
# Collect files
# ---------------------------------------------------------------------------
$extensions = @('.jsx', '.js', '.tsx', '.ts', '.html')
if ($Backend) { $extensions += '.py' }
$skipDirs = '[\\/](node_modules|dist|build|\.git|\.vscode|migrations|__pycache__|venv|\.venv|env|staticfiles|coverage)[\\/]'

$files = Get-ChildItem -Path $root -Recurse -File | Where-Object {
  ($extensions -contains $_.Extension.ToLower()) -and
  ($_.FullName -notmatch $skipDirs) -and
  ($ExcludeFiles -notcontains $_.Name) -and
  ($_.Name -notmatch '\.min\.|package-lock')
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $root ".backup-medicine-$stamp"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$utf8Bom = New-Object System.Text.UTF8Encoding($true)

$totalChanged = 0
$filesChanged = 0
$leftovers = New-Object System.Collections.Generic.List[string]

Write-Host ""
Write-Host ("Mode: " + $(if ($Apply) { "APPLY (files will be written)" } else { "DRY RUN (nothing is written)" })) -ForegroundColor Cyan
Write-Host ("Scanning " + $files.Count + " files under " + $root) -ForegroundColor Cyan
Write-Host ""

foreach ($f in $files) {
  $raw = [System.IO.File]::ReadAllText($f.FullName)
  if ($raw -notmatch '(?i)medicine') { continue }

  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)

  $markup = @('.jsx', '.tsx', '.html') -contains $f.Extension.ToLower()
  $lines = [regex]::Split($raw, '(?<=\n)')
  $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/')
  $fileChanges = 0

  for ($i = 0; $i -lt $lines.Length; $i++) {
    $old = $lines[$i]
    if ($old -notmatch '(?i)medicine') { continue }

    $new = Fix-Line $old $markup
    if ($new -cne $old) {
      $fileChanges++
      $lines[$i] = $new
      if ($fileChanges -eq 1) { Write-Host $rel -ForegroundColor Yellow }
      Write-Host ("  line {0}" -f ($i + 1)) -ForegroundColor DarkGray
      Write-Host ("  - " + $old.Trim()) -ForegroundColor Red
      Write-Host ("  + " + $new.Trim()) -ForegroundColor Green
    }

    if ($lines[$i] -match '(?i)(?<![\w])medicines?(?![\w])') {
      $leftovers.Add(("{0}:{1}: {2}" -f $rel, ($i + 1), $lines[$i].Trim()))
    }
  }

  if ($fileChanges -gt 0) {
    $filesChanged++
    $totalChanged += $fileChanges
    if ($Apply) {
      $dest = Join-Path $backupDir $rel
      New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
      Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
      $enc = if ($hasBom) { $utf8Bom } else { $utf8NoBom }
      [System.IO.File]::WriteAllText($f.FullName, ($lines -join ''), $enc)
    }
  }
}

# ---------------------------------------------------------------------------
# Summary + review list
# ---------------------------------------------------------------------------
$reportPath = Join-Path $root "medicine-leftovers.txt"
$leftovers | Set-Content -Path $reportPath -Encoding UTF8

Write-Host ""
Write-Host "-------------------------------------------------------------" -ForegroundColor Cyan
Write-Host ("Lines " + $(if ($Apply) { "changed" } else { "that would change" }) + ": $totalChanged in $filesChanged files") -ForegroundColor Cyan
Write-Host ("Lines still containing the word (left on purpose, review them): " + $leftovers.Count) -ForegroundColor Cyan
Write-Host ("List saved to: " + $reportPath) -ForegroundColor Cyan
if ($Apply -and $filesChanged -gt 0) {
  Write-Host ("Backup of the original files: " + $backupDir) -ForegroundColor Cyan
  Write-Host "To undo:  Copy-Item -Recurse -Force '$backupDir\*' '$root'" -ForegroundColor Cyan
}
if (-not $Apply) {
  Write-Host "This was a dry run. Re-run with -Apply to write the changes." -ForegroundColor Yellow
}
Write-Host ""