# Réparation MEM1 — écritures d’état atomiques

## Cadre et garde-fous

- Dépôt de travail : `cb-repar-memory-2026-09-02`.
- Branche : `fix/mem1-ecritures-atomiques-2026-09-03`.
- Base constatée : `d0e067392`.
- Rapport créé avant toute inspection, comme demandé.
- `~/code-buddy` n’a pas été lu ni écrit ; aucun push, appel API, service ou port existant n’a été touché.
- Aucun fichier n’a été écrit dans `~/.codebuddy`. Les temporaires de test ont été créés sous le clone puis retirés.

## Symptôme traité

Le redémarrage observé le 02/09 à 20 h 12 pouvait laisser `~/.codebuddy/memory/summaries.json` à 0 octet. Au démarrage suivant, le parseur remontait `Unexpected end of JSON input`, puis le repli silencieux perdait les résumés. La lecture MEM1 traite désormais vide, tronqué, JSON invalide et JSONL partiellement écrit comme un état indisponible : repli explicite, `logger.warn` une seule fois par chemin et tentative de restauration depuis `.bak` ou un temporaire valide.

## Journal par lots

| Lot | Périmètre | Commit(s) | Vérification | Statut |
|---|---|---|---|---|
| 0 | Réservation Fable 5 et rapport préalable | `docs/FABLE5-CODEX-COORDINATION.md` en attente du lot documentaire | réservation ajoutée avant inspection | terminé |
| 1 | Utilitaire atomique, lectures défensives, JSONL et tests | `e678a6cdb`, `3525a6866`, `9e36ac091`, `ddf01e23f` | utilitaire 6/6 ; typecheck 0 | terminé |
| 2 | Mémoire et compagnon | `8beefe119` | inclus dans les suites ciblées | terminé |
| 3 | Fleet, sessions, self-model, état projet et auxiliaires connexes | `5b649cc8a`, `1d2f375d3`, `09e0f30cc`, `e774a070d`, `8910191c3`, `72e493078` | suites ciblées 151/151 | terminé |
| 4 | Test MEM1 déterministe et documentation/passation | `6a62e70b4`, `ddf01e23f` et lot documentaire final | typecheck, suites ciblées, lint ciblé ; lint global limité à 2 erreurs QA | terminé |

## Inventaire et classification

### A — Atomique : même dossier, fsync, rename

Le point d’entrée unique est [`src/utils/atomic-write.ts`](src/utils/atomic-write.ts) :

- `writeFileAtomic` : chemin temporaire dans le dossier cible (`:60-62`), ouverture en `0600` par défaut (`:29-40`, `:101-111`), écriture puis `fsync` du fichier (`:111-114`), fermeture, `rename` dans la même arborescence et `fsync` du dossier (`:115-117`, `:81-93`), nettoyage du temporaire en cas d’erreur (`:118-123`).
- `writeJsonAtomic` : sérialisation JSON + newline vers ce chemin (`:127-133`).
- variantes synchrones utilisées par le compagnon/configuration (`writeFileAtomicSync`, `writeJsonAtomicSync`, `:135-194`) avec `fsyncSync`, `renameSync` et `chmodSync`.
- Les appels d’état sensibles passent explicitement `{ mode: 0o600 }`. Les fichiers projet destinés à être lisibles par les outils générés restent en `0644` dans `src/utils/init-project.ts:599-640,770-843,917`.
- Les lecteurs `readJsonAtomic`/`readJsonAtomicSync` (`:247-297`, `:353-391`) et `readTextAtomic`/variantes (`:393-488`) refusent le vide/invalide, renvoient le fallback et restaurent le premier `.bak` ou temporaire valide (`:208-235`, `:281-292`, `:374-385`).
- `readJsonLinesAtomic` et variantes (`:418-454`, `:491-536`) conservent le préfixe valide d’un journal déchiré, tentent une copie valide et avertissent une fois (`warnUnreadable: :196-202`).

Les états principaux désormais couverts sont :

| Domaine et fichiers persistants | Écritures atomiques / lectures défensives (fichier:ligne) |
|---|---|
| Mémoire globale : `~/.codebuddy/memory/memory-index.json`, `summaries.json`, `user-profile.json`, `bayesian-state.json`, `projects/*.json` | `src/memory/enhanced-memory.ts:318-424,855`; `src/memory/auto-memory.ts:246,292`; `src/memory/memory-candidate-queue.ts:287,313`; `src/memory/user-model.ts:367,393`; `src/memory/ocr-memory-pipeline.ts:299,332`; `src/memory/subagent-memory.ts:91-139`; `src/memory/semantic-memory-search.ts:325,355`; `src/memory/knowledge-graph.ts:1013,1095`. |
| Mémoire Markdown : mémoire projet/utilisateur, archives, résumés et rollout | `src/memory/persistent-memory.ts:356,365,1241,1437`; `src/memory/memory-consolidation.ts:143,212,228,257`; `src/memory/collective-knowledge-graph.ts:931`; `src/memory/ckg-engine-policy.ts:25`; `src/memory/presence-injector.ts:81`. |
| Compagnon : `reminders.json`, `pending-acks.json`, `snoozes.json`, relationship, cards, mission board, event follow-ups | `src/companion/reminders.ts:77,97,383-394,919,932`; `src/companion/relationship-state.ts:71,108`; `src/companion/cards.ts:189,196`; `src/companion/mission-board.ts:134,220`; `src/companion/event-followups.ts:94,103`. |
| Compagnon : inbox, gateways, curator, prefetch, continuity, voix, privacy, incident repair, assistant config | `src/companion/gateway-inbox.ts:518,525,660-784`; `src/companion/gateway.ts:350,357`; `src/companion/skill-curator.ts:243,250,665`; `src/companion/prefetch-config.ts:98,117`; `src/companion/prefetch-engine.ts:101,116`; `src/companion/continuity.ts:216,229`; `src/companion/voice-guidance.ts:42,65`; `src/companion/voice-improvement-loop.ts:211,234`; `src/companion/voice-incident-repair.ts:124,140,149`; `src/companion/privacy.ts:205`; `src/companion/assistant-config.ts:867,875`. |
| Mémoire du compagnon : percepts et safety ledger | Lecture JSONL défensive `src/companion/percepts.ts:514,541` et `src/companion/safety-ledger.ts:145`; les ajouts restent append-only à `percepts.ts:504` et `safety-ledger.ts:190`. |
| Fleet : `peer-sessions/*.json`, `fleet-model-performance.jsonl`, coûts, sagas, colab, pont CKG | `src/fleet/peer-session-store.ts:99,203`; `src/fleet/model-scoreboard.ts:150,165`; `src/fleet/cost-tracker.ts:105,252`; `src/fleet/saga-store.ts:203,437`; `src/fleet/colab-store.ts:729-771`; `src/fleet/peer-ckg-bridge.ts:506,542`. |
| Sessions et self-model | Timeline JSONL : `src/sessions/timeline.ts:90,104`; sessions JSON : `src/persistence/session-store.ts:235,254,985,1014`; évolution : `src/self-model/evolution-notes.ts:356-383`; usage ElevenLabs : `src/voice/elevenlabs-voice.ts:103,117,135`. |
| Projet `.codebuddy/*.json` et index/context | `src/knowledge/code-graph-persistence.ts:42,57`; `src/knowledge/graph-drift.ts:51,61,84`; `src/context/context-manager-v2.ts:1673`; `src/context/codebase-rag/codebase-rag.ts:916-963`; `src/context/codebase-rag/vector-store.ts:188,200`; `src/knowledge/workspace-indexer.ts:54-59,134-182,270`; `src/search/usearch-index.ts:391,412+`; `src/utils/init-project.ts:684,720,737,813`. |
| Autres stores d’état déjà raccordés au même utilitaire | `src/advanced/session-replay.ts`; `src/agent/isolation/agent-workspace.ts`; `src/analytics/dashboard.ts`, `roi-tracker.ts`; `src/browser-automation/profile-manager.ts:48`; `src/mcp/mcp-oauth.ts:146`; `src/security/session-encryption.ts:90,271`; `src/research/research-topics.ts`; `src/offline/offline-mode.ts`; `src/personas/persona-manager.ts`; `src/spec/spec-store.ts:203-511`; `src/tracks/track-manager.ts`; `src/versioning/{config-migrator,migration-manager,version-detector}.ts`; `src/workspace/workspace-manager.ts`. |

L’audit couvre 193 sources modifiées et 707 références d’API de lecture/écriture atomique dans `src/`. Les anciennes implémentations déjà sûres par temporaire + rename ont été conservées, notamment `src/meals/private-json-store.ts:84-89`, `src/meals/profile-store.ts:217-221`, `src/life-rhythm/{etalab-holiday-provider,home-mode-store,cooking-timer-store}.ts`, `src/research/paper-qa/{persistent-corpus-index,disk-embedding-cache}.ts`, `src/security/{policy-amendments,bash-allowlist/allowlist-store,credential-manager}.ts`.

### B — Append `O_APPEND` assumé

Ces fichiers sont des journaux d’événements : ils ne font pas d’écrasement direct. Les lecteurs sont tolérants à la dernière ligne déchirée et récupèrent une copie valide si disponible.

| Fichier:ligne | Contenu |
|---|---|
| `src/sessions/timeline.ts:90`; `src/companion/percepts.ts:504`; `src/companion/safety-ledger.ts:190` | timeline/percepts/ledger JSONL |
| `src/companion/reminders.ts:242`; `src/companion/gateway.ts:823`; `src/companion/idle-loop.ts:100` | journaux compagnon |
| `src/companion/conversation-improvement-loop.ts:317`; `src/companion/voice-improvement-loop.ts:250` | amélioration conversation/voix |
| `src/memory/collective-knowledge-graph.ts:971,1007`; `src/memory/persistent-memory.ts:1066`; `src/memory/memory-consolidation.ts:193,199` | cache embedding, ledger CKG et archives Markdown append |
| `src/fleet/model-scoreboard.ts:185` | `fleet-model-performance.jsonl` |
| `src/daemon/autonomy-briefing.ts:404`; `src/scheduler/cron-scheduler.ts:1040`; `src/conversation/cross-channel-bridge.ts:858`; `src/conversation/companion-model-routing.ts:1012` | journaux auxiliaires |
| `src/sensory/episodic-journal.ts:243`; `src/sensory/sensory-rules-engine.ts:69`; `src/sensory/dreaming.ts:120`; `src/openclaw/gateway-bridge.ts:948,974,983,992` | événements sensoriels/gateway |

### C — Écritures directes restantes, volontairement hors état MEM1

L’audit final des zones `src/memory`, `src/companion`, `src/fleet`, `src/sessions`, `src/self-model`, `src/persistence` et `src/voice` ne laisse que :

- `src/persistence/session-store.ts:515,818` : exports Markdown/texte explicitement demandés par l’appelant ;
- `src/voice/*`, `src/sensory/voice-loop.ts`, `src/companion/camera.ts`, `src/companion/lisa-selfie*.ts` : WAV, audio ou photos binaires, pas des fichiers d’état JSON/JSONL/MD ;
- `src/persistence/session-lock.ts:97`, `src/companion/daily-interaction-budget.ts:158`, `src/memory/memory-consolidation.ts:191` : création exclusive `wx` de verrous, pas remplacement d’état ;
- append-only listés en B.

Les écritures d’artefacts/outils (sorties Excel/SQL/archive, fichiers de travail de sandbox, restauration de snapshots, exports CLI) restent des écritures de contenu demandé, distinctes des stores d’état serveur/compagnon. Elles sont inventoriées comme telles, et ne sont pas présentées comme atomiques MEM1.

## Tests rouge → vert

Dans [`tests/utils/atomic-write.test.ts`](tests/utils/atomic-write.test.ts) :

- interruption factice immédiatement après `open` : l’ancien contenu reste lisible (`:27-53`) ;
- fichier 0 octet : fallback propre et un seul `logger.warn` sur deux lectures (`:55-65`) ;
- restauration `.bak` et `.tmp.*` valides après cible tronquée (`:67-77`) ;
- restauration JSONL depuis `.bak` après dernière ligne déchirée (`:79-88`) ;
- restauration synchrone depuis `.bak` lorsque la cible principale manque (`:90-98`).

Le test compagnon MEM1 [`tests/companion/proactive-engine.test.ts:321-338`](tests/companion/proactive-engine.test.ts:321) utilise un RNG injecté afin de vérifier le fallback sans dépendre d’un template aléatoire.

## Vérifications exécutées

- `npm test -- --fileParallelism=false tests/utils/atomic-write.test.ts --run` → **1 fichier, 6 tests passés**.
- `npm test -- --fileParallelism=false tests/companion/proactive-engine.test.ts --run` → **1 fichier, 22 tests passés**.
- `npm test -- --fileParallelism=false tests/memory tests/companion tests/sessions tests/fleet --run` → **151 fichiers passés, 1466 tests passés, 1 skipped** ; durée finale 40,28 s.
- `npm run typecheck -- --pretty false` → **TypeScript racine + `typecheck:gpuNode-identity`, code 0**.
- `npx eslint --quiet` sur les sources modifiées et le test atomic → **0 erreur**.
- `npm run lint -- --quiet` → **échec limité à 2 erreurs préexistantes dans `_qa/gk20/run-path.mjs:7:50` (`stat`) et `:261:9` (`runsAfter`)** ; aucun warning avec `--quiet` et aucune erreur source MEM1.
- `git diff --check` → **0 sortie** sur les lots de code.

## Commits fonctionnels

`e678a6cdb` → `3525a6866` → `9e36ac091` → `8beefe119` → `5b649cc8a` → `1d2f375d3` → `09e0f30cc` → `e774a070d` → `8910191c3` → `72e493078` → `6a62e70b4` → `ddf01e23f`.

Le dernier lot documentaire ajoutera ce rapport, la ligne MEM1 de [`CLAUDE.md`](CLAUDE.md) et la mise à jour de [`docs/FABLE5-CODEX-COORDINATION.md`](docs/FABLE5-CODEX-COORDINATION.md) avec les commits et vérifications de passation.

## Reste ouvert

Le lint global devra être nettoyé séparément dans `_qa/gk20/run-path.mjs`; ces deux variables inutilisées ne concernent pas MEM1. Les exports, binaires/audio, locks `wx` et journaux append-only ne sont pas des écrasements d’état JSON/JSONL/MD et restent volontairement hors de la conversion atomique.
