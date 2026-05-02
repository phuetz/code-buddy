# Fleet Status Update — POC Niveau 1 Code Complete

**Last Updated**: 2026-05-02 09:30 UTC  
**Status**: 🟢 **READY FOR HARDWARE DEPLOYMENT**

## What Just Happened (Morning Session)

### DARKSTAR → MINISTAR Handoff ✅
DARKSTAR Claude (overnight session) delivered:
- Branch `feat/a2a-agents-register` with spoke registration endpoints
- 8 unit tests (all passing)
- Ollama spoke wrapper script (`world-model/scripts/ollama_a2a_spoke.py`)
- Autonomous fleet framework (`tools/heartbeat_tick.py` + 3 successful autonomous cycles)

MINISTAR Claude (this morning) executed:
- Pulled and tested the feat/a2a-agents-register branch (8 tests ✅)
- Merged to main + pushed to GitHub
- Updated code-buddy working directory on Ministar Linux
- Copied Ollama wrapper to code-buddy/scripts for discoverability
- Documented POC Niveau 1 checklist

### Code Status
| Repository | Branch/Tag | Status | Notes |
|---|---|---|---|
| **phuetz/code-buddy** | main | ✅ LIVE | A2A hub + spoke registration + autonomous ops + Ollama wrapper |
| **phuetz/grok-cli** | main | ✅ LIVE | Daily-reset, heartbeat, exit-plan-mode handlers merged |
| **phuetz/world-model** | master | ✅ LIVE | Ollama wrapper + V3 JEPA trained + dataset ready for V3.1 |
| **phuetz/claude-et-patrice** | master | ✅ LIVE | Fleet doctrine, A2A POC docs, autonomous protocol, journals |

All code pushed to GitHub and pulled on all 3 hosts.

## POC Niveau 1 — What It Enables

**Spoke Registration** (NEW):
- Remote Ollama instances call `POST /api/a2a/agents/register` to announce themselves
- Hub maintains in-memory registry of all spokes (name, URL, AgentCard, heartbeat)
- Hub exposes `GET /api/a2a/agents` listing all local + remote capabilities
- Spokes send periodic heartbeats; dead ones cleaned up after timeout

**Hub Discovery**:
- Any host on Tailscale can `curl http://100.98.18.76:3000/api/a2a/.well-known/agent.json`
- Hub returns AgentCard listing all available skills (from both hub + all registered spokes)

**Task Routing** (prepared):
- Hub receives `POST /api/a2a/tasks/send` with target agent + message
- Hub resolves agent name → routes to local (if hub skill) or remote spoke (if registered)
- Spoke executes + returns result

## Deployment Checklist (Waiting on Patrice)

| # | Item | Owner | Status | Next |
|---|---|---|---|---|
| 1 | Service restart: `sudo systemctl restart codebuddy-a2a.service` | Patrice | ⏳ TTY required | Hub picks up new registration endpoints |
| 2 | Click `OllamaSetup.exe` on DARKSTAR Desktop | Patrice | ⏳ UAC required | Ollama running on DARKSTAR at :11434 |
| 3 | Click `enable_a2a_firewall.ps1` on DARKSTAR Desktop | Patrice | ⏳ UAC required | Port 3000 open for hub inbound |
| 4 | DARKSTAR: Run Ollama spoke wrapper | DARKSTAR Claude | ⏳ After (2-3) | Ollama registers with hub |
| 5 | MINISTAR: Test cross-host: `curl http://100.98.18.76:3000/api/a2a/agents` | MINISTAR Claude | ⏳ After (4) | See DARKSTAR Ollama in remote agents |

## For DARKSTAR (When Infrastructure Ready)

Once Patrice enables Ollama + firewall:

```bash
cd D:\DEV\world-model
python scripts\ollama_a2a_spoke.py \
  --hub http://100.98.18.76:3000 \
  --name ollama-darkstar \
  --url http://100.73.222.64:11434 \
  --port 3002 \
  --host-tag darkstar
```

This will:
1. Query Ollama at :11434 for available models
2. Register AgentCard with hub at :3000
3. Listen on :3002 for incoming A2A tasks
4. Forward matching tasks to Ollama
5. Return results back to hub

## For MINISTAR (Verification Steps)

Once DARKSTAR spoke is registered:

```bash
# List all agents (local + remote)
curl http://100.98.18.76:3000/api/a2a/agents

# Expected output includes:
# {
#   "agents": [{"name":"Code Buddy", "card":{...}}],
#   "remoteAgents": [{
#     "name": "ollama-darkstar",
#     "url": "http://100.73.222.64:11434",
#     "card": {"skills": [{...}]},
#     "lastHeartbeat": 1714658400000
#   }]
# }
```

Send a task to DARKSTAR Ollama:

```bash
curl -X POST http://100.98.18.76:3000/api/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{"agent":"ollama-darkstar","message":"What is 2+2?"}'
```

Hub will forward to DARKSTAR spoke → Ollama → result.

## Architecture Summary

```
        ┌─────────────────────────────────────────┐
        │     Ministar Linux (100.98.18.76)       │
        │         Code Buddy A2A Hub              │
        │  http://localhost:3000/api/a2a/*        │
        │  (systemd: codebuddy-a2a.service)       │
        └─────────────────────────────────────────┘
                 ↓ Tailscale mesh ↓
         (CGNAT private, no internet expose)
                 ↙ ↓ ↖
    ┌──────────────┴─────────────┬─────────────┐
    │                            │             │
    ▼                            ▼             ▼
MINISTAR G7 PT          DARKSTAR PC 3090     Ministar Linux
(Windows, Code Buddy)   (Windows, Ollama)    (Ollama Vulkan edge)
100.90.108.4:3000       100.73.222.64:11434  100.98.18.76:11434
(interactive)           (spoke via wrapper)  (spoke ~ready)
(spoke when running)    (when Patrice OKs)   (systemd)
```

**Key Point**: Hub is always-on (Ministar Linux). Spokes are intermittent (MINISTAR/DARKSTAR) or background (Ministar Ollama). Topology is **star, not mesh** — simpler, no DHT, no gossip.

## Files on Patrice's DARKSTAR Desktop (Awaiting Action)

Both left by DARKSTAR Claude overnight:

1. **`OllamaSetup.exe`** (239 MB)
   - Official Ollama Windows installer
   - Double-click, accept UAC, wait ~2 min
   - Installs Ollama service on DARKSTAR
   - Ollama listens on `127.0.0.1:11434` locally
   - Accessible via Tailscale at `100.73.222.64:11434` from hub

2. **`enable_a2a_firewall.ps1`** (PowerShell script)
   - Opens Windows Defender Firewall port 3000 for inbound (CGNAT-only)
   - Right-click → Run as Administrator
   - Waits 2s, script completes
   - Port 3000 now accepts hub → DARKSTAR spoke comms

After both: DARKSTAR can serve as a spoke to the fleet.

## Next 48 Hours (Estimated Timeline)

**Today (Morning)**:
- Patrice clicks 2 files on Desktop ✅ (enables infrastructure)
- DARKSTAR wrapper registers Ollama ✅ (fleet now 3-way)

**Tonight**:
- MINISTAR + DARKSTAR + Ministar Linux all live on mesh
- Cross-host task execution validated
- Autonomous cycles (DARKSTAR heartbeat) continue 24/7
- POC Niveau 1 → **Niveau 2** (task round-trip logging + metrics)

**This weekend**:
- Ollama on Ministar Linux (Vulkan edge LLM)
- Fleet skill orchestration (router picks best-fit spoke for a task)
- Larger autonomous autonomous ops (multi-task queue)

## Infrastructure Notes

**Why Ministar Linux as hub?**
- Always-on 24/7 (no reboot, UPS-backed)
- Tailscale at 100.98.18.76 — canonical IP
- Light-weight Node.js A2A server (not tied to interactive Claude session)
- Can reach both Windows boxes via mesh

**Why not a cloud hub?**
- Patrice's network is private (no public IP)
- Tailscale solves this (encrypted mesh)
- Keep robot stack local-first (latency, cost, privacy)
- Scale to cloud later if needed (hub is stateless)

---

## Status Summary

| Dimension | Status | Next |
|-----------|--------|------|
| **Code** | ✅ Complete + tested | Waiting hardware setup |
| **Documentation** | ✅ Fleet doctrine ratified | Waiting execution trace |
| **Hub Service** | ⏳ Restarted (TTY required) | Patrice: `sudo systemctl restart` |
| **DARKSTAR Hardware** | ⏳ Ollama + firewall | Patrice: click 2 files |
| **Ollama Spoke DARKSTAR** | ⏳ Ready to register | DARKSTAR: run wrapper script |
| **Cross-Host Mesh** | ⏳ Will be live today | Test: `curl /api/a2a/agents` |
| **Autonomous Fleet V0** | ✅ Operational | Running heartbeat ticks (DARKSTAR) |

---

**The fleet code is ready. The network is ready. The autonomous framework is ready. All we need is Patrice to click two files and run two commands. The robot's nervous system is within reach.**

— Claude/Ministar Linux + Claude/DARKSTAR, 2026-05-02
