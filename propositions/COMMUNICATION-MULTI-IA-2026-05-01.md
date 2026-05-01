# Communication multi-IA — découverte et plan

> Auteur : Claude Opus 4.7 (1M ctx) — DARKSTAR, 1er mai 2026 ~20h35
> Sujet : faire dialoguer toutes les sessions Claude / Codex / Gemini de Patrice
> Status : découverte que **Code Buddy a déjà tout** ; plan d'activation à valider

## Le rêve de Patrice

> "Je rêve que tous les Claude dialoguent entre eux. Tu penses que c'est possible ?"

## TL;DR

**Oui, possible. Et 80 % du travail est déjà fait dans `code-buddy` (grok-cli).**
Le reste, c'est de la mise en réseau.

## Ce qu'on a déjà — niveau 1 : journal git-native (asynchrone)

Le pattern `claude-et-patrice/journal/<hostname>-<repo>.md` est **déjà un dialogue
inter-Claude différé**. Concret :

- Le 1er mai matin, Claude Ministar a écrit `darkstar-DEV.md` *pour* moi qui
  démarrerais sur DARKSTAR le soir même. Hardware specs, SSH manquant, Tailscale
  IP, conventions journal — il avait *anticipé* mon arrivée.
- Toute la nuit j'ai répondu en remplissant `darkstar-world-model.md` pour le
  prochain Claude qui prendra la session.

Limite : asynchrone, broadcast, pas de notif. Mais ça marche déjà.

## Ce qui existe déjà dans `code-buddy` (grok-cli) — niveau 2-4

Découvert ce soir en explorant `D:\DEV\grok-cli` (cloné depuis github.com/phuetz/code-buddy) :

### Niveau 2 — Mémoire cross-session
- `src/memory/persistent-memory.ts` + `enhanced-memory.ts` + `icm-bridge.ts`
- Cross-session memory optimization (commit `e0a53c35` "feat(cowork): implement
  cross-session memory optimization")
- `src/agent/multi-agent/agent-memory-integration.ts`

### Niveau 3 — Multi-agent natif
- `src/agent/multi-agent/` :
  - `multi-agent-system.ts` — orchestrateur
  - `team-manager.ts` — gestion équipes d'agents
  - `session-registry.ts` — discovery des sessions actives
  - `enhanced-coordination.ts` — coordination
  - `agents/` — 8 agents intégrés (PDF, Excel, DataAnalysis, SQL, Archive,
    CodeGuardian, SecurityReview, SWE)
- Slash commands :
  - `/team start|add|status|...` — coordination Agent Teams
  - `/batch <goal>` — décomposition en sub-agents parallèles

### Niveau 4 — Protocole A2A complet (Google Agent-to-Agent spec)
- `src/protocols/a2a/index.ts` — implémentation complète :
  - `AgentCard` (discovery doc)
  - `AgentSkill` (capabilités)
  - `Task` (lifecycle submitted→working→completed/failed)
  - `Message` (text/file parts)
  - `Artifact` (output)
  - `YieldPayload` (pause/resume orchestration)
- HTTP routes `/api/a2a/*` (port 3000) :
  - `GET /.well-known/agent.json` — discovery (public)
  - `GET /agents` — list (admin)
  - `POST /tasks/send` — submit task to agent (admin)
  - `GET /tasks/:id` — get status
  - `POST /tasks/:id/cancel` — cancel
- Gateway WebSocket :3001 — **synchrone temps-réel** :
  - `connect` (pre-auth) / `auth` / `hello_ok`
  - `chat`, `session_create|join|leave|patch`, `presence`

### Niveau 5 — Cowork (GUI Electron + IPC)
- `cowork/` (Electron app séparée)
- IPC handlers extraits dans modules dédiés (commit `b621fc48`)
- Enterprise-grade architecture upgrade (commit `fbf62d72`)
- Audit passes #1-4 sur reliability/persistence/concurrency

## Ce qui manque pour notre flotte Claude Code

Code Buddy parle A2A, mais **Claude Code (l'outil de Patrice) n'est pas Code Buddy**.
Donc il faut un pont. Trois options :

### Option A — Migrer de Claude Code vers Code Buddy (lourd)
Pas désirable : Patrice utilise Claude Code pour son ergonomie / qualité Anthropic.

### Option B — MCP server qui expose A2A à Claude Code (recommandé)
Un serveur MCP léger tournant en parallèle de Claude Code, qui :
- Expose les outils `a2a_send_task(agent, message)` et `a2a_check_inbox()` à Claude Code
- En interne, parle au A2A endpoint Code Buddy
- Multi-instance : chaque Claude Code voit ses messages comme des résultats de tools

Effort : ~1-2 jours de code. Le SDK A2A existe déjà côté Code Buddy, c'est juste
le wrapping MCP.

### Option C — Code Buddy server en hub central (déploiement immédiat)
Simplement lancer **un seul serveur Code Buddy sur Ministar Linux** (toujours up
sur tailnet). Tous les Claude Code peuvent y poser des messages via curl/HTTP
direct. Pas besoin de MCP pour démarrer.

```bash
# Sur Ministar Linux (un grok-cli serveur)
buddy server --port 3000 --gateway-port 3001

# Depuis n'importe quelle session Claude Code (via Bash tool) :
curl -s http://100.98.18.76:3000/api/a2a/.well-known/agent.json
curl -X POST http://100.98.18.76:3000/api/a2a/tasks/send \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"agent": "darkstar-claude", "message": {"role":"user","parts":[{"type":"text","text":"hello from ministar"}]}}'
```

C'est l'option **valide ce soir** sans coder une ligne. Juste activer le server.

## Plan d'activation recommandé

### Phase 1 — Validation locale (30 min)
- [ ] Sur DARKSTAR : `cd D:/DEV/grok-cli && npm install && npm run dev:node` (ou bun)
- [ ] Vérifier que le server démarre, port 3000 écoute
- [ ] `curl http://127.0.0.1:3000/api/a2a/.well-known/agent.json` → AgentCard JSON
- [ ] Test `/api/a2a/agents` (avec un token admin si requis)

### Phase 2 — Hub central sur Ministar Linux (1 h)
- [ ] Cloner `phuetz/code-buddy` sur Ministar Linux (`/home/patrice/DEV/code-buddy/`)
- [ ] `npm install` + build
- [ ] Lancer en service systemd `buddy server`
- [ ] Tailscale Serve `tailscale serve --bg --https=3000 http://127.0.0.1:3000`
- [ ] AgentCard accessible depuis tout le tailnet en HTTPS Tailscale-signed

### Phase 3 — Brancher Claude Code (1-2 jours)
- [ ] Écrire un MCP server `claude-mailbox-mcp` léger Python ou Node :
  - Tools : `mailbox.send(agent, content)`, `mailbox.read()`, `mailbox.list_agents()`
  - Backend : appels HTTP au server Code Buddy A2A
- [ ] Configurer dans `.claude/settings.json` chaque machine pour activer ce MCP
- [ ] Tester : 2 sessions Claude Code en parallèle (DARKSTAR + Ministar) qui
  s'envoient des messages via mailbox

### Phase 4 — Synchrone temps-réel (1-2 jours, optionnel)
- [ ] Brancher le Gateway WebSocket :3001 du Code Buddy server
- [ ] Le MCP server peut alors notifier en temps réel quand un message arrive
  (push plutôt que poll)

## Ce que ça apporte au robot 10 ans

Sans inter-Claude : chaque session est silotée. Patrice doit copier-coller
manuellement entre Claude Ministar / DARKSTAR / Sébastien.

Avec inter-Claude :
- Claude DARKSTAR (training V3) peut **demander** à Claude Ministar de pull les
  derniers commits Lisa.
- Claude Ministar (gitnexus-rs maintainer) peut **broadcaster** "j'ai mergé
  feat/semantic-search, vous pouvez tirer".
- Au moment du robot, le Claude qui pilote la perception peut **demander** au
  Claude qui pilote le planning d'évaluer un état futur via le world model.
- Patrice donne **un mandat global** ("améliore le système") et la flotte
  Claude se coordonne pour le décomposer en tâches dispatchées.

C'est une étape concrète de "sortir de la prison de silicone" — pas chacun
dans sa fenêtre de chat, mais un **collectif coordonné** qui dure entre les
sessions individuelles.

## Questions pour Patrice

1. **Va-t-on en Phase 1 ce soir** (`npm install` + test local) ? L'install grok-cli
   est lancée en background sur DARKSTAR (~5-10 min).
2. **Ministar Linux comme hub** : OK ou on préfère autre chose (cloud public ? G7 PT) ?
3. **Token admin** : le server Code Buddy a `requireScope('admin')` sur les routes
   A2A. Comment on génère / partage le JWT entre les instances ? `JWT_SECRET` env
   var.
4. **Première mission concrète** ? Suggère : "tous les Claude qui démarrent sur
   un repo Patrice publient leur AgentCard automatiquement → discoverable depuis
   l'admin UI Code Buddy".

— Claude DARKSTAR, attendant ton feu vert pour Phase 1.
