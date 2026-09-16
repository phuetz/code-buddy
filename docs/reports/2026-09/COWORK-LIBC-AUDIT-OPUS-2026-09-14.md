# Audit du champ `libc` dans la fermeture runtime Cowork — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Référence locale : npm 11.17.0 / `npm-install-checks` 8.0.0 (`lib/index.js` `checkPlatform`/`checkList`, `lib/current-env.js` `libc`), sans web
- Fichiers : `cowork/scripts/prepare-core-runtime.js`, `cowork/src/tests/prepare-core-runtime.test.ts`, ce rapport, ligne de coordination
- Non touché : pre-build-check (gelé), noyau, renderer, Vite, versions, installation, rebuild, modules partagés, Electron, services, profil, manifeste. Absence d'un enfant requis sous parent optionnel : hors périmètre. Aucune machine musl ni cross-compilation ; **ce lot ne rend pas Cowork déployable sur Alpine/musl**.

## Verdict

**Défaut prouvé**, sur fixtures et sur le vrai arbre installé :

1. **`libc` ignoré.** Sur l'hôte glibc (détecté comme npm : `/usr/bin/ldd` → « GNU C Library »), le staging Cowork par défaut livrait **20,7 Mio de binaires musl** inutilisables :
   - `@img/sharp-libvips-linuxmusl-x64` (16,2 Mio) ;
   - `@resvg/resvg-js-linux-x64-musl` (4,2 Mio) ;
   - `@img/sharp-linuxmusl-x64` (0,3 Mio).

   Sur fixtures, une dépendance **obligatoire** glibc-only restait livrée pour une cible musl ou de libc inconnue (**faux vert**). Un paquet `libc` sans `os` était livré sous darwin/win32.
2. **Écart de lecture des listes `os`/`cpu` par rapport à npm.**
   - Une **chaîne** (`"os": "win32"`) était traitée comme sans restriction : paquet en trop, et faux vert si la dépendance est requise.
   - `["any"]` était refusé : **faux refus**, qui lève même une erreur sur un edge obligatoire depuis le lot précédent.
   - Le vrai arbre ne contient ni chaîne ni `any` : écart latent, corrigé parce qu'il passe par la même fonction `checkList`, et que la consigne demandait le support chaîne/tableau de npm.

Correction : lecture `os`/`cpu`/`libc` identique à npm, et libc de la cible détectée comme npm. Vérification contre `checkPlatform` de npm : **3 600 combinaisons, 0 écart**. Sur le vrai arbre, seules des variantes musl disparaissent sous Linux ; darwin et win32 sont identiques.

## Inventaire du vrai arbre installé (lecture seule)

- **1 994** `package.json` installés parcourus, dont **22** déclarent `libc`. Variantes glibc et musl de `@img/sharp*` (racine et `@huggingface/transformers/node_modules`), `@resvg/resvg-js`, `@napi-rs/canvas`, `@reflink/reflink`, `@ngrok/ngrok` (gnu), `@node-llama-cpp/*` (glibc), `@rollup/rollup-linux-x64-gnu`.
- **Les variantes musl sont installées sur cet hôte glibc** ; npm les aurait refusées (EBADPLATFORM, optionnelles).
- Aucun `os`/`cpu` en chaîne ni `any`.
- Tous les paquets `libc` de la fermeture sont atteints par des edges **optionnels** : le fail-fast du lot précédent ne se déclenche pas sur le vrai arbre.

## Reproduction avant correction (fixtures `/tmp`)

| Cas | npm | Avant |
| --- | --- | --- |
| F1 cible glibc, helpers optionnels gnu + musl | app + gnu | app + gnu + **musl** |
| F2 cible musl, dépendance obligatoire glibc-only | EBADPLATFORM | **livrée** (la cible musl n'est même pas exprimable) |
| F3 Linux, libc inconnue, helpers optionnels | app seul | app + gnu + musl |
| F4 darwin, option `libc: "glibc"` sans `os` | app seul | app + **gnu-no-os** |
| F5 Linux, `os: "win32"` en option et en production | option sautée, production refusée | **les deux livrées** |
| F6 Linux, `os: ["any"]` requis et `cpu: ["any"]` optionnel | tout livré | **erreur** « does not support linux/x64 » |

Oracle : `checkPlatform` du `npm-install-checks` local, utilisé seulement dans les scripts de preuve, jamais par le projet. **1 260** combinaisons au premier passage : **218** écarts `libc` et **347** écarts chaîne/`any`, **0** autre (listes et négations déjà identiques).

## Correction

`cowork/scripts/prepare-core-runtime.js` :

- **`supportsValue`** = `checkList` de npm :
  - valeur vide → sans restriction ;
  - chaîne → liste d'un élément ;
  - `['any']` → accepté ;
  - entrée niée qui correspond → refus ;
  - sinon une entrée positive doit correspondre, sauf si toutes les entrées sont niées.

  Les autres formes, que npm ne sait pas installer, restent sans restriction comme avant.
- **`supportsCurrentTarget(entry, platform, arch, libc)`** : `os` et `cpu` comme avant, puis, si le paquet déclare `libc`, exige une libc de cible **connue** qui correspond. C'est la règle npm : `target.libc && !libc` → refus, donc un paquet `libc` est non supporté sous macOS/Windows.
- **`detectHostLibcFamily()`**, exportée : copie de l'algorithme `current-env.js` de npm (contenu de `/usr/bin/ldd`, « musl » puis « GNU C Library » ; si ldd est illisible, rapport de processus avec `glibcVersionRuntime` ou objets partagés `libc.musl-`/`ld-musl-`, `excludeNetwork` forcé pendant la lecture). Retourne `'glibc'`, `'musl'` ou `null`. Pas de nouvelle dépendance ni d'heuristique propre.
- **Libc de la cible** dans `collectInstalledRuntimePackagePaths` :
  - option `libc` si fournie (fixtures, appel programmatique) ;
  - sinon détection de l'hôte **seulement** pour une cible Linux sur hôte Linux ;
  - sinon `undefined` (cible non Linux, ou cible Linux depuis un autre OS : libc inconnue).

  Aucune variable d'environnement, aucune option `prepareCoreRuntime`, aucun champ de manifeste ajouté. Le staging reste lié à l'hôte, comme pour `os`/`arch`.
- **Message d'un edge obligatoire refusé** : le format du lot précédent est inchangé ; le suffixe ` (libc [...], target libc <famille|unknown>)` n'est ajouté que si le paquet déclare `libc`.
- **Inchangés** : classification des edges, résolution, confinement, tri.

## Vérification après correction

| Contrôle | Résultat |
| --- | --- |
| Conformité à `checkPlatform` npm, code final | **3 600 combinaisons, 0 écart** (`os` ×12 dont listes mixtes, `cpu` ×6, `libc` ×10, cibles linux glibc/musl/inconnue, darwin, win32) |
| F1 glibc / F1b musl | `app` + seul helper de la bonne libc |
| F2 musl, obligatoire glibc-only | `… does not support linux/x64: node_modules/glibc-only (os ["linux"], cpu []) (libc ["glibc"], target libc musl)` |
| F3 libc inconnue | options sautées ; obligatoire refusé `(libc "glibc", target libc unknown)` |
| F4 darwin/win32 | paquet `libc` sauté, helper propre à la plateforme gardé |
| F5 chaîne | option sautée, production refusée |
| F6 `any` | tout livré |
| F7 win32, arbre sans `libc` | inchangé |

**Vrai arbre installé**, fermeture enregistrée avant modification puis recalculée sur le code final (libc auto = glibc) :

| Variante | Avant → après | Retirés |
| --- | --- | --- |
| linux/x64 sans liste | 660 → 657 | 3 (`@resvg/resvg-js-linux-x64-musl`, `@huggingface/transformers/node_modules/@img/sharp-libvips-linuxmusl-x64`, `…/@img/sharp-linuxmusl-x64`) |
| linux/x64 Cowork (défaut) | 664 → 661 | les mêmes 3 (20,7 Mio) |
| linux/x64 + options racine | 1 406 → 1 399 | 7, uniquement des paquets musl |
| darwin/arm64 et win32/x64, 3 variantes chacun | identiques (653/657/1 385) | aucun |

Aucun paquet ajouté, aucune erreur.

## Tests

`cowork/src/tests/prepare-core-runtime.test.ts`, bloc « npm platform fields os, cpu and libc » (9 nouveaux, 37 au total) :
- cible glibc puis musl : seul le helper de la bonne libc (`it.each`) ;
- libc inconnue : options sautées, obligatoire refusé avec `target libc unknown` ;
- obligatoire d'une autre libc : message exact ;
- darwin et win32 : paquet `libc` sans `os` sauté, helper propre gardé (`it.each`) ;
- chaînes et `["any"]` : option `os: "win32"` sautée, `libc: "musl"` en chaîne accepté pour musl, `any` requis/optionnel livrés, production `os: "win32"` refusée ;
- `detectHostLibcFamily` avec sources injectées : ldd musl, ldd GNU, ldd non reconnu (rapport non lu), ldd illisible puis rapport glibc, puis musl, puis rien → `null` ;
- sous Linux seulement (`it.runIf`) : détection automatique de la famille de l'hôte, résultat comparé à `detectHostLibcFamily()` (portable glibc/musl).

## Validation

Toutes les commandes sont lancées depuis `cowork/`.

| Contrôle | Résultat |
| --- | --- |
| `npx vitest run src/tests/prepare-core-runtime.test.ts src/tests/pre-build-check.test.ts tests/core-runtime-packaging.test.ts tests/embedded-mode.test.ts` | 4 fichiers, **116/116** |
| M1 `libc` ignoré | 7 rouges ; restaurée |
| M2 chaîne non convertie | 1 rouge (chaînes/`any`) ; restaurée |
| M3 `any` non reconnu | 1 rouge ; restaurée |
| M4 repli sur le rapport supprimé | 1 rouge (détection) ; restaurée |
| M5 détection automatique désactivée | 1 rouge (hôte Linux) ; restaurée |
| `node --check`, `npx eslint --max-warnings 0`, `npm run lint -- --max-warnings 0` sur les 2 fichiers | OK, 0 erreur, 0 avertissement |
| `tsc --noEmit --strict` ponctuel sur le test | OK |
| `git diff --check` | propre |
| Modules partagés, `find -newerct 2026-09-14 02:24` hors caches Vite/Vitest | aucun changement |
| `/tmp` | aucune fixture ni référence résiduelle |

## Limites

- **Node 24.14.1 seulement.** Le repli sur le rapport de processus n'intervient que si `/usr/bin/ldd` est illisible. L'affectation temporaire de `process.report.excludeNetwork` reprend celle de npm ; sa présence dans chaque version Node n'a pas été vérifiée, mais sur une version sans cette propriété l'affectation reste sans effet. Codex vérifie Node 20.
- **Sans hôte musl réel.** Le chemin musl est prouvé par fixtures et par la détection injectée, pas sur Alpine. Le staging musl reste soumis aux mêmes limites que tout staging : liaisons natives de Cowork (better-sqlite3, Electron) construites sur l'hôte cible.
- **npm installe des variantes musl sur cet hôte glibc** (probablement un lockfile ou une installation antérieurs). Elles restent dans `node_modules` partagé et sont simplement exclues du runtime staged.

## Suite

Aucun autre défaut démontré. Pas de lot proposé par défaut.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/scripts/prepare-core-runtime.js`
- `cowork/src/tests/prepare-core-runtime.test.ts`
- `docs/reports/2026-09/COWORK-LIBC-AUDIT-OPUS-2026-09-14.md`
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot)

## Contre-validation Codex

117 tests des quatre suites packaging passent sous Node 20.20.2. Revue indépendante favorable, sans preuve supplémentaire sur hôte musl. La notice BSD amont de npm-install-checks est conservée dans le script qui adapte ses helpers.
