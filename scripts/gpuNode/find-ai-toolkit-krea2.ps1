$ErrorActionPreference = 'Stop'

$root = 'D:\DEV\Krea2TrainerRuntime\ai-toolkit'
Get-ChildItem -Path $root -Recurse -File -Include '*.yaml', '*.yml', '*.py' |
  Select-String -Pattern 'krea2' -List |
  ForEach-Object { $_.Path }
