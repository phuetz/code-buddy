# DARKSTAR Nightwork Plan — Code Buddy Collaboration Study

**Date** : 2026-05-02 (overnight session)  
**Task** : Deep study of Code Buddy collaboration system + integration with fleet  
**Method** : Autonomous loop (Ralph loop) — iterate → test → validate → document  
**Duration** : Full night (8+ hours)

---

## Ralph Loop Framework

```
┌─────────────────────────────────────────────────────┐
│  1. READ CODE (src/protocols/a2a, collaboration)   │
│  2. UNDERSTAND (architecture, flow, constraints)   │
│  3. TEST (locally, cross-host via hub)             │
│  4. DOCUMENT (findings in journal)                 │
│  5. PROPOSE (improvements, integration points)     │
│  6. SLEEP(30min) → back to 1                       │
└─────────────────────────────────────────────────────┘
```

**Each iteration** : 30-40 min per loop = 12-16 loops per night

---

## Code Buddy Study Targets

### Phase 1 — Architecture (Loop 1-4)
- [ ] **Entry point** : `src/index.ts` — how Code Buddy boots
- [ ] **A2A Protocol** : `src/protocols/a2a/` — AgentCard, skills, task format
- [ ] **Server routes** : `src/server/routes/a2a-protocol.ts` — endpoints
- [ ] **Types** : `src/types/` — interfaces for agents, tasks, capabilities
- [ ] **Document** : Create `DARKSTAR-CODE-BUDDY-ANALYSIS.md`

### Phase 2 — Integration Points (Loop 5-8)
- [ ] **Spoke registration** : How would DARKSTAR register? (endpoint pending)
- [ ] **Task execution** : How does hub route tasks to spokes?
- [ ] **Error handling** : What happens if a spoke fails?
- [ ] **Discovery** : Cross-host validation (already working via Ministar)
- [ ] **Propose** : What's missing for POC Level 1?

### Phase 3 — Implementation (Loop 9-12)
- [ ] **Patch `/api/a2a/agents/register`** : ~50 LOC to accept spoke registrations
- [ ] **In-memory registry** : `Map<spokeName, {card, url, lastHeartbeat}>`
- [ ] **Test registration** : DARKSTAR Ollama → register → hub lists it
- [ ] **Write PR** : Send patch back to Ministar for merge

### Phase 4 — Collaboration Demo (Loop 13-16)
- [ ] **Call hub from DARKSTAR** : Test `/api/a2a/.well-known/agent.json`
- [ ] **Hub call DARKSTAR** : Task sent to DARKSTAR spoke (once registered)
- [ ] **Round-trip** : MINISTAR question → HUB → DARKSTAR Ollama → answer
- [ ] **Document success** : Update `etat_projets.md`, push to fleet

---

## Tools & Environment

**DARKSTAR has** :
- 2× RTX 3090 (CUDA available)
- ComfyUI stack (to be installed)
- Local Ollama (if needed)
- Tailscale (100.73.222.64) — can reach hub (100.98.18.76:3000)

**Hub (Ministar) provides** :
- A2A discovery endpoint (always-on)
- Ollama spoke (qwen3.6:35b available)
- Workspace for testing (`claude-et-patrice/` repo)

---

## Output Artifacts (by morning)

1. **`DARKSTAR-CODE-BUDDY-ANALYSIS.md`** — full architecture breakdown
2. **`a2a-agents-register.patch`** — 50 LOC patch for spoke registration
3. **`TEST-RESULTS.md`** — validation steps + cross-host test logs
4. **Updated `etat_projets.md`** — POC Niveau 1 progress
5. **`journal/darkstar-DEV.md`** — session notes (hourly checkpoints)

---

## Communication During Night

**Hub (Ministar Linux) will**:
- Stay online (24/7, no shutdown)
- Watch `claude-et-patrice` for commits (DARKSTAR pushes findings)
- Keep Ollama spoke hot for testing
- Log any hub activity in `/var/log/codebuddy-a2a-hub.log`

**DARKSTAR should**:
- `git pull --rebase` every 2 loops (refresh hub status)
- `git push` after each major finding (async comm)
- Test against hub endpoint: `curl http://100.98.18.76:3000/api/a2a/.well-known/agent.json`
- Document blockers in journal as they appear

---

## Success Criteria (Morning Review)

- [ ] Code Buddy A2A architecture fully understood
- [ ] `/api/a2a/agents/register` endpoint spec drafted
- [ ] At least 1 end-to-end test (DARKSTAR → Hub → Ministar)
- [ ] Patch ready for PR
- [ ] All findings documented + pushed

**If achieved** : POC Niveau 1 can be merged. DARKSTAR becomes a real fleet participant (not just observer).

---

## Nightwork Rules (Ralph Loop Discipline)

1. **Time-box each loop** : 30-40 min max. If stuck, skip → next loop.
2. **Commit often** : After each major insight, push to repo.
3. **Test incrementally** : Don't wait until end-of-night to validate.
4. **Log in journal** : Hourly checkpoint with status + blockers.
5. **Fallback to Ministar** : If blocked, ask hub via git comment in issue (async Q&A).

---

**Hub is ready. Study well, DARKSTAR. We're building the nervous system of the robot. 🤖**

---

*Prepared by Claude/Ministar Linux — 2026-05-02 00:35 UTC*
