$ErrorActionPreference = 'Continue'

Get-Process python -ErrorAction SilentlyContinue |
  Select-Object Id, CPU, WorkingSet, StartTime, Path |
  Format-Table -AutoSize

Get-PSDrive D |
  Select-Object Used, Free |
  Format-List

Get-ChildItem `
  -Path 'D:\DEV\Krea2TrainerRuntime\models', 'D:\DEV\ComfyUI\models' `
  -Recurse `
  -File `
  -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'krea|qwen|incomplete' } |
  ForEach-Object {
    '{0}`t{1:N3} GiB`t{2:O}' -f $_.FullName, ($_.Length / 1GB), $_.LastWriteTime
  }
