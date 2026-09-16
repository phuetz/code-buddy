# Réparation du build Vite/Electron Cowork — Claude Opus, 2026-09-14

## État après assemblage par Codex

**Le build Vite complet est désormais vert** dans la branche d'intégration :
renderer, main Electron et preload. Le verdict Opus ci-dessous décrit sa
livraison isolée, avant le raccord du correctif navigateur du pilote.

Codex a déplacé `resolveToolEffect`, son avertissement et son latch de
`src/tools/metadata.ts` vers `src/tools/tool-effect.ts`, et ajusté les trois
consommateurs runtime ainsi que leur test. Le catalogue ne charge plus le
logger Node dans le navigateur. Les avertissements et la classification des
effets gardent leur comportement côté runtime. Aucun faux logger ni
`shimMissingExports` n'est introduit.

Preuves intégrées : 48 tests runtime/profils/traces/CLI verts ; build du noyau
et commande compilée `buddy tools catalog --json` verts ; cinq tests Cowork
de build verts, dont bundle SQL réellement chargé et bundle de profils
exécuté dans une VM sans `process` ni `require` ; lint ciblé propre.
Le nouveau test navigateur échouait sur `os.homedir` avant la séparation.
`vite build` complet termine avec code 0 : renderer 13,32 s, main 31,50 s,
preload 98 ms. Log : `/tmp/cb-cowork-integrated-vite-build.log`.

Reprise des cinq tests de build sous Node 20.20.2 : **5/5 verts**. Validation
complète du noyau en profil isolé : **exit 0**, lint/typechecks/pack verts,
**38 538 tests verts, 37 ignorés, 1 todo** (2 150 fichiers verts, 9 ignorés).
Même limitation Chromium absent du cache isolé que dans les passes précédentes.
Log : `/tmp/cb-cowork-build-full-validate.log`.

Contrôle visuel sur le renderer compilé avec Chromium headless, 1440 × 1000 :
reconnexion en attente désactivée, erreur visible, puis disparition après
authentification. Serveur statique loopback et IPC fictif, aucune connexion
backend ni lancement Electron. Aucune exception de page ; seule la police
Google, bloquée volontairement, échoue au réseau. Navigateur et serveur arrêtés.
Preuves : `/tmp/cb-fleet-panel-browser-qa.json` et captures
`/tmp/cb-fleet-panel-{busy,error,authenticated}.png`.

La correction CommonJS `ignore` d'Opus est retenue. La branche appbuilder
mentionnée dans sa livraison n'est pas fusionnée dans ce lot. Aucun installateur
Electron ni publication npm n'est produit ici.

## Livraison isolée Opus (conservée pour les preuves)

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`
- Branche : `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit, aucun push**
- Périmètre : `cowork/vite.config.ts`, test de build dédié, ce rapport, ligne de coordination
- Non fait, conformément à la mission : npm install/rebuild, modification de paquets dans les `node_modules` liés, lancement d'Electron, profil, compte, service robot, FleetBridge/FleetPanel

## Verdict

| Cible Vite | Base `d579f26ec` | Après correction |
| --- | --- | --- |
| Processus principal (`dist-electron/main`) | **rouge** (Flow de `react-native` via AlaSQL) | **vert** (20,14 s) |
| Preload (`dist-electron/preload`) | non atteint | **vert** (104 ms) |
| Renderer (`dist`) | rouge **masqué** par l'échec du main | **rouge**, défaut préexistant du noyau, hors périmètre |
| `npx vite build` complet | exit 1 | **exit 1** |

Le build Vite complet **n'est pas vert**. Le blocage AlaSQL est corrigé et prouvé. Le second blocage, côté renderer, ne se corrige pas honnêtement par la config : il demande une modification des sources noyau (voir « Blocage renderer »). Rien ici ne vaut packaging : `npm run build` (téléchargements, `tsc`, `electron-builder`) n'a pas été lancé.

## Diagnostic Codex vérifié

| Affirmation | Vérification indépendante | Résultat |
| --- | --- | --- |
| `sql-agent.ts` importe `alasql` → `alasql.fs.js` | `vite-plugin-electron` 0.29.1 impose `conditions: ['node']` et `formats: ['cjs']` (Cowork sans `"type": "module"`) ; exports AlaSQL 4.17.0 : `node` → `./dist/alasql.fs.js` ; l'erreur Rollup nomme `alasql.fs.js` comme importeur | confirmé |
| `alasql.fs.js` requiert `react-native`, `react-native-fs`, `react-native-fetch-blob` | lignes 3962 (`require('react-native')` dans un try/catch), 4045/4278/4300/4345/4388 (`react-native-fs`) et 4214 (`react-native-fetch-blob`), toutes derrière `utils.isReactNative` | confirmé |
| Rollup CommonJS parse le Flow des modules mobiles | `[commonjs--resolver] Expected 'from', got 'typeOf'` sur `react-native/index.js:27:7` | confirmé |
| Installation normale identique au symlink | `package-lock.json` racine contient `node_modules/react-native` 0.84.0 (optional, peer) et `node_modules/react-native-fs` 2.20.0 (optional) : pair et dépendance optionnelle d'AlaSQL, installés aussi par `npm ci`. `react-native-fetch-blob` n'est pas installé | confirmé |
| « Externaliser les trois ids suffit, SQL fonctionne » | **infirmé pour un AlaSQL réellement bundlé** : le plugin CommonJS hisse `require('react-native-fs')` en tête de chunk | **corrigé** |

### Correction du diagnostic : `external` seul est dangereux

Le test dédié bundle AlaSQL avec les externals exacts du main, puis charge la sortie dans Node. Avec les trois ids simplement externalisés :

```
Error: Cannot find module 'react-native-fs'
 ❯ Module.<anonymous> /tmp/cowork-alasql-main-1u31TV/probe.cjs:5:20
```

La ligne 5 du chunk est un `require` exécuté **au chargement**, hors de toute garde. Le plugin CommonJS de Vite 7 laisse intacts les seuls `require` externes placés dans un try/catch (`ignoreTryCatch`) ; `react-native-fs` et `react-native-fetch-blob` sont dans des `if`, donc convertis en imports hissés. Dans une app packagée, le module est absent : le main Electron planterait au démarrage dès qu'AlaSQL serait inclus. Dans un checkout de dev, le vrai `react-native-fs` fait `require('react-native')` dès sa ligne 10, hors try/catch, et ce fichier Flow lève `SyntaxError: Unexpected token 'typeof'` : même plantage.

La preuve Node 20/24 de Codex (« `SELECT 2+3` = 5, `isReactNative=false` ») porte vraisemblablement sur `alasql.fs.js` brut, où les `require` restent paresseux. Elle ne se transpose pas au bundle.

### Précision : AlaSQL n'est pas dans le bundle main aujourd'hui

Un plugin de diagnostic temporaire (retiré depuis) a lu le graphe Rollup en `generateBundle` :

```
[DIAG] alasql in graph: node_modules/alasql/dist/alasql.fs.js isIncluded= false
[DIAG] sql-agent in graph: src/agent/specialized/sql-agent.ts isIncluded= false
[DIAG] shortest chain entry -> alasql:
  cowork/src/main/index.ts [included=true]
  cowork/src/main/voice/tts-bridge.ts [included=true]
  src/companion/assistant-config.ts [included=true]
  src/sensory/respond-decider.ts [included=true]
  src/sensory/voice-loop.ts [included=false]
  src/companion/companion-toolset.ts [included=false]
  src/tools/registry/index.ts [included=false]
  src/tools/registry/delegate-agent-tools.ts [included=false]
  src/agent/specialized/agent-registry.ts [included=false]
  src/agent/specialized/sql-agent.ts [included=false]
  node_modules/alasql/dist/alasql.fs.js [included=false]
```

AlaSQL est **résolu et parsé** pendant la construction du graphe, ce qui suffit à faire échouer le build, puis **éliminé** par tree-shaking. Dans la sortie finale, aucun chunk de `dist-electron/` ne contient `alasql`, `isCordova` ni `require("react-native…")`. Le SqlAgent réel de Cowork s'exécute depuis `code-buddy/dist`, chargé à l'exécution par `loadCoreModule()` ; sa disponibilité en app packagée dépend du staging `prepare-core-runtime.js`, que ce lot ne touche pas.

## Correction livrée

`cowork/vite.config.ts`, entrée main uniquement :

1. `export const alasqlReactNativeModules = ['react-native', 'react-native-fs', 'react-native-fetch-blob']`, avec un commentaire qui explique pourquoi `external` ne suffit pas.
2. `build.commonjsOptions.ignore: alasqlReactNativeModules`. Le plugin CommonJS n'ajoute pas ces `require` à ses expressions (`if (!ignoreRequire(id))`, `vite/dist/node/chunks/config.js:4706`) : ni résolution, ni parse Flow, ni hissage. Les appels restent paresseux, dans leurs gardes. Vite fusionne `commonjsOptions` en profondeur avec ses défauts (`include: [/node_modules/]`, `extensions`) via `mergeWithDefaults`.
3. La liste d'externals existante est extraite, inchangée, dans `export const mainProcessExternals` pour que le test bundle avec exactement la même liste. `alasql` n'est pas externalisé.

Aucun shim, aucune exclusion du SQL, aucun `shimMissingExports`, aucune dépendance ajoutée. Preload et renderer inchangés.

## Test dédié

`cowork/tests/vite-main-alasql-react-native.test.ts`, 4 tests :

1. La config câble `ignore: alasqlReactNativeModules` et `external: mainProcessExternals` ; ni les ids mobiles ni `alasql` ne sont externalisés.
2. Garde de dérive : les `require('react-native…')` de l'entrée Node d'AlaSQL installée correspondent exactement à la liste.
3. Bundle réel (`vite.build`, CJS, `conditions: ['node']`, mêmes externals et `ignore`) chargé avec les modules mobiles absents : `SELECT 2 + 3 AS answer` → `[{ answer: 5 }]`, `isReactNative === false`, et seule la sonde `react-native` est demandée (preuve que rien n'est hissé).
4. Même bundle quand `react-native` résout vers le vrai fichier Flow installé (cas du checkout de dev) : SQL et `isReactNative` identiques. Sous Node 24, charger ce fichier lève `SyntaxError: Unexpected token 'typeof'`, absorbée par le try/catch de la sonde.

Les tests 2 à 4 sont ignorés si `alasql` n'est pas résolvable, le 4 si `react-native` ne l'est pas : AlaSQL reste une dépendance optionnelle racine. Le test 1 tourne toujours.

## Preuves

Node v24.14.1, Vite 7.3.3, Rollup 4.59.0, vite-plugin-electron 0.29.1, Electron 35.7.5 (version lue, non lancé).

| Étape | Commande (depuis `cowork/`) | Résultat |
| --- | --- | --- |
| Rouge de base | `npx vite build` | exit 1 : `[commonjs--resolver] Expected 'from', got 'typeOf'` sur `react-native/index.js`, importeur `alasql.fs.js` |
| Diagnostic temporaire | `npx vite build` + plugins DIAG (retirés) | graphe ci-dessus ; avec `logger` détourné pour `metadata.ts`, renderer 14,31 s + main 31,61 s + preload 111 ms verts (seul blocage renderer identifié) |
| Contre-preuve `external` seul | test dédié, sonde en externals | 2 échecs : `Cannot find module 'react-native-fs'` à `probe.cjs:5:20` |
| Mutation liste vide | test dédié, `alasqlReactNativeModules = []` | rouge : même erreur Flow que le build réel ; liste restaurée |
| Tests finaux | `npx vitest run --reporter verbose tests/vite-main-alasql-react-native.test.ts tests/vite-config-watch-ignore.test.ts` | 2 fichiers, **5/5 verts** |
| Build final | `npx vite build` | main ✓ 20,14 s, preload ✓ 104 ms, renderer ✗ `"homedir" is not exported by "__vite-browser-external"` ; exit 1 |
| Sortie main | `grep -rlE "require\(\"react-native\|require\('react-native" dist-electron/` | aucune occurrence |
| Syntaxe | `node --check` sur le chunk main principal et `dist-electron/preload/index.js` | OK (parse seul, aucune exécution) |
| Lint | `npx eslint --max-warnings 0` et `npm run lint -- --max-warnings 0` sur les 2 fichiers | 0 erreur, 0 avertissement |
| Types | `npx tsc -p tsconfig.node.json --noEmit` ; `tsc --noEmit --strict` ponctuel sur le test | OK |
| Diff | `git diff --check` + recherche d'espaces finaux dans les fichiers non suivis | propre |

Journaux locaux non suivis (motif `dist*` de `cowork/.gitignore`) : `cowork/dist-diag-build.log` (build de diagnostic) et `cowork/dist-final-build.log` (build final). La sortie renderer du build de diagnostic (`cowork/dist`, 01:27), trompeuse, a été supprimée. `cowork/dist-electron/` provient du build final.

### Intégrité des `node_modules` liés

`find` sur `~/code-buddy/cowork/node_modules` et sur le `node_modules` racine lié, fichiers modifiés depuis 2026-09-14 01:18:00 hors caches Vite/Vitest : **aucun**. Seuls des caches d'outillage partagés ont une date récente : les répertoires vides `.vite-temp/` (config bundlée puis effacée par Vite) et `.vite/vitest/…/results.json`. Certaines de ces dates (01:32:21, 01:33:45) ne correspondent à aucune de mes commandes : une autre session partage ces mêmes `node_modules`. Aucun fichier de paquet n'a été modifié.

## Blocage renderer (non corrigé, décision attendue)

Erreur : `../src/utils/logger.ts (17:9): "homedir" is not exported by "__vite-browser-external"`.

Chaîne : renderer (`tool-profile-inspector-strip.tsx` et `hermes-plan-strip.tsx`, qui utilisent `buildHermesToolsetDescriptor` / `buildHermesIntegrationPlan`) → `src/fleet/dispatch-profile.ts` → `src/security/tool-policy/tool-groups.ts` → `src/tools/metadata.ts` → `import { logger } from "../utils/logger.js"` (fs, path, os, chalk). L'import vient de `f565be180` (06/09, taxonomie C5 `resolveToolEffect`). Il viole la règle écrite dans `src/tools/registry/tool-alias-map.ts` : les modules importables par le renderer Cowork restent sans `logger`. Sur la base, cet échec était masqué : le main échouait d'abord.

Aucune correction de config honnête : un alias vers un faux logger ou `shimMissingExports` masquerait la violation de couche (écartés, conformément à la consigne). Options pour le propriétaire du noyau :

1. Porter l'extraction déjà faite par Astra sur `integration/appbuilder-2026-09-12` (`c47356fff`, **non ancêtre** de `d579f26ec`) : `src/tools/metadata-catalog.ts` en données pures, importé par `tool-groups.ts`.
2. Ou sortir le `logger.warn` de `resolveToolEffect` du module de données.

Le diagnostic prouve qu'une fois `logger` retiré du graphe renderer, le build Vite complet passe.

**Conflit à arbitrer** : la même branche Astra corrigeait AlaSQL autrement (`alasql` externalisé, staging dans `prepare-core-runtime.js`). Sa fusion entrerait en conflit avec `cowork/vite.config.ts` ici. Les deux approches ne se cumulent pas : il faut en choisir une.

## Commandes refusées (non contournées)

- Commandes composées (`;`, `&&`, redirection + `echo $?`) : relancées en commandes simples équivalentes, sans changer leur nature.
- `git check-ignore -v …` : approbation requise ; l'ignorance a été lue dans les `.gitignore`.
- `cat /proc/pressure/*` et `ls /usr/bin/node*` (hors répertoires autorisés) : pression E/S non lue (`uptime` : charge 4,40) ; **Node 20 non testé**, seul Node 24.14.1 est présent dans nvm.
- `git hash-object` sur les fichiers livrés : approbation requise ; pas d'empreinte.

## Passation

- Fichiers à ajouter nommément (aucun commit fait) :
  - `cowork/vite.config.ts` (modifié)
  - `cowork/tests/vite-main-alasql-react-native.test.ts` (nouveau)
  - `docs/reports/2026-09/COWORK-BUILD-OPUS-2026-09-14.md` (nouveau)
  - `docs/FABLE5-CODEX-COORDINATION.md` (déjà modifié par Codex avant la session ; ma ligne mise à jour)
- Non suivis et ignorés : `cowork/dist-electron/`, `cowork/dist-diag-build.log`, `cowork/dist-final-build.log`.
- Décisions attendues :
  1. correction noyau du renderer (option 1 ou 2 ci-dessus) ;
  2. choix entre `commonjsOptions.ignore` (ce lot) et l'externalisation + staging d'Astra ;
  3. job CI Linux `cd cowork && npx vite build`. `release-cowork.yml` fait `npm ci` racine, `npm ci` Cowork puis `npx vite build` : il échouerait aujourd'hui sur les deux défauts.
- À refaire après la correction renderer : `npx vite build` complet, puis ce test ; puis Node 20 si pertinent (Cowork exige Node ≥ 22 et Electron 35 embarque son propre Node).
