# Slash commands dans le runtime packagé Cowork — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Décision pilote appliquée : livrer `string-width` et `@google/generative-ai` via le staging, rendre fatal le gate `commands/headless-slash.js`
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Source : `dist` de la branche d'intégration, en lecture seule (`~/DEV/cb-improvements-persistence-2026-09-13/dist`)
- Non touché : noyau, versions, npm install/rebuild, Electron, userData, serveur, lot build AlaSQL/renderer (gelé), présence UI. Les 3 corrections de sonde copiées par Codex et leurs 3 tests sont inchangés ; seul le helper de fixture partagé est complété (voir Tests).

## Résultat

| Élément | Avant | Après |
| --- | --- | --- |
| Staging par défaut (vrai `dist`, override `better-sqlite3`) | 660 paquets | **664 paquets** (+4) |
| Import confiné de `commands/headless-slash.js` sur le vrai runtime | **échec** `Cannot find package 'string-width'` | **succès** |
| `/help` exécuté depuis le runtime isolé | — | **handled**, 562 lignes, aucun fichier écrit dans le `HOME` isolé |
| Gate pre-build-check de la passerelle slash | absent | `esm-import`, **fatal** |
| Source installée sans `string-width` | runtime livré sans passerelle (faux vert) | staging arrêté par un **diagnostic nommé**, runtime précédent intact |

## Modifications

### `cowork/scripts/prepare-core-runtime.js`

- **Liste figée** `COWORK_REQUIRED_OPTIONAL_DEPENDENCIES = ['@google/generative-ai', 'string-width']`, exportée et documentée par ses importeurs statiques : `commands/handlers/ultraplan-handler`, `commands/handlers/test-handlers`, et à l'exécution `testing/ai-integration-tests`.
- **Intégration au parcours existant** : `collectInstalledRuntimePackagePaths` accepte `requiredOptionalDependencies`. Chaque nom entre dans la même file que les `dependencies` racine, donc sa fermeture est prise sur l'installation réelle, versions imbriquées comprises : `string-width/node_modules/strip-ansi` 7 plutôt que le `strip-ansi` hissé. `includeRootOptional` et le reste des options racine restent exclus.
- **Diagnostics fermés** :
  - `Cowork-required dependency <nom> is not declared by the core package` : refus de livrer un paquet fantôme non déclaré ;
  - `Cowork-required optional dependency is not installed: <nom> (the packaged slash-command gateway imports it; run npm install without --omit=optional)` ;
  - `Cowork-required optional dependency does not support <plateforme>/<arch>` : un filtre `os`/`cpu` ne peut plus l'écarter en silence.
  - Les trois erreurs surviennent **avant** l'effacement du runtime existant.
- **Manifeste staged** : nouveau champ `requiredOptionalDependencies`, placé à côté de `includeRootOptional`, `packageCount` et `nativeOverrides`. Le noyau lit ce manifeste comme un objet libre (`runtimeManifestAt` → `isPlainRecord`), et `validateRuntimeManifest` ne rejette pas les champs supplémentaires.
- **Option** `prepareCoreRuntime({ requiredOptionalDependencies })` : par défaut la liste Cowork, `[]` possible pour les essais.

### `cowork/scripts/pre-build-check.js`

Nouveau check fatal `Code Buddy slash-command gateway dependency closure` sur `.bundle-resources/core-runtime/dist/commands/headless-slash.js`, de type `esm-import`. Il passe donc par la sonde confinée du lot précédent : une dépendance présente seulement dans `cowork/node_modules` ou `<repo>/node_modules` le fait échouer. Aucun marqueur `package.json` redondant : l'import confiné est la preuve.

## Preuve sur le vrai staging isolé

Méthode :
- disposition `/tmp/cowork-slash-proof-*` calquée sur le dépôt : `repo/node_modules` et `repo/cowork/node_modules` en liens symboliques en lecture vers les modules partagés, `dist` d'intégration copié, manifeste source généré par `computeDistDigest` ;
- `fs.linkSync` neutralisé : copies uniquement, aucun lien physique vers les inodes partagés ;
- `HOME` et XDG isolés ; nettoyage final avec retrait explicite des liens symboliques.

```
pre-build-check gate: {"label":"Code Buddy slash-command gateway dependency closure","relPath":".bundle-resources/core-runtime/dist/commands/headless-slash.js","type":"esm-import","severity":"fatal"}

[1] staging WITHOUT the Cowork list: 660 packages (2.7 s), nativeOverrides=["better-sqlite3"]
   PASS dist/desktop/codebuddy-engine-adapter.js
   PASS dist/conversation/semantic-response-runtime.js
   PASS dist/agent/codebuddy-agent.js
   FAIL dist/commands/headless-slash.js | Cannot find package 'string-width' in the staged runtime (resolved outside it: ~/code-buddy/cowork/node_modules/string-width/index.js)

[2] default staging: 664 packages (3.1 s); added: ["node_modules/@google/generative-ai","node_modules/emoji-regex","node_modules/string-width","node_modules/string-width/node_modules/strip-ansi"]
    staged manifest: {"requiredOptionalDependencies":["@google/generative-ai","string-width"],"includeRootOptional":false,"packageCount":664,"nativeOverrides":["better-sqlite3"]}
    versions: @google/generative-ai 0.21.0, emoji-regex 10.6.0, string-width 7.2.0, strip-ansi (imbriqué) 7.1.2
   PASS adapter / semantic runtime / agent / commands/headless-slash.js (sondes confinées)

[3] source without string-width -> Cowork-required optional dependency is not installed: string-width (the packaged slash-command gateway imports it; run npm install without --omit=optional)
    previous runtime untouched: true

[4] /help from isolated runtime: exit=0
    {"handled":true,"denied":false,"reason":null,"chars":21491,"lines":562,"head":["╔═…╗","║ 📚 CODE BUDDY COMMANDS ║","╚═…╝",""],"hasHelp":true}
    {"deniedToken":{"handled":true,"denied":true,"reason":"__YOLO_MODE__ is not available in this surface yet"}}
    files created in isolated HOME: []

cleanup: removed true | shared roots intact: true true
```

Précisions :
- **Étape [1]** : la dépendance manquante est résolue ici depuis `cowork/node_modules` (lui aussi ancêtre), pas seulement depuis la racine. La sonde confinée l'attrape quand même.
- **Étape [3]** : la source sans `string-width` est simulée par un `repo/node_modules` fait de liens vers chaque entrée partagée sauf `string-width`. Rien n'a été retiré des modules partagés.
- **Étape [4]** : le runtime est déplacé hors de toute ascendance `node_modules`, puis `executeHeadlessSlashToken('__HELP__', [], new Set(['__HELP__']))` est appelé, exactement le chemin de `slash-command-bridge.ts`. Environnement minimal (`PATH`, `HOME`/XDG isolés, `TMPDIR`, `NODE_ENV=test`), sans clé fournisseur, LLM, moteur ni config utilisateur.

## Tests

`cowork/src/tests/prepare-core-runtime.test.ts` (16 tests) :
- **nouveaux** (5) :
  - la liste exacte est livrée avec sa fermeture, dont `strip-ansi` imbriqué et `ansi-regex` remonté, mais pas les autres options racine ;
  - dépendance absente nommée avec la consigne ;
  - dépendance non déclarée refusée ;
  - dépendance filtrée pour la cible refusée ;
  - `prepareCoreRuntime` s'arrête sans écrire de runtime ;
- **fixtures adaptées** : les trois tests existants passant par `prepareCoreRuntime` déclarent et installent les deux paquets factices (helper `installCoworkRequiredOptional`). Le test ESM attend les 4 chemins et le champ de manifeste.

`cowork/src/tests/pre-build-check.test.ts` (29 tests) :
- **complément de fixture** : le helper partagé `populateEngineAdapter` écrit désormais `dist/commands/headless-slash.js` et deux faux paquets staged (`string-width` ESM, `@google/generative-ai` CommonJS à export nommé). Indispensable pour que les tests « tout passe » reflètent le nouveau gate. Les 3 tests de sonde copiés par Codex ne sont pas modifiés : leur filtre ne vise que l'adapter et l'agent ;
- **nouveaux** (4) : passerelle et dépendances staged → vert ; passerelle absente → fatal ; `string-width` puis `@google/generative-ai` présents seulement dans l'installation source ancêtre → fatal, détail nommant le paquet.

## Validation

Toutes les commandes sont lancées depuis `cowork/`, Node v24.14.1.

| Contrôle | Résultat |
| --- | --- |
| Tests avant ajout des fixtures | 8 rouges attendus (3 fixtures sans les paquets, 5 fixtures sans passerelle) |
| `npx vitest run src/tests/pre-build-check.test.ts src/tests/prepare-core-runtime.test.ts tests/core-runtime-packaging.test.ts tests/embedded-mode.test.ts` | 4 fichiers, **90/90** |
| Mutation A : liste Cowork vide | 5 tests staging rouges ; restaurée |
| Mutation B : gate réduit à un contrôle d'existence (`type: 'file'`) | 2 tests « only exists in the source install » rouges ; restauré |
| `node --check` sur les deux scripts | OK |
| `npx eslint --max-warnings 0` sur les 4 fichiers | 0 erreur, 0 avertissement |
| `npm run lint -- --max-warnings 0` sur les 4 fichiers | 1 erreur **préexistante** : `no-constant-condition` sur le `while (true)` de `resolveInstalledDependencyPath`. La base `HEAD` passée au même lint via stdin donne la même erreur (ligne 191) ; aucun hunk de ce lot ne touche cette ligne. Les 3 autres fichiers sont propres |
| `tsc --noEmit --strict` ponctuel sur les 2 tests | OK |
| `git diff --check` | propre |
| `node_modules` partagés, `find -newerct 2026-09-14 01:54` hors caches Vite/Vitest | aucun changement |
| `/tmp` | aucune fixture résiduelle |

## Limites

- Node 24.14.1 seulement ; Windows et macOS non exécutés.
- Seul `/help` a été exécuté. Les autres jetons de l'allowlist Cowork n'ont pas été lancés, conformément à la consigne (pas d'import arbitraire des 122 modules).
- `packageCount` et `requiredOptionalDependencies` du manifeste staged ne sont pas revérifiés par le pre-build-check : le gate d'import confiné apporte la preuve comportementale.

## Lots suivants proposés

1. **Lisibilité du détail de sonde** (complément à la correction copiée, non fait) : quand un paquet manque sans ancêtre (cas d'un clone CI propre), l'erreur native `ERR_MODULE_NOT_FOUND` traverse `nextResolve`, et sa trace recopie l'URL `data:` du hook dans le détail du check. Il suffirait de rattraper l'erreur dans le hook et d'en réduire la trace, comme pour le refus confiné. Observé dans la sortie du test existant « staged adapter cannot resolve a bare ESM dependency ».
2. **Lint legacy du staging** : remplacer `while (true)` par une boucle bornée dans `resolveInstalledDependencyPath` pour rendre `npm run lint` vert sur ce script (préexistant, purement qualité).
3. **Garde systématique** (reporté par consigne) : sonde confinée en une passe des modules `loadCoreModule` de Cowork, en avertissement, pour détecter la prochaine option statique non livrée.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/scripts/prepare-core-runtime.js`
- `cowork/scripts/pre-build-check.js` (contient aussi la sonde confinée du lot précédent, déjà copiée)
- `cowork/src/tests/prepare-core-runtime.test.ts`
- `cowork/src/tests/pre-build-check.test.ts` (contient aussi les 3 tests du lot précédent, inchangés)
- `docs/reports/2026-09/COWORK-SLASH-STAGING-OPUS-2026-09-14.md`
- `docs/FABLE5-CODEX-COORDINATION.md` (ma ligne)

## Contre-validation du pilote

Codex a porté les quatre fichiers de code/tests et ce rapport dans la branche
`integration/improvements-persistence-2026-09-13`. Revue indépendante : aucun
défaut bloqueur, erreurs avant effacement du runtime et fermeture des dépendances
imbriquées conservée. Les quatre suites passent également sous Node 20.20.2 :
90 tests verts. Aucune version de dépendance modifiée.

Preuve indépendante renforcée : cet environnement possède un `/node_modules`
global, donc déplacer le runtime sous `/tmp` seul ne suffit pas à isoler les
résolutions. Le second contrôle utilise la sonde confinée ESM/CommonJS réelle.
Un staging de 664 paquets est copié sans hardlinks ; un wrapper à l'intérieur
importe la passerelle, exécute `/help` (562 lignes) et vérifie un jeton refusé.
Résultat vert sous Node 20.20.2 et 24.14.1 ; HOME de fixture vide, fixture supprimée.
Preuve : `/tmp/cb-slash-staging-confined-independent.json`. Electron, fournisseurs
et ABI SQLite ne sont pas exercés.

Lint, typechecks et contrôle paquet (10 tests) passent. Le garde données
personnelles a repéré un chemin utilisateur absolu dans ce rapport ; anonymisé
avant commit puis garde rejoué : 40/40 verts.
