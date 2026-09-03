# Réparation COMPACT1 — hooks avant/après compaction

## Suivi

- Dépôt : `/home/patrice/DEV/cb-compact1-2026-09-03`
- Branche annoncée : `fix/compact1-2026-09-03`
- Statut : implémentation, vérifications, commits et documentation réalisés.

## Fichiers lus en entier

- `docs/FABLE5-CODEX-COORDINATION.md` — 328 lignes lors de la lecture initiale ; 329 après réservation.
- `src/context/context-manager-v2.ts` — 1 778 lignes lors de la lecture initiale ; 1 821 après implémentation.
- `src/hooks/user-hooks.ts` — 580 lignes lors de la lecture initiale ; 667 après implémentation.
- `src/hooks/hook-manager.ts` — 332 lignes.
- `src/hooks/hook-types.ts` — 200 lignes.
- `src/hooks/hook-runner.ts` — 404 lignes.
- `src/context/context-engine.ts` — 102 lignes.
- `src/context/default-context-engine.ts` — 76 lignes.
- `src/context/index.ts` — 155 lignes.
- `src/events/event-bus.ts` — 57 lignes.
- `docs/context-engine.md` — 102 lignes lors de la lecture initiale ; 105 après documentation.
- `tests/hooks/user-hooks.test.ts` — 462 lignes.
- `tests/context/compact-hooks.test.ts` — 159 lignes après ajout.
- `tests/hooks/pre-compact.test.ts` — 34 lignes après ajout.

La référence `/home/patrice/DEV/lecture-comparative-2026-09-03/codex/codex-rs/core/src/compact.rs` et les docs Codex associées ont été consultées en lecture seule avec `rg` autour de `pre_compact`/`post_compact`. Aucun texte de plus de 10 lignes n’a été repris ; aucun `NOTICE` n’est donc nécessaire.

## Réservation et inventaire des chemins

La mission a été réservée dans `docs/FABLE5-CODEX-COORDINATION.md` avant les modifications de code, sur la branche `fix/compact1-2026-09-03`, HEAD initial `51b8a29316764b268423560cf4eaf2862c46a3af`.

Commande exécutée :

```text
rg -n -e "prepareMessagesRaw\\(" -e "prepareMessages\\(" -e "compactTurnMessagesInPlace\\(" -e "engine\\.compact\\(" -e "\\.compact\\(" src/context/context-manager-v2.ts src/context/default-context-engine.ts src/agent/execution/context-pipeline.ts src/agent/execution/agent-executor.ts src/context/smart-compaction.ts src/agent/execution/retry-fallback.ts src/commands/handlers/vibe-handlers.ts
```

Sortie :

```text
src/agent/execution/context-pipeline.ts:172:      ? contextManager.prepareMessagesRaw(slimmed)
src/agent/execution/context-pipeline.ts:173:      : contextManager.prepareMessages(slimmed)
src/agent/execution/context-pipeline.ts:196: * `prepareMessages()` is pure and returns a NEW array; the agent-executor
src/agent/execution/context-pipeline.ts:202:export function compactTurnMessagesInPlace(
src/agent/execution/retry-fallback.ts:360:            const compacted = await this.compactionEngine.compact(messages);
src/context/default-context-engine.ts:43:    const prepared = this.manager.prepareMessagesRaw(messages);
src/context/default-context-engine.ts:54:    return this.manager.prepareMessagesRaw(messages, { reason: 'plugin' });
src/context/smart-compaction.ts:767:  return engine.compact(messages);
src/context/context-manager-v2.ts:357:   * When set, prepareMessages() delegates to engine.assemble().
src/context/context-manager-v2.ts:385:  prepareMessagesRaw(
src/context/context-manager-v2.ts:685:  prepareMessages(
src/context/context-manager-v2.ts:716:      const compacted = this.prepareMessagesRaw(messages, options);
src/context/context-manager-v2.ts:726:    return this.prepareMessagesRaw(messages, options);
src/context/context-manager-v2.ts:730:   * @deprecated Use prepareMessages() — this is kept for backwards compatibility
src/context/context-manager-v2.ts:733:    return this.prepareMessagesRaw(messages);
src/agent/execution/agent-executor.ts:1368:            // Trigger context compaction IN PLACE — prepareMessages() is pure
src/agent/execution/agent-executor.ts:1370:            const compacted = compactTurnMessagesInPlace(this.deps.contextManager, messages, {
src/agent/execution/agent-executor.ts:1894:                const compacted = compactTurnMessagesInPlace(this.deps.contextManager, messages, {
EXIT_CODE=0
```

Les appels de `retry-fallback.ts` et `smart-compaction.ts` utilisent un autre moteur (`SmartCompactionEngine`), pas `ContextManagerV2`. Les deux appels `compactTurnMessagesInPlace` repassent par `prepareTurnMessages` puis `ContextManagerV2`; l’ancienne méthode privée de V2 délègue maintenant au point instrumenté. `/compact` n’appelait pas directement la compaction : son handler pose désormais un drapeau `manual` consommé au prochain `prepareMessages`.

## Vérifications

### Rouge initial — tests écrits avant la production

Commande : `npx vitest run tests/context/compact-hooks.test.ts tests/hooks/pre-compact.test.ts`

Code de retour : `1`

Sortie :

```text
❯ tests/hooks/pre-compact.test.ts (1 test | 1 failed) 4ms
     × uses the existing hooks.json command format and sends JSON on stdin 3ms
❯ tests/context/compact-hooks.test.ts (4 tests | 3 failed) 249ms
     × emits pre_compact and post_compact with the before/after counters 83ms
     × injects a command hook preserve response into the compaction summary 37ms
     × ignores a failing or timed-out hook and still compacts 35ms

 FAIL  tests/context/compact-hooks.test.ts > COMPACT1 — global compaction events and preservation hooks > emits pre_compact and post_compact with the before/after counters
AssertionError: expected "vi.fn()" to be called with arguments: [ ObjectContaining{…} ]
Number of calls: 0

 FAIL  tests/context/compact-hooks.test.ts > COMPACT1 — global compaction events and preservation hooks > injects a command hook preserve response into the compaction summary
AssertionError: expected '[Conversation Summary]\n' to contain '<preserved_context>'

 FAIL  tests/context/compact-hooks.test.ts > COMPACT1 — global compaction events and preservation hooks > ignores a failing or timed-out hook and still compacts
AssertionError: expected "warn" to be called at least once

 FAIL  tests/hooks/pre-compact.test.ts > COMPACT1 — user pre_compact hook contract > uses the existing hooks.json command format and sends JSON on stdin
TypeError: manager.runPreCompact is not a function

Test Files  2 failed (2)
Tests  4 failed | 1 passed (5)
```

### Vert — implémentation minimale

Commande : `npx vitest run tests/context/compact-hooks.test.ts tests/hooks/pre-compact.test.ts`

Code de retour : `0`

Sortie :

```text
 RUN v4.1.9 /home/patrice/DEV/cb-compact1-2026-09-03

 Test Files  2 passed (2)
      Tests  7 passed (7)
   Start at  15:58:49
   Duration  1.04s (transform 469ms, setup 47ms, import 587ms, tests 451ms, environment 0ms)
```

### Vert — suites voisines ciblées

Commande : `npx vitest run tests/context/compact-hooks.test.ts tests/context/context-engine.test.ts tests/context/non-owning-engine-limit.test.ts tests/context/owns-compaction-limit.test.ts tests/context/compaction-current-request.test.ts tests/context/compaction-limit.test.ts tests/context/compaction-stats.test.ts tests/hooks/pre-compact.test.ts tests/hooks/user-hooks.test.ts tests/unit/handlers.test.ts tests/unit/config-command.test.ts tests/commands/headless-slash.test.ts tests/unit/enhanced-command-handler.test.ts tests/agent/codebuddy-agent.test.ts tests/unit/codebuddy-agent.test.ts`

Code de retour : `0`

Sortie :

```text
 RUN v4.1.9 /home/patrice/DEV/cb-compact1-2026-09-03

 Test Files  15 passed (15)
      Tests  500 passed (500)
   Start at  15:56:55
   Duration  8.72s (transform 12.02s, setup 496ms, import 15.12s, tests 6.89s, environment 2ms)
```

Commande événements/bus/confidentialité : `npx vitest run tests/events/event-bus.test.ts tests/unit/events.test.ts tests/security/donnees-personnelles.test.ts`

Code de retour : `0`

Sortie :

```text
 RUN v4.1.9 /home/patrice/DEV/cb-compact1-2026-09-03

 Test Files  3 passed (3)
      Tests  117 passed (117)
   Start at  15:57:44
   Duration  4.92s (transform 235ms, setup 74ms, import 234ms, tests 5.01s, environment 0ms)
```

Typecheck : `npx tsc --noEmit -p .` — code `0`, aucune sortie.

ESLint ciblé sur les fichiers TypeScript modifiés : code `0`. Sortie :

```text
/home/patrice/DEV/cb-compact1-2026-09-03/src/context/default-context-engine.ts
  37:42  warning  'budget' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
```

`git diff --check` est vert (code `0`). Aucun `npm install`, appel réseau, service, push ou écriture dans `/home/patrice/code-buddy` n’a été effectué.

## Implémentation et commits

- `src/events/types.ts:691-715, 939-943` et `src/events/index.ts:168-172` : charge typée et événements `context:pre_compact` / `context:post_compact` dans `ContextEvents` et `AllEvents`, exportés par le module.
- `src/context/context-manager-v2.ts:377-475, 685-734, 1793-1812` : drapeau manuel, émission avant/après avec compteurs, injection `<preserved_context>`, délégation de l’ancien chemin et propagation du workspace.
- `src/hooks/user-hooks.ts:289-365` : extension `pre_compact` du format `.codebuddy/hooks.json`, stdin JSON, stdout limité à 2 000 caractères, timeout plafonné à 5 s, échec journalisé avec `logger.warn` et ignoré.
- `src/context/default-context-engine.ts:54` : chemin `compact()` du moteur par défaut marqué `reason: 'plugin'` quand il repasse par V2.
- `src/agent/infrastructure/agent-infrastructure.ts:606-614` et `src/agent/codebuddy-agent.ts:162,1727-1729` : workspace actif transmis au manager et API de demande manuelle.
- `src/commands/handlers/branch-handlers.ts:9`, `src/commands/handlers/vibe-handlers.ts:138`, `src/commands/client-dispatcher.ts:222-223`, `src/commands/headless-slash.ts:42-60,123` : câblage `/compact` TUI/headless.
- `tests/context/compact-hooks.test.ts:39-159`, `tests/hooks/pre-compact.test.ts:6-34`, `tests/unit/handlers.test.ts:1470-1477` : événements, raisons auto/manual/plugin, stdin/stdout, injection, échec/timeout, absence de hook et handler `/compact`.
- `docs/context-engine.md:52-54` : trois lignes de documentation utilisateur.

Commit fonctionnel : `9e66ac876 feat(context): add compaction lifecycle hooks` — code et tests ajoutés nominativement, sans `node_modules`, docs ni rapport.
Commit documentaire : `6d0441ef6 docs(context): document compaction lifecycle hooks`.

## Décisions / points ouverts

- Décision imposée par l’API existante : `ContextManagerV2` et ses chemins d’agent sont synchrones. Le hook `pre_compact` utilise donc `spawnSync` borné à 5 s dans le gestionnaire existant ; convertir la compaction en `async` aurait modifié tous les appelants et tests hors périmètre.
- Le nouveau nom de configuration est exactement `pre_compact`; l’alias déjà existant `PreCompact` est aussi accepté pour ne pas casser une configuration utilisateur actuelle. La sortie est traitée comme texte, conformément au contrat demandé.
- Un moteur plugin déclarant `ownsCompaction: true` assemble directement son propre contexte (`context-manager-v2.ts:708-713`) et ne passe pas par `prepareMessagesRaw`; il n’est donc pas instrumenté ici. Un plugin qui appelle `ContextManagerV2` ou `DefaultContextEngine.compact` passe bien par les événements. C’est le seul point ouvert de portée, explicitement dicté par « s’il passe par le manager ».
- `/compact` conserve le comportement documenté existant : message d’information immédiat, puis compaction au prochain passage de préparation. Il n’y a pas de compaction synchrone de l’historique UI à cet endroit.

## Bilan final (dix lignes maximum)

1. Événements globaux typés `context:pre_compact` et `context:post_compact` ajoutés.
2. Les compteurs avant/après et les raisons auto/manual/plugin sont couverts.
3. `/compact` demande une compaction manuelle au prochain tour.
4. Le chemin `DefaultContextEngine.compact` est marqué plugin.
5. Le hook utilisateur `pre_compact` lit le JSON sur stdin.
6. Sa sortie texte est injectée dans `<preserved_context>` et plafonnée à 2 000 caractères.
7. Timeout 5 s et erreurs non bloquantes journalisées par `logger.warn`.
8. Les tests ciblés et voisins couvrent 500 cas verts, puis 117 cas bus/confidentialité.
9. `tsc` et ESLint ciblé sortent code 0 ; ESLint garde un warning préexistant.
10. Commits `9e66ac876` et `6d0441ef6` créés ; la coordination est mise à jour pour passation.
