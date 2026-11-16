# Baut smartvisu-assist-<version>.vsix ohne Node/vsce und installiert es optional (für die lokale Entwicklung).
# Zum Veröffentlichen im Marketplace bzw. bei Open VSX stattdessen vsce/ovsx verwenden.
#   .\build.ps1            -> nur bauen
#   .\build.ps1 -Install   -> bauen und in VS Code installieren
param([switch]$Install)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$vsix = Join-Path $root "$($pkg.name)-$($pkg.version).vsix"
$files = @('package.json', 'extension.js', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md') +
    (Get-ChildItem $root -File -Filter 'README*.md' | ForEach-Object { $_.Name }) +
    (Get-ChildItem $root -File -Filter 'package.nls*.json' | ForEach-Object { $_.Name }) +
    (Get-ChildItem (Join-Path $root 'lib') -File | ForEach-Object { "lib/$($_.Name)" }) +
    (Get-ChildItem (Join-Path $root 'lib/l10n') -File | ForEach-Object { "lib/l10n/$($_.Name)" }) +
    (Get-ChildItem (Join-Path $root 'lib/shng') -File | ForEach-Object { "lib/shng/$($_.Name)" }) +
    (Get-ChildItem (Join-Path $root 'data') -File -Filter '*.json' | ForEach-Object { "data/$($_.Name)" }) +
    # Screenshots nur fürs README – das lädt sie von GitHub (siehe Convert-ReadmeLinks), im Paket wären sie Ballast
    (Get-ChildItem (Join-Path $root 'media') -File | Where-Object { $_.Name -notlike 'screenshot-*' } | ForEach-Object { "media/$($_.Name)" }) +
    (Get-ChildItem (Join-Path $root 'media/previews') -File -ErrorAction SilentlyContinue | ForEach-Object { "media/previews/$($_.Name)" }) +
    (Get-ChildItem (Join-Path $root 'media/previews/blocks') -File -ErrorAction SilentlyContinue | ForEach-Object { "media/previews/blocks/$($_.Name)" })
# "%description%" aus package.nls.json auflösen
$description = $pkg.description
if ($description -match '^%(.+)%$') {
    $nls = Get-Content (Join-Path $root 'package.nls.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $description = $nls.($Matches[1])
}

$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="$($pkg.name)" Version="$($pkg.version)" Publisher="$($pkg.publisher)" />
    <DisplayName>$($pkg.displayName)</DisplayName>
    <Description xml:space="preserve">$([System.Security.SecurityElement]::Escape($description))</Description>
    <Categories>Programming Languages,Snippets,Other</Categories>
    <Icon>extension/media/icon.png</Icon>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="$($pkg.engines.vscode)" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
"@

$contentTypes = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".txt" ContentType="text/plain" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>
'@

# Die Detailseite einer Erweiterung in VS Code zeigt nur Bilder von https-Adressen und öffnet nur http(s)-Links –
# relative Pfade im README deshalb (wie vsce) auf das GitHub-Repository aus package.json umschreiben:
# Bilder -> .../raw/HEAD/<pfad>, Links -> .../blob/HEAD/<pfad>. Im Repository selbst bleiben sie relativ.
$repoBase = $null
if ($pkg.repository -and $pkg.repository.url -match 'github\.com[/:]([^/]+)/([^/]+?)(\.git)?/?$') {
    $repoBase = "https://github.com/$($Matches[1])/$($Matches[2])"
}
function Convert-ReadmeLinks([string]$text) {
    [regex]::Replace($text, '(!?)\[([^\]]*)\]\((?!https?:|mailto:|#)([^)\s]+)\)', {
        param($m)
        $kind = if ($m.Groups[1].Value) { 'raw' } else { 'blob' }
        "$($m.Groups[1].Value)[$($m.Groups[2].Value)]($repoBase/$kind/HEAD/$($m.Groups[3].Value))"
    })
}

if (Test-Path $vsix) { Remove-Item $vsix }
$zip = [System.IO.Compression.ZipFile]::Open($vsix, 'Create')
try {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    foreach ($entry in @(@('extension.vsixmanifest', $manifest), @('[Content_Types].xml', $contentTypes))) {
        $w = New-Object System.IO.StreamWriter($zip.CreateEntry($entry[0]).Open(), $utf8)
        $w.Write($entry[1]); $w.Close()
    }
    foreach ($f in $files) {
        # Pfade im Zip mit "/" – sonst erkennt VS Code die Dateien nicht
        if ($repoBase -and $f -like 'README*.md') {
            $w = New-Object System.IO.StreamWriter($zip.CreateEntry("extension/$f").Open(), $utf8)
            $w.Write((Convert-ReadmeLinks (Get-Content (Join-Path $root $f) -Raw -Encoding UTF8))); $w.Close()
        } else {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $root $f), "extension/$f") | Out-Null
        }
    }
} finally {
    $zip.Dispose()
}
Write-Host "Gebaut: $vsix"

if ($Install) {
    # code.cmd verträgt kein UNC-Arbeitsverzeichnis (\\smarthomeng\...) – deshalb lokal starten
    Push-Location $root
    try { & code --install-extension $vsix --force } finally { Pop-Location }
}
