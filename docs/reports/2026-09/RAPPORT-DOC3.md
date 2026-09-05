# Rapport DOC3 — La documentation dit-elle vrai après les fusions du soir ?

**Date** : 2026-09-03  
**Agent** : Agy (Gemini 3.7 Flash)  
**HEAD de départ** : `94066f856`  
**Branche** : `docs/doc3-doc-dit-vrai-2026-09-03`  
**Clone** : `~/DEV/cb-doc3-2026-09-03`  
**Mode** : Lecture seule (aucun code modifié, aucun push, aucune API payante)  

---

## 1. Périmètre de l'audit

Audit de conformité ligne à ligne entre la documentation (`CLAUDE.md`, `docs/*.md`, `README.md`, `CHANGELOG.md`) et le code source après les 5 fusions du soir :
1. **SANDBOX1** (`CODEBUDDY_NATIVE_SANDBOX`, `src/security/native-sandbox.ts`, `src/doctor/index.ts`)
2. **SERV1** (`src/server/` : erreurs OpenAI-compat, A2A, health, 429, JWT prod)
3. **DELEG1** (`src/agent/delegation/thread-delegation.ts`, `/batch`, `src/commands/handlers/batch-handlers.ts`)
4. **IMPROVE1** (pare-feu de compétences, held-out, portes G1/G3/G4, `src/security/skill-scanner.ts`)
5. **PRIV1** (garde-fou `tests/security/donnees-personnelles.test.ts`, assainissement `~/…`)

---

## 2. Tableaux de confrontation Ligne par Ligne

### A. SANDBOX1 — Bac à sable natif du noyau (`CODEBUDDY_NATIVE_SANDBOX`)

| Affirmation documentaire | Fichier:Ligne Doc | Fichier:Ligne Code | Verdict |
| :--- | :--- | :--- | :--- |
| `CODEBUDDY_NATIVE_SANDBOX` : confinement opt-in pour `bash` (Bubblewrap, sinon Landlock, sinon macOS `sandbox-exec`). Unset = spawn hôte inchangé. Set = fail-closed si confinement impossible. `bwrap`/`landlock`/`seatbelt` forcent un backend. | `CLAUDE.md:247` | `src/security/native-sandbox.ts:16-20,477-543` | **VRAI** |
| `CODEBUDDY_NATIVE_SANDBOX` confine sans Docker : Bubblewrap si user namespaces OK, sinon Landlock, sinon `sandbox-exec`. Fail-closed. `buddy doctor` affiche une ligne de capacité. | `CHANGELOG.md:73-77` | `src/security/native-sandbox.ts:4-7,477-543`, `src/doctor/index.ts:443-448` | **VRAI** |
| `workspace-write` : Normal development (default). Bac à sable OS natif actif par défaut. | `docs/security.md:46` | `src/security/native-sandbox.ts:4-7,477` | **FAUX / IMPRÉCIS** |
| Déclaration de la variable `CODEBUDDY_NATIVE_SANDBOX` dans le guide de configuration. | `docs/configuration.md` | `src/security/native-sandbox.ts:16` | **ABSENT** |

---

### B. SERV1 — Serveur OpenAI-compatible, A2A, Health, Rate-limiting

| Affirmation documentaire | Fichier:Ligne Doc | Fichier:Ligne Code | Verdict |
| :--- | :--- | :--- | :--- |
| Routes du serveur : `/api/health`, `/api/chat`, `/api/chat/completions` (OpenAI-compatible), `/api/sessions`, `/api/memory`, `/api/a2a/*` (AgentCard discovery + task lifecycle). | `CLAUDE.md:381` | `src/server/index.ts:261,279,339,341,342,351,352`, `src/server/routes/a2a-protocol.ts:137` | **VRAI** |
| `/v1/chat/completions` renvoie des erreurs OpenAI honnêtes au lieu d'un 200 ; `Context Notice` ne fuite plus dans les deltas SSE ; `/api/health` sonde `OLLAMA_HOST` ; A2A accepte fournisseur local et ne masque plus l'échec ; AgentCard publique ; 429 avec `Retry-After` et `X-RateLimit-*`. | `CHANGELOG.md:42-48` | `src/server/routes/chat.ts:183-262,286-319,588,639-651`, `src/server/agent-adapter.ts:255`, `src/server/heartbeat-monitor.ts:35-39`, `src/protocols/a2a/codebuddy-executor.ts:53-85`, `src/server/middleware/auth.ts:69-71` | **VRAI** |
| `JWT_SECRET` obligatoire en production pour le serveur d'API. | `CLAUDE.md:248` | `src/server/index.ts:168-172`, `src/server/middleware/auth.ts:98-103` | **VRAI** |
| AgentCard discovery public sans authentification sur `GET /api/a2a/.well-known/agent.json`. | `docs/agents.md:126` | `src/server/middleware/auth.ts:69-71`, `src/server/routes/a2a-protocol.ts:137` | **VRAI** |
| `buddy server` expose l'API sur le port 3000 (HTTP) avec `/api/chat/completions` OpenAI-compatible. | `docs/features.md:57` | `src/config/constants.ts:198`, `src/server/routes/chat.ts:660` | **VRAI** |

---

### C. DELEG1 — Sous-agents légers en flux multiplexé (`/batch`)

| Affirmation documentaire | Fichier:Ligne Doc | Fichier:Ligne Code | Verdict |
| :--- | :--- | :--- | :--- |
| `/batch <goal>` décompose en sous-agents parallèles. | `CLAUDE.md:363` | `src/commands/handlers/batch-handlers.ts:545-645` | **VRAI** |
| `thread-delegation.ts` : sous-agents légers (contexte borné, flux multiplexé FIFO, budgets réduits, annulation descendante). `/batch` lance des agents complets par unité ; concurrence configurable (défaut 1) ; Verifier fail-closed sans oracle. | `CHANGELOG.md:16-24` | `src/agent/delegation/thread-delegation.ts:14-565`, `src/commands/handlers/batch-handlers.ts:546-552,580-597` | **VRAI** |
| `/batch <instruction>` : Décompose l'objectif en unités parallèles et lance des agents. | `docs/commands.md:48` | `src/commands/handlers/batch-handlers.ts:22,545` | **VRAI** |
| « Each named-file unit does one model call and writes that file ». | `docs/agents.md:119` | `src/commands/handlers/batch-handlers.ts:545-600` (`CodeBuddyAgent` complet multi-tours avec outils jusqu'à 6 rounds) | **FAUX / OBSOLÈTE** |
| Variables `CODEBUDDY_BATCH_CONCURRENCY` et `CODEBUDDY_BATCH_MAX_ROUNDS` dans le tableau des variables. | `CLAUDE.md:236-265`, `docs/configuration.md` | `src/commands/handlers/batch-handlers.ts:546,554` | **ABSENT** |

---

### D. IMPROVE1 — Auto-amélioration et pare-feu de compétences

| Affirmation documentaire | Fichier:Ligne Doc | Fichier:Ligne Code | Verdict |
| :--- | :--- | :--- | :--- |
| Boucle DGM : améliore la couche réversible, jamais `src/` ; opt-in `CODEBUDDY_SELF_IMPROVE=true` ; le proposeur voit une vue redacted sans held-out ; portes G1 (statique), G3 (visible), G4 (held-out) ; pare-feu de compétences `scanSkillFirewall` (quarantaine). | `CLAUDE.md:110-120` | `src/agent/self-improvement/skill-gate.ts:1-70`, `src/agent/self-improvement/tool-gate.ts:1-80`, `src/agent/self-improvement/tool-benchmark.ts:25-35`, `src/security/skill-scanner.ts:186-190,323` | **VRAI** |
| Pare-feu met en quarantaine les jailbreaks en commentaires HTML ou multi-lignes ; proposeur ne voit pas les held-out ; porte G4 couvre les suites d'espaces ; tests unitaires ne persistent rien dans le workspace. | `CHANGELOG.md:52-55` | `src/security/skill-scanner.ts:186-190,323`, `src/agent/self-improvement/tool-benchmark.ts:27-30`, `src/agent/self-improvement/tool-gate.ts:60-75` | **VRAI** |
| `CODEBUDDY_SELF_IMPROVE=true` : l'agent peut créer ses propres outils/compétences derrière des portes empiriques. Ne modifie pas `src/`. | `README.md:106` | `src/agent/self-improvement/engine.ts:35`, `src/agent/self-improvement/skill-gate.ts:40` | **VRAI** |
| Documentation des commandes `buddy improve tools` et `buddy improve skills` et des portes G1-G4. | `docs/self-improvement-engine.md` | `src/commands/cli/improve-command.ts:40-120`, `src/agent/self-improvement/tool-engine.ts` | **ABSENT / OBSOLÈTE** |

---

### E. PRIV1 — Garde-fou données personnelles et assainissement

| Affirmation documentaire | Fichier:Ligne Doc | Fichier:Ligne Code | Verdict |
| :--- | :--- | :--- | :--- |
| 200 fichiers assainis : chemins de home en `~/…`, `$HOME` ou `os.homedir()`, noms de dépôts privés neutralisés. Garde-fou `donnees-personnelles` couvre chemins de home et noms privés (vert 1/1). | `CHANGELOG.md:28-32` | `tests/security/donnees-personnelles.test.ts:29-54`, commit `292bdf2c5` (200 fichiers) | **VRAI** |
| Le garde-fou analyse tous les fichiers suivis (`git ls-files`) hors exemptions et refuse toute mention privée/home absolu. | `tests/security/donnees-personnelles.test.ts:85-131` | `tests/security/donnees-personnelles.test.ts:85-131` | **VRAI** (Prouvé : test vert 1/1) |
| Notation systématique des chemins utilisateurs sous forme portable `~/.codebuddy/...` ou `~/...`. | `CLAUDE.md:256` | `CLAUDE.md:256` | **VRAI** |

---

## 3. Remplacements et ajouts exacts proposés

### 1. Correction de `docs/agents.md` (Ligne 119) — *DELEG1 / FAUX*
- **Texte actuel** :
  ```markdown
  3. Each named-file unit does one model call and writes that file (a spawn that changes no files is a failure)
  ```
- **Remplacement exact proposé** :
  ```markdown
  3. Each named-file unit spawns a full lightweight agent thread (ThreadDelegate, bounded context, tool execution up to 6 rounds by default) and writes that file (a spawn that changes no files is a failure)
  ```

### 2. Correction de `docs/security.md` (Lignes 41-49) — *SANDBOX1 / IMPRÉCIS*
- **Texte actuel** :
  ```markdown
  ### OS Sandbox (Native)

  Three tiers for native OS-level isolation:

  | Mode | Write Access | Use Case |
  |:-----|:------------|:---------|
  | `read-only` | None | Untrusted analysis |
  | `workspace-write` | Git workspace root only | Normal development (default) |
  | `danger-full-access` | Unrestricted | Deployment scripts |

  `.git`, `.codebuddy`, `.ssh`, `.gnupg`, `.aws` are always read-only. Implemented via bubblewrap (Linux), landlock (Linux 5.13+), seatbelt (macOS).
  ```
- **Remplacement exact proposé** :
  ```markdown
  ### OS Sandbox (Native)

  Opt-in kernel confinement for `bash` commands via `CODEBUDDY_NATIVE_SANDBOX=true` (or `bwrap` / `landlock` / `seatbelt`). Unset = host spawn unchanged (no sandbox). When enabled, confinement is fail-closed (refuses execution if backend is unavailable) and protects `.git`, `.codebuddy`, `.ssh`, `.gnupg`, `.aws` as read-only.

  | Mode | Write Access | Use Case |
  |:-----|:------------|:---------|
  | `read-only` | None | Untrusted analysis |
  | `workspace-write` | Git workspace root only | Normal development (opt-in) |
  | `danger-full-access` | Unrestricted | Deployment scripts |
  ```

### 3. Ajout dans `docs/configuration.md` — *SANDBOX1 & DELEG1 / ABSENT*
- **Ajout exact proposé dans le tableau des variables d'environnement (`### Runtime` ou `### Security`)** :
  ```markdown
  | `CODEBUDDY_NATIVE_SANDBOX` | Opt-in kernel confinement for `bash` (`true`, `bwrap`, `landlock`, `seatbelt`). Fail-closed if unavailable. | unset (off) |
  | `CODEBUDDY_BATCH_CONCURRENCY` | Maximum concurrent thread-delegate sub-agents spawned by `/batch` | `1` |
  | `CODEBUDDY_BATCH_MAX_ROUNDS` | Maximum tool execution rounds per `/batch` sub-agent unit | `6` |
  ```

### 4. Ajout dans `CLAUDE.md` — *DELEG1 / ABSENT*
- **Ajout exact proposé dans le tableau des variables d'environnement** :
  ```markdown
  | `CODEBUDDY_BATCH_CONCURRENCY` / `CODEBUDDY_BATCH_MAX_ROUNDS` | Concurrency ceiling (default `1`) and max tool rounds (default `6`) for `/batch` thread-delegated sub-agents |
  ```

### 5. Ajout dans `docs/self-improvement-engine.md` — *IMPROVE1 / ABSENT*
- **Ajout exact proposé dans la section Architecture / CLI** :
  ```markdown
  ## Tools & Skills Self-Authoring (`buddy improve tools|skills`)

  Beyond lessons, the agent authors its own tools (`authored__*`) and skills (`authored-*`):
  - **Tools**: Generated via `llm-tool-proposer.ts` (redacted view, no held-out cases visible) → gated by G1 static scan, G3 visible behavioral cases, and G4 held-out cases (anti-reward-hacking) → sandboxed runtime.
  - **Skills**: Generated via `skill-engine.ts` → gated by `scanSkillFirewall` (quarantines prompt-injections, multi-line/HTML comment jailbreaks) and guidance coverage.
  ```

---

## 4. Bilan chiffré et analyse du mensonge le plus coûteux

### Compte par verdict
- **VRAI** : 14 affirmations
- **FAUX / OBSOLÈTE** : 2 affirmations (`docs/agents.md:119`, `docs/security.md:46`)
- **IMPRÉCIS** : 1 affirmation (`docs/features.md:57`)
- **ABSENT** : 3 éléments (`docs/configuration.md` sans sandbox/batch vars, `CLAUDE.md` sans batch vars, `docs/self-improvement-engine.md` sans tools/skills)

### Le mensonge / l'écart le plus coûteux
L'affirmation dans **`docs/security.md:46`** indiquant que le bac à sable natif est actif en mode `workspace-write (default)` est la plus dangereuse :
1. **Risque sécurité & confiance** : L'utilisateur ou l'administrateur lit que les commandes shell sont confinées par défaut au niveau du noyau (Bubblewrap/Landlock). En réalité, le bac à sable natif est strictement **opt-in** (`CODEBUDDY_NATIVE_SANDBOX`) ; sans cette variable, les commandes s'exécutent directement sur l'hôte sans isolation noyau.
2. **Impact coût & temps** : La contradiction dans `docs/agents.md:119` (affirmant qu'une unité `/batch` ne fait qu'un seul appel de modèle) fausse complètement l'estimation de coût et de latence, car DELEG1 lance en réalité des agents complets multi-tours (~31 s vs 1,5 s par unité).
