param(
  [string]$RuntimeRoot = 'D:\DEV\Krea2TrainerRuntime',
  [string]$ComfyRoot = 'D:\DEV\ComfyUI',
  [string]$TrainingTask = 'CodeBuddy-Krea2-Lisa-Train',
  [string]$ComfyTask = 'CodeBuddy-ComfyUI'
)

$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $RuntimeRoot 'output\lisa-krea2'
$candidate = Get-ChildItem -Path $outputDir -Filter '*.safetensors' -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $candidate) { throw "No Krea Lisa checkpoint found under $outputDir" }
if ($candidate.Length -lt 1MB) { throw "Checkpoint is unexpectedly small: $($candidate.FullName)" }
if ((Get-Date) - $candidate.LastWriteTime -lt [TimeSpan]::FromSeconds(8)) {
  throw "Checkpoint was written less than 8 seconds ago; wait until the save is stable"
}

Stop-ScheduledTask -TaskName $TrainingTask -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$lorasDir = Join-Path $ComfyRoot 'models\loras'
New-Item -ItemType Directory -Force -Path $lorasDir | Out-Null
$destination = Join-Path $lorasDir 'lisa-krea2.safetensors'
Copy-Item -Path $candidate.FullName -Destination $destination -Force

Start-ScheduledTask -TaskName $ComfyTask
$ready = $false
for ($attempt = 1; $attempt -le 90; $attempt++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8188/' -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      $ready = $true
      break
    }
  } catch {
    # Keep polling while the model service starts.
  }
}
if (-not $ready) { throw 'ComfyUI did not become ready within 90 seconds' }

$installed = Get-Item -Path $destination
Write-Output "Promoted: $($candidate.FullName)"
Write-Output "Installed: $($installed.FullName) ($($installed.Length) bytes)"
Write-Output 'ComfyUI ready on http://127.0.0.1:8188'
