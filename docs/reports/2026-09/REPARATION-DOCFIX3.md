# Réparation DOCFIX3

## Périmètre

| Élément | État vérifié |
|---|---|
| Réservation | DOCFIX3 est réservé à Codex sur la branche `docs/docfix3-2026-09-04`, avec les cinq fichiers documentaires et ce rapport dans la zone dédiée (`docs/FABLE5-CODEX-COORDINATION.md:20`). |
| Source | Les cinq corrections proviennent de la section 3 du rapport DOC3 (`docs/reports/2026-09/RAPPORT-DOC3.md:81-143`). |

## Corrections appliquées

| Fichier | Décision documentaire | Preuve dans le code |
|---|---|---|
| `docs/agents.md:119` | Une unité nommée crée un fil d’agent complet léger, borné, avec six tours d’outils par défaut, puis exige un vrai diff de fichier. | `createDefaultBatchSpawnFn` lit la concurrence et le nombre de tours, instancie `CodeBuddyAgent` avec le budget enfant et vérifie les fichiers modifiés (`src/commands/handlers/batch-handlers.ts:542-605,633-664`); `ThreadDelegation` limite la concurrence et exécute chaque tour via `processUserMessageStream` (`src/agent/delegation/thread-delegation.ts:279-305,405-485`); `CodeBuddyAgent` reçoit `maxToolRounds` (`src/agent/codebuddy-agent.ts:100-142`). |
| `docs/security.md:41-46` | Le confinement natif de `bash` est opt-in; variable absente signifie spawn inchangé; variable active signifie sélection fail-closed d’un backend disponible. | `isNativeSandboxEnabled` renvoie faux si la variable est absente ou désactivée (`src/security/native-sandbox.ts:16-25,91-104`); `confineSpawn` conserve les arguments sans sonde quand le mode est éteint et refuse l’exécution quand aucun backend ne peut être appliqué (`src/security/native-sandbox.ts:449-487`); Bubblewrap est sondé avant préférence, Landlock est le repli Linux avec ABI et Python, et Seatbelt est le chemin macOS (`src/security/native-sandbox.ts:183-231`). |
| `docs/configuration.md:155-157` | Les variables `CODEBUDDY_NATIVE_SANDBOX`, `CODEBUDDY_BATCH_CONCURRENCY` et `CODEBUDDY_BATCH_MAX_ROUNDS` sont documentées avec leurs valeurs par défaut effectives. | Les deux variables `/batch` ont les replis `1` et `6` (`src/commands/handlers/batch-handlers.ts:545-557`); le sandbox est désactivé sans variable et reconnaît `true`, `bwrap`, `landlock` et `seatbelt` (`src/security/native-sandbox.ts:21-25,91-104`). |
| `CLAUDE.md:247-249` | La variable native déjà documentée est conservée sans doublon; les deux variables DELEG1 sont ajoutées avec les plafonds `1` et `6`. | La ligne native correspond à la sélection et au refus fail-closed du code (`src/security/native-sandbox.ts:449-543`); les lignes batch correspondent à la concurrence et aux tours configurés (`src/commands/handlers/batch-handlers.ts:545-557`). |
| `docs/self-improvement-engine.md:83-88` | `buddy improve tools|skills` est documenté avec les outils `authored__*`, les skills `authored-*`, les portes G1/G3/G4 pour les outils, puis le firewall et la couverture pour les skills. | Les deux sous-commandes et leurs moteurs sont enregistrés par le CLI (`src/commands/cli/improve-command.ts:332-404`); le proposeur d’outils reçoit une vue sans held-out et les portes G1/G3/G4 sont bloquantes (`src/agent/self-improvement/llm-tool-proposer.ts:1-10,25-49`, `src/agent/self-improvement/tool-gate.ts:1-10,41-108`); l’exécution de scoring est sandboxée (`src/agent/self-improvement/sandbox-scorer.ts:1-5,19-50`). |

## Propositions DOC3 écartées ou précisées

- Le terme `ThreadDelegate` de la proposition n’est pas repris: la classe concrète est `ThreadDelegation`, tandis que `ThreadDelegateAgent` est l’interface de l’agent enfant (`src/agent/delegation/thread-delegation.ts:22-31,279-305`).
- La clause DOC3 affirmant que `.git`, `.codebuddy`, `.ssh`, `.gnupg` et `.aws` sont toujours en lecture seule n’est pas appliquée: Bubblewrap monte `projectRoot` en écriture et Landlock donne les droits d’écriture à `projects + tmps`; les chemins secrets masqués concernent le home (`src/security/native-sandbox.ts:303-324,346-380`, `src/security/landlock-confine.py:197-204`).
- La formulation `skill-engine.ts` a été précisée: `LlmSkillProposer` construit la proposition et `SkillImprovementEngine` orchestre le cycle et appelle la porte (`src/agent/self-improvement/skill-proposer.ts:82-99`, `src/agent/self-improvement/skill-engine.ts:60-114`).
- Le code ne détecte pas explicitement AppArmor: il mesure l’utilisabilité de Bubblewrap, conserve la raison de l’échec, puis choisit Landlock si ses prérequis sont présents (`src/security/native-sandbox.ts:183-231`).

## Commits par fichier cible

| Fichier | Commit |
|---|---|
| `docs/agents.md` | `b4c98b314` |
| `docs/security.md` | `736911c0e` |
| `docs/configuration.md` | `1a62005ca` |
| `CLAUDE.md` | `26faafbf0` |
| `docs/self-improvement-engine.md` | `ae1325607` |

## Vérifications

| Commande | Résultat |
|---|---|
| `npm run build` | Succès, code de sortie `0`. |
| `npx vitest run tests/docs tests/security` avant compilation | Échec: `tests/docs/revue-gemini-docs.test.ts` attend `dist/index.js` (`tests/docs/revue-gemini-docs.test.ts:18-24`), absent dans le clone; résultat `50` fichiers, `924` tests passés, `16` échecs. |
| `npx vitest run tests/docs tests/security` après compilation | Succès: `50` fichiers, `940` tests passés, `0` échec. |
| `git diff --check` | Succès avant les commits et après la compilation, code de sortie `0`. |

## Garde-fous et passation

| Point | État |
|---|---|
| Original | `~/code-buddy` n’a pas été modifié. |
| Réseau et services | Aucun push, aucune API payante et aucun service démarré. |
| Zone | Aucun fichier source n’a été modifié; les cinq cibles, ce rapport et la ligne de coordination restent dans la zone DOCFIX3. |
