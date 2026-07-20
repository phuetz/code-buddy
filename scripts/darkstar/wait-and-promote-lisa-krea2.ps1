param(
  [string]$RuntimeRoot = 'D:\DEV\Krea2TrainerRuntime',
  [string]$TrainingTask = 'CodeBuddy-Krea2-Lisa-Train',
  [int]$ExpectedSteps = 1000,
  [int]$TimeoutMinutes = 180
)

$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $RuntimeRoot 'output\lisa-krea2'
$logPath = Join-Path $RuntimeRoot 'logs\lisa-krea2-training.log'
$promoteScript = Join-Path $RuntimeRoot 'promote-lisa-krea2-checkpoint.ps1'
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$expectedName = 'lisa-krea2_{0}.safetensors' -f $ExpectedSteps.ToString('D9')

while ((Get-Date) -lt $deadline) {
  $task = Get-ScheduledTask -TaskName $TrainingTask -ErrorAction SilentlyContinue
  $trainingRunning = $task -and $task.State -eq 'Running'
  if (Test-Path $logPath) {
    $progress = Get-Content -Path $logPath -Tail 8 |
      Select-String -Pattern 'lisa-krea2:' |
      Select-Object -Last 1
    if ($progress) { Write-Output $progress.Line }

    $exitLine = Get-Content -Path $logPath -Tail 40 |
      Select-String -Pattern '^Training exit code: (-?\d+)$' |
      Select-Object -Last 1
    if (-not $trainingRunning -and $exitLine) {
      $exitCode = [int]$exitLine.Matches[0].Groups[1].Value
      if ($exitCode -ne 0) { throw "Lisa Krea training failed with exit code $exitCode" }
      $candidate = Join-Path $outputDir $expectedName
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Training exited successfully but final checkpoint is missing: $candidate"
      }
      & $promoteScript -ExpectedSteps $ExpectedSteps
      exit $LASTEXITCODE
    }
  }
  Start-Sleep -Seconds 30
}

throw "Timed out waiting for completed Lisa Krea training and $expectedName"
