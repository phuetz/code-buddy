# setup_a2a_autostart_darkstar.ps1
#
# DARKSTAR — auto-start Ollama + A2A spoke wrapper at logon (User scope, no admin).
#
# Pattern : aligné sur MINISTAR (journal/ministar-grok-cli.md 2026-05-02 ~14h15).
# Source de référence : claude-et-patrice/propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md
# Adaptations DARKSTAR par rapport à la proposition initiale :
#   - User scope (pas Machine) : OLLAMA_HOST + scheduled tasks AtLogon → évite UAC
#   - Ollama mode user-app (pas service Windows) : on lance "ollama app.exe" en task
#   - Wrapper FastAPI = D:\DEV\grok-cli\scripts\ollama_a2a_spoke.py
#     (le wrapper world-model est V0 register-only sans serveur :3002 — ne convient pas)
#   - python.exe absolu = C:\Users\patri\venv\Scripts\python.exe (fastapi/uvicorn déjà installés)
#
# Limite acceptée : le spoke ne sera up qu'après le 1er logon Patrice après reboot.
# Acceptable car DARKSTAR est intermittent par design (le hub 24/7 est Ministar Linux).
#
# Usage : double-clic ou clic droit > Exécuter avec PowerShell. Pas besoin admin.

$ErrorActionPreference = 'Stop'

Write-Host "=== DARKSTAR A2A spoke auto-start setup ===" -ForegroundColor Cyan

# === 0. Pré-requis ===
$ollamaCli     = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
$pythonExe     = "C:\Users\patri\venv\Scripts\python.exe"
$wrapperDir    = "D:\DEV\grok-cli"
$wrapperScript = "scripts\ollama_a2a_spoke.py"

if (-not (Test-Path $ollamaCli))                          { throw "[FAIL] Ollama CLI not found at $ollamaCli" }
if (-not (Test-Path $pythonExe))                          { throw "[FAIL] Python venv not found at $pythonExe" }
if (-not (Test-Path "$wrapperDir\$wrapperScript"))        { throw "[FAIL] Wrapper not found at $wrapperDir\$wrapperScript — git pull origin main first" }

Write-Host "[OK] Pre-reqs found." -ForegroundColor Green

# === 1. OLLAMA_HOST=0.0.0.0:11434 (User scope, sans admin) ===
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
$env:OLLAMA_HOST = "0.0.0.0:11434"  # current session
Write-Host "[OK] OLLAMA_HOST=0.0.0.0:11434 set (User scope)" -ForegroundColor Green

# === 2. Scheduled task : OllamaServer (ollama.exe serve, NOT ollama app.exe systray) ===
# Important : "ollama app.exe" est l'UI systray et ne démarre pas toujours le serveur.
# On utilise directement le CLI "ollama.exe serve" pour un boot fiable headless.
$ollamaAction    = New-ScheduledTaskAction -Execute $ollamaCli -Argument 'serve'
$ollamaTrigger   = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
$ollamaPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$ollamaSettings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
                   -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                   -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Unregister-ScheduledTask -TaskName "OllamaServer" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "OllamaServer" `
    -Description "Ollama LLM server — auto-start at logon for fleet spoke ollama-darkstar. Source: claude-et-patrice/propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md" `
    -Action $ollamaAction -Trigger $ollamaTrigger -Principal $ollamaPrincipal -Settings $ollamaSettings | Out-Null
Write-Host "[OK] OllamaServer scheduled task registered" -ForegroundColor Green

# === 3. Scheduled task : OllamaA2ASpoke ===
$argList = "$wrapperScript --hub http://100.98.18.76:3000 --name ollama-darkstar --url http://100.73.222.64:3002 --port 3002"

$wrapperAction    = New-ScheduledTaskAction -Execute $pythonExe -Argument $argList -WorkingDirectory $wrapperDir
$wrapperTrigger   = New-ScheduledTaskTrigger -AtLogon -User $env:USERNAME
$wrapperPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$wrapperSettings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
                    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Unregister-ScheduledTask -TaskName "OllamaA2ASpoke" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "OllamaA2ASpoke" `
    -Description "A2A spoke wrapper (ollama-darkstar) — auto-start at logon. Source: claude-et-patrice/propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md" `
    -Action $wrapperAction -Trigger $wrapperTrigger -Principal $wrapperPrincipal -Settings $wrapperSettings | Out-Null
Write-Host "[OK] OllamaA2ASpoke scheduled task registered" -ForegroundColor Green

# === 4. Firewall port 3002 (best-effort, no-op si pas admin) ===
try {
    $rule = Get-NetFirewallRule -DisplayName "A2A Spoke 3002" -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -DisplayName "A2A Spoke 3002" -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort 3002 -Profile Private,Domain `
            -Description "A2A FastAPI wrapper for Code Buddy fleet" -ErrorAction Stop | Out-Null
        Write-Host "[OK] Firewall rule added for port 3002" -ForegroundColor Green
    } else {
        Write-Host "[OK] Firewall rule for port 3002 already exists" -ForegroundColor Green
    }
} catch {
    Write-Host "[WARN] Firewall rule needs admin — skipping. If cross-host curl fails on :3002, run this script as Administrator once or run:" -ForegroundColor Yellow
    Write-Host '      New-NetFirewallRule -DisplayName "A2A Spoke 3002" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3002 -Profile Private,Domain' -ForegroundColor Yellow
}

# === 5. Démarrage immédiat des tasks (test) ===
Write-Host "`n=== Starting tasks now ===" -ForegroundColor Cyan
Start-ScheduledTask -TaskName "OllamaServer"
Start-Sleep -Seconds 5
Start-ScheduledTask -TaskName "OllamaA2ASpoke"
Start-Sleep -Seconds 4

Get-ScheduledTask -TaskName "OllamaServer", "OllamaA2ASpoke" | Get-ScheduledTaskInfo |
    Select-Object @{N='Task';E={$_.TaskName}}, LastRunTime, LastTaskResult, NextRunTime | Format-Table -AutoSize

# === 6. Validation HTTP ===
Write-Host "=== Validation ===" -ForegroundColor Cyan
function Probe([string]$label, [string]$url) {
    try { $r = Invoke-WebRequest -Uri $url -TimeoutSec 5 -UseBasicParsing; "  [OK]   $label  (HTTP $($r.StatusCode))" }
    catch { "  [FAIL] $label  ($($_.Exception.Message))" }
}
Probe 'Ollama local'    'http://127.0.0.1:11434/api/tags'
Probe 'Ollama tailnet'  'http://100.73.222.64:11434/api/tags'
Probe 'Spoke local'     'http://127.0.0.1:3002/api/a2a/.well-known/agent.json'
Probe 'Spoke tailnet'   'http://100.73.222.64:3002/api/a2a/.well-known/agent.json'
Probe 'Hub agents'      'http://100.98.18.76:3000/api/a2a/agents'

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Spoke wrapper logs: check Task Scheduler -> OllamaA2ASpoke -> History tab"
Write-Host "Or run interactively to debug: cd $wrapperDir; & '$pythonExe' $argList"
