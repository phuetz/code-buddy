param(
  [string]$RuntimeRoot = 'D:\DEV\Krea2TrainerRuntime',
  [string]$ComfyRoot = 'D:\DEV\ComfyUI',
  [string]$TrainingTask = 'CodeBuddy-Krea2-Lisa-Train',
  [string]$ComfyTask = 'CodeBuddy-ComfyUI',
  [int]$ExpectedSteps = 1000
)

$ErrorActionPreference = 'Stop'
$outputDir = Join-Path $RuntimeRoot 'output\lisa-krea2'
$logPath = Join-Path $RuntimeRoot 'logs\lisa-krea2-training.log'
$expectedName = 'lisa-krea2_{0}.safetensors' -f $ExpectedSteps.ToString('D9')
$candidatePath = Join-Path $outputDir $expectedName
$candidate = Get-Item -LiteralPath $candidatePath -ErrorAction SilentlyContinue

if (-not $candidate) { throw "Final Krea Lisa checkpoint is missing: $candidatePath" }
if ($candidate.Length -lt 1MB) { throw "Checkpoint is unexpectedly small: $($candidate.FullName)" }
if ((Get-Date) - $candidate.LastWriteTime -lt [TimeSpan]::FromSeconds(8)) {
  throw "Checkpoint was written less than 8 seconds ago; wait until the save is stable"
}

$task = Get-ScheduledTask -TaskName $TrainingTask -ErrorAction SilentlyContinue
if ($task -and $task.State -eq 'Running') {
  throw "Training task $TrainingTask is still running; refusing to promote an intermediate checkpoint"
}
$exitLine = Get-Content -LiteralPath $logPath -Tail 40 -ErrorAction SilentlyContinue |
  Select-String -Pattern '^Training exit code: 0$' |
  Select-Object -Last 1
if (-not $exitLine) { throw 'Training log does not contain a successful final exit code' }

$lorasDir = Join-Path $ComfyRoot 'models\loras'
New-Item -ItemType Directory -Force -Path $lorasDir | Out-Null
$destination = Join-Path $lorasDir 'lisa-krea2.safetensors'
$temporary = "$destination.tmp-$([guid]::NewGuid().ToString('N'))"
$backup = $null
$sourceHash = (Get-FileHash -LiteralPath $candidate.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

# ComfyUI may have been restarted by an older training runner. Keep it stopped
# while the LoRA path is replaced, then start it only after hash verification.
Stop-ScheduledTask -TaskName $ComfyTask -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

try {
  Copy-Item -LiteralPath $candidate.FullName -Destination $temporary
  $temporaryHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($temporaryHash -ne $sourceHash) { throw 'Copied checkpoint SHA-256 mismatch' }

  if (Test-Path -LiteralPath $destination) {
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
    $backup = "$destination.backup-$stamp"
    Move-Item -LiteralPath $destination -Destination $backup
  }
  Move-Item -LiteralPath $temporary -Destination $destination
} catch {
  Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  if ($backup -and -not (Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $backup)) {
    Move-Item -LiteralPath $backup -Destination $destination
  }
  throw
}

$installedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
if ($installedHash -ne $sourceHash) { throw 'Installed checkpoint SHA-256 mismatch' }

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
$receipt = [ordered]@{
  schemaVersion = 1
  promotedAt = (Get-Date).ToUniversalTime().ToString('o')
  expectedSteps = $ExpectedSteps
  source = $candidate.FullName
  sourceSha256 = $sourceHash
  installed = $installed.FullName
  installedSha256 = $installedHash
  bytes = $installed.Length
  backup = $backup
}
$receiptPath = Join-Path $outputDir 'promotion-receipt.json'
$receipt | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $receiptPath -Encoding UTF8
Write-Output "Promoted: $($candidate.FullName)"
Write-Output "Installed: $($installed.FullName) ($($installed.Length) bytes, sha256 $installedHash)"
if ($backup) { Write-Output "Previous LoRA preserved: $backup" }
Write-Output "Receipt: $receiptPath"
Write-Output 'ComfyUI ready on http://127.0.0.1:8188'
