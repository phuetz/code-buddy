# Start ComfyUI on Darkstar for Lisa / Code Buddy (listen on all interfaces).
# Prefer GPU 1 so GPU 0 can keep Voicebox / Ollama warm.
param(
  [int]$Gpu = 1,
  [int]$Port = 8188,
  [string]$ComfyRoot = "D:\DEV\ComfyUI",
  [string]$LogDir = "D:\DEV\ComfyUI\logs",
  [string]$TaskName = "CodeBuddy-ComfyUI"
)

$ErrorActionPreference = "Stop"
$python = Join-Path $ComfyRoot "venv\Scripts\python.exe"
$main = Join-Path $ComfyRoot "main.py"

if (-not (Test-Path $python)) { throw "Missing $python" }
if (-not (Test-Path $main)) { throw "Missing $main" }

$env:CUDA_VISIBLE_DEVICES = "$Gpu"
$env:PYTORCH_CUDA_ALLOC_CONF = "expandable_segments:True"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$stdoutLog = Join-Path $LogDir "comfyui-$Port.out.log"
$stderrLog = Join-Path $LogDir "comfyui-$Port.err.log"
Write-Host "Starting ComfyUI on GPU $Gpu port $Port (0.0.0.0)…"
Write-Host "Root: $ComfyRoot"

# Windows OpenSSH can close or invalidate inherited console handles after the
# SSH session ends. Register a real background task so ComfyUI owns a stable
# lifetime and file-backed streams; otherwise tqdm may raise OSError 22 from
# KSampler and every later image generation fails.
$runnerPath = Join-Path $ComfyRoot "run-codebuddy-comfyui-$Port.cmd"
$runner = @(
  '@echo off',
  "set CUDA_VISIBLE_DEVICES=$Gpu",
  'set PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True',
  ('cd /d "{0}"' -f $ComfyRoot),
  ('"{0}" "{1}" --listen 0.0.0.0 --port {2} --disable-auto-launch 1>>"{3}" 2>>"{4}"' -f `
    $python, $main, $Port, $stdoutLog, $stderrLog)
) -join "`r`n"
Set-Content -Path $runnerPath -Value $runner -Encoding Ascii

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction `
  -Execute 'cmd.exe' `
  -Argument ('/d /c "{0}"' -f $runnerPath) `
  -WorkingDirectory $ComfyRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal `
  -UserId $currentUser `
  -LogonType Interactive `
  -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  $existing | Stop-ScheduledTask -ErrorAction SilentlyContinue
}
Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Code Buddy ComfyUI inference server for Lisa selfies' `
  -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$task = Get-ScheduledTask -TaskName $TaskName
if ($task.State -notin @('Running', 'Ready')) {
  throw "ComfyUI scheduled task entered unexpected state: $($task.State)"
}

Write-Host "ComfyUI task started ($TaskName, state $($task.State))"
Write-Host "stdout: $stdoutLog"
Write-Host "stderr: $stderrLog"
