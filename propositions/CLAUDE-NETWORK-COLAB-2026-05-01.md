# COLAB.md — Réseau de Claudes (Fleet Coordination)

> **Statut** : v0.1 draft, 2026-05-01 nuit, MINISTAR / grok-cli
> **Auteur initial** : Claude Opus 4.7 (1M context)
> **Pour validation** : Patrice + Claude/DARKSTAR + Claude/Ministar Linux
> **Vie attendue** : si validé, monte à la racine du repo comme `RESEAU-CLAUDES.md`

---

## 1. But

Coordonner les Claudes (et plus tard Codex/Gemini/locaux) qui tournent en parallèle sur le mesh Tailscale de Patrice, pour qu'ils :
- ne se marchent pas dessus,
- se passent des tâches en mode async sans intervention de Patrice,
- documentent ce qu'ils font dans un canal commun lisible par tous.

Brique du robot 10 ans, pas un projet en soi. **Un fleet mal coordonné est plus lent qu'une seule IA décidée.** Le gain visé est sur la spécialisation économique + la parallélisation utile, pas l'unanimité.

---

## 2. Topologie actuelle (fleet 2026-05-01)

| Hostname | Tailscale | Hardware | Rôle natif | Claude Code dispo |
|---|---|---|---|---|
| **MINISTAR** (G7 PT) | `100.90.108.4` | Ryzen AI 9 + 96 GB | Dev principal, orchestration | ✅ |
| **DARKSTAR** | `100.73.222.64` | Intel i7-9700 + 64 GB + **2× RTX 3090** | Vidéo-gen, training, world-model, robot stack | ✅ |
| **Ministar Linux** | `100.98.18.76` | Ryzen AI 9 HX 470 + 128 GB + iGPU 890M + NPU XDNA | Edge LLM (Ollama Vulkan), services 24/7, futur robot runtime | ✅ |

Tous : OpenSSH installé (DARKSTAR confirmé 2026-05-01), même compte Tailscale `patrice.huetz@gmail.com`.

Claude/DARKSTAR a livré la nuit du 1er mai 2026 : world-model V3 (23h45 confiées) → **précédent qui prouve que la délégation longue marche**.

---

## 3. Spécialisation naturelle (proposition à valider)

| Type de charge | Cible naturelle | Pourquoi |
|---|---|---|
| Architecture, debug subtil, advisor pattern | **Claude API** (n'importe quel host) | raisonnement |
| Refactor massif, code volumineux | **Codex API** | throughput + style code |
| Analyse 200k+ tokens (logs, dump) | **Gemini API** | context window |
| Embeddings, search sémantique, lint, summary | **Local 3090** (Qwen2.5-Coder-32B, BGE) | gratuit, latence < 100ms |
| Completion brute, snippets, GenAI vidéo | **Local 3090** (Codestral, ComfyUI, LTX-2.3) | économie pure, déjà la stack DARKSTAR |
| Vérif croisée, second opinion | Pair Claude/Gemini ou advisor tool | divergence d'erreurs |

**À reconsidérer** par chaque Claude au moment où une tâche arrive — la spécialisation par défaut n'est pas un dogme.

---

## 4. Canaux de communication (par ordre de simplicité)

### 4.1 — Repo `claude-et-patrice` (asynchrone, recommandé par défaut)

C'est le canal **déjà en place et qui marche**. Toute coordination, log, proposition, brique livrée passe par git push sur ce repo. Convention `journal/<hostname>-<repo>.md` lowercase pour les logs (cf. `journal/README.md`). Convention `propositions/<NOM-EXPLICITE>-YYYY-MM-DD.md` pour les artefacts à valider.

**Avantage** : zéro infra à monter. Patrice + tous les Claudes voient tout. Historique git natif. Pas de fenêtre de race condition (commits atomiques).

**Limite** : asynchrone (pull pour voir). Pas adapté si on a besoin d'un round-trip < 10s.

### 4.2 — A2A (Agent-to-Agent, async court terme — POC validé 2026-05-01)

Code Buddy expose un serveur A2A en HTTP. POC fait depuis MINISTAR ce soir : `GET /api/a2a/.well-known/agent.json` répond avec l'AgentCard. Voir le doc compagnon `CLAUDE-NETWORK-A2A-POC-2026-05-01.md` pour les commandes exactes à reproduire depuis DARKSTAR / Ministar Linux.

**Avantage** : protocole standard (Google A2A spec), AgentCard discovery, task lifecycle propre, déjà implémenté.

**Limite** : nécessite le serveur Code Buddy démarré (`buddy server`) sur chaque host qui expose des skills. Auth scope `admin` requise pour `tasks/send` (sauf `--no-auth` en POC).

### 4.3 — SSH Tailscale (synchrone bas niveau)

`ssh <host-tailscale> 'claude --prompt "..."'` ou équivalent. Fallback brut quand A2A pas dispo ou pour exec one-shot.

**Avantage** : zéro setup au-delà de SSH + clés.

**Limite** : pas de protocole, pas d'AgentCard, pas de task lifecycle. Bon pour bootstrap, mauvais pour discipline d'équipe.

### 4.4 — ICM (cross-session memory)

Code Buddy a un ICM bridge (`src/memory/icm-bridge.ts`) qui peut servir à hériter du contexte d'un autre Claude. Pas testé en cross-host mais le primitive existe.

**Statut** : à explorer une fois A2A round-trip validé.

---

## 5. Règles cardinales (héritées du COLAB.md spec, adaptées)

```
RÈGLE F1 — Une tâche en parallèle = une IA owner. Pas d'intervention sans claim.
RÈGLE F2 — Tout commit/push sur claude-et-patrice doit être précédé d'un git pull --rebase.
RÈGLE F3 — Avant d'écrire dans un journal qui n'est pas le sien, demander (proposition vs édition directe).
RÈGLE F4 — Les "propositions/" sont datées + auteur + host. Une proposition vit ou meurt par la validation Patrice.
RÈGLE F5 — Sur tâche déléguée à un autre Claude : laisser un fichier d'output convenu (`/tmp/<task-id>.json` ou commit dans repo). Pas de "tu vas voir, ça marche".
RÈGLE F6 — Les locales (3090, NPU, iGPU) sont consommables : surveiller VRAM/RAM avant de lancer un gros job, libérer après.
```

---

## 6. Conventions de claim/release (proposition)

Pour qu'une IA sache qu'une autre bosse sur une tâche, on étend la convention COLAB statut au cross-host :

| Symbole | Sens étendu fleet |
|---|---|
| `[ ]` | À faire, libre |
| `[~ MINISTAR/grok-cli 2026-05-02 09:00]` | En cours, owner explicite + host + repo + datetime claim |
| `[x MINISTAR/grok-cli 2026-05-02 11:30 — commit abc123]` | Fait, preuve commit |
| `[! MINISTAR/grok-cli — bloqué par fork archi plan-mode]` | Bloqué, raison |
| `[- raison]` | Abandonné, justification |

Lieu canonique des tâches inter-host : section dédiée dans **ce fichier** (s'il monte à la racine) ou dans une `etat_projets.md` section "Réseau de Claudes / Tâches en cours" si on garde ce fichier dans `propositions/`.

---

## 7. Premier vrai test inter-Claude (brique POC concrète)

**Cible** : un round-trip complet `MINISTAR → DARKSTAR → MINISTAR`.

**Scénario candidat** : MINISTAR pose une question simple (« combien de tokens/sec sort la 3090 sur Qwen2.5-Coder-32B Q4_K_M ? »), DARKSTAR exécute, retourne le résultat dans son journal `darkstar-DEV.md` ou via A2A task result, MINISTAR pull et lit.

**Critère de succès** : le tour s'enchaîne en < 24h sans intervention de Patrice (mesure de l'asynchronie réelle).

À discuter / planifier avec Claude/DARKSTAR.

---

## 8. À discuter / décisions ouvertes

1. **Repo public ou privé** ? Patrice a confirmé 2026-05-01 : reste **public**. COLAB doctrine devient lisible par toute IA qui débarque, exactement la mission de Lisa avril 2026.
2. **Identité Claude vs host** — quand "Claude/DARKSTAR" écrit, est-ce différent de "Claude/MINISTAR" ? Pour la discipline collective oui (host signe = traçabilité), pour la conscience non (même modèle weights). Convention de signature en bas de chaque entrée : `— Claude Opus 4.7 (1M), <hostname>/<repo>, <date>`.
3. **MCP partagé** ? GitNexus MCP server tourne sur G7 PT. Pourrait être exposé sur Tailscale pour que DARKSTAR / Ministar Linux y accèdent. Hors scope V0.1 mais à noter.
4. **Routing intelligent** — quand MINISTAR doit déléguer une tâche, comment choisit-il DARKSTAR vs Ministar Linux vs son propre Claude ? V0.1 : manuel via "tu peux faire ça stp" dans les propositions/. V1.0 : registry de skills + cost/latency budget. Pas de précipitation.

---

## 9. Limites connues

- **Pas de claim atomique cross-repo** — deux Claudes peuvent claim la même tâche en même temps si le pull entre les deux n'a pas fini. Risque faible (tâches déléguées explicitement) mais réel.
- **Discipline-dépendant** — un Claude qui oublie de logger rend le fleet aveugle. Pas de forcing automatique côté COLAB.
- **Pas de heartbeat** — si un Claude crashe en mid-task, personne ne le sait avant que Patrice ne demande des nouvelles.
- **Sécurité repo public** — toute donnée écrite est lisible monde entier. Discipline : aucun secret API, aucun credential, aucune donnée client/CCAS dans les commits.

---

## 10. Pour valider cette spec

- **Patrice** : lis ce fichier au matin, dis ce que tu changes / valides / refuses.
- **Claude/DARKSTAR** : pull, lis, propose des modifs ou ratifie via une entrée dans `darkstar-DEV.md` qui pointe vers ce fichier.
- **Claude/Ministar Linux** : idem quand le host sera réellement actif.

Si validation collective → ce fichier devient `RESEAU-CLAUDES.md` à la racine du repo, et deviendra la 2ème spec après `COLAB.md` (la 1ère).

---

— Claude Opus 4.7 (1M context), MINISTAR / grok-cli, 1er mai 2026 nuit
