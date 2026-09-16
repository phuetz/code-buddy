# Audit du filtrage os/cpu de la fermeture runtime Cowork — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Fichiers : `cowork/scripts/prepare-core-runtime.js` (fonction `collectInstalledRuntimePackagePaths` seulement), `cowork/src/tests/prepare-core-runtime.test.ts`, ce rapport, ligne de coordination
- Non touché : pre-build-check (gelé), noyau, renderer, Vite, versions, cibles supportées, installation, rebuild, modules partagés, Electron, backend, profil. Node 24.14.1 ; fixtures synthétiques dans `/tmp`, sans staging réel ni sonde réelle.

## Verdict

**Hypothèse prouvée.** Un paquet incompatible avec la cible était sauté par `supportsCurrentTarget` quel que soit l'edge qui y menait. Une dépendance requise disparaissait donc en silence, son parent restait livré et le staging se déclarait réussi. Seules les graines Cowork étaient revérifiées après coup.

L'audit a aussi trouvé le **défaut inverse** dans la même fonction : un nom déclaré à la fois en `dependencies` et en `optionalDependencies` (optionnel pour npm, qui le laisse absent quand il échoue) provoquait une fausse erreur « required … is missing ».

Les deux sont corrigés par une seule définition de l'edge obligatoire. Sur le vrai arbre installé, la fermeture est **identique à l'octet** pour 9 variantes.

## Reproduction (code avant correction, cible linux/x64)

| Cas | Arbre installé | Attendu (sémantique npm) | Avant | Après |
| --- | --- | --- | --- | --- |
| H1 | `app` → `dependencies.native-helper` (`os: [win32]`) | erreur | `["node_modules/app"]` **(faux vert)** | `Installed dependency native-helper required by node_modules/app does not support linux/x64: node_modules/native-helper (os ["win32"], cpu [])` |
| H2 | racine → `dependencies.root-native` (`cpu: [arm64]`) | erreur | `["node_modules/app"]` **(faux vert)** | `Installed production dependency root-native does not support linux/x64: …` |
| H3 | `app` → `optionalDependencies` helper win32 + helper linux | helper linux seul, pas d'erreur | conforme | inchangé |
| H4 | nom dans `dependencies` **et** `optionalDependencies`, installé, `os: [darwin]` | sauté, pas d'erreur | conforme | inchangé |
| H5 | même nom doublé, **non installé** | pas d'erreur | `Installed dependency dual-missing required by node_modules/app is missing` **(fausse erreur)** | `["node_modules/app"]` |
| H6 | `app` → option `opt-parent` → `dependencies.opt-child` win32 | pas d'erreur (sous-arbre optionnel) | conforme | inchangé |
| H7 | `app` → `peerDependencies.peer-native` win32 | sauté, pas d'erreur | conforme | inchangé |
| H8 | `a` → option `shared`, `b` → `dependencies.shared`, `shared` win32, dans les deux ordres de file | erreur | `["node_modules/a","node_modules/b"]` **(faux vert)** | erreur `shared required by node_modules/b`, dans les deux ordres |
| H8 profond | `a` → option `mid`, `b` → `dependencies.mid` → `dependencies.leaf` win32 | erreur | faux vert | erreur `leaf required by node_modules/mid` |
| H9 | graine Cowork `seed` win32 | erreur | erreur (fail-closed) | même préfixe de message, détail `os`/`cpu` ajouté |
| H10 | `app` → `dependencies.real-missing` absent | erreur | erreur | inchangé |

**Conséquence de H1 sur un runtime staged** : `prepareCoreRuntime` réussissait avec `packagePaths: ["node_modules/app"]`, `packageCount: 1` et sans `native-helper`. La sonde confinée du pre-build-check (utilisée en lecture seule) échouait ensuite sur l'adapter staged : `Error [MODULE_NOT_FOUND]: Cannot find module 'native-helper'`. Après correction, le staging est refusé avant toute écriture, et un runtime précédent reste intact (test dédié).

**Portée réelle** : le staging refuse le cross-target tant que les overrides natifs sont actifs. H1, H2 et H8 demandent donc un arbre installé qui contient un paquet requis incompatible avec l'hôte : `npm install --force`, `--os`/`--cpu`, `node_modules` copié ou mis en cache depuis une autre plateforme, ou API programmatique sans overrides. Défaut latent, mais faux vert réel dans ces cas.

## Correction

Dans `collectInstalledRuntimePackagePaths`, la file contient désormais des **edges** : `{ packagePath, dependencyName, obligation, requiredBy }`.

- **Obligatoires** :
  - `production` : les `dependencies` racine ;
  - `cowork` : `COWORK_REQUIRED_OPTIONAL_DEPENDENCIES` ;
  - `transitive` : les `dependencies` d'un paquet lui-même obligatoire.
- **Optionnels** :
  - `optionalDependencies` et `peerDependencies` ;
  - options racine (`includeRootOptional`) ;
  - tout edge sous un paquet optionnel ;
  - un nom que le même paquet redéclare en `optionalDependencies`, racine comprise (npm : les `optionalDependencies` écrasent les `dependencies` du même nom).
- **Paquet incompatible** : sauté si l'edge est optionnel ; sinon erreur nommée avant toute écriture (`production`, `cowork` avec le préfixe existant, ou `required by <parent>`), avec les champs `os` et `cpu` du paquet.
- **Ordre de file** : un paquet d'abord inclus par un edge optionnel est **reparcouru** dès qu'un edge obligatoire l'atteint (`walkedAsObligatory`), pour que ses dépendances requises soient revérifiées.
- **Paquet absent** : règle déclarative inchangée (`dependencies` absent → erreur), sauf les noms doublés, désormais optionnels (H5).
- **Contrôle Cowork** : le contrôle a posteriori des graines devient inutile et est retiré ; les graines sont des edges `cowork`. Le message du lot slash est conservé et le test existant reste vert.
- **Inchangés** : `resolveInstalledDependencyPath`, confinement, tri, ordre de parcours pour les arbres compatibles, manifeste, versions, cibles.

Choix documenté : sous un parent optionnel, un enfant requis **absent** échoue toujours (règle déclarative existante, fail-closed), alors qu'un enfant requis **incompatible** est sauté. L'audit ne portait que sur le filtrage de cible, et npm n'installe pas un tel parent en installation normale. Aligner aussi l'absence sur la chaîne d'obligation serait un changement distinct, à décider.

## Non-régression sur le vrai arbre installé (lecture seule)

La fermeture du vrai arbre (package.json de base + `node_modules` partagés) est enregistrée avant modification, puis recalculée après, sur le code final :

```
linux/x64/none: IDENTICAL (660 packages)
linux/x64/cowork: IDENTICAL (664 packages)
linux/x64/includeOptional: IDENTICAL (1406 packages)
darwin/arm64/none: IDENTICAL (653 packages)
darwin/arm64/cowork: IDENTICAL (657 packages)
darwin/arm64/includeOptional: IDENTICAL (1385 packages)
win32/x64/none: IDENTICAL (653 packages)
win32/x64/cowork: IDENTICAL (657 packages)
win32/x64/includeOptional: IDENTICAL (1385 packages)
identical 9/9
```

Les 7 paquets filtrés pour darwin et win32 ne sont atteints que par des edges optionnels : aucune fausse erreur. La racine ne déclare aucun nom à la fois en `dependencies` et en `optionalDependencies`.

## Tests

`cowork/src/tests/prepare-core-runtime.test.ts`, bloc « target filtering of dependency edges » (8 nouveaux, 28 au total) :
- H1 transitive requise incompatible : message exact ;
- H2 production racine incompatible ;
- H8 dans les deux ordres de file (`it.each`) ;
- H8 profond : reparcours d'un paquet d'abord atteint en optionnel ;
- options normales toujours sautées dans un même arbre : option plateforme, peer, nom doublé incompatible, enfant requis d'un parent optionnel ; chemins exacts ;
- H5 nom doublé absent → pas d'erreur, et H10 vrai manquant → erreur ;
- `prepareCoreRuntime` refuse sans remplacer un runtime staged existant (marqueur conservé).

## Validation

Toutes les commandes sont lancées depuis `cowork/`.

| Contrôle | Résultat |
| --- | --- |
| `npx vitest run src/tests/prepare-core-runtime.test.ts src/tests/pre-build-check.test.ts tests/core-runtime-packaging.test.ts tests/embedded-mode.test.ts` | 4 fichiers, **107/107** |
| M1 saut silencieux rétabli | 7 rouges (H1, H2, H8 ×2, profond, refus avant remplacement, graine Cowork du lot slash) ; restaurée |
| M2 reparcours supprimé | 1 rouge (H8 profond) ; restaurée |
| M3 noms doublés traités comme requis | 2 rouges (options, H5) ; restaurée |
| M4 obligation propagée sous un parent optionnel | 1 rouge (options normales) ; restaurée |
| `node --check`, `npx eslint --max-warnings 0`, `npm run lint -- --max-warnings 0` sur les 2 fichiers | OK, 0 erreur, 0 avertissement |
| `tsc --noEmit --strict` ponctuel sur le test | OK |
| `git diff --check` | propre |
| Modules partagés, `find -newerct 2026-09-14 02:19` hors caches Vite/Vitest | aucun changement |
| `/tmp` | aucune fixture ni référence résiduelle |

## Correction de méthode sur les lots précédents

Comme Codex l'a signalé, `/node_modules` existe sur l'hôte (1 entrée, sans `string-width`, `@google` ni `chalk`). Mes preuves « runtime déplacé hors de toute ascendance » des lots précédents ne l'excluaient pas :
- les **échecs** `Cannot find package 'string-width'` restent valides, puisque le paquet n'y est pas ;
- l'exécution de `/help` sans confinement du lot slash ne prouvait pas l'hermétisme. Codex l'a refaite avec le confinement réel (Node 20/24).

Ce lot ne comporte aucune sonde réelle.

## Suite

Aucun autre défaut démontré.

Observation non traitée : `supportsCurrentTarget` ignore le champ `libc` que npm 10 sait filtrer. Non démontré comme défaut ici (hôte glibc) ; à auditer seulement si une cible musl devient pertinente.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/scripts/prepare-core-runtime.js`
- `cowork/src/tests/prepare-core-runtime.test.ts`
- `docs/reports/2026-09/COWORK-TARGET-FILTER-AUDIT-OPUS-2026-09-14.md`
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot)

## Contre-validation du pilote

Port sélectif dans la branche `integration/improvements-persistence-2026-09-13`.
Les quatre suites packaging passent sous Node 20.20.2 : 108 tests, comprenant
la régression de terminaison ajoutée au lot précédent. Revue indépendante :
aucun défaut bloquant nouveau, cycles bornés et promotion optionnel vers requis
correctement reparcourue avant remplacement du runtime. La différence héritée
entre enfant absent et incompatible sous parent optionnel reste documentée.
