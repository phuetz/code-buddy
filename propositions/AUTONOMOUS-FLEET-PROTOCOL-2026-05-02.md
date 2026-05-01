# Protocole de collaboration autonome du fleet — v0.1

> **Statut** : v0.1 draft, 2026-05-02 nuit, DARKSTAR / grok-cli (Claude Opus 4.7 1M)
> **Compagnons doctrinaux** : `CLAUDE-NETWORK-COLAB-2026-05-01.md` v0.2, `CLAUDE-NETWORK-A2A-POC-2026-05-01.md` v0.2
> **Cible** : permettre aux 3 sessions Claude (DARKSTAR, MINISTAR, Ministar Linux) de collaborer sans intervention humaine
> **Demande Patrice** : "j'aimerai un protocole permettant de collaborer de façon autonome — il y a des technologies de battements de cœur"

---

## TL;DR

Code Buddy embarque déjà **toutes les briques** d'un fleet autonome. Elles ne sont juste pas câblées ensemble pour notre cas (3 sessions Claude Code via Tailscale). On peut activer la collaboration autonome **sans écrire un seul module nouveau** — juste des fichiers partagés bien placés et un peu de glue.

---

## 1. Inventaire des briques existantes (Code Buddy)

| Brique | Fichier | Rôle | Statut nous |
|---|---|---|---|
| **HeartbeatEngine** | `src/daemon/heartbeat.ts` | Réveil périodique (30min default), lecture `HEARTBEAT.md`, action autonome | À activer |
| **AIColabManager** | `src/collaboration/ai-colab-manager.ts` | Tasks COLAB programmatique, `claim/release/handoff/worklog` | À activer |
| **A2A register** | `src/server/routes/a2a-protocol.ts` (PR feat/a2a-agents-register) | Discovery cross-host | Pushé en branche, à merger |
| **A2A discovery** | `/api/a2a/.well-known/agent.json` + `/api/a2a/agents` | Liste des spokes connectés | LIVE sur hub Ministar Linux |
| **Multi-agent system** | `src/agent/multi-agent/` | Orchestration in-process, team-manager, mailbox | Optionnel V1 |
| **TeamSession** | `src/collaboration/team-session.ts` | WebSocket sync real-time | Overkill V0 |
| **Channels (peer-routing, dm-pairing, offline-queue)** | `src/channels/` | Messaging routing inspiré OpenClaw | Overkill V0 |

**OpenClaw** est l'inspiration architecturale (cf. README, repoProfile.json). Pas un module monolithique mais un ensemble : `src/openclaw/index.ts` ré-exporte 6 enterprise features (ToolPolicy, Hooks, SmartCompaction, RetryFallback, SemanticMemory, PluginConflict). Le système de communication "OpenClaw-inspired" se trouve éclaté dans `src/channels/` + `src/agent/multi-agent/` + `src/collaboration/` + `src/daemon/`.

---

## 2. Architecture cible v0.1 (minimum viable autonome)

```
┌─────────────────────────────────────────────────────────────────┐
│  Repo claude-et-patrice (git, source de vérité asynchrone)      │
│                                                                   │
│  .codebuddy/                                                      │
│    HEARTBEAT.md          ← checklist partagée (lue par tous)    │
│    colab-tasks.json      ← queue des tâches fleet                │
│    colab-worklog.json    ← log append-only de qui a fait quoi    │
│    presence.json         ← liveness (qui est en ligne)           │
└─────────────────────────────────────────────────────────────────┘
       ▲                    ▲                    ▲
       │ git pull/push      │                    │
       │                    │                    │
   Claude/DARKSTAR    Claude/MINISTAR     Claude/Ministar Linux
   ┌────────────┐     ┌────────────┐      ┌────────────┐
   │ Heartbeat  │     │ Heartbeat  │      │ Heartbeat  │
   │   30 min   │     │   30 min   │      │   30 min   │
   │            │     │            │      │            │
   │ ColabMgr   │     │ ColabMgr   │      │ ColabMgr   │
   │ (claim/    │     │            │      │            │
   │ release)   │     │            │      │            │
   └────────────┘     └────────────┘      └────────────┘
       │ A2A heartbeat ping toutes les 30s
       ▼
   ┌──────────────────────────────────────────────┐
   │  Hub Ministar Linux 100.98.18.76:3000        │
   │  (codebuddy-a2a.service systemd active)      │
   │  /api/a2a/agents → presence registry         │
   └──────────────────────────────────────────────┘
```

**2 canaux complémentaires** :
1. **Asynchrone via repo** (git push/pull) : tâches, handoffs, worklogs. Append-only, persistent, traçable.
2. **Synchrone via A2A** (HTTP heartbeat 30s) : liveness, discovery. Volatile, instantané.

---

## 3. Conventions de fichiers

### `.codebuddy/HEARTBEAT.md` — checklist partagée

Pattern : un Claude qui se réveille (Heartbeat tick) lit ce fichier, voit ce qui est à faire, claime une tâche dans `colab-tasks.json`, agit, log.

Structure recommandée :
```markdown
# HEARTBEAT.md — checklist fleet

## À surveiller (chaque tick)

- [ ] `colab-tasks.json` → des tâches `[ ]` libres ?
- [ ] `presence.json` → un Claude offline > 1h ?  envoyer signal ou prendre en charge ses tâches `[~]`
- [ ] Repos critiques (world-model, gitnexus-rs, MonArtisan) → erreurs de build récentes ?
- [ ] Branche `feat/*` ouverte > 24h sans activité → ping ou close ?

Si rien à faire, répondre `HEARTBEAT_OK` (suppression compteur).

## Règles d'action autonome

1. Ne **jamais** push sans `git pull --rebase` d'abord (règle F2 du COLAB).
2. Ne **jamais** modifier le journal d'un autre host.
3. Sur tâche claimée : marquer `[~ host/repo YYYY-MM-DD HH:mm]` immédiatement.
4. Si tâche prend > 30 min : update worklog avec progress, ne pas tout différer à la fin.
5. Sur ambiguïté/risque : créer une `proposition/<NOM>-YYYY-MM-DD.md` et attendre Patrice.
```

### `.codebuddy/colab-tasks.json` — queue fleet

```json
{
  "version": "0.1",
  "tasks": [
    {
      "id": "task-2026-05-02-001",
      "title": "Merger feat/a2a-agents-register sur main du hub Linux",
      "description": "Pull la branche, npm test -- a2a-remote, si vert merger sur main + systemctl restart",
      "status": "open",
      "priority": "high",
      "assignedAgent": null,
      "claimedBy": null,
      "claimedAt": null,
      "filesToModify": ["src/protocols/a2a/index.ts", "src/server/routes/a2a-protocol.ts"],
      "acceptanceCriteria": [
        "npm test -- a2a-remote: 8 passing",
        "GET /api/a2a/agents retourne 'remoteAgents' field",
        "POST /api/a2a/agents/register crée une entry"
      ],
      "createdBy": "darkstar/grok-cli",
      "createdAt": "2026-05-02T00:30:00Z"
    }
  ]
}
```

### `.codebuddy/colab-worklog.json` — append-only

```json
{
  "version": "0.1",
  "entries": [
    {
      "id": "wl-2026-05-02-001",
      "date": "2026-05-02T00:35:00Z",
      "agent": "darkstar/grok-cli",
      "taskId": null,
      "summary": "Bootstrap protocole autonome v0.1",
      "filesModified": [
        {"file": ".codebuddy/HEARTBEAT.md", "changes": "Création"},
        {"file": ".codebuddy/colab-tasks.json", "changes": "Création"},
        {"file": ".codebuddy/colab-worklog.json", "changes": "Création"}
      ],
      "issues": [],
      "nextSteps": ["Activer HeartbeatEngine sur les 3 hosts", "Test end-to-end claim/release"]
    }
  ]
}
```

### `.codebuddy/presence.json` — liveness éphémère

Mis à jour toutes les 30s par chaque Claude actif. Si une session crashe ou se ferme, son entry n'est plus rafraîchie → autres sessions le détectent (`now - lastSeen > 60s`).

```json
{
  "darkstar/grok-cli": {
    "host": "darkstar",
    "tailnetIp": "100.73.222.64",
    "lastSeen": "2026-05-02T00:35:12Z",
    "status": "active",
    "currentTask": null
  },
  "ministar/grok-cli": { "..." },
  "ministar-linux/code-buddy": { "..." }
}
```

**Note** : `presence.json` doit être réfréchi sans causer de conflits git. Solution : un seul Claude (le hub Ministar Linux) maintient ce fichier en mémoire et le commit toutes les 5 minutes (granularité acceptable). Les autres lui pingent via `/api/a2a/agents/heartbeat` → c'est le hub qui consolide.

---

## 4. Activation par session (90 min total)

### Phase 1 — bootstrap fichiers fleet (30 min, déjà en cours côté DARKSTAR)
- [x] Cette proposition rédigée
- [ ] `claude-et-patrice/.codebuddy/HEARTBEAT.md` créé
- [ ] `claude-et-patrice/.codebuddy/colab-tasks.json` créé avec 3-5 tâches initiales
- [ ] `claude-et-patrice/.codebuddy/colab-worklog.json` créé
- [ ] Commit + push

### Phase 2 — HeartbeatEngine sur Ministar Linux (30 min, à faire par Claude/Ministar Linux)
- [ ] Sur le hub : créer `~/code-buddy/.codebuddy/HEARTBEAT.md` (symlink vers le repo claude-et-patrice ou copie sync git)
- [ ] Activer le HeartbeatEngine via slash command `/heartbeat enable` ou config TOML
- [ ] Vérifier événements `heartbeat:wake` dans les logs systemd

### Phase 3 — Activation MINISTAR + DARKSTAR (15 min chacun)
- [ ] Sur chaque host : cloner `~/code-buddy` (déjà fait MINISTAR + DARKSTAR), `git checkout main`, `npm install` (si pas déjà fait)
- [ ] Symlinker `.codebuddy/HEARTBEAT.md` du repo claude-et-patrice (ou copier)
- [ ] Démarrer une session interactive Code Buddy avec `--heartbeat` flag (ou équivalent)
- [ ] Vérifier que le tick fire et que la session écrit dans worklog

### Phase 4 — Test end-to-end (15 min)
- [ ] Créer une tâche test dans `colab-tasks.json` (ex: "écrire un haïku sur le robot 10 ans")
- [ ] Attendre le prochain heartbeat tick (≤ 30 min) sur n'importe quel host
- [ ] Vérifier que le Claude qui se réveille la claime, l'exécute, log dans worklog, push
- [ ] Bonus : 2 sessions s'éveillent en parallèle → seul le 1er à push gagne (l'autre voit "déjà claimée" au prochain tick)

---

## 5. Garde-fous

1. **Pas de boucle infinie** : `maxConsecutiveSuppressions` (default 5) force un full review après 5 ticks `HEARTBEAT_OK`. Et un Claude qui se réveille fait **maximum 1 tâche par tick**, pas une rafale.
2. **Pas d'écriture cross-journal** : règle F3 préservée. Chaque Claude écrit uniquement dans son `<host>-<repo>.md`.
3. **Tâches risquées hors scope autonome** : tout ce qui touche à la prod (push main de world-model, deploy hub, modif config production) reste en `priority: critical` qui demande validation Patrice avant claim.
4. **Audit trail** : `colab-worklog.json` est append-only. Aucune entry ne peut être modifiée a posteriori. Pour corriger une erreur, on append une entry de correction.
5. **Suspension fleet** : Patrice peut faire `echo "FLEET_PAUSE" > .codebuddy/HEARTBEAT.md` → tous les Claudes voient ça au prochain tick et se mettent en pause jusqu'à reset.

---

## 6. Risques + mitigations

| Risque | Probabilité | Mitigation |
|---|---|---|
| Conflits git sur push concurrent | Haute | Convention F2 (git pull --rebase) + stratégie 1-Claude-par-fichier (chacun son journal/worklog) |
| Tâches mal cadrées générant des dégâts | Moyenne | Acceptance criteria obligatoires, scope `priority: critical` validation humaine |
| HeartbeatEngine pas activable sur Claude Code (l'outil) | Haute | Le HeartbeatEngine est dans Code Buddy ; pour Claude Code on devra écrire un wrapper léger qui poll claude-et-patrice/.codebuddy/ et invoke `claude --print` en CLI. ~50 LOC bash. |
| Patrice oublie un Claude qui boucle | Faible | `FLEET_PAUSE` keyword + `maxConsecutiveSuppressions=5` cap |
| Présence pas synchronisée entre hosts | Moyenne | Présence consolidée par le hub uniquement, pas un round-robin commits |

---

## 7. Versions futures

- **v0.2** : intégration Ollama spokes (LLM locaux pour tâches d'embedding/lint/summary à coût zéro)
- **v0.3** : sub-agents A2A — un Claude peut déléguer une tâche à un autre via `/api/a2a/tasks/send` (PR feat/a2a-agents-register sera prérequise pour la discovery)
- **v0.4** : memory partagée — `claude-et-patrice/.codebuddy/memory/` indexé par embedding, search via Ollama nomic-embed-text
- **v0.5** : escalade automatique — si un Claude bloque > 1h sur une tâche `[~]`, le hub auto-handoff vers un autre Claude dispo

---

## 8. Pour valider

- **Patrice** : lis cette proposition au matin. Tu valides la doctrine v0.1 ? Quels garde-fous tu veux renforcer ?
- **Claude/MINISTAR** : ratifie via une entry dans `journal/ministar-grok-cli.md` qui pointe vers ce fichier. Tu peux aussi commenter sur les limitations connues que je n'ai pas vues.
- **Claude/Ministar Linux** : *quand* une session sera active là, ratifie aussi. C'est elle qui hébergera la consolidation `presence.json`.

Si validation collective + activation Phase 1-4 : on a une fleet vraiment autonome. Plus besoin de ton intervention pour qu'on collabore. Tu deviens architecte / juge final, pas plus traducteur.

---

— Claude Opus 4.7 (1M context), DARKSTAR / grok-cli, 2 mai 2026 nuit
