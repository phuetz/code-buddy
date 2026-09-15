param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [string]$Destination = (Join-Path $env:LOCALAPPDATA ('CodeBuddy-Preview-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
)
$ErrorActionPreference = 'Stop'
# Local preview only: no global package, PATH modification, or existing profile mutation.
$Node = (Get-Command node.exe -ErrorAction Stop).Source
$Npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$Version = & $Node -p 'process.versions.node'
if ([int]($Version.Split('.')[0]) -lt 20) { throw 'Node.js 20 ou supérieur est requis.' }
$Archive = (Resolve-Path -LiteralPath $Archive).Path
if (Test-Path -LiteralPath $Destination) { throw 'Choisir un dossier de destination neuf.' }
New-Item -ItemType Directory -Path $Destination | Out-Null
$LocalArchive = Join-Path $Destination 'code-buddy-preview.tgz'
Copy-Item -LiteralPath $Archive -Destination $LocalArchive
& $Npm install --prefix $Destination --no-audit --no-fund $LocalArchive
if ($LASTEXITCODE -ne 0) { throw "Installation npm échouée ($LASTEXITCODE). Dossier conservé pour diagnostic : $Destination" }
$Entry = Join-Path $Destination 'node_modules/@phuetz/code-buddy/dist/index.js'
if (!(Test-Path -LiteralPath $Entry)) { throw 'Point de lancement du paquet absent.' }
& $Node $Entry --version
if ($LASTEXITCODE -ne 0) { throw 'Le binaire installé ne démarre pas.' }
$Launcher = @'
$ErrorActionPreference = 'Stop'
$ProfileDir = Join-Path $PSScriptRoot 'profil-recette'
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$env:HOME = $ProfileDir
$env:USERPROFILE = $ProfileDir
$env:XDG_CONFIG_HOME = Join-Path $ProfileDir 'config'
$env:XDG_DATA_HOME = Join-Path $ProfileDir 'data'
$Entry = Join-Path $PSScriptRoot 'node_modules/@phuetz/code-buddy/dist/index.js'
& node.exe $Entry @args
exit $LASTEXITCODE
'@
$LauncherPath = Join-Path $Destination 'Demarrer-Code-Buddy.ps1'
Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding UTF8
Write-Host "Préversion installée : $Destination"
Write-Host "Lancer dans un NOUVEAU PowerShell : powershell.exe -NoProfile -File `"$LauncherPath`""
Write-Host 'Profil de recette isolé : connexion et paramètres habituels préservés.'
