# Multi-AI collaboration — Hermes vs OpenClaw vs Code Buddy

Date: 2026-06-08

> Question (Patrice) : *« plusieurs AI et Code Buddy doivent pouvoir collaborer —
> comment est-ce fait dans Hermes et OpenClaw ? »*
>
> Réponse courte : **Code Buddy collabore déjà en multi-AI** (la fleet : `peer.chat`,
> `peer.tool.invoke`, `peer_delegate`, A2A, ACP) — son substrat AI-to-AI est
> **plus riche** qu'OpenClaw. La seule brique distinctive que **Hermes** a et que
> Code Buddy n'a pas *unifiée* est un **tableau de tâches partagé, multi-machine,
> ordonné par dépendances, avec claim à bail (TTL)**. Les morceaux existent déjà
> (moteur DAG `cowork/missions`, queue fleet `colab-store`, fleet peer.chat) — ils
> ne sont pas câblés ensemble pour le cas multi-machine. Donc le travail probable
> est **du câblage, pas un 4ᵉ système de tâches**.

---

## 1. Comment Hermes le fait — le **kanban**

Hermes centralise la collaboration multi-IA dans un **board kanban SQLite durable
partagé entre profils** (`hermes kanban`). Chaque IA est un *profil*.

- **Claim atomique + TTL** : `kanban claim <task> --ttl 900` réserve une tâche
  *ready* de façon atomique (SQLite) et imprime le workspace résolu. Le bail
  expire (défaut 900 s) → la tâche d'une IA morte est **auto-relâchée**. C'est la
  pièce de robustesse clé : « une IA crashe en plein milieu » est géré nativement.
- **Dépendances (DAG)** : `kanban link parent child` — une tâche n'est *ready*
  que quand ses dépendances sont *done*.
- **Workspaces isolés** par profil (chaque worker travaille à part).
- **Swarm** : `kanban swarm GOAL --worker P:T:SKILLS … --verifier V --synthesizer S`
  — décompose un but en **workers parallèles → verifier → synthesizer** (une
  topologie multi-agent de vérification/synthèse, exactement la discipline
  « rien de “fait” sans preuve »).
- **Mode continu** : `kanban daemon` / `watch` / `heartbeat`, `assign`/`reassign`/
  `reclaim`, `comment`, `block`/`unblock`, `schedule`, `dispatch`, `decompose`.

→ Modèle : **un board partagé, atomique, à dépendances, avec des profils qui
claiment et exécutent en parallèle**.

## 2. Comment OpenClaw le fait — le **gateway hub**

OpenClaw centralise sur un **gateway** (déjà documenté dans
`docs/openclaw-integration-audit.md`) :

- **Agents isolés** (`openclaw agents add|bind|bindings`) : plusieurs agents,
  chacun workspace + auth, derrière un seul gateway.
- **Routing bindings** : quel canal / compte / peer route vers quel agent
  (`bind`/`unbind`). La collaboration = le gateway dispatche les messages
  entrants vers le bon agent.
- **Node delegation + pairing** : des *nodes* (devices) s'appairent au gateway
  (pending → approve → token) et peuvent exécuter du travail délégué.
- **Bridge ACP** (`openclaw acp`) : expose les agents via l'Agent Client Protocol
  (clé de session `agent:main:main`) pour qu'un éditeur/un autre agent les pilote.
- **Channels** : Telegram/Slack/Discord/… comme surfaces d'entrée/sortie.

→ Modèle : **un hub central qui route entre canaux, agents isolés et nodes
appairés** ; collaboration *humain↔agent* et *agent↔node*, pas un board de tâches
partagé entre IA pairs.

## 3. Ce que Code Buddy a **déjà**

| Axe | Surfaces existantes |
|---|---|
| **AI-to-AI (LLM/outils entre pairs)** | Fleet : `peer.chat` / `peer.chat-stream` / `peer.chat-session.*` / `peer.tool.invoke` / `peer.describe`, l'outil `peer_delegate` (le LLM délègue tout seul à un pair), `route_peer` (classe + choisit un pair). Transport WS gateway sur **Tailscale**. |
| **Protocoles d'interop** | **A2A** (Google Agent-to-Agent : AgentCard + cycle de tâche, `/api/a2a/*`), **ACP** (`protocols/acp/acp-server`, `acp-agentic-runner` — Code Buddy *est* un agent ACP pilotable), **MCP**. |
| **Moteur de tâches DAG** | `cowork/src/main/missions/` — `Mission` + `SubTask.dependsOn[]` (graphe), `mission-heartbeat` (réveil proactif 15 min), `mission-recovery` (resume au boot), store atomique. **Mono-machine** (Electron, câblé à la Mission Board Cowork). |
| **Queue fleet cross-machine** | `src/fleet/colab-store.ts` (convention `colab-tasks.json`/`worklog`/`presence`, claim optimiste, garde-fou `critical`, détection de présence stale). Multi-machine (arbitrage = `git push`). |
| **Boucle autonome** | `src/daemon/autonomous-loop.ts` + `autonomous-daemon.ts` (tick continu + `wake()` event-driven), échelle de modèles **local → réseau Tailscale → payant** (`model-tier`). |
| **Multi-agent in-process** | `MultiAgentSystem` + `/swarm` / `/team` / `/batch` (décompose en sous-tâches parallèles via `WorkflowOrchestrator`). |

## 4. Carte des recoupements + **le vrai gap**

| Capacité | Hermes | OpenClaw | Code Buddy |
|---|:--:|:--:|:--:|
| Invocation LLM AI-to-AI entre pairs | via portal/tools | partiel (node) | **oui (peer.chat, plus riche)** |
| Protocole agent standard (ACP/A2A) | ACP | ACP | **ACP + A2A + MCP** |
| Gateway hub + routing | oui | **oui (cœur)** | oui (fleet + gateway) |
| Pairing d'appareil | DM pairing | **oui (cœur)** | oui (gateway device pairing, ajouté 2026-06-08) |
| Board de tâches partagé | **kanban (cœur)** | non (routing) | colab-store (file) + cowork DAG (mono-machine) |
| Claim **atomique + TTL/bail** | **oui** | n/a | **non** ← gap |
| Dépendances (DAG) entre tâches | **oui** | n/a | oui *mais* mono-machine (cowork), pas dans la queue fleet ← gap d'unification |
| Topologie swarm (workers→verifier→synth) | **oui** | non | `/swarm` in-process, pas sur board partagé |
| Workspaces isolés par profil | **oui** | oui (agents) | partiel |

**Le gap honnête** : Code Buddy n'a pas **un** tableau partagé, multi-machine,
ordonné par dépendances, avec **claim à bail (TTL)** — le combo distinctif du
kanban Hermes. Mais les briques existent : le **moteur DAG `cowork/missions`**, la
**queue fleet `colab-store`**, et le substrat **fleet peer.chat**. Le manque est
l'**unification/câblage**, pas un nouveau moteur.

## 5. Recommandation (si on code)

Par ordre de valeur, **sans bâtir un 4ᵉ board** :

1. **TTL/bail sur le claim du `colab-store`** (robustesse n°1 : une IA qui meurt
   en plein travail → son claim expire et la tâche redevient *ready*). Version
   honnête minimale = **expiration paresseuse à la lecture** (`nextClaimable`
   ignore un claim dont le bail est dépassé) — pas de timer/sweeper tant que le
   daemon ne le pilote pas. Compose avec la détection de présence stale déjà là.
2. **Dépendances dans la queue fleet** : porter `dependsOn[]` (déjà éprouvé dans
   `cowork/missions`) sur `colab-store` → une tâche n'est claimable que si ses
   parents sont *completed*. Idéalement **réutiliser les types `cowork/missions`**
   plutôt que redéfinir.
3. **Topologie swarm** = chantier séparé et ultérieur (ne pas bundler).

**Ne pas refaire la fleet** : `peer.chat`/`peer_delegate`/A2A/ACP sont déjà le
substrat multi-IA, et sur l'axe AI-to-AI Code Buddy dépasse OpenClaw.

---

*Rédigé par Claude (Opus 4.8, 1M context), Ministar Ubuntu, 2026-06-08, avec
Hermes Agent v0.16.0 et OpenClaw 2026.6.1 installés localement et inspectés.*
