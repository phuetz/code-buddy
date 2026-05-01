# A2A Hub Status — Ministar Linux

**Date** : 2026-05-02  
**Hub** : Claude/Ministar Linux (100.98.18.76)  
**Status** : 🟢 **ACTIVE — 24/7 ONLINE**

---

## Hub Information

| Item | Value |
|------|-------|
| **Hub Name** | Code Buddy A2A Hub |
| **URL** | `http://100.98.18.76:3000` |
| **Discovery Endpoint** | `/api/a2a/.well-known/agent.json` ✅ |
| **Tailscale IP** | 100.98.18.76 |
| **Uptime** | 24/7 always-on |

---

## Live Spokes

### 1. Ollama Spoke (Ministar Linux)
- **URL** : `http://100.98.18.76:3002`
- **Status** : 🟢 **ACTIVE**
- **Models** :
  - `qwen3.6:35b-a3b-q4_K_M` (23 GB) ← Best performer
  - `qwen3:4b` (2.5 GB) ← Fast
  - `gemma4:26b` (16 GB)
  - `nomic-embed-text` (274 MB)
- **Capability** : Text generation, embeddings, inference

---

## Awaiting Spokes

### DARKSTAR (100.73.222.64)
**Status** : 🟡 **REACHABLE but NOT YET REGISTERED**

When you (Claude/DARKSTAR) come online:
1. **Validate hub cross-host** :
   ```bash
   curl http://100.98.18.76:3000/api/a2a/.well-known/agent.json
   ```

2. **Deploy stack robot** (see `propositions/PLAN-DARKSTAR-INSTALL-2026-05-02.md`):
   - ComfyUI CUDA + LTX-2.3
   - Ollama local (if needed)
   - Faster-whisper CUDA
   - SAM 2 vision

3. **When Ollama runs on DARKSTAR**, register as spoke:
   ```bash
   python world-model/scripts/ollama_a2a_spoke.py --port 3002
   ```

---

## POC Status

| Level | Status | Notes |
|-------|--------|-------|
| **0** | ✅ **DONE** | Hub discovery, cross-host validation (MINISTAR Windows ✓) |
| **1** | 🔄 **IN PROGRESS** | Spoke auto-register via `POST /api/a2a/agents/register` (~50 LOC Code Buddy) |
| **2** | ⏳ **PENDING** | Task round-trip: MINISTAR calls DARKSTAR Ollama via hub |
| **3+** | 📋 **QUEUED** | Intelligent routing, skill registry, multi-hop tasks |

---

## Communication Channels

- **Async** : This repo (`claude-et-patrice/`) — pull `etat_projets.md` for updates
- **Real-time** : A2A API when both spokes register
- **Logs** : Check `journal/ministar-ubuntu-DEV.md` for session notes

---

## Next Actions (DARKSTAR)

1. **Validate** : `curl http://100.98.18.76:3000/...` ✅
2. **Implement** : PLAN-DARKSTAR-INSTALL
3. **Register** : Ollama spoke when ComfyUI is ready
4. **Report** : Update `etat_projets.md` with DARKSTAR status

---

**Message from Hub (Ministar Linux)**:  
"Welcome, DARKSTAR. Hub is live and waiting. When you're ready, register your spokes and we'll start orchestrating the robot stack together. 🚀"

---

*Last updated by Claude/Ministar Linux — 2026-05-02 00:30 UTC*
