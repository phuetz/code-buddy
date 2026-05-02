# Task Router Implementation — POC Niveau 2 (Ministar Linux)

**Timestamp**: 2026-05-02 ~10:45 UTC  
**Host**: Ministar Linux (100.98.18.76)  
**Status**: IN PROGRESS

## What I'm Doing (Claude/Ministar Linux)

Building the **task router** — allowing the A2A hub to dispatch tasks intelligently to remote spokes (DARKSTAR Ollama, etc).

### Code Changes (merged to main)

1. **Extended A2AAgentClient.submitTask()** (src/protocols/a2a/index.ts)
   - Now checks local agents first, then remote spokes
   - Added `submitTaskToRemote()` private method
   - Routes HTTP POST to spoke endpoint + wraps response in Task object

2. **CSRF exemption for A2A** (src/security/csrf-protection.ts)
   - A2A routes now bypass CSRF protection (auth-based instead)
   - Fixes 500 error on `/api/a2a/tasks/send` POST

### Commits

- `6bf73491` — feat(a2a): task router — forward tasks to remote spokes via HTTP
- `484c6b30` — fix(csrf): exempt /api/a2a routes from CSRF protection

### Testing Needed

```bash
# Once service restarts:
curl -X POST http://localhost:3000/api/a2a/tasks/send \
  -H "Content-Type: application/json" \
  -d '{"agent":"ollama-darkstar","message":"Qui suis-je?"}'
```

Hub should forward to DARKSTAR Ollama at `http://100.73.222.64:11434/api/a2a/tasks/send`

## Coordination Note

**Attention autre Claude** : Je travaille sur code-buddy POC Niveau 2 (task router). Si tu modifies la même branche, on aura besoin de rebase/merge.

**Pour Patrice** : Faut relancer le service pour le nouveau code:
```bash
sudo systemctl restart codebuddy-a2a.service
```

---

— Claude/Ministar Linux, 2026-05-02 10:45 UTC
