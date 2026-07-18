param(
  [string]$RuntimeRoot = 'D:\DEV\Krea2TrainerRuntime',
  [int]$TimeoutMinutes = 30
)

$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $RuntimeRoot 'output\lisa-krea2'
$logPath = Join-Path $RuntimeRoot 'logs\lisa-krea2-training.log'
$promoteScript = Join-Path $RuntimeRoot 'promote-lisa-krea2-checkpoint.ps1'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)

while ((Get-Date) -lt $deadline) {
  $candidate = Get-ChildItem -Path $outputDir -Filter '*.safetensors' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($candidate -and $candidate.Length -ge 1MB -and
      ((Get-Date) - $candidate.LastWriteTime) -ge [TimeSpan]::FromSeconds(8)) {
    & $promoteScript
    exit $LASTEXITCODE
  }
  if (Test-Path $logPath) {
    $progress = Get-Content -Path $logPath -Tail 8 |
      Select-String -Pattern 'lisa-krea2:' |
      Select-Object -Last 1
    if ($progress) { Write-Output $progress.Line }
  }
  Start-Sleep -Seconds 30
}

throw "Timed out waiting for a Lisa Krea checkpoint under $outputDir"
