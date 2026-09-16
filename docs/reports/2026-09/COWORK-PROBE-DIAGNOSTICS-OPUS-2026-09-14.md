# Diagnostics des sondes d'import staged Cowork — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Fichiers modifiés : `cowork/scripts/pre-build-check.js` (générateur de la sonde confinée), `cowork/scripts/prepare-core-runtime.js` (boucle de `resolveInstalledDependencyPath` et export), tests dédiés, ce rapport, ligne de coordination
- Non touché : manifeste et dépendances du lot slash (liste `COWORK_REQUIRED_OPTIONAL_DEPENDENCIES`, gate `headless-slash`), noyau, renderer, build AlaSQL, installation, rebuild, modules partagés, Electron, serveur, profil utilisateur. Node 24.14.1 seulement ; Node 20 à vérifier par Codex.

## Résultat

| Scénario (fixture `/tmp`) | Détail avant | Détail après |
| --- | --- | --- |
| S1 paquet ESM absent partout | **2 000** car. (tronqué), URL `data:` du hook recopiée, bloc `{ code, url }` coupé | **183** car., `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'missing-esm' imported from <adapter>` |
| S2 `require` CommonJS absent partout | 1 220 car., frames internes | 332 car., message natif + `Require stack` + frame du module requérant |
| S3 import ESM refusé (paquet seulement chez l'ancêtre) | **importeur absent** | `… imported from <adapter> (only resolvable outside the staged runtime: <chemin>)` |
| S4 `require` CommonJS refusé | **1re ligne « Cannot find module » = gabarit source `'${request}'`** (Node imprime la ligne du `throw`) | `Error [MODULE_NOT_FOUND]: Cannot find module 'anc-cjs' required from <module> (only resolvable…)` + frame du requérant |
| S5 paquet absent, importeur imbriqué très long | 2 000 car. tronqués, `data:` | 575 car., paquet et importeur complets |
| S6 replis optionnels `try require` / `try import()` (absent partout et seulement chez l'ancêtre) | codes corrects | **codes identiques** (`MODULE_NOT_FOUND` ×2, `ERR_MODULE_NOT_FOUND` ×2) |
| S7 `SyntaxError` dans un module staged | rapport natif | **rapport natif conservé** (`file://…:1`, ligne source, curseur, `SyntaxError`) |

Vérification sur le vrai `dist` d'intégration, staging réel dans `/tmp` :

```
[R1] default staging 664 packages: codebuddy-engine-adapter.js=PASS semantic-response-runtime.js=PASS codebuddy-agent.js=PASS headless-slash.js=PASS
[R2] sans la liste Cowork, disposition du dépôt (306 car., sans data:)
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'string-width' imported from …/core-runtime/dist/testing/ai-integration-tests.js (only resolvable outside the staged runtime: ~/code-buddy/cowork/node_modules/string-width/index.js)
[R3] même runtime hors de toute ascendance, erreur native (169 car., sans data:)
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'string-width' imported from …/isolated-resources/dist/testing/ai-integration-tests.js
```

## Correction 1 : détail de sonde lisible

Tout se passe dans `confinedImportSource`, source du processus enfant :

1. **Refus confinés** : ils prennent la forme des erreurs natives et nomment l'importeur.
   - ESM (hook `resolve`) : `Cannot find package '<spécificateur>' imported from <context.parentURL> (only resolvable outside the staged runtime: <fichier>)`.
   - CommonJS (`Module._resolveFilename`) : `Cannot find module '<requête>' required from <parent.filename> (only resolvable outside the staged runtime: <fichier>)`.
   - Codes inchangés : `ERR_MODULE_NOT_FOUND`, ou `MODULE_NOT_FOUND` sous condition `require` / en CommonJS.
2. **Rapport compact de l'import de premier niveau** : l'enfant rattrape l'échec. Une erreur qui porte un `code` Node (erreur de résolution native ou refus) est écrite sous la forme `Nom [code]: message`, suivie des seuls frames `at …` hors `node:internal`, hors wrapper `[eval]` et hors URL `data:` ; code de sortie 1. Une erreur sans code (`SyntaxError`…) est relancée : Node garde son rapport complet.
3. **Retrait de la surcharge de trace** dans le hook : le rapport compact rend inutile la surcharge `error.stack` du lot précédent, qui ne couvrait pas les erreurs natives traversant `nextResolve`.

Les replis optionnels ne voient aucun changement : seul l'import de premier niveau de la sonde est enveloppé, et les erreurs propagées gardent leur objet et leur code. La troncature à 2 000 caractères de `probeStagedImport` est conservée.

## Correction 2 : `while (true)` legacy

`resolveInstalledDependencyPath` utilisait `while (true)` avec deux sorties internes (`!cursor`, `parent === cursor`). Nouvelle forme : `while (cursor !== previous)`, avec `previous = cursor; cursor = packageParent(cursor)`. Ordre des candidats, confinement, valeurs de retour et erreurs sont identiques. La sortie `parent === cursor` devient la condition de boucle. La fonction est exportée pour ses tests. Aucune désactivation de lint.

**Preuve d'équivalence** (non committée) : l'ancienne fonction est extraite de `HEAD` et exécutée dans un contexte `vm`, puis comparée à la nouvelle sur :
- 17 curseurs : racine, scopes, imbrications à 3 niveaux, `packages/app`, `node_modules/`, chemins hors `node_modules`, échappements `../` ;
- 15 noms : présents à différents niveaux, absents, scopés, sans `package.json`, invalides, 215 caractères ;
- plus `coreRoot` égal à la racine du système de fichiers.

Résultat : **289 comparaisons, 0 écart** sur les valeurs comme sur les messages d'erreur.

## Tests

`cowork/src/tests/pre-build-check.test.ts`, bloc « staged import diagnostics » (5 nouveaux, 34 au total) :
- paquet absent partout : ligne de tête `Error [ERR_MODULE_NOT_FOUND]: … 'chalk' … imported from <adapter réel>`, pas de `data:`, moins de 2 000 caractères ;
- import ESM refusé : importeur et mention « only resolvable outside the staged runtime » ;
- `require` CommonJS refusé : importeur (`index.cjs` réel), ni `${request}` ni `data:` ;
- replis optionnels pour des paquets absents partout : sonde verte (codes vérifiés dans la fixture) ;
- `SyntaxError` staged : URL `file://…/chalk/index.js:1` et `SyntaxError: Unexpected token ';'` conservés.

`cowork/src/tests/prepare-core-runtime.test.ts`, bloc `resolveInstalledDependencyPath` (4 nouveaux, 20 au total) :
- plus proche d'abord puis remontée : imbriqué, paquet englobant, racine, scope, `packages/app` ;
- `null` après l'échec de la recherche racine, depuis toute profondeur ;
- terminaison avec `coreRoot` égal à la racine du système de fichiers (`path.parse(os.tmpdir()).root`, nom absent aléatoire, simple et scopé) ;
- refus d'échappement conservé.

## Validation

Toutes les commandes sont lancées depuis `cowork/`.

| Contrôle | Résultat |
| --- | --- |
| `npx vitest run src/tests/prepare-core-runtime.test.ts src/tests/pre-build-check.test.ts tests/core-runtime-packaging.test.ts tests/embedded-mode.test.ts` | 4 fichiers, **99/99** |
| Mutation M1 : l'enfant relance toute erreur (rapport Node brut) | 3 tests de lisibilité rouges ; garde-fous des replis et de `SyntaxError` verts ; restaurée |
| Mutation M2 : refus sans importeur | 2 tests d'importeur rouges ; 32 verts ; restaurée |
| Mutation M3 : remontée des paquets englobants sautée | test « nearest-first » rouge ; restaurée |
| `node --check` sur les deux scripts | OK |
| `npx eslint --max-warnings 0` sur les 4 fichiers | 0 erreur, 0 avertissement |
| `npm run lint -- --max-warnings 0` (legacy) sur les 4 fichiers | **0 erreur** (l'erreur `no-constant-condition` préexistante a disparu) |
| `tsc --noEmit --strict` ponctuel sur les 2 tests | OK |
| `git diff --check` | propre |
| `node_modules` partagés, `find -newerct 2026-09-14 02:06:30` hors caches Vite/Vitest | aucun changement |
| `/tmp` | aucune fixture résiduelle |

## Recherche d'un défaut supplémentaire

Question testée : la sonde transmet `process.env` au processus enfant, donc le vrai `HOME` du packager. Si l'import de l'agent (plus de 700 modules) écrivait dans le profil, le `cwd` ou `TMPDIR`, le pre-build-check modifierait le poste de packaging.

Vérification sur un vrai staging (664 paquets), avec `HOME`, `USERPROFILE`, XDG et `TMPDIR` isolés, puis les 4 sondes : **aucune entrée** créée dans `HOME`, `TMPDIR`, le `cwd` Cowork ni à la racine du runtime. **Pas de défaut**, aucune correction.

Aucun autre défaut concret démontré pendant ce lot, donc pas de lot supplémentaire proposé par défaut. Pistes observées mais **non démontrées** (à ne pas traiter sans reproduction) : durée des sondes sur un runner Windows lent face au délai de 30 s (l'agent prend 0,7 s ici) ; runs Node 20, Windows et macOS de ces tests, à la charge de Codex.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/scripts/pre-build-check.js`
- `cowork/scripts/prepare-core-runtime.js`
- `cowork/src/tests/pre-build-check.test.ts`
- `cowork/src/tests/prepare-core-runtime.test.ts`
- `docs/reports/2026-09/COWORK-PROBE-DIAGNOSTICS-OPUS-2026-09-14.md`
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot)

## Contre-validation du pilote

Port sélectif dans `integration/improvements-persistence-2026-09-13`. Les 99 tests
du lot passent sous Node 20.20.2. Une revue indépendante a trouvé un cas de
terminaison : après un import CommonJS ayant ouvert un intervalle puis échoué,
`process.exitCode = 1` conservait le processus jusqu'au délai de 30 secondes,
qui masquait le diagnostic.

La régression a été reproduite puis corrigée : écriture synchrone bornée à
2 000 caractères, puis fin immédiate de l'enfant sur une erreur d'import codée.
Les succès, replis optionnels et erreurs sans code gardent leur comportement.
Après ce complément, les quatre suites passent sous Node 20 et 24 : 100 tests.
Lint ciblé, syntaxe Node et diff-check passent. Le processus est une sonde jetable ;
ses finalizers éventuels ne s'exécutent pas après cette erreur fatale.
