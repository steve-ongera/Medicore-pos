# rename-medicine-to-product.ps1
#
# Frontend-only update for a GENERAL POS (not pharmacy):
#   1. Renames components/MedicineSearch.jsx -> ProductSearch.jsx and updates every import / usage.
#   2. Renames the exported helpers (MedicineEditModal -> ProductEditModal, etc.) everywhere.
#   3. Replaces profile.item / profile.Item / profile.items with product / Product / products
#      (so a shop whose business type is PHARMACY no longer shows "medicine").
#   4. Fixes a few hardcoded phrases ("Add new medicine" -> "Add new product", ...).
#   5. OPTIONAL (-UseProductsApi): points api.js at the /products/ and /product-batches/ aliases
#      your backend urls.py already registers.
#
# It does NOT touch: API function names (getMedicines...), payload keys (medicine: id),
# CSS classes, backend field names, or any logic. A full backup of src is made first.
#
# Run from your frontend folder:
#   powershell -ExecutionPolicy Bypass -File .\rename-medicine-to-product.ps1 -DryRun
#   powershell -ExecutionPolicy Bypass -File .\rename-medicine-to-product.ps1
#   powershell -ExecutionPolicy Bypass -File .\rename-medicine-to-product.ps1 -UseProductsApi

[CmdletBinding()]
param(
  [string]$SrcPath = ".\src",
  [switch]$UseProductsApi,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$src = (Resolve-Path $SrcPath).Path
$root = Split-Path $src -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)

Write-Host ""
Write-Host "Source folder: $src" -ForegroundColor Cyan
if ($DryRun) { Write-Host "DRY RUN: nothing will be written." -ForegroundColor Yellow }

# ---------------------------------------------------------------- backup
if (-not $DryRun) {
  $backup = Join-Path $root ("src_backup_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  Copy-Item -Path $src -Destination $backup -Recurse
  Write-Host "Backup created: $backup" -ForegroundColor Green
}

# ---------------------------------------------------------------- rules
# 1) identifiers / file name (word-boundary, case-sensitive)
$identifiers = @(
  @("MedicineSearch",      "ProductSearch"),
  @("MedicineEditModal",   "ProductEditModal"),
  @("MedicineAddModal",    "ProductAddModal"),
  @("useCanEditMedicine",  "useCanEditProduct"),
  @("clearMedicineCache",  "clearProductCache"),
  @("onMedicineUpdated",   "onProductUpdated"),
  @("onMedicineCreated",   "onProductCreated")
)

# 2) hardcoded phrases (exact, case-sensitive)
$phrases = @(
  @("Add new medicine",   "Add new product"),
  @("Add New Medicine",   "Add New Product"),
  @("Add medicine",       "Add product"),
  @("Add Medicine",       "Add Product"),
  @("Find medicine",      "Find product"),
  @("Find Medicine",      "Find Product"),
  @("Search medicine",    "Search product"),
  @("Search Medicine",    "Search Product"),
  @("Tap a medicine",     "Tap a product"),
  @("tap a medicine",     "tap a product"),
  @("Edit medicine",      "Edit product"),
  @("Edit Medicine",      "Edit Product"),
  @("No medicines found", "No products found"),
  @("No medicines in",    "No products in"),
  @("Loading medicines",  "Loading products"),
  @("a medicine name",    "a product name")
)

function Get-Word([string]$key) {
  switch -CaseSensitive ($key) {
    "Item"  { return "Product" }
    "Items" { return "Products" }
    "item"  { return "product" }
    "items" { return "products" }
  }
}

$ev  = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) Get-Word $m.Groups[1].Value }
$evA = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) '="' + (Get-Word $m.Groups[1].Value) + '"' }
$evB = [System.Text.RegularExpressions.MatchEvaluator]{ param($m) '"' + (Get-Word $m.Groups[1].Value) + '"' }

$k = '(Items|items|Item|item)'

# ---------------------------------------------------------------- run
$files = Get-ChildItem -Path $src -Recurse -File -Include *.js,*.jsx,*.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' }

$changedFiles = 0
foreach ($f in $files) {
  $orig = [System.IO.File]::ReadAllText($f.FullName)
  $text = $orig

  foreach ($pair in $identifiers) {
    $text = [regex]::Replace($text, ('\b' + [regex]::Escape($pair[0]) + '\b'), $pair[1])
  }

  # profile.item wording (order matters)
  $text = [regex]::Replace($text, ('\$\{profile\.' + $k + '\}'), $ev)    # `...${profile.item}...`
  $text = [regex]::Replace($text, ('=\{profile\.' + $k + '\}'), $evA)    # attr={profile.item}
  $text = [regex]::Replace($text, ('\{profile\.' + $k + '\}'), $ev)      # JSX text {profile.item}
  $text = [regex]::Replace($text, ('\bprofile\.' + $k + '\b'), $evB)     # bare expression

  foreach ($pair in $phrases) {
    $text = $text.Replace($pair[0], $pair[1])
  }

  # optional: point the API client at the /products/ aliases
  if ($UseProductsApi -and $f.FullName -match '\\services\\api\.(js|ts)$') {
    $text = [regex]::Replace($text, '(["''`])/medicine-batches/', '$1/product-batches/')
    $text = [regex]::Replace($text, '(["''`])/medicines/', '$1/products/')
  }

  if ($text -ne $orig) {
    $changedFiles++
    Write-Host ("  updated: " + $f.FullName.Substring($src.Length + 1)) -ForegroundColor Green
    if (-not $DryRun) { [System.IO.File]::WriteAllText($f.FullName, $text, $utf8) }
  }
}

# ---------------------------------------------------------------- file rename
$old = Join-Path $src "components\MedicineSearch.jsx"
$new = Join-Path $src "components\ProductSearch.jsx"
if (Test-Path $old) {
  if (Test-Path $new) {
    Write-Host "ProductSearch.jsx already exists - NOT renaming MedicineSearch.jsx. Check manually." -ForegroundColor Red
  } else {
    Write-Host "  renamed: components\MedicineSearch.jsx -> components\ProductSearch.jsx" -ForegroundColor Green
    if (-not $DryRun) { Rename-Item -Path $old -NewName "ProductSearch.jsx" }
  }
} else {
  Write-Host "components\MedicineSearch.jsx not found (already renamed?)." -ForegroundColor Yellow
}

# ---------------------------------------------------------------- review list
# Remaining "medicine" words that look like screen text (inside quotes / JSX text).
$reportPath = Join-Path $root "medicine-wording-review.txt"
$pattern = '(["''`>])[^"''`<>]*\b[Mm]edicines?\b[^"''`<>]*["''`<]'
$hits = @()
$scanFiles = Get-ChildItem -Path $src -Recurse -File -Include *.js,*.jsx,*.ts,*.tsx |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' }
foreach ($f in $scanFiles) {
  $n = 0
  foreach ($line in [System.IO.File]::ReadAllLines($f.FullName)) {
    $n++
    if ($line -match $pattern -and $line -notmatch '/medicines?/|/medicine-batches/|^\s*(import|//)') {
      $hits += ($f.FullName.Substring($src.Length + 1) + ":" + $n + ":  " + $line.Trim())
    }
  }
}
if (-not $DryRun) { $hits | Set-Content -Path $reportPath -Encoding UTF8 }

Write-Host ""
Write-Host "Files changed: $changedFiles" -ForegroundColor Cyan
Write-Host ("Lines still mentioning 'medicine' as text: " + $hits.Count) -ForegroundColor Cyan
if (-not $DryRun) { Write-Host "Review list saved to: $reportPath" }
Write-Host ""
Write-Host "Next: run  npm run build  (or npm run dev) and click through Walk-in Sale, search, edit and add." -ForegroundColor Cyan
Write-Host "To undo: delete src and copy the src_backup_* folder back as src." -ForegroundColor DarkGray