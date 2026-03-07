param(
  [ValidateRange(1, 168)]
  [int]$Hours = 24,
  [ValidateRange(0, 100000)]
  [int]$MaxCycles = 0,
  [ValidateRange(0, 600)]
  [int]$PauseSeconds = 5,
  [ValidateSet('mixed', 'e2e-only')]
  [string]$Profile = 'mixed',
  [ValidateRange(1, 1000)]
  [int]$CoverageEveryNCycles = 4,
  [string]$RepoRoot = '',
  [string]$LogRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

if ([string]::IsNullOrWhiteSpace($LogRoot)) {
  $LogRoot = Join-Path $RepoRoot '.custom-output\real-conditions'
}

$e2eFiles = @(
  'test-e2e.mjs',
  'test-e2e-extended.mjs',
  'test-e2e-advanced.mjs'
)

foreach ($testFile in $e2eFiles) {
  $fullPath = Join-Path $RepoRoot $testFile
  if (-not (Test-Path $fullPath)) {
    throw "Missing test file: $fullPath"
  }
}

$todoPath = Join-Path $RepoRoot 'todo.md'
$todoExistedAtStart = Test-Path $todoPath
$todoBaseline = if ($todoExistedAtStart) {
  Get-Content -Path $todoPath -Raw -Encoding UTF8
} else {
  ''
}

function Restore-TodoFile {
  param(
    [string]$Path,
    [bool]$ExistedAtStart,
    [string]$Baseline
  )

  if ($ExistedAtStart) {
    Set-Content -Path $Path -Value $Baseline -Encoding UTF8
    return 'restored'
  }

  if (Test-Path $Path) {
    Remove-Item -Path $Path -Force
    return 'removed'
  }

  return 'unchanged'
}

function New-Step {
  param(
    [string]$Id,
    [string]$Command
  )

  return [pscustomobject]@{
    id      = $Id
    command = $Command
  }
}

function Get-CyclePlan {
  param(
    [int]$Cycle,
    [string]$Mode,
    [int]$CoverageEvery
  )

  if ($Mode -eq 'e2e-only') {
    return @(
      (New-Step -Id 'e2e-basic' -Command 'node test-e2e.mjs'),
      (New-Step -Id 'e2e-extended' -Command 'node test-e2e-extended.mjs'),
      (New-Step -Id 'e2e-advanced' -Command 'node test-e2e-advanced.mjs')
    )
  }

  $bucket = ($Cycle - 1) % 4
  switch ($bucket) {
    0 {
      return @(
        (New-Step -Id 'unit-suite' -Command 'npm test -- tests/unit'),
        (New-Step -Id 'e2e-basic' -Command 'node test-e2e.mjs')
      )
    }
    1 {
      return @(
        (New-Step -Id 'commands-tools-suite' -Command 'npm test -- tests/commands tests/tools'),
        (New-Step -Id 'e2e-extended' -Command 'node test-e2e-extended.mjs')
      )
    }
    2 {
      return @(
        (New-Step -Id 'agent-workflows-suite' -Command 'npm test -- tests/agent tests/workflows tests/reasoning'),
        (New-Step -Id 'e2e-advanced' -Command 'node test-e2e-advanced.mjs')
      )
    }
    default {
      $steps = @(
        (New-Step -Id 'channels-integration-suite' -Command 'npm test -- tests/channels tests/integration'),
        (New-Step -Id 'security-sandbox-suite' -Command 'npm test -- tests/security tests/sandbox')
      )
      if ($Cycle % $CoverageEvery -eq 0) {
        $steps += (New-Step -Id 'coverage-snapshot' -Command 'npm run test:coverage')
      }
      return $steps
    }
  }
}

function Invoke-Step {
  param(
    [string]$Command,
    [string]$StdOutPath,
    [string]$StdErrPath,
    [string]$WorkingDirectory
  )

  $exitCode = 1
  $timedOut = $false

  Push-Location $WorkingDirectory
  try {
    & cmd.exe /c $Command 1>> $StdOutPath 2>> $StdErrPath
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
  } catch {
    $exitCode = 1
    Add-Content -Path $StdErrPath -Value "Exception: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }

  return [pscustomobject]@{
    exitCode = $exitCode
    timedOut = $timedOut
  }
}

function Read-CoverageSummary {
  param([string]$ProjectRoot)

  $summaryPath = Join-Path $ProjectRoot 'coverage\coverage-summary.json'
  if (-not (Test-Path $summaryPath)) {
    return $null
  }

  try {
    $raw = Get-Content -Path $summaryPath -Raw -Encoding UTF8
    $json = $raw | ConvertFrom-Json
    if ($null -eq $json.total) {
      return $null
    }

    return [pscustomobject]@{
      path       = $summaryPath
      lines      = [double]$json.total.lines.pct
      functions  = [double]$json.total.functions.pct
      branches   = [double]$json.total.branches.pct
      statements = [double]$json.total.statements.pct
    }
  } catch {
    return $null
  }
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $LogRoot "run-$stamp"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$runnerLog = Join-Path $runDir 'runner.log'
$cyclesJsonl = Join-Path $runDir 'cycles.jsonl'
$coverageJsonl = Join-Path $runDir 'coverage.jsonl'
$summaryJson = Join-Path $runDir 'summary.json'

$startAt = Get-Date
$endAt = $startAt.AddHours($Hours)

"[$($startAt.ToString('o'))] Starting real-conditions campaign for $Hours hour(s)." |
  Tee-Object -FilePath $runnerLog -Append | Out-Null
"[$($startAt.ToString('o'))] Profile: $Profile" |
  Tee-Object -FilePath $runnerLog -Append | Out-Null
"[$($startAt.ToString('o'))] Coverage snapshot frequency: every $CoverageEveryNCycles cycle(s)." |
  Tee-Object -FilePath $runnerLog -Append | Out-Null
"[$($startAt.ToString('o'))] Max cycles: $(if ($MaxCycles -gt 0) { $MaxCycles } else { 'unlimited' })" |
  Tee-Object -FilePath $runnerLog -Append | Out-Null
"[$($startAt.ToString('o'))] Repo: $RepoRoot" | Tee-Object -FilePath $runnerLog -Append | Out-Null
"[$($startAt.ToString('o'))] Logs: $runDir" | Tee-Object -FilePath $runnerLog -Append | Out-Null

$cycle = 0
$failedCycles = 0
$totalStepFailures = 0
$coverageSnapshots = 0

while ((Get-Date) -lt $endAt -and ($MaxCycles -le 0 -or $cycle -lt $MaxCycles)) {
  $cycle++
  $cycleStartedAt = Get-Date
  $cycleOk = $true
  $steps = New-Object System.Collections.Generic.List[object]

  $cyclePlan = Get-CyclePlan -Cycle $cycle -Mode $Profile -CoverageEvery $CoverageEveryNCycles
  $planNames = ($cyclePlan | ForEach-Object { $_.id }) -join ', '

  "[$($cycleStartedAt.ToString('o'))] === Cycle #$cycle started ===" |
    Tee-Object -FilePath $runnerLog -Append | Out-Null
  "[$($cycleStartedAt.ToString('o'))] Plan: $planNames" |
    Tee-Object -FilePath $runnerLog -Append | Out-Null

  foreach ($step in $cyclePlan) {
    $stepStartedAt = Get-Date
    $stdoutLog = Join-Path $runDir ("cycle-{0:D4}-{1}.out.log" -f $cycle, $step.id)
    $stderrLog = Join-Path $runDir ("cycle-{0:D4}-{1}.err.log" -f $cycle, $step.id)

    "[$($stepStartedAt.ToString('o'))] Running [$($step.id)] $($step.command)" |
      Tee-Object -FilePath $runnerLog -Append | Out-Null

    $result = Invoke-Step `
      -Command $step.command `
      -StdOutPath $stdoutLog `
      -StdErrPath $stderrLog `
      -WorkingDirectory $RepoRoot

    $stepDurationSec = [Math]::Round(((Get-Date) - $stepStartedAt).TotalSeconds, 2)
    $ok = $result.exitCode -eq 0
    if (-not $ok) {
      $cycleOk = $false
      $totalStepFailures++
    }

    $stepRecord = [pscustomobject]@{
      id          = $step.id
      command     = $step.command
      exitCode    = $result.exitCode
      ok          = $ok
      durationSec = $stepDurationSec
      stdoutLog   = $stdoutLog
      stderrLog   = $stderrLog
    }
    $steps.Add($stepRecord) | Out-Null

    "[$((Get-Date).ToString('o'))] Completed [$($step.id)] exit=$($result.exitCode) duration=${stepDurationSec}s" |
      Tee-Object -FilePath $runnerLog -Append | Out-Null

    if ($step.id -eq 'coverage-snapshot' -and $ok) {
      $coverage = Read-CoverageSummary -ProjectRoot $RepoRoot
      if ($null -ne $coverage) {
        $coverageSnapshots++
        $coverageRecord = [pscustomobject]@{
          cycle      = $cycle
          capturedAt = (Get-Date).ToString('o')
          lines      = $coverage.lines
          functions  = $coverage.functions
          branches   = $coverage.branches
          statements = $coverage.statements
          sourcePath = $coverage.path
        }
        $coverageRecord | ConvertTo-Json -Compress | Add-Content -Path $coverageJsonl -Encoding UTF8
        "[$((Get-Date).ToString('o'))] Coverage snapshot: lines=$($coverage.lines)% functions=$($coverage.functions)% branches=$($coverage.branches)% statements=$($coverage.statements)%" |
          Tee-Object -FilePath $runnerLog -Append | Out-Null
      } else {
        "[$((Get-Date).ToString('o'))] Coverage snapshot requested but coverage-summary.json not found." |
          Tee-Object -FilePath $runnerLog -Append | Out-Null
      }
    }
  }

  $cycleFinishedAt = Get-Date
  $cycleDurationSec = [Math]::Round(($cycleFinishedAt - $cycleStartedAt).TotalSeconds, 2)
  if (-not $cycleOk) {
    $failedCycles++
  }

  $cycleRecord = [pscustomobject]@{
    cycle       = $cycle
    startedAt   = $cycleStartedAt.ToString('o')
    finishedAt  = $cycleFinishedAt.ToString('o')
    durationSec = $cycleDurationSec
    ok          = $cycleOk
    steps       = $steps
  }
  $cycleRecord | ConvertTo-Json -Depth 6 -Compress | Add-Content -Path $cyclesJsonl -Encoding UTF8

  $todoAction = Restore-TodoFile -Path $todoPath -ExistedAtStart:$todoExistedAtStart -Baseline $todoBaseline
  "[$((Get-Date).ToString('o'))] Todo baseline action: $todoAction" |
    Tee-Object -FilePath $runnerLog -Append | Out-Null

  "[$($cycleFinishedAt.ToString('o'))] === Cycle #$cycle finished | ok=$cycleOk | duration=${cycleDurationSec}s ===" |
    Tee-Object -FilePath $runnerLog -Append | Out-Null

  if ((Get-Date) -lt $endAt -and $PauseSeconds -gt 0) {
    Start-Sleep -Seconds $PauseSeconds
  }
}

$finishedAt = Get-Date
$totalDurationSec = [Math]::Round(($finishedAt - $startAt).TotalSeconds, 2)
$successfulCycles = $cycle - $failedCycles

$summary = [pscustomobject]@{
  startedAt           = $startAt.ToString('o')
  finishedAt          = $finishedAt.ToString('o')
  requestedHours      = $Hours
  profile             = $Profile
  coverageEveryCycles = $CoverageEveryNCycles
  maxCycles           = $MaxCycles
  totalDurationSec    = $totalDurationSec
  totalCycles         = $cycle
  successfulCycles    = $successfulCycles
  failedCycles        = $failedCycles
  totalStepFailures   = $totalStepFailures
  coverageSnapshots   = $coverageSnapshots
  runnerLog           = $runnerLog
  cyclesJsonl         = $cyclesJsonl
  coverageJsonl       = $coverageJsonl
  runDir              = $runDir
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryJson -Encoding UTF8

"[$($finishedAt.ToString('o'))] Campaign completed." | Tee-Object -FilePath $runnerLog -Append | Out-Null
"[$($finishedAt.ToString('o'))] Summary: $summaryJson" | Tee-Object -FilePath $runnerLog -Append | Out-Null

Write-Host "Campaign completed."
Write-Host "Run directory: $runDir"
Write-Host "Summary: $summaryJson"
