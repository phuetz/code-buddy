$ErrorActionPreference = 'SilentlyContinue'

$roots = @(
  'D:\DEV\ComfyUI\venv\Lib\site-packages',
  'D:\DEV\ComfyUI\workflows',
  'D:\DEV\ComfyUI\workflow_library'
)

Get-ChildItem -Path $roots -Recurse -File |
  Where-Object { $_.Name -match 'krea.?2' } |
  ForEach-Object { $_.FullName }

Get-ChildItem -Path $roots -Recurse -File -Include '*.json' |
  Select-String -Pattern 'krea2_turbo|krea2_raw|Krea 2' -List |
  ForEach-Object { $_.Path }
