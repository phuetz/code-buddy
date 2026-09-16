$ErrorActionPreference = 'Continue'

schtasks.exe /End /TN 'CodeBuddy-ComfyUI' | Out-Host
Start-Sleep -Seconds 2
schtasks.exe /Run /TN 'CodeBuddy-ComfyUI' | Out-Host

$deadline = (Get-Date).AddSeconds(90)
do {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8188/system_stats' -TimeoutSec 3
    if ($health) {
      Write-Output 'ComfyUI ready on http://127.0.0.1:8188'
      exit 0
    }
  } catch {
    Start-Sleep -Seconds 2
  }
} while ((Get-Date) -lt $deadline)

throw 'ComfyUI did not become ready within 90 seconds'
