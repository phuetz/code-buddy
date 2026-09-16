# Réparation PERSONA1 — huit tests rouges

Mission ouverte le 04/09/2026 dans `~/DEV/cb-persona1-2026-09-04`, branche
`fix/persona1-huit-rouges-2026-09-04`, base `1709228c8`.

Ce rapport a été créé avant toute inspection du dépôt. `~/code-buddy` et le vrai
`~/.codebuddy` n'ont jamais été écrits. Tous les HOME de QA sont sous
`~/DEV/cb-persona1-2026-09-04/_qa/persona1/`.

## Reproduction initiale

Commande exécutée avec un HOME QA contrôlé :

```text
HOME=~/DEV/cb-persona1-2026-09-04/_qa/persona1/home \
  npx vitest run tests/enhanced-memory.test.ts tests/persona-manager.test.ts tests/persona-handler.test.ts
```

Rouge initial collé :

```text
Test Files  3 failed (3)
Tests       8 failed | 73 passed (81)

enhanced-memory: 7 != 2 (recall), 5 != 1 (type), 2 != 1 (tags),
                 2 != 1 (query), 31 != 3 (stats)
persona-handler:  "No active persona." does not contain "Default Assistant"
persona-manager:  active id undefined != "default"
                  status does not contain "Active"
```

## Provenance mesurée

### Mémoire

Le code initial construisait toujours `~/.codebuddy/memory` (`src/memory/enhanced-memory.ts:194`)
et les tests créaient chaque `EnhancedMemory` sans répertoire dédié. Leur mock de
`fs-extra` ne remplaçait pas `node:fs/promises`, utilisé par `readJsonAtomic` et
`writeJsonAtomic`. Après chaque test, `dispose()` écrivait donc l'index ; l'instance
du test suivant rechargeait les entrées précédentes.

Reproduction sur un HOME QA réellement neuf (`clean-home.B3xIpG`) avec
`strace -f -e trace=openat` :

```text
.../_qa/persona1/clean-home.B3xIpG/.codebuddy/memory/memory-index.json
  O_RDONLY = -1 ENOENT
.../_qa/persona1/clean-home.B3xIpG/.codebuddy/memory/memory-index.json.tmp....
  O_WRONLY|O_CREAT|O_TRUNC, 0600
```

Le premier accès est donc bien absent, puis le même chemin est créé et relu par
les tests suivants. Aucun `codebuddy.db` n'a été ouvert dans cette suite mockée :
la tentative de repository SQLite échoue avant connexion et le code retombe sur
le JSON. Le parasite n'est ni le vrai HOME, ni le cwd, ni un cache de module :
c'est la persistance normale du défaut, partagée entre tests.

### Personas

Le défaut initial était `path.join(os.homedir(), '.codebuddy', 'personas')`
(`src/personas/persona-manager.ts:522`) et `initialize()` lisait ensuite
`persona-state.json` avant d'appliquer `activePersonaId` (`:553-555`). Le trace
initial ouvre effectivement `.../_qa/persona1/home/.codebuddy/persona-state.json`.
En parallèle, les tests lisaient `getActivePersona()` avant d'attendre la
promesse d'initialisation ; l'état actif pouvait donc être nul au moment de la
commande. Les appels `setActivePersona()` des tests écrivaient aussi un état
partagé sous ce défaut.

## Corrections

1. `EnhancedMemory` accepte `dataDir?: string`. Sans option, le chemin reste
   exactement `~/.codebuddy/memory`, vérifié par `getDefaultMemoryDataDir()`.
   Les tests utilisent un `makeTmpDir()` local à `_qa/persona1`, `useSQLite:false`,
   puis attendent `flush()` avant de retirer leur répertoire.
2. `PersonaManager` accepte `persistActivePersona`, `true` par défaut. Les tests
   utilisent un `customPersonasDir` local et `persistActivePersona:false`, puis
   attendent `manager.ready()`. Le chemin de production reste exactement
   `~/.codebuddy/personas`, et la persistance active reste activée par défaut,
   assertions dédiées à l'appui.
3. Les deux helpers de chemin rendent ces défauts testables sans instancier un
   composant qui écrirait dans un HOME réel. Les deux `any` historiques du fichier
   mémoire ont été remplacés par un cast `unknown` pour satisfaire l'ESLint ciblé.

Commits de cause :

- `4838c0313` — `fix(memory): inject enhanced memory data directory`
- `7e8967bc1` — `fix(personas): isolate active persona persistence in tests`

## Vérifications

| Commande | Résultat |
|---|---|
| trois fichiers ciblés, HOME QA factice et peuplé (`memory-index.json`, persona persistée) | **3 fichiers, 83/83 tests verts** |
| `npx vitest run tests/memory tests/personas tests/commands` | **171 fichiers : 1 507 passés, 5 ignorés, 3 rouges** ; les 3 rouges sont les smokes Hermes réels, environnement navigateur local indisponible, hors PERSONA1 |
| même suite avec `--exclude tests/commands/hermes-commands.test.ts` | **170 fichiers, 1 459 passés, 5 ignorés** |
| `npx tsc --noEmit -p .` | **0** |
| ESLint ciblé sur les 5 fichiers modifiés (`--max-warnings=0`) | **0 erreur, 0 avertissement** |
| `git diff --check` | **0** |

La preuve d'isolation a été exécutée après avoir peuplé le faux HOME : les tests
ciblés ont continué à utiliser leurs répertoires QA injectés et n'ont pas rappelé
`foreign-memory` ni `foreign-persona`. Aucun service n'a été touché, aucun push et
aucun appel payant n'ont été effectués.
