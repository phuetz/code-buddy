# Staging runtime du packaging Cowork — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Source auditée : `dist` de la branche d'intégration, en lecture seule (`~/DEV/cb-improvements-persistence-2026-09-13/dist`, 7 684 fichiers, 54 Mio)
- Périmètre : scripts de staging Cowork, tests dédiés, ce rapport, ligne de coordination
- Non fait : npm install/rebuild, téléchargement, electron-builder, versions de paquets, services, fichiers build livrés (`cowork/vite.config.ts`, test AlaSQL), FleetBridge/FleetPanel, sources noyau

## Verdict

| Question | Réponse | Preuve |
| --- | --- | --- |
| Le runtime livré résout-il ses dépendances obligatoires ? | **Oui pour les trois entrées sondées** (adapter, semantic runtime, agent). **Non pour `commands/headless-slash.js`**, que Cowork charge pour ses slash commands | exécution sur un vrai staging isolé |
| Le pre-build-check dit-il la vérité ? | **Non avant correction** : ses sondes d'import résolvaient les paquets manquants depuis les `node_modules` ancêtres du dépôt (faux vert). **Oui après** | fixture + vrai staging, contre-preuve rouge |
| Options SQL et natives : diagnostic honnête ? | **Oui** pour SQL (`basic` + avertissement explicite) ; les natives absentes échouent proprement en `ERR_MODULE_NOT_FOUND` | exécution sur le runtime isolé |

**Défaut corrigé (un seul)** : validation non hermétique de `cowork/scripts/pre-build-check.js`.
**Défaut démontré, non corrigé** : `headless-slash.js` introuvable en app packagée. La correction relève d'un arbitrage, voir « Lot suivant proposé ».

## Défaut corrigé : sonde d'import non hermétique

### Cause

`prepare-core-runtime.js` prépare le runtime dans `cowork/.bundle-resources/core-runtime/`, donc sous `cowork/node_modules` et `<repo>/node_modules`. Les sondes `esm-import` du pre-build-check lançaient un simple `await import(<fichier staged>)`. La recherche Node remonte les dossiers parents et trouvait dans ces `node_modules` ancêtres tout paquet absent du staging. Sous `<resources>/dist` d'une app installée, ces ancêtres n'existent pas. Le commentaire du script affirmait pourtant que la sonde prouvait la résolution « exactly as it will under `<resources>/dist` ».

Le seul garde-fou était le marqueur codé en dur `node_modules/chalk/package.json` : il protège `chalk` et rien d'autre.

### Reproduction sur fixture (`/tmp`)

Disposition calquée sur le dépôt : `node_modules/chalk` à la racine, `cowork/` complet pour win32, runtime staged **sans** `chalk`.

```
PASS .bundle-resources/core-runtime/dist/desktop/codebuddy-engine-adapter.js
PASS .bundle-resources/core-runtime/dist/agent/codebuddy-agent.js
FAIL .bundle-resources/core-runtime/node_modules/chalk/package.json
resources-like import dist/desktop/codebuddy-engine-adapter.js exit=1 Cannot find package 'chalk' …
resources-like import dist/agent/codebuddy-agent.js exit=1 Cannot find package 'chalk' …
```

### Reproduction sur le vrai staging

Méthode :
- fixture `/tmp/cowork-runtime-proof-*` : `repo/package.json` copié de la base, `repo/node_modules` en **lien symbolique** vers les modules partagés, `dist` d'intégration **copié** ;
- `prepareCoreRuntime` réel vers `repo/cowork/.bundle-resources/core-runtime` : 660 paquets, 10,3 s ;
- `fs.linkSync` neutralisé pour forcer la copie, parce que `/tmp` est sur le même système de fichiers que `/home` et que des liens physiques auraient partagé les inodes des `node_modules` partagés ;
- `HOME` isolé ; sonde d'origine répliquée à l'identique.

| Entrée | [A] runtime dans la disposition du dépôt, sonde d'origine | [B] même runtime déplacé hors de toute ascendance |
| --- | --- | --- |
| `desktop/codebuddy-engine-adapter.js` | exit 0 | exit 0 |
| `conversation/semantic-response-runtime.js` | exit 0 | exit 0 |
| `agent/codebuddy-agent.js` | exit 0 | exit 0 |
| `commands/headless-slash.js` | **exit 0** (faux vert) | **exit 1** : `Cannot find package 'string-width' imported from …/dist/testing/ai-integration-tests.js` |

### Correction

`cowork/scripts/pre-build-check.js` :
- `probeStagedImport(rootDir, entryPath, runtimeRoot)` (exporté) lance l'import dans un processus Node **confiné au runtime staged**.
- Côté ESM, un hook `resolve` enregistré par `module.register` refuse toute résolution hors du runtime avec `ERR_MODULE_NOT_FOUND`, ou `MODULE_NOT_FOUND` quand la condition `require` est présente.
- Côté CommonJS, `Module._resolveFilename` applique le même refus avec `MODULE_NOT_FOUND`. Les replis optionnels `try { require() }` et `try { await import() }` se comportent donc comme en app packagée.
- La trace de l'erreur du hook est réduite à `Error [code]: message`, sinon le détail recopiait l'URL `data:` du hook.
- `runChecks` utilise cette sonde pour les checks `esm-import` (tous sous `.bundle-resources/core-runtime`). Liste des checks, sévérités et manifeste inchangés.

Mécanisme validé au préalable sous Node 24.14.1 :
- sans confinement : `{"cjs":1,"esm":"loaded"}` (fuite) ;
- avec confinement : `{"cjs":"caught:MODULE_NOT_FOUND","esm":"caught:ERR_MODULE_NOT_FOUND:…"}`, le code d'erreur traversant bien le thread des hooks, et aucun avertissement expérimental.

### Après correction, vrai staging, disposition du dépôt (ancêtre présent)

```
PASS dist/desktop/codebuddy-engine-adapter.js (82 ms)
PASS dist/conversation/semantic-response-runtime.js (74 ms)
PASS dist/agent/codebuddy-agent.js (680 ms)
FAIL dist/commands/headless-slash.js (212 ms)
[Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'string-width' in the staged runtime (resolved outside it: …/node_modules/string-width/index.js)]
```

La sonde confinée reproduit exactement le comportement de la disposition `<resources>` [B]. Aucune régression : les trois entrées gardées par le packaging restent vertes sur le runtime réel.

### Tests

`cowork/src/tests/pre-build-check.test.ts`, bloc « staged imports ignore ancestor node_modules ». Le parent temporaire joue le rôle de la racine du dépôt.

1. Une dépendance ESM présente seulement chez l'ancêtre bloque l'adapter et l'agent (`Cannot find package 'chalk'`).
2. Un `require` CommonJS d'un paquet staged vers un paquet seulement présent chez l'ancêtre bloque les deux sondes (`Cannot find module 'ancestor-only-cjs'`).
3. Un `try { require() }` et un `try { await import() }` optionnels vers des paquets seulement présents chez l'ancêtre restent verts, avec `MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND`.

## Défaut démontré, non corrigé : slash commands en app packagée

`cowork/src/main/commands/slash-command-bridge.ts:470` appelle `loadCoreModule('commands/headless-slash.js')`. Son graphe statique (425 modules) importe deux **optionalDependencies racine**, que `prepare-core-runtime.js` ne livre pas par défaut, par choix documenté :
- `string-width` : `import stringWidth from "string-width"` dans `commands/handlers/test-handlers.js` (et `testing/ai-integration-tests.js`) ;
- `@google/generative-ai` : `import { GoogleGenerativeAI } from '@google/generative-ai'` dans `commands/handlers/ultraplan-handler.js`.

Sur les 122 modules que Cowork charge via `loadCoreModule`, c'est le **seul** dont le graphe d'imports statiques exige un paquet non livré (analyse statique, lecture seule). En app packagée, `loadCoreModule` rendrait `null` et le pont journaliserait `Core headless-slash module unavailable`. En dev, tout fonctionne grâce au `node_modules` racine, et aucun check ne sonde ce module. L'exécution s'arrête au premier paquet manquant (`string-width`) ; `@google/generative-ai` suivrait.

## Audit des options SQL et natives

- **Fermeture livrée** : 660 paquets (549 au premier niveau). Le `dist` importe 79 paquets nus ; 26 manquent au staging. Répartition :
  - majoritairement des `import()` dynamiques d'options : `better-sqlite3`, `alasql`, `sharp`, `playwright`, `node-pty`, `tree-sitter*`, `xlsx`, `tar`, `web-push`, `node-llama-cpp`, `@xenova/transformers`, `@nut-tree-fork/nut-js`, `@picovoice/porcupine-node`, `@mlc-ai/web-llm`, et `@phuetz/companion-core` (non déclaré, chargé seulement sous `CODEBUDDY_COMPANION_CORE`) ;
  - imports statiques d'options hors des modules que Cowork charge : `d3-node` (renderers/charts), `vscode-languageserver*` (lsp, devDependencies) ;
  - faux positifs de gabarits de code générés (`react-dom`, `helmet`, `@vitejs/plugin-react`, `vscode`).
- **SQL** : sur le runtime isolé, sans `better-sqlite3` ni `alasql`, `SQLAgent.initialize()` émet `{"engine":"basic","warning":"No SQL engine available. Limited functionality."}`. Diagnostic honnête. Dans le vrai packaging, `better-sqlite3` est remplacé par la liaison Electron de Cowork (`nativeOverrides`) et gardé par deux checks fatals.
- **Natives** : `better-sqlite3`, `alasql`, `node-pty`, `sharp`, `tree-sitter` → `ERR_MODULE_NOT_FOUND` dans le runtime isolé ; leur gestion par chaque appelant du noyau n'est pas auditée ici.
- **Manifeste** : `codebuddy-runtime.json` est validé par digest du `dist` (schéma 2), aucun défaut trouvé. `packageCount` et `nativeOverrides` ne sont pas vérifiés par le pre-build-check : écart mineur, non démontré comme défaut.

## Preuves de validation

Toutes les commandes sont lancées depuis `cowork/`, Node v24.14.1.

| Contrôle | Résultat |
| --- | --- |
| `npx vitest run src/tests/pre-build-check.test.ts src/tests/prepare-core-runtime.test.ts tests/core-runtime-packaging.test.ts tests/embedded-mode.test.ts` | 4 fichiers, **81/81** |
| Contre-preuve : sonde d'origine remise temporairement | **3 nouveaux tests rouges**, 22 existants verts ; correction restaurée |
| `node --check scripts/pre-build-check.js` | OK |
| `npx eslint --max-warnings 0` et `npm run lint -- --max-warnings 0` sur les 2 fichiers | 0 erreur, 0 avertissement |
| `tsc --noEmit --strict` ponctuel sur le test | OK |
| `git diff --check` | propre |
| `node_modules` liés, `find -newerct 2026-09-14 01:38` hors caches Vite/Vitest | aucun changement |
| Fixtures `/tmp` | supprimées (lien symbolique retiré avant la suppression récursive) ; cible partagée intacte |

## Limites

- Node 20 non disponible (seul 24.14.1 dans nvm). Cowork exige Node ≥ 22 ; `module.register` existe depuis Node 20.6. Windows et macOS non exécutés : les chemins passent par `path.relative`/`path.sep` et `fileURLToPath`.
- L'analyse de joignabilité suit les imports statiques du `dist`, pas les `import()` relatifs paresseux internes au noyau : un module chargé plus tard par l'agent peut encore exiger une option non livrée (par exemple les renderers `d3-node`).
- Aucune commande refusée. Un pipeline `grep | sed` a été remplacé par un script Node en lecture seule, méthode autorisée.

## Lot suivant proposé

1. **Slash commands packagées** (décision) : soit rendre paresseux dans le noyau les imports de `string-width` et `@google/generative-ai` (propriétaire du noyau), soit livrer explicitement ces deux petits paquets optionnels dans le staging Cowork. Ensuite, ajouter `commands/headless-slash.js` aux sondes `esm-import` (sévérité à choisir), désormais significatives.
2. **Garde systématique** : sonder en une passe confinée les 122 modules `loadCoreModule` de Cowork et lister les échecs par module, en fatal ou en avertissement. Le défaut ci-dessus deviendrait visible au packaging, ainsi que toute régression future.

## Passation

- Fichiers de ce lot, à ajouter nommément :
  - `cowork/scripts/pre-build-check.js`
  - `cowork/src/tests/pre-build-check.test.ts`
  - `docs/reports/2026-09/COWORK-RUNTIME-STAGING-OPUS-2026-09-14.md`
  - `docs/FABLE5-CODEX-COORDINATION.md` (ma ligne)
- Fichiers du lot précédent encore présents dans le worktree, déjà repris par Codex : `cowork/vite.config.ts`, `cowork/tests/vite-main-alasql-react-native.test.ts`, `COWORK-BUILD-OPUS-2026-09-14.md`. Non modifiés dans ce lot.

## Contre-validation du pilote après port sélectif

Codex a porté les deux fichiers de code et ce rapport dans la branche
`integration/improvements-persistence-2026-09-13`, après revue indépendante.
La sonde isole la résolution des modules ; elle ne constitue pas une sandbox
d'exécution. Les builtins et les replis optionnels restent utilisables.

- Node 24 : les 25 tests du contrôle avant packaging passent.
- Node 20.20.2 : les quatre suites staging/packaging, 81 tests, passent.
- ESLint des deux fichiers : zéro erreur et zéro avertissement.
- Revue indépendante : aucun défaut bloqueur ; sondes supplémentaires pour
  builtins ESM/CommonJS et lien symbolique sortant conformes.

Le lot suivant sur les dépendances des commandes slash a été confié à Opus :
stager les deux paquets déjà utilisés par le noyau et ajouter une sonde fatale.
Cette décision ne change pas les versions des dépendances.

Validation pilote avant commit : `npm run validate -- tests/docs/cowork-public-docs-privacy.test.ts` vert (lint, typechecks, paquet 10 tests et documentation 13 tests). Garde de données personnelles lancé après indexation : 40/40. Une première commande utilisait un chemin de test inexistant ; corrigée puis rejouée avec succès.
