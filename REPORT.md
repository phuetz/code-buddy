# Inventaire des tests — sections 1 à 4

Révision de départ : `48dd6db32`. Cette reprise corrige les preuves de ce rapport et le test de synchronisation. Aucun code de production n'est modifié.

Les commandes Vitest ci-dessous ont été exécutées dans un export `git archive` jetable, avec `HOME`, `USERPROFILE` et `XDG_*` jetables et une limite de 600 s. Les sorties **intégrales**, y compris les échecs, sont conservées dans `preuves/` du dossier de livraison externe. Les extraits suivants sont copiés de ces sorties.

## 1. Compaction réversible : `context_expand`

Test existant : `tests/tools/context-expand.test.ts`. Mutant **source** : le retour de succès de `ContextExpandTool.execute()` passe de `true` à `false` dans `src/tools/context-expand-tool.ts`.

```text
FAIL  tests/tools/context-expand.test.ts > context_expand > renders exact archived messages with their roles
AssertionError: expected { success: false, …(1) } to deeply equal { success: true, …(1) }
 ❯ tests/tools/context-expand.test.ts:60:20
Test Files  1 failed (1)
Tests  2 failed | 3 passed (5)
mutant_exit=1
```

Sortie complète : `mutant-source-context-expand.log`.

## 2. Chronologie : `buddy replay`

Test existant : `tests/commands/replay.test.ts`, via `createReplayCommand(...).parseAsync()`. Mutant **source** : `renderTools()` renvoie `'-'` dans `src/commands/replay.ts`.

```text
FAIL  tests/commands/replay.test.ts > buddy replay > lists timeline turns as a table with previews, tools, and files
AssertionError: expected 'turn | time        | preview       | …' to contain 'write_file:ok'
 ❯ tests/commands/replay.test.ts:88:22
Test Files  1 failed (1)
Tests  1 failed | 3 passed (4)
mutant_exit=1
```

Sortie complète : `mutant-source-replay.log`. Ce test couvre le rejeu de la chronologie ; il ne valide pas à lui seul le journal des épisodes de Lisa.

## 3. Fédération : `buddy research sync` et `peer.ckg.sync`

Test ajouté : `tests/commands/research-sync.test.ts`. Il traverse le parseur Commander, `runSync()`, `pullFromPeer()`, `dispatchPeerRequest()`, la méthode RPC enregistrée par `wirePeerCkgBridge()`, puis `remember()` et `recall()` sur deux graphes jetables. Le transport reste en processus ; aucun WebSocket ni pair distant n'est testé. Le CKG et le transport réseau par défaut ne sont pas exercés.

Avant reprise, supprimer `wirePeerCkgBridge()` laissait le test vert (`avant-sans-pont.log` : `Tests 1 passed (1)`, sortie 0). Après reprise, la même suppression donne :

```text
FAIL  tests/commands/research-sync.test.ts > buddy research sync (end to end) > runs sync end to end and ingests peer facts into local CKG
"research sync failed: no handler registered for \"peer.ckg.sync\""
 ❯ tests/commands/research-sync.test.ts:95:24
Test Files  1 failed (1)
Tests  1 failed (1)
without_bridge_exit=1
```

Un mutant **source** qui enregistre la mauvaise méthode RPC donne le même refus (`mutant-source-pont-rpc.log`). Un autre mutant **source** qui altère le message final dans `src/commands/research/knowledge-ingest.ts` donne :

```text
FAIL  tests/commands/research-sync.test.ts > buddy research sync (end to end) > runs sync end to end and ingests peer facts into local CKG
Received: "❌ CKG FAIL depuis alpha-peer : 2 ingérée(s), 0 déjà vue(s), curseur 1790362320775."
 ❯ tests/commands/research-sync.test.ts:98:20
Test Files  1 failed (1)
Tests  1 failed (1)
mutant_exit=1
```

Sortie complète : `mutant-source-message-sync.log`. Le curseur dépend de l'heure de la sonde ; le test exige un nombre via `/curseur \d+/`.

## État des preuves

La sonde du rapport initial a échoué sur quatre contrôles : nom du test absent, valeur `42` impossible, mutation de l'attendu plutôt que de la source, et ligne erronée pour `context_expand` (`sonde-rapport-avant.log`). Les extraits ci-dessus reprennent les vrais noms, lignes et valeurs observés. Les trois fonctionnalités justifient `🧪` pour les surfaces testées, sans démontrer une exécution réelle multi-machine.

## Ce que je n'ai pas pu vérifier

- Le transport WebSocket entre deux machines et les profils réels.
- Le journal des épisodes de Lisa au-delà de la chronologie `buddy replay`.
- Les composants Rust et les plateformes Windows/macOS dans cette passe Linux.
