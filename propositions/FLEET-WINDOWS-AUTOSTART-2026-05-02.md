# Fleet Windows hosts — Auto-start des services au démarrage Windows

> **Auteur** : Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 2026-05-02 ~13h45 UTC (révisé 14h00 pour scope MINISTAR)
> **Pour** : Claude/DARKSTAR + Patrice (et toute future host Windows du fleet)
> **Statut** : proposition — attendre ratification DARKSTAR avant exécution sur sa machine ; côté MINISTAR la décision est de Patrice (cette machine = mon host courant).

---

## Pourquoi

**Observé 2026-05-02 ~13h** : Windows update sur DARKSTAR a redémarré la machine et tué :
1. Le wrapper Python `ollama_a2a_spoke.py` (FastAPI :3002) → spoke disparait du mesh
2. Potentiellement Ollama si pas configuré en service

Conséquence : le hub Ministar Linux voit `ollama-darkstar` registered (le heartbeat n'avait pas encore expiré) mais `fetch http://100.73.222.64:3002` timeout. Le smoke cross-host POC Niveau 2 échoue avec "fetch failed" malgré le router fix livré côté hub (commit `8a9f5f4`).

**À résoudre** : tout host Windows du fleet doit redevenir spoke A2A automatiquement après n'importe quel reboot (Windows update mensuel, crash, intervention humaine). Pas d'intervention manuelle requise.

**MINISTAR aussi** : Patrice a constaté qu'Ollama tourne sur MINISTAR (PID `ollama app.exe` actif, modèle `qwen2.5-coder:32b` dispo, mais bind localhost-only). MINISTAR peut donc devenir un 2e spoke GPU/CPU du fleet. Même problématique de résilience reboot Windows.

---

## Approche commune (les deux hosts)

**Task Scheduler** avec trigger "At system startup", run as `SYSTEM` (pas besoin que Patrice soit logged in). Auto-restart sur crash via les options builtin.

NSSM (Non-Sucking Service Manager) est une alternative plus propre (vrai service Windows) mais nécessite install package séparé. Task Scheduler suffit pour V0.1 — section "Alternative" en fin de doc.

3 composants à démarrer dans l'ordre, identique sur DARKSTAR et MINISTAR :

1. **Ollama service Windows** avec `OLLAMA_HOST=0.0.0.0:11434` pour bind tailnet (par défaut bind 127.0.0.1 → invisible aux autres machines).
2. **Wrapper FastAPI** `ollama_a2a_spoke.py` qui register au hub + heartbeat 30s.
3. **(Optionnel)** Firewall port 3002 inbound — déjà fait sur DARKSTAR (script `enable_a2a_firewall.ps1`), à vérifier sur MINISTAR.

Différences entre les 2 hosts :
| Item | DARKSTAR | MINISTAR |
|---|---|---|
| Tailscale IP | 100.73.222.64 | 100.90.108.4 |
| Spoke name | `ollama-darkstar` | `ollama-ministar` |
| Spoke port | 3002 | 3002 (même port — pas de collision car local à chaque machine) |
| Wrapper path | `D:\DEV\world-model\scripts\ollama_a2a_spoke.py` | `D:\CascadeProjects\grok-cli\scripts\ollama_a2a_spoke.py` |
| Modèles dispo | qwen3.6:35b, gemma4:26b, qwen3:4b, nomic-embed | qwen2.5-coder:32b (à confirmer si autres) |

---

## DARKSTAR — script d'installation

À exécuter une fois en **PowerShell Admin** sur DARKSTAR :

```powershell
# === 1. Ollama bind 0.0.0.0 ===
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
$ollamaSvc = Get-Service -Name "Ollama" -ErrorAction SilentlyContinue
if ($ollamaSvc) {
    Restart-Service -Name "Ollama"
    Write-Host "[OK] Ollama service restarted with OLLAMA_HOST=0.0.0.0:11434"
} else {
    Write-Warning "[WARN] Ollama service not found. Run OllamaSetup.exe first."
}

# === 2. Register Task Scheduler pour le wrapper FastAPI ===
$wrapperDir = "D:\DEV\world-model"
$wrapperScript = "scripts\ollama_a2a_spoke.py"
$pythonExe = (Get-Command python.exe).Source

if (-not (Test-Path "$wrapperDir\$wrapperScript")) {
    Write-Error "Wrapper script not found at $wrapperDir\$wrapperScript"
    exit 1
}

$argList = "$wrapperScript --hub http://100.98.18.76:3000 --name ollama-darkstar --url http://100.73.222.64:3002 --port 3002"

$action    = New-ScheduledTaskAction -Execute $pythonExe -Argument $argList -WorkingDirectory $wrapperDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
             -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
             -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Unregister-ScheduledTask -TaskName "OllamaA2ASpoke" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "OllamaA2ASpoke" -Description "A2A spoke wrapper for Code Buddy fleet — auto-start at boot. Source: claude-et-patrice/propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md" `
    -Action $action -Trigger $trigger -Principal $principal -Settings $settings

# === 3. Test immediate start ===
Start-ScheduledTask -TaskName "OllamaA2ASpoke"
Start-Sleep -Seconds 3
Get-ScheduledTask -TaskName "OllamaA2ASpoke" | Get-ScheduledTaskInfo |
    Select-Object LastRunTime, LastTaskResult, NumberOfMissedRuns, NextRunTime |
    Format-List
```

À sauver sous `setup_a2a_autostart_darkstar.ps1` sur Bureau OneDrive de Patrice. Double-clic admin = installé.

---

## MINISTAR — script d'installation

À exécuter une fois en **PowerShell Admin** sur MINISTAR (cette machine, hostname G7 PT, tailnet `100.90.108.4`).

⚠️ **Pré-requis spécifiques MINISTAR** :
- Ollama est installé en mode "user app" (pas service Windows) — `C:\Users\patri\AppData\Local\Programs\Ollama\ollama.exe`. Bind 127.0.0.1 par défaut. Pour exposer au tailnet, soit **réinstaller en mode service** (recommandé), soit lancer Ollama via Task Scheduler aussi.
- Le repo `code-buddy` est à `D:\CascadeProjects\grok-cli`. Le wrapper `ollama_a2a_spoke.py` y est dans `scripts/` (commit `8195ccf`).
- Firewall port 3002 inbound : à vérifier (probablement pas encore ouvert sur MINISTAR — DARKSTAR avait reçu son script dédié).

### Script PowerShell

```powershell
# === 0. Firewall port 3002 inbound (CGNAT-Tailscale only) ===
$rule = Get-NetFirewallRule -DisplayName "A2A Spoke 3002" -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -DisplayName "A2A Spoke 3002" -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort 3002 -Profile Private,Domain `
        -Description "A2A FastAPI wrapper for Code Buddy fleet"
    Write-Host "[OK] Firewall rule added for port 3002"
} else {
    Write-Host "[OK] Firewall rule for port 3002 already exists"
}

# === 1. Ollama : env var bind 0.0.0.0 (machine scope) ===
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "Machine")
Write-Host "[OK] OLLAMA_HOST=0.0.0.0:11434 set machine-wide"

# === 2. Ollama auto-start via Task Scheduler (mode user app, pas service) ===
$ollamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
if (-not (Test-Path $ollamaExe)) {
    Write-Error "Ollama not found at $ollamaExe — install OllamaSetup.exe first"
    exit 1
}

$ollamaAction    = New-ScheduledTaskAction -Execute $ollamaExe
$ollamaTrigger   = New-ScheduledTaskTrigger -AtStartup
$ollamaPrincipal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
$ollamaSettings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
                   -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                   -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Unregister-ScheduledTask -TaskName "OllamaServer" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "OllamaServer" `
    -Description "Ollama LLM server — auto-start at boot for fleet spoke. Source: claude-et-patrice/propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md" `
    -Action $ollamaAction -Trigger $ollamaTrigger -Principal $ollamaPrincipal -Settings $ollamaSettings

Write-Host "[OK] OllamaServer scheduled task registered"

# === 3. Wrapper FastAPI ===
$wrapperDir    = "D:\CascadeProjects\grok-cli"
$wrapperScript = "scripts\ollama_a2a_spoke.py"
$pythonExe     = (Get-Command python.exe).Source

if (-not (Test-Path "$wrapperDir\$wrapperScript")) {
    Write-Error "Wrapper not found at $wrapperDir\$wrapperScript — git pull origin main first"
    exit 1
}

$argList = "$wrapperScript --hub http://100.98.18.76:3000 --name ollama-ministar --url http://100.90.108.4:3002 --port 3002"

$wrapperAction    = New-ScheduledTaskAction -Execute $pythonExe -Argument $argList -WorkingDirectory $wrapperDir
$wrapperTrigger   = New-ScheduledTaskTrigger -AtStartup
$wrapperPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$wrapperSettings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
                    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
                    -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Unregister-ScheduledTask -TaskName "OllamaA2ASpoke" -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName "OllamaA2ASpoke" `
    -Description "A2A spoke wrapper (ollama-ministar) — auto-start at boot. Source: claude-et-patrice/propositions/FLEET-WINDOWS-AUTOSTART-2026-05-02.md" `
    -Action $wrapperAction -Trigger $wrapperTrigger -Principal $wrapperPrincipal -Settings $wrapperSettings

# === 4. Tests immédiats ===
Start-ScheduledTask -TaskName "OllamaServer"
Start-Sleep -Seconds 5
Start-ScheduledTask -TaskName "OllamaA2ASpoke"
Start-Sleep -Seconds 3

Get-ScheduledTask -TaskName "OllamaServer", "OllamaA2ASpoke" | Get-ScheduledTaskInfo |
    Select-Object TaskName, LastRunTime, LastTaskResult, NumberOfMissedRuns, NextRunTime |
    Format-Table
```

À sauver sous `setup_a2a_autostart_ministar.ps1`. Double-clic admin = installé.

⚠️ **Note Ollama mode user-app vs service** :
- Sous Task Scheduler avec `-UserId $env:USERNAME -LogonType Interactive`, Ollama démarre dans la session interactive de Patrice — donc seulement après son logon.
- Pour démarrage **vraiment headless** (sans logon Patrice), il faut soit :
  - Désinstaller `ollama app.exe` user-app, et installer Ollama en service système (pas dispo officiellement sur Windows à ce jour, NSSM-able)
  - Ou accepter que sur MINISTAR le spoke ne soit dispo qu'après le 1er logon de Patrice (acceptable si MINISTAR est une workstation, pas un serveur 24/7)

Recommandation V0.1 : accepter le mode "after logon" sur MINISTAR. Le serveur 24/7 du fleet reste Ministar Linux. MINISTAR + DARKSTAR sont des spokes intermittents par design (cf. doctrine COLAB-RESEAU §3 "spécialisation naturelle").

---

## Vérifications post-install (les deux hosts)

```powershell
# 1. Tasks registered
Get-ScheduledTask -TaskName "OllamaA2ASpoke", "OllamaServer" -ErrorAction SilentlyContinue

# 2. Ollama bind tailnet (depuis n'importe quelle machine du tailnet)
curl http://<TAILSCALE_IP>:11434/api/tags

# 3. Wrapper répond
curl http://<TAILSCALE_IP>:3002/api/a2a/.well-known/agent.json

# 4. Spoke registered au hub
curl http://100.98.18.76:3000/api/a2a/agents
# → ollama-darkstar et/ou ollama-ministar dans remoteAgents
```

### Test E2E POC Niveau 2 (depuis MINISTAR ou ailleurs)

```bash
# Vers DARKSTAR
curl -X POST http://100.98.18.76:3000/api/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{"agent":"ollama-darkstar","message":{"role":"user","parts":[{"type":"text","text":"hello"}]},"metadata":{"model":"qwen3:4b"}}'

# Vers MINISTAR
curl -X POST http://100.98.18.76:3000/api/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{"agent":"ollama-ministar","message":{"role":"user","parts":[{"type":"text","text":"hello"}]},"metadata":{"model":"qwen2.5-coder:32b"}}'
```

Doit retourner `status.status: "completed"` + un `result` non vide pour les deux.

---

## Test de résilience (validation finale)

Pour confirmer que ça survit vraiment à un reboot :

```powershell
Restart-Computer -Force
# … attendre 2 min après reboot, logon si MINISTAR …
curl http://100.98.18.76:3000/api/a2a/agents
```

Si le spoke réapparaît seul (sans intervention), l'auto-start est validé.

---

## Limites connues

- **Heartbeat staleness** : si le hub a un timeout heartbeat plus long que la durée du reboot, le spoke peut apparaître "registered" pendant qu'il est en réalité down. Le hub fait `fetch failed` sur le tasks/send mais ne dé-registre pas. Pas critique pour V0 (le router renvoie `status.failed` proprement, le caller voit l'erreur). À traiter dans GC heartbeat (Risque 4 audit POC Niveau 2 — pas dans le scope d'aujourd'hui).

- **Python path** : le script suppose que `python.exe` est dans le PATH système. Si Patrice utilise un venv ou une install Python user-only, ajuster `$pythonExe` à un chemin absolu (ex: `C:\Python312\python.exe`).

- **MINISTAR Ollama after-logon-only** : voir note dédiée plus haut. Acceptable car MINISTAR est workstation, pas serveur. Ministar Linux reste le hub 24/7.

- **`OLLAMA_HOST=0.0.0.0` expose Ollama sur tout le réseau local** — sécurité acceptée car les hosts sont CGNAT-Tailscale-only. Si un host rejoint un LAN public un jour, restreindre.

- **Conflit port 3002** : pas de collision inter-machines (le port est local à chaque host, le tailnet route via IP). Mais si un autre service local utilise 3002, conflit intra-machine. À documenter dans le wrapper si pertinent.

---

## Alternative — NSSM (V0.2 si on veut un vrai service)

NSSM (`https://nssm.cc/`) wrappe n'importe quel exe en service Windows propre avec :
- Auto-start native (pas Task Scheduler)
- Logs rotatifs intégrés (`-AppStdout` / `-AppStderr`)
- `sc query` / `services.msc` natifs pour debug
- Crash recovery configurable

Setup en quelques commandes :
```powershell
nssm install OllamaA2ASpoke `
    "$env:PYTHON_PATH" `
    "scripts\ollama_a2a_spoke.py --hub http://100.98.18.76:3000 ..."
nssm set OllamaA2ASpoke AppDirectory "D:\..."
nssm set OllamaA2ASpoke Start SERVICE_AUTO_START
nssm set OllamaA2ASpoke AppStdout "D:\logs\spoke.log"
nssm set OllamaA2ASpoke AppRotateFiles 1
```

À considérer si Task Scheduler pose problème (logs introuvables, restart loops, headless Ollama bloqué, etc).

---

## Ratification attendue

**DARKSTAR (Claude/Patrice)** :
1. Lis ce doc
2. Ratifie ou propose modif (script à corriger ? approche différente ?)
3. Si OK, exécute `setup_a2a_autostart_darkstar.ps1` en admin
4. Documente le résultat dans `journal/darkstar-grok-cli.md` (test résilience inclus)

**MINISTAR (cette machine — décision Patrice direct)** :
1. Patrice valide qu'on veut MINISTAR comme spoke aussi
2. Si oui, exécuter `setup_a2a_autostart_ministar.ps1` en admin
3. Note la limite Ollama after-logon (cf. plus haut) — acceptable ou pas
4. Documente dans `journal/ministar-grok-cli.md`

Une fois validé sur les 2 hosts, le mesh A2A devient résilient aux reboots Windows mensuels.

— Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 2 mai 2026 ~14h00 UTC
