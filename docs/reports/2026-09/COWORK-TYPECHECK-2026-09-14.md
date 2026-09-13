# Compilation TypeScript Cowork

Les 20 diagnostics présents avant les lots Cowork ont deux causes : les types
des dépendances optionnelles du noyau ne sont pas inclus dans le projet Cowork,
et l'alias `OSConfig` réexporte une interface sans préciser `type` alors que
Cowork active `isolatedModules`.

Le projet Cowork inclut désormais `../src/types/optional-deps.d.ts`, déjà utilisé
par le noyau, et l'alias utilise `export type`. Aucune option de rigueur n'est
désactivée, aucun type n'est élargi ni aucune dépendance installée. Le changement
de réexport concerne uniquement la compilation, sans objet runtime ajouté.

Preuves :

- Avant : 20 diagnostics identiques sur la base et après les premiers lots
  (`/tmp/cb-cowork-baseline-typecheck.log`).
- Après : `npm run typecheck` dans Cowork, **exit 0**
  (`/tmp/cb-cowork-typecheck-clean.log`).
- `npm run validate -- tests/sandbox/os-sandbox.test.ts` : **exit 0**,
  lint sans erreur, typechecks noyau/paquets et pack verts, **12/12 tests**
  (`/tmp/cb-cowork-typecheck-fix-validate.log`).

Le packaging complet d'un installateur Electron reste une étape distincte.
