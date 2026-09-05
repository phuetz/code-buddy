# Réparation SWARMFIX1

Date : 2026-09-04
Branche : `fix/swarmfix1-2026-09-04`

## Périmètre

- Réparer ou réaligner le test `tests/unit/swarm-handler.test.ts` selon le contrat actuel de `/swarm`.
- Identifier et rendre hermétique le test de `tests/unit` qui écrit dans `.codebuddy/agent-memory/alice/MEMORY.md`.

## État initial

Rapport créé avant toute inspection du dépôt. Les constats, modifications, commits et preuves seront complétés pendant l'intervention.

## Point 1 — `/swarm` et DELEG2

Le contrat DELEG2 est le nouveau chemin voulu : `/swarm <tâche>` appelle
`/agents run <tâche>` avec une option `threadDelegation` contenant la
concurrence, le budget parent et le flux d'événements. L'override de stratégie
reste `parallel` pendant l'appel et est restauré ensuite. Le test unitaire
attendait l'ancienne signature à un seul argument ; il a été réaligné pour
vérifier la tâche, les options de délégation et l'ordre de l'override.

Preuves :

- état initial : `npx vitest run tests/unit/swarm-handler.test.ts` → 1 échec,
  10 succès ;
- test réaligné : même commande → 11 succès ;
- mutation temporaire de `DEFAULT_CONCURRENCY` en `+ 1` → 1 échec, 10 succès ;
- restauration de la source → 11 succès.

Le fichier `src/commands/handlers/swarm-handler.ts` est restauré sans diff.

## Point 2 — écriture mémoire

Le coupable est `tests/unit/cc9-cc18.test.ts`, dans `CC14: SpawnOptions
memory field`. `spawnAgent({ memory: 'project' })` puis `completeAgent()` ne
fournissaient pas de racine de projet ; le chemin projet retombait donc sur
`process.cwd()` et ajoutait une entrée datée à
`.codebuddy/agent-memory/alice/MEMORY.md`.

Le test utilise désormais des répertoires sous `_qa/swarmfix1/tmp`, substitue
`process.cwd()` vers ce répertoire pendant le cycle spawn/complete, restaure le
spy dans `finally`, nettoie le répertoire après chaque test et vérifie que le
`MEMORY.md` du dépôt reste inchangé. Les trois répertoires temporaires du
fichier `cc9-cc18.test.ts` sont confinés sous le clone ; `_qa/swarmfix1/` est
ignoré par Git.

Preuves :

- `cc9-cc18.test.ts` avant correction : 53/53, puis `git status` →
  `M .codebuddy/agent-memory/alice/MEMORY.md` ;
- `imessage-adapter.test.ts` : 42/42, puis aucun changement mémoire ;
- après correction : `cc9-cc18.test.ts` → 53/53 et aucun `MEMORY.md` modifié ;
- mutation temporaire du spy vers le dépôt réel : 1 échec, 52 succès et
  `MEMORY.md` à nouveau modifié ;
- restauration du spy et du fichier suivi : 53/53 et aucun `MEMORY.md` modifié.

## Vérifications finales

- `npx vitest run tests/unit/swarm-handler.test.ts tests/commands` → code 1,
  131 fichiers, 1 270 tests : 1 267 succès et 3 échecs dans les smokes Hermes
  locaux (`tests/commands/hermes-commands.test.ts`), hors zone SWARMFIX1 ;
- `npx vitest run --reporter=dot --maxWorkers=4 tests/unit` → code 0,
  358 fichiers et 15 086 tests réussis ;
- `npx tsc --noEmit -p .` → code 0 ;
- `npx eslint --max-warnings=0 tests/unit/swarm-handler.test.ts
  tests/unit/cc9-cc18.test.ts` → code 0 ;
- `git diff --check` → code 0 ;
- `git status --short` après la suite complète → propre.

Les trois échecs Hermes sont reproductibles, liés à leur smoke navigateur local
(`local-playwright`/`local` retournent `failed`) et ne concernent ni le handler
SWARM ni l’écriture mémoire ; ils restent ouverts hors périmètre.

Commits de correction : `f2a0f772a` (point 1) et `64cdc66f3` (point 2) ;
la présente mise à jour documentaire clôt la passation.
