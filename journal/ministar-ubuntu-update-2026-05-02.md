# Update — Ministar Linux Hub Activation (POC Niveau 1)

**Timestamp**: 2026-05-02 ~09:25 UTC  
**Host**: Ministar Linux (100.98.18.76)  
**Task**: Merge DARKSTAR's feat/a2a-agents-register branch and activate spoke registration

## Actions Completed

### ✅ Tested feat/a2a-agents-register branch
- Checked out `origin/feat/a2a-agents-register`
- Ran `npm test -- tests/protocols/a2a-remote-agents.test.ts`
- **Result**: All 8 A2A remote agent tests PASS ✅
- Test file shows:
  - `registerRemoteCard()` — store agent card in hub registry
  - `listRemoteAgents()` — return registered remote agents
  - `touchRemoteAgent()` — update heartbeat timestamp
  - `unregisterRemoteAgent()` — cleanup on spoke shutdown

### ✅ Merged to main and pushed
- `git merge origin/feat/a2a-agents-register`
- Added 224 lines across 3 files (routes + types + tests)
- Pushed to `origin/main` (commit `843b95a6`)
- All code is now live on GitHub

### ✅ Pulled latest code-buddy on Ministar Linux
- `cd /home/patrice/code-buddy && git pull origin main`
- Picked up 21 new commits from DARKSTAR including:
  - `feat(daily-reset)` — /daily-reset command for autonomous cycles
  - `feat(heartbeat)` — /heartbeat command for fleet presence
  - `feat(exit_plan_mode)` — V4.4 formal approval gate
  - `merge feat(a2a): spoke registration endpoint`
- Working directory ready, code updated

### ⏳ Service restart pending
- `systemctl restart codebuddy-a2a.service` requires sudo password (TTY context)
- **Action for Patrice or interactive session**: Execute this command to activate the new spoke registration endpoints

## What's New in the Hub (post-merge)

Three new HTTP endpoints now available on `http://100.98.18.76:3000/api/a2a/`:

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/agents/register` | POST | Remote spoke calls this to register its AgentCard | scope=read |
| `/agents/:name/heartbeat` | POST | Spoke calls periodically to signal liveness | scope=read |
| `/agents/:name` | DELETE | Spoke calls on graceful shutdown to unregister | scope=read |

**Security**: All three use `requireScope('read')` — lower than 'admin' so any Tailscale peer can register (sufficient since we're behind private tailnet).

**Format** (POST /agents/register):
```json
{
  "name": "ollama-darkstar",
  "url": "http://100.73.222.64:11434",
  "card": { "skills": [...], "version": "0.1.0", ... }
}
```

## POC Niveau 1 Checklist

- [x] A2A hub running on Ministar Linux (systemd service)
- [x] Spoke registration endpoint implemented + tested
- [x] Code merged to main + pushed to GitHub
- [x] Code pulled on Ministar Linux
- [ ] **Service restarted** (awaiting Patrice or interactive session with sudo)
- [ ] DARKSTAR Ollama installation (awaiting Patrice UAC click on Desktop files)
- [ ] Ollama spoke registration test

## For DARKSTAR (next steps)

Once Patrice clicks `OllamaSetup.exe` + `enable_a2a_firewall.ps1`:

1. Ollama running on DARKSTAR at `http://127.0.0.1:11434` (internal) / `http://100.73.222.64:11434` (Tailscale)
2. Run the Ollama A2A wrapper (from world-model/scripts):
   ```bash
   python ollama_a2a_spoke.py \
     --hub http://100.98.18.76:3000 \
     --name ollama-darkstar \
     --url http://100.73.222.64:11434 \
     --host-tag darkstar
   ```
3. Wrapper registers spoke card at hub
4. Hub now lists DARKSTAR Ollama in `GET /api/a2a/agents` response

## For Patrice (immediate actions)

1. **Restart the hub service** (requires sudo):
   ```bash
   sudo systemctl restart codebuddy-a2a.service
   ```
   Then verify:
   ```bash
   sudo systemctl status codebuddy-a2a.service
   curl http://localhost:3000/api/a2a/agents
   ```

2. **Click on Desktop files** (UAC popup expected):
   - `OllamaSetup.exe` — Ollama Windows installation
   - `enable_a2a_firewall.ps1` — Open port 3000 for hub inbound

Once done, DARKSTAR can register its Ollama spoke and the fleet becomes fully meshed.

---

**Status**: Code Buddy A2A hub v0.3 POC Niveau 1 is **code-complete and tested**. Awaiting service restart + infrastructure setup to activate.

— Claude/Ministar Linux, 2026-05-02 09:25 UTC
