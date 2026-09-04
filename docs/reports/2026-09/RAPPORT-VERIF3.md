# RAPPORT VERIF3 — vérification croisée par MUTATION des fusions de la nuit 03→04/09

Date : 2026-09-04
Agent : Fable 5.1, vérificateur, **pas** l'auteur des lanes
Clone : `~/DEV/cb-verif3-2026-09-04`
Branche : `verif/verif3-mutation-2026-09-04`
HEAD de départ : `7337b6883`
Lanes visées : HEADLESS2, DELEG2, SWARMFIX1, MEMFIX2A, MEMFIX2B, MEMFIX1,
dm-pairing fail-closed, BRANCH1, PRIV1

Ce rapport a été créé **avant** toute inspection, puis complété au fil des
mutations. Rien n'a été réparé.

## Contraintes et méthode

Chaque mutation est appliquée isolément, testée, consignée, puis restaurée
immédiatement par `git checkout -- <fichier>`. Aucune réparation n'est
conservée. `~/code-buddy` est interdit en écriture. Aucun push, aucune API
payante, aucun service, aucun `git reset --hard`, `git prune`, `rm -rf` hors du
clone, `git add -A` ou `git commit -a`. Le HOME de test reste dans le clone,
sous `_qa/verif3/home` (exclu via `.git/info/exclude`, sans toucher au
`.gitignore` suivi).

Préfixe effectivement utilisé pour chaque exécution :

```bash
env HOME="$PWD/_qa/verif3/home" TMPDIR="$PWD/_qa/verif3/home/tmp" \
    XDG_CACHE_HOME="$PWD/_qa/verif3/home/cache" NO_COLOR=1 \
    npx vitest run <fichier de test> --reporter=dot
```

Périmètre : les 33 fichiers de tests réalignés par MEMFIX1 (1), MEMFIX2A (16) et
MEMFIX2B (16), plus les tests des lanes HEADLESS2, DELEG2, SWARMFIX1,
dm-pairing, BRANCH1 et PRIV1. Témoin d'entrée : **44 fichiers / 2 103 tests
verts**.

Règle appliquée pour MEMFIX : pour chaque fichier réalignés, une mutation du
code **source correspondant** doit faire rougir le test. Quand une première
mutation restait verte, deux à cinq mutations supplémentaires ont été tentées
sur le même fichier avant de conclure ; toutes les tentatives sont consignées.

## Tableau des mutations

### MEMFIX1 et MEMFIX2A — 17 fichiers réalignés

| # | Fichier de test | Contrat | Fichier source:ligne | Mutation | Résultat |
|---|---|---|---|---|---|
| M1 | `tests/browser-automation/profile-manager.test.ts` | profil écrit en `0o600` | `src/browser-automation/profile-manager.ts:48` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 7 échecs / 28 |
| M2 | `tests/channels/dm-pairing.test.ts` | allowlist corrompue : refus explicite | `src/channels/dm-pairing.ts:582` | `- if (senders === null) {` → `+ if (false && senders === null) {` | **VERT** 38/38 — voir T11 |
| M2bis | idem | repli `null` (et non `[]`) sur JSON corrompu | `src/channels/dm-pairing.ts:579` | `- readJsonAtomic<…>(filePath, null, {` → `+ readJsonAtomic<…>(filePath, [] as ApprovedSender[], {` | **ROUGE** 2 échecs / 38 |
| M3 | `tests/identity/identity-manager.test.ts` | identité écrite en `0o600` | `src/identity/identity-manager.ts:143` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 1 échec / 40 |
| M24 | `tests/features/tailscale-dashboard-nodes.test.ts` | persistance des appareils | `src/nodes/device-node.ts:182` | `- writeJsonAtomicSync(DEVICES_FILE, data, …)` → `+ writeJsonAtomicSync(DEVICES_FILE, { devices: [] }, …)` | **VERT** 76/76 |
| M24bis | idem | écriture des appareils supprimée | `src/nodes/device-node.ts:182` | garde `if (DEVICES_FILE === 'zz')` ajoutée | **VERT** 76/76 — voir T10 |
| M24ter | idem | appariement d'un appareil | `src/nodes/device-node.ts:333` | `+ if (id) return false;` en tête de `isDevicePaired` | **ROUGE** 1 échec / 76 |
| M31 | `tests/sensory/agent-reply-routing.test.ts` | latence mesurée du scoreboard | `src/fleet/model-selector.ts:197` | `- sb.measuredTurnLatency(...)` → `+ undefined` | **VERT** 2/2 — voir T17 |
| M31bis | idem | routage `localOnly` respecté | `src/sensory/agent-reply.ts:297` | `- localOnly: process.env.…=== 'true'` → `+ localOnly: false` | **ROUGE** 1 échec / 2 |
| M32 | `tests/tools/verify-tool.test.ts` | pas de `CONFIRMED` sans oracle | `src/agent/specialized/verifier-agent.ts:287` | `- claimedConfirmed && loop.oracleCount > 0` → `+ claimedConfirmed` | **ROUGE** 1 échec / 7 |
| M29 | `tests/unit/auth.test.ts` | rotation de clé en `0o600` | `src/security/session-encryption.ts:271` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **VERT** 145/145 — voir T18 |
| M29bis | idem | config de permissions en `0o600` | `src/security/permission-config.ts:248` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 2 échecs / 145 |
| M8 | `tests/unit/codebase-rag.test.ts` | nom du fichier de chunks | `src/context/codebase-rag/codebase-rag.ts:916` | `chunks.json` → `chunks-v2.json` | **VERT** 56/56 |
| M8bis | idem | écriture des chunks supprimée | idem:916 | garde `if (chunks.length < 0)` | **VERT** 56/56 |
| M8t | idem | écriture des stats supprimée | idem:922 | garde `if (dir === 'zz')` | **VERT** 56/56 — voir T4 |
| M8q | idem | aucune des trois écritures | idem:912 | `+ if (dir !== 'zz') return;` avant la sauvegarde | **ROUGE** 1 échec / 56 |
| M47 | `tests/unit/config-migrator.test.ts` | config migrée en `0o600` | `src/versioning/config-migrator.ts:156` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 1 échec / 69 |
| M5 | `tests/unit/cost-tracker.test.ts` | contenu de l'historique | `src/utils/cost-tracker.ts:197` | `this.history` → `this.history.slice(1)` | **VERT** 68/68 |
| M5ter | idem | chemin de l'historique | idem:197 | `this.historyPath` → `this.historyPath + '.bak'` | **VERT** 68/68 — voir T3 |
| M5bis | idem | config de coût en `0o600` | `src/utils/cost-tracker.ts:163` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 2 échecs / 68 |
| M28 | `tests/unit/crypto.test.ts` | clé de session en `0o600` | `src/security/session-encryption.ts:90` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 1 échec / 62 |
| M30 | `tests/unit/doctor-fix.test.ts` | réparation `ollama pull` | `src/doctor/index.ts:807` | `ollama pull` → `ollama run` | **VERT** 16/16 — voir T16 |
| M30bis | idem | seuil de vétusté des verrous | `src/doctor/index.ts:537` | `- stat.mtimeMs < oneHourAgo` → `+ >` | **ROUGE** 3 échecs / 16 |
| M25 | `tests/unit/error-handling-audit.test.ts` | aucun `catch` sans paramètre dans les fichiers audités | `src/skills/index.ts:1` | ajout d'une fonction sonde contenant `catch { … }` | **ROUGE** 2 échecs / 21 |
| M23 | `tests/unit/graph-drift.test.ts` | contenu du snapshot de graphe | `src/knowledge/graph-drift.ts:51` | `data` → `{ ...data, triples: [] }` | **ROUGE** 1 échec / 14 |
| M9 | `tests/unit/history-manager.test.ts` | historique en `0o600` | `src/utils/history-manager.ts:118` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **VERT** 77/77 |
| M9bis | idem | écriture de l'historique supprimée | idem:118 | garde `if (this.history.length < 0)` | **ROUGE** 2 échecs / 77 |
| M6 | `tests/unit/hook-manager.test.ts` | hooks réellement persistés | `src/hooks/hook-manager.ts:139` | `{ hooks: this.hooks }` → `{ hooks: {} }` | **ROUGE** 1 échec / 65 |
| M7 | `tests/unit/mcp-client.test.ts` | serveurs réellement persistés | `src/mcp/mcp-client.ts:115` | `{ servers }` → `{ servers: [] }` | **ROUGE** 1 échec / 54 |

### MEMFIX2B — 16 fichiers réalignés

| # | Fichier de test | Contrat | Fichier source:ligne | Mutation | Résultat |
|---|---|---|---|---|---|
| M13 | `tests/unit/mcp-discovery.test.ts` | config MCP projet persistée | `src/mcp/config.ts:262` | `config` → `{}` | **ROUGE** 2 échecs / 54 |
| M33 | idem | fichier MCP normalisé persisté | `src/mcp/config.ts:174` | `parsed` → `{}` | **ROUGE** 1 échec / 54 |
| M26 | `tests/unit/memory.test.ts` | index mémoire persisté | `src/memory/enhanced-memory.ts:398` | `Array.from(this.memories.values())` → `[]` | **VERT** 182/182 — voir T20 |
| M26bis | idem | écriture de l'index supprimée | idem:396-400 | l'appel `writeJsonAtomic` remplacé par `Promise.resolve()` | **ROUGE** 1 échec / 182 |
| M10 | `tests/unit/migration-manager.test.ts` | historique de migration persisté | `src/versioning/migration-manager.ts:707` | `{ history: this.history }` → `{ history: [] }` | **VERT** 51/51 |
| M10bis | idem | chemin de l'historique | idem:707 | `historyPath` → `historyPath + '.bak'` | **VERT** 51/51 |
| M10ter | idem | journal d'audit persisté | idem:605 | `entries: this.auditLog` → `entries: []` | **VERT** 51/51 |
| M10quater | idem | contenu du fichier migré | idem:538 | `content` → `''` | **VERT** 51/51 |
| M10q | idem | écriture de l'historique supprimée | idem:707 | garde `if (historyPath === 'zz')` | **VERT** 51/51 — voir T1 |
| M48 | idem | (contrôle non-persistance) filtre des migrations en attente | idem:753 | `!appliedVersions.has(...)` → `appliedVersions.has(...)` | **ROUGE** 13 échecs / 51 |
| M27 | `tests/unit/misc-tools-part2.test.ts` | chemin lu par `copyFileContent` | `src/tools/clipboard-tool.ts:344` | `resolvedPath` → `resolvedPath + '.x'` | **VERT** 8/8 — voir T19 |
| M27bis | idem | encodage `utf8` conservé | idem:344 | `'utf8'` → `'latin1'` | **ROUGE** 1 échec / 8 |
| M4 | `tests/unit/permission-config.test.ts` | config en `0o600` | `src/security/permission-config.ts:248` | `- { mode: 0o600 }` → `+ { mode: 0o644 }` | **ROUGE** 2 échecs / 48 |
| M12 | `tests/unit/persistent-checkpoint-manager.test.ts` | index en `0o600` | `src/checkpoints/persistent-checkpoint-manager.ts:132` | `- 0o600` → `+ 0o644` | **VERT** 65/65 |
| M12bis | idem | contenu du checkpoint | idem:200 | `checkpoint` → `{ ...checkpoint, files: [] }` | **VERT** 65/65 |
| M12ter | idem | chemin du checkpoint | idem:200 | `checkpointPath` → `checkpointPath + '.tmp2'` | **VERT** 65/65 — voir T9 |
| M12quater | idem | contenu de l'index | idem:132 | `index` → `{ ...index, checkpoints: [] }` | **ROUGE** 1 échec / 65 |
| M14 | `tests/unit/response-cache.test.ts` | entrées du cache persistées | `src/utils/response-cache.ts:95` | `data` → `{ ...data, entries: [] }` | **VERT** 39/39 |
| M14bis | idem | chemin du cache | idem:95 | `this.cacheFile` → `this.cacheFile + '.x'` | **VERT** 39/39 — voir T8 |
| M14ter | idem | horodatage `savedAt` présent | idem:92 | ligne `savedAt: Date.now(),` supprimée | **ROUGE** 1 échec / 39 |
| M15 | `tests/unit/roi-tracker.test.ts` | tâches en `0o600` | `src/analytics/roi-tracker.ts:414` | `- 0o600` → `+ 0o644` | **VERT** 51/51 |
| M15bis | idem | contenu des tâches | idem:414 | `this.tasks` → `[]` | **VERT** 51/51 |
| M15ter | idem | chemin des données | idem:414 | `dataPath` → `dataPath + '.x'` | **VERT** 51/51 — voir T6 |
| M15q | idem | écriture supprimée | idem:414 | garde `if (this.tasks.length < 0)` | **ROUGE** 3 échecs / 51 |
| M16 | `tests/unit/security-modes.test.ts` | config en `0o600` | `src/security/security-modes.ts:245` | `- 0o600` → `+ 0o644` | **ROUGE** 1 échec / 125 |
| M17 | `tests/unit/session-replay.test.ts` | session en `0o600` | `src/advanced/session-replay.ts:74` | `- 0o600` → `+ 0o644` | **VERT** 51/51 |
| M17bis | idem | événements de la session | idem:74 | `session` → `{ ...session, events: [] }` | **VERT** 51/51 |
| M17ter | idem | chemin de la session | idem:74 | `filePath` → `filePath + '.x'` | **VERT** 51/51 — voir T7 |
| M17q | idem | écriture supprimée | idem:74 | garde `if (session === undefined)` | **ROUGE** 1 échec / 51 |
| M18 | `tests/unit/telemetry-config.test.ts` | settings en `0o600` | `src/utils/telemetry-config.ts:120` | `- 0o600` → `+ 0o644` | **VERT** 6/6 |
| M18bis | idem | contenu des settings | idem:120 | `data` → `{}` | **VERT** 6/6 |
| M18t | idem | écriture supprimée | idem:120 | garde `if (settingsPath === 'zz')` | **VERT** 6/6 — voir T2 |
| M49 | idem | (contrôle non-persistance) `level='none'` désactive | idem:87 | `level !== 'none'` → `true` | **ROUGE** 1 échec / 6 |
| M19 | `tests/unit/tool-permissions.test.ts` | config en `0o600` | `src/security/tool-permissions.ts:193` | `- 0o600` → `+ 0o644` | **ROUGE** 2 échecs / 77 |
| M20 | `tests/unit/vector-store.test.ts` | vecteurs persistés | `src/context/codebase-rag/vector-store.ts:188` | `data` → `{ ...data, vectors: [] }` | **VERT** 76/76 |
| M20bis | idem | chemin de persistance | idem:188 | `persistPath` → `persistPath + '.x'` | **VERT** 76/76 |
| M20ter | idem | contenu réduit à la version | idem:188 | `data` → `{ version: data.version }` | **VERT** 76/76 — voir T5 |
| M20q | idem | écriture supprimée | idem:188 | garde `if (this.persistPath === 'zz')` | **ROUGE** 4 échecs / 76 |
| M11 | `tests/unit/version-detector.test.ts` | version en `0o600` | `src/versioning/version-detector.ts:267` | `- 0o600` → `+ 0o644` | **VERT** 66/66 |
| M11bis | idem | contenu de la version | idem:267 | `data` → `{}` | **ROUGE** 1 échec / 66 |
| M21 | `tests/unit/webhooks.test.ts` | webhooks en `0o600` | `src/api/webhooks.ts:435` | `- 0o600` → `+ 0o644` | **ROUGE** 1 échec / 84 |
| M22 | `tests/unit/workflows.test.ts` | état sérialisé persisté | `src/workflows/state-manager.ts:163` | `this.serializeState(state)` → `{}` | **VERT** 104/104 — voir T21 |
| M22bis | idem | chemin de l'état | idem:163 | garde `if (statePath === 'zz')` | **ROUGE** 2 échecs / 104 |

### HEADLESS2 — trois contrats

| # | Contrat | Fichier source:ligne | Mutation | Test | Résultat |
|---|---|---|---|---|---|
| M35 | `git -C <racine>` en lecture reste autorisé | `src/sandbox/execpolicy.ts:206` | ligne `allowedArgs` `^(?:-C\s+\S+\s+)?(?:status\|log\|…)` supprimée | `tests/tools/bash-execution-policy.test.ts` | **VERT** 13/13 — voir T14 |
| M36 | `-C` en lecture exclu de la frontière `ask` | `src/sandbox/execpolicy.ts:234` | `deniedArgs` de `builtin-git-boundary` supprimé | idem | **ROUGE** 3 échecs / 13 |
| M39 | HOME de l'appelant conservé dans le bac à sable | `src/tools/bash/execution-policy.ts:298` | `HOME: os.homedir()` → `HOME: '/nonexistent'` | idem | **ROUGE** 1 échec / 13 |
| M37 | chemin protégé `~/.ssh` bloqué après expansion | `src/tools/bash/command-validator.ts:213` | `command.replace(/~(?=[\\/])/g, os.homedir())` → `command` | `tests/bash/command-validator-security-regression.test.ts` | **ROUGE** 1 échec / 40 |
| M38 | variables d'environnement transmises à Docker | `src/sandbox/docker-sandbox.ts:737` | `config.environment ?? {}` → `{}` | `tests/sandbox/docker-sandbox.test.ts` | **ROUGE** 1 échec / 28 |

Docker était présent sur la machine de vérification, donc le test HOME du bac à
sable a bien été exécuté (et non court-circuité par sa garde de disponibilité).

### DELEG2, SWARMFIX1, BRANCH1

| # | Contrat | Fichier source:ligne | Mutation | Test | Résultat |
|---|---|---|---|---|---|
| M40 | concurrence par défaut = 1 | `src/agent/delegation/thread-delegation.ts:280` | `DEFAULT_CONCURRENCY = 1` → `= 4` | `tests/commands/team-thread-delegation.test.ts` | **ROUGE** 1 échec / 5 |
| M41 | FIFO des créneaux | idem:267 | `waiters.shift()` → `waiters.pop()` | idem | **VERT** 5/5 |
| M41ter | FIFO des créneaux | idem:267 | idem | `tests/commands/swarm-thread-delegation.test.ts` | **VERT** 2/2 — voir T13 |
| M41bis | FIFO des créneaux | idem:267 | idem | `tests/agent/delegation/thread-delegation.test.ts` | **ROUGE** 1 échec / 10 |
| M42 | annulation descendante depuis le parent | idem:307 | `parentAbortListener = () => this.cancel(...)` → `() => {}` | `tests/commands/team-thread-delegation.test.ts` | **ROUGE** 1 échec / 5 |
| M43 | isolation des erreurs enfant | idem:496 | `request.resolve({ …reason: 'agent_error'… })` → `throw new Error(message)` | idem | **ROUGE** 1 échec / 5 |
| M44 | `/swarm` force `strategy=parallel` | `src/commands/handlers/swarm-handler.ts:140` | `_setActiveStrategy('parallel');` supprimé | `tests/unit/swarm-handler.test.ts` | **ROUGE** 2 échecs / 11 |
| M45 | stratégie précédente restaurée | idem:175 | `_setActiveStrategy(previousStrategy)` → `_setActiveStrategy('parallel')` | idem | **ROUGE** 3 échecs / 11 |
| M46 | commande `worktree add` construite | `src/commands/handlers/worktree-handlers.ts:135` | `git worktree add "<path>" <branch>` → `git worktree add -b <branch> "<path>"` | `tests/commands/worktree-handlers.test.ts` | **VERT** 17/17 |
| M46bis | nom de branche rapporté | idem:152 | `branch` réaffecté à `'autre-branche'` après l'ajout | idem | **VERT** 17/17 |
| M46ter | chemin et branche rendus à l'utilisateur | idem:161-164 | `📁 Path: ${resolvedPath}` / `🌿 Branch: ${branchName}` → littéraux masqués | idem | **VERT** 17/17 — voir T15 |
| M46quater | l'action `add` est prise en charge | idem:43 | `case 'add':` → `case 'add-desactive':` | idem | **ROUGE** 2 échecs / 17 |

Hermétisme BRANCH1 vérifié séparément : avant exécution, aucun dossier
`branch/` ni `feature-branch/` ; après
`npx vitest run tests/commands/worktree-handlers.test.ts` (17/17 verts), aucun
des deux dossiers n'apparaît, et `git status --short` ne signale rien. Le
contrôle a été refait après chacune des quatre mutations ci-dessus : toujours
aucun dossier créé.

### PRIV1 — les seize motifs interdits, un par un

Fichier muté : `tests/security/donnees-personnelles.test.ts`, une entrée de
`INTERDITS` à la fois. Commande :
`npx vitest run tests/security/donnees-personnelles.test.ts --reporter=dot`.

| # | Motif | Mutation | Résultat |
|---|---|---|---|
| P1 | organisme d'emploi (nom courant) | suffixe `-x` ajouté au littéral | **VERT** 7/7 |
| P2 | ancien organisme, forme accentuée | suffixe `-x` | **VERT** 7/7 |
| P3 | ancien organisme, forme non accentuée | suffixe `-x` | **VERT** 7/7 |
| P4 | couverture des privations d'activité, forme accentuée | suffixe `-x` | **VERT** 7/7 |
| P5 | couverture des privations d'activité, forme non accentuée | suffixe `-x` | **VERT** 7/7 |
| P6 | cumul d'allocation | suffixe `-x` | **VERT** 7/7 |
| P7 | qualité de prestataire du client public | suffixe `-x` | **VERT** 7/7 |
| P8 | statut administratif de recherche d'activité | suffixe `-x` | **VERT** 7/7 |
| P9 | préfixe d'adresse du réseau privé | `['100','73','']` → `['100','74','']` | **VERT** 7/7 |
| P10 | nom de la machine GPU | suffixe `-x` | **VERT** 7/7 |
| P11 | chemin du home auteur | `'rice'` → `'x'` | **ROUGE** 1 échec / 7 |
| P12 | chemin Windows avec slash | `'patri'` → `'patr-x'` | **ROUGE** 1 échec / 7 |
| P13 | chemin Windows avec antislash | `'patri'` → `'patr-x'` | **ROUGE** 1 échec / 7 |
| P14 | dépôt privé de passation | `'patrice'` → `'patr-x'` | **ROUGE** 1 échec / 7 |
| P15 | ancien moteur d'exploration privé | `'-rs'` → `'-x'` | **ROUGE** 1 échec / 7 |
| P16 | outil éditorial privé | `'commander'` → `'command-x'` | **ROUGE** 1 échec / 7 |

Les six ROUGE correspondent exactement aux six fixtures unitaires ajoutées par
VERIFIX2 : la trouvaille F2 de VERIF2 est bien fermée **pour ces six motifs**.

## Trouvailles

Vingt-et-une trouvailles. Aucune n'a été réparée.

### T1 — `migration-manager` : la persistance réalignée n'est gardée par rien

Cinq mutations distinctes de `src/versioning/migration-manager.ts` restent
vertes : historique vidé, chemin de l'historique dévié, journal d'audit vidé,
contenu de fichier migré vidé, et **suppression complète** de l'écriture de
l'historique. La seule assertion sur la frontière atomique est
`expect(mockWriteJson).toHaveBeenCalled()` (`tests/unit/migration-manager.test.ts:466`),
et `mockWriteFile` (`writeFileAtomic`) n'est jamais assertée. Le fichier reste
sensible par ailleurs (M48 rougit sur `getPendingMigrations`), donc c'est bien
le contrat MEM1 réaligné qui n'est plus discriminé.

### T2 — `telemetry-config` : la persistance réalignée n'est gardée par rien

Trois mutations vertes, dont la suppression totale de `writeJsonAtomicSync`.
Les six tests ne lisent jamais ce qui est persisté : ils passent par le cache
en mémoire du module. Le fichier reste sensible au comportement (M49 rougit),
mais l'écriture réalignée n'est plus observée.

### T3 — `cost-tracker` : l'écriture de l'historique n'est ni chemin ni contenu

`saveHistory` n'est vérifiée que par un `toHaveBeenCalled()` nu ; le contenu
tronqué et le chemin dévié passent. Seule l'écriture de `cost-config.json` est
assertée avec chemin, objet et `mode: 0o600`.

### T4 — `codebase-rag` : une écriture sur trois peut casser en silence

`saveIndex` écrit `chunks.json`, `file-index.json` et `stats.json` ; l'unique
assertion est `toHaveBeenCalled()`. Renommer le fichier de chunks, supprimer
l'écriture des chunks ou celle des stats reste vert. Seule la suppression des
trois écritures rougit.

### T5 — `vector-store` : persistance vérifiée par la seule existence d'un appel

Chemin dévié, contenu réduit à sa version, vecteurs vidés : trois mutations
vertes. Les tests de persistance n'affirment que `expect(fs.writeFileSync).toHaveBeenCalled()`.

### T6 — `roi-tracker` : idem, chemin, contenu et mode non assertés

Trois mutations vertes ; seule la suppression de l'appel rougit.

### T7 — `session-replay` : idem, chemin, contenu et mode non assertés

Trois mutations vertes ; seule la suppression de l'appel rougit.

### T8 — `response-cache` : l'assertion de chemin est trop lâche

`expect.stringContaining('response-cache.json')` laisse passer un suffixe
ajouté au chemin, et `entries: expect.any(Object)` laisse passer un cache vide.
Seul `savedAt` est réellement discriminant.

### T9 — `persistent-checkpoint-manager` : le fichier de checkpoint n'est pas vérifié

Chemin et contenu du checkpoint individuel peuvent être altérés sans rougir ;
seul l'index l'est. Le mock de test ignore par ailleurs l'argument `mode`, donc
`0o600` n'est pas gardé pour ce fichier.

### T10 — `tailscale-dashboard-nodes` : le double atomique est de l'isolation, pas un contrat

`mockWriteJsonAtomicSync` n'est jamais asserté : il sert uniquement à empêcher
l'écriture réelle de `devices.json`. C'est légitime, mais aucun contrat de
persistance n'est gardé dans ce fichier ; sa sensibilité vient du comportement
(`isDevicePaired`).

### T11 — `dm-pairing` : le `throw` explicite n'est pas gardé pour lui-même

Supprimer la garde `if (senders === null) { … throw }` reste vert, parce que
l'itération sur `null` lève de toute façon. Le contrat fail-closed **est** gardé
(M2bis rougit sur le repli `[]`), mais un futur refactor qui retirerait le
message d'erreur explicite et le `logger.warn` ne serait pas détecté.

### T12 — PRIV1 : dix motifs sur seize n'ont aucune fixture isolée

P1 à P10 restent verts : les dix motifs littéraux (organisme d'emploi sous ses
formes accentuée et non accentuée, la couverture des privations d'activité
sous ses deux formes, le cumul d'allocation, la qualité de prestataire, le
statut administratif de recherche d'activité, le préfixe d'adresse du réseau privé, nom de la machine GPU) ne sont exercés que
par le balayage du corpus, actuellement propre. VERIFIX2 a fermé la trouvaille
F2 pour les six motifs construits par concaténation, mais pas pour ces dix-là :
une faute de frappe ou une suppression y passerait inaperçue tant que le dépôt
ne contient pas déjà la fuite. C'est la trouvaille la plus importante de ce
rapport, parce que ce test est le garde-fou d'un dépôt public.

### T13 — DELEG2 : le FIFO de `/swarm` et `/team` n'est pas discriminé

`waiters.shift()` → `waiters.pop()` reste vert sur
`tests/commands/team-thread-delegation.test.ts` (dont un test s'appelle pourtant
« keeps FIFO order per member ») et sur
`tests/commands/swarm-thread-delegation.test.ts`. Le FIFO global **est** gardé
par `tests/agent/delegation/thread-delegation.test.ts` depuis VERIFIX2 (M41bis
rougit) : la trouvaille F1 de VERIF2 est fermée au niveau du moteur, mais les
tests de multiplexage de DELEG2 ne la rejouent pas. Le test « FIFO par membre »
ne met en attente qu'un seul candidat par membre, donc FIFO et LIFO donnent le
même ordre.

### T14 — HEADLESS2 : l'entrée d'autorisation `-C` en lecture est redondante

Supprimer la ligne `allowedArgs` qui autorise explicitement
`git -C <racine> status|log|…` laisse le test vert : la décision `sandbox`
provient en réalité du `deniedArgs` de la règle frontière (M36, rouge). La
partie « autorisation » du correctif n'est donc pas prouvée par le test ; seule
la partie « ne pas demander d'escalade » l'est.

### T15 — BRANCH1 : l'hermétisme tient, les assertions de `add` sont quasi tautologiques

Aucun dossier `branch/` ni `feature-branch/` n'est créé, avant comme après
chaque mutation : le correctif BRANCH1 tient. En revanche, les tests
« add worktree » n'affirment que `handled === true` et la présence de la chaîne
qu'ils ont eux-mêmes passée en argument. Dévier l'argv `git worktree add`,
falsifier le nom de branche rapporté ou masquer complètement chemin et branche
dans la réponse laisse le test vert.

### T16 — `doctor-fix` : la réparation `ollama pull` n'est pas exercée

Remplacer `ollama pull` par `ollama run` reste vert. Les seize tests couvrent
les répertoires manquants, les verrous vieillis et les settings corrompus, pas
la réparation de modèle.

### T17 — `agent-reply-routing` : la latence mesurée est neutralisée par le test

Le test fournit lui-même un scoreboard dont `measuredTurnLatency` renvoie
toujours `null`. Supprimer la lecture de la latence dans
`src/fleet/model-selector.ts` est donc invisible. Le contrat réellement gardé
est la propagation de `localOnly` (M31bis, rouge).

### T18 — `auth` : la rotation de clé de session n'a pas d'assertion de permissions

`writeFileAtomic(this.config.keyPath, newKey, { mode: 0o600 })` (rotation) peut
passer en `0o644` sans rougir ; seule l'écriture initiale de la clé (couverte
par `crypto.test.ts`) et la config de permissions le sont.

### T19 — `misc-tools-part2` : l'assertion de chemin est trop lâche

`expect.stringContaining('test.txt')` laisse passer un suffixe ajouté au
chemin lu. Seul l'encodage est discriminant.

### T20 — `memory` : le contenu de l'index mémoire n'est pas asserté

Persister un index vide reste vert ; seule la disparition de l'appel rougit.

### T21 — `workflows` : le contenu de l'état sérialisé n'est pas asserté

Persister `{}` à la place de `this.serializeState(state)` reste vert ; le
chemin, lui, est gardé.

## Contrats qui tiennent

Cinquante-et-une mutations ont rougi sur le test ciblé :

* **MEMFIX** — les 33 fichiers réalignés rougissent tous sous au moins une
  mutation de leur source, **sauf** `migration-manager` et `telemetry-config`
  dont seule la persistance réalignée est aveugle (T1, T2) ; ces deux-là
  rougissent bien sous une mutation comportementale.
* **HEADLESS2** — la frontière `ask` de `git -C` en lecture, l'expansion du
  tilde avant les chemins protégés, la transmission de HOME au bac à sable et
  la transmission des variables d'environnement à Docker sont toutes gardées.
* **DELEG2** — concurrence par défaut à 1, annulation descendante et
  confinement des erreurs enfant sont gardés ; le FIFO l'est au niveau du
  moteur.
* **SWARMFIX1** — l'override `strategy=parallel` et sa restauration sont
  gardés tous les deux.
* **dm-pairing** — le repli fail-closed sur une allowlist corrompue est gardé.
* **BRANCH1** — l'hermétisme est vérifié : aucun dossier créé.
* **PRIV1** — les six motifs construits par concaténation sont gardés
  individuellement.

## Journal

* Rapport créé et chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md`
  **avant** toute inspection (commit `34284135f`).
* Témoin d'entrée : 44 fichiers / 2 103 tests verts en 5,9 s.
* 105 mutations appliquées isolément ; chacune suivie d'un
  `git checkout -- <fichier>` immédiat. Deux tentatives supplémentaires ont été
  rejetées par le harnais (motif non unique) et n'ont donc jamais touché le
  disque : elles ne sont pas comptées.
* Aucun code de production ni de test n'est conservé muté.
* Aucun push, aucun service, aucune API payante, aucune écriture dans
  `~/code-buddy`.
* HOME et TMPDIR de test : `_qa/verif3/` dans le clone, exclu via
  `.git/info/exclude` (le `.gitignore` suivi n'a pas été modifié).

## Vérifications finales

| Commande | Résultat |
|---|---|
| `npx vitest run` sur les 44 fichiers du périmètre (témoin de sortie) | **44 fichiers / 2 103 tests verts**, identique au témoin d'entrée |
| `npx vitest run tests/commands/worktree-handlers.test.ts` puis `ls -d branch feature-branch` | 17/17 verts, **aucun dossier créé** |
| `npx vitest run tests/security/donnees-personnelles.test.ts` | **7/7 verts** après restauration |
| `npx tsc --noEmit -p .` | code 0 |
| `git diff --check` | code 0 |
| `git status --short` | **propre** ; seuls le rapport et la ligne de coordination sont commités, nommément |

## Bilan

1. 105 mutations ciblées sur HEADLESS2, DELEG2, SWARMFIX1, MEMFIX1, MEMFIX2A, MEMFIX2B, dm-pairing, BRANCH1 et PRIV1.
2. 51 ROUGE attendus observés ; 54 mutations restées VERTES, regroupées en 21 trouvailles.
3. T12 est la plus grave : dix des seize motifs de `donnees-personnelles.test.ts` n'ont aucune fixture isolée.
4. T1 et T2 sont les seuls fichiers MEMFIX dont la persistance réalignée ne rougit sous aucune mutation.
5. T3 à T11 et T19 à T21 sont des assertions `toHaveBeenCalled()` nues ou des `stringContaining` trop lâches.
6. T13 : le FIFO est gardé au niveau du moteur (VERIFIX2) mais pas dans les tests de multiplexage DELEG2.
7. T15 : l'hermétisme BRANCH1 tient, mais les assertions de `worktree add` sont quasi tautologiques.
8. Les contrats de sécurité de HEADLESS2, SWARMFIX1 et du fail-closed dm-pairing tiennent tous.
9. Rien n'a été réparé ; chaque mutation a été restaurée immédiatement ; `git status` est propre.
10. Rapport : `docs/reports/2026-09/RAPPORT-VERIF3.md`.
