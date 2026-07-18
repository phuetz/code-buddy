param(
  [int]$Gpu = 1,
  [string]$RuntimeRoot = 'D:\DEV\Krea2TrainerRuntime',
  [string]$TaskName = 'CodeBuddy-Krea2-Lisa-Train'
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $RuntimeRoot 'venv\Scripts\python.exe'
$toolkit = Join-Path $RuntimeRoot 'ai-toolkit'
$config = Join-Path $RuntimeRoot 'configs\lisa-krea2.yaml'
$logDir = Join-Path $RuntimeRoot 'logs'
$log = Join-Path $logDir 'lisa-krea2-training.log'
$runner = Join-Path $RuntimeRoot 'run-lisa-krea2-training.cmd'

foreach ($required in @($python, (Join-Path $toolkit 'run.py'), $config)) {
  if (-not (Test-Path $required)) { throw "Missing $required" }
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$lines = @(
  '@echo off',
  "set CUDA_VISIBLE_DEVICES=$Gpu",
  "set HF_HOME=$RuntimeRoot\hf_cache",
  "set PYTHONPATH=$toolkit",
  'set PYTHONUTF8=0',
  'set PYTHONIOENCODING=utf-8',
  'set NO_ALBUMENTATIONS_UPDATE=1',
  ('cd /d "{0}"' -f $toolkit),
  ('"{0}" "{1}" "{2}" 1>"{3}" 2>&1' -f $python, (Join-Path $toolkit 'run.py'), $config, $log),
  'set TRAIN_EXIT=%ERRORLEVEL%',
  ('echo.>>"{0}"' -f $log),
  ('echo Training exit code: %TRAIN_EXIT%>>"{0}"' -f $log),
  ('schtasks.exe /Run /TN "CodeBuddy-ComfyUI" >>"{0}" 2>&1' -f $log),
  'exit /b %TRAIN_EXIT%'
)
Set-Content -Path $runner -Value ($lines -join "`r`n") -Encoding Ascii

# Free the 24 GB card used by ComfyUI. Lisa remains available through the
# Ministar SD Turbo fallback during training.
schtasks.exe /End /TN 'CodeBuddy-ComfyUI' | Out-Host
Start-Sleep -Seconds 3

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/d /c "{0}"' -f $runner) -WorkingDirectory $toolkit
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Principal $principal `
  -Settings $settings `
  -Description 'Train Lisa identity LoRA on Krea 2 Raw; restart ComfyUI when complete' `
  -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

$task = Get-ScheduledTask -TaskName $TaskName
Write-Output "Training task $TaskName state: $($task.State)"
Write-Output "Log: $log"
