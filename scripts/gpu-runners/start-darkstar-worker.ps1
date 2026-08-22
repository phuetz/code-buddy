[CmdletBinding()]
param(
  [string]$BindHost = '100.73.222.64',
  [int]$Port = 4310,
  [string]$Repo = 'D:\DEV\code-buddy-gpu-worker',
  [string]$NodeDir = 'D:\DEV\_third_party\node-v22.23.1-win-x64',
  [string]$StateDir = 'D:\CodeBuddyData\gpu-worker',
  [string]$TokenFile = 'D:\CodeBuddyData\gpu-worker\token',
  [string]$LongCatReadyFile = 'D:\CodeBuddyData\gpu-worker\longcat-ready',
  [ValidateRange(0, 600)]
  [int]$BindWaitSeconds = 120
)

$ErrorActionPreference = 'Stop'
$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
if ([Text.Encoding]::UTF8.GetByteCount($token) -lt 24) {
  throw 'The GPU worker token file must contain at least 24 bytes.'
}

$runner = Join-Path $Repo 'scripts\gpu-runners\panoworld-wsl.sh'
$longcatRunner = Join-Path $Repo 'scripts\gpu-runners\longcat-wsl.sh'
$longcatAdapter = Join-Path $Repo 'scripts\gpu-runners\longcat-runner.py'
$longcatInference = Join-Path $Repo 'scripts\gpu-runners\longcat-lowmem-inference.py'
$node = Join-Path $NodeDir 'node.exe'
$entrypoint = Join-Path $Repo 'dist\index.js'
foreach ($path in @($runner, $node, $entrypoint)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required worker file does not exist: $path"
  }
}

$roots = @('D:\DEV', 'D:\CodeBuddyData', 'D:\LisaMedia') |
  Where-Object { Test-Path -LiteralPath $_ -PathType Container }
if ($roots.Count -eq 0) {
  throw 'No GPU worker filesystem root is available.'
}

# Scheduled tasks can start before Tailscale has restored its interface after a
# reboot. Wait for the configured private address instead of exiting once and
# leaving the worker stopped until a human notices.
if ($BindHost -notin @('0.0.0.0', '127.0.0.1', '::', '::1') -and $BindWaitSeconds -gt 0) {
  $deadline = [DateTime]::UtcNow.AddSeconds($BindWaitSeconds)
  while (-not (Get-NetIPAddress -IPAddress $BindHost -ErrorAction SilentlyContinue)) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw "GPU worker bind address did not become available within $BindWaitSeconds seconds: $BindHost"
    }
    Start-Sleep -Seconds 2
  }
}

$env:CODEBUDDY_GPU_WORKER_TOKEN = $token
$env:CODEBUDDY_GPU_MAX_TEMP_C = '88'
$env:CODEBUDDY_PANOWORLD_RUNNER = 'C:\Windows\System32\wsl.exe'
$env:CODEBUDDY_PANOWORLD_RUNNER_ARGS = @(
  '-d',
  'Ubuntu-22.04',
  '--',
  'bash',
  '/mnt/d/DEV/code-buddy-gpu-worker/scripts/gpu-runners/panoworld-wsl.sh'
) | ConvertTo-Json -Compress
Remove-Item Env:CODEBUDDY_LONGCAT_RUNNER -ErrorAction SilentlyContinue
Remove-Item Env:CODEBUDDY_LONGCAT_RUNNER_ARGS -ErrorAction SilentlyContinue
Remove-Item Env:CODEBUDDY_LONGCAT_RUNNER_REVISION -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $LongCatReadyFile -PathType Leaf) {
  $longcatReady = Get-Content -LiteralPath $LongCatReadyFile -Raw | ConvertFrom-Json
  if (
    $longcatReady.runnerVersion -ne '2' -or
    $longcatReady.upstreamCommit -ne '6b3f4b8582a8bc3f20f795735f5383716c4ba794' -or
    $longcatReady.avatarRevision -ne '92016c71d5d318d0f5d84e4db30015a571484ab6' -or
    $longcatReady.baseRevision -ne '03b55529b1d1d4045f5fbe14d65c8c6e8116b278'
  ) {
    throw 'LongCat readiness marker does not match the deployed runner and checkpoints.'
  }
  foreach ($longcatFile in @($longcatRunner, $longcatAdapter, $longcatInference)) {
    if (-not (Test-Path -LiteralPath $longcatFile -PathType Leaf)) {
      throw "LongCat readiness marker exists but a runner component is missing: $longcatFile"
    }
  }
  $env:CODEBUDDY_LONGCAT_RUNNER = 'C:\Windows\System32\wsl.exe'
  $env:CODEBUDDY_LONGCAT_RUNNER_ARGS = @(
    '-d',
    'Ubuntu-22.04',
    '--',
    'bash',
    '/mnt/d/DEV/code-buddy-gpu-worker/scripts/gpu-runners/longcat-wsl.sh'
  ) | ConvertTo-Json -Compress
  $revisionMaterial = @(
    $longcatReady.runnerVersion,
    $longcatReady.upstreamCommit,
    $longcatReady.avatarRevision,
    $longcatReady.baseRevision,
    (Get-FileHash -LiteralPath $longcatRunner -Algorithm SHA256).Hash.ToLowerInvariant(),
    (Get-FileHash -LiteralPath $longcatAdapter -Algorithm SHA256).Hash.ToLowerInvariant(),
    (Get-FileHash -LiteralPath $longcatInference -Algorithm SHA256).Hash.ToLowerInvariant()
  ) -join ':'
  $revisionSha = [Security.Cryptography.SHA256]::Create()
  try {
    $revisionBytes = [Text.Encoding]::UTF8.GetBytes($revisionMaterial)
    $env:CODEBUDDY_LONGCAT_RUNNER_REVISION = (
      [BitConverter]::ToString($revisionSha.ComputeHash($revisionBytes))
    ).Replace('-', '').ToLowerInvariant()
  } finally {
    $revisionSha.Dispose()
  }
}
$forwarded = 'CODEBUDDY_GPU_JOB_REQUEST/p:CODEBUDDY_GPU_JOB_RESULT/p:CODEBUDDY_GPU_JOB_ID:CODEBUDDY_GPU_ALLOWED_ROOTS_JSON:CODEBUDDY_GPU_MAX_TEMP_C'
$env:WSLENV = if ($env:WSLENV) { "${env:WSLENV}:$forwarded" } else { $forwarded }

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
Set-Location -LiteralPath $Repo
$arguments = @(
  $entrypoint,
  'gpu-worker',
  '--host',
  $BindHost,
  '--port',
  [string]$Port,
  '--state-dir',
  $StateDir,
  '--worker-id',
  'darkstar',
  '--max-concurrency',
  '1',
  '--root'
) + $roots
& $node @arguments
exit $LASTEXITCODE
