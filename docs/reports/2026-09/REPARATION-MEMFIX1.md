# Réparation MEMFIX1 — profile-manager

Date : 2026-09-04
Dépôt : `~/DEV/cb-memfix1-2026-09-04`
Branche : `fix/memfix1-profile-manager-2026-09-04`

## Périmètre et contraintes

Mission : qualifier les 13 échecs de `tests/browser-automation/profile-manager.test.ts`, distinguer harnais périmé et défaut de production, réaligner ou corriger sans affaiblir les assertions, puis vérifier les suites demandées.

Le dépôt original `~/code-buddy` est hors périmètre d'écriture. Aucun push, aucune API payante, aucun service externe, aucun `HOME` hors `~/DEV/cb-memfix1-2026-09-04/_qa/memfix1/home`.

## Réservation Fable5

Réservation inscrite dans `docs/FABLE5-CODEX-COORDINATION.md` : Codex (GPT-5), zone `src/browser-automation/profile-manager.ts`, `tests/browser-automation/profile-manager.test.ts`, utilitaires de persistance directement nécessaires, ce rapport et la ligne de coordination. Aucun fichier du dépôt `~/code-buddy` n'a été écrit.

## État initial

Commande de référence, avec le HOME jetable du clone :

```text
HOME=~/DEV/cb-memfix1-2026-09-04/_qa/memfix1/home npx vitest run tests/browser-automation/profile-manager.test.ts
```

Résultat : 1 fichier, 28 tests ; 13 failed, 15 passed ; 1 erreur non gérée (`EACCES: mkdir '/custom'`). Les erreurs étaient exactement les 9 appels `vi.fn()` non appelés, 3 indexations de `mockFs.writeFile.mock.calls[0]`, et `null.savedAt` annoncés par SWEEP9.

MEM1 (`09e0f30cc`, `src/browser-automation/profile-manager.ts:48,58`) remplace `fs.writeFile`/`fs.readFile` par `writeJsonAtomic`/`readJsonAtomic`. Le lecteur atomique lit via `node:fs` (`src/utils/atomic-write.ts:256`), pas via le mock `fs/promises` du test, et renvoie le fallback à `src/utils/atomic-write.ts:297`. Le garde-fou de production `if (!profile) return null` est présent à `src/browser-automation/profile-manager.ts:59`.

## Verdicts par échec

Les numéros ci-dessous sont ceux du test à l'état initial, avant réalignement. Les 13 verdicts sont des harnais périmés ; aucun défaut de production MEM1 n'est retenu.

| # | Échec initial | Verdict et cause précise |
|---:|---|---|
| 1 | `tests/browser-automation/profile-manager.test.ts:76` | HARNAIS : vérifie `mockFs.writeFile`; la production appelle `writeJsonAtomic` à `src/browser-automation/profile-manager.ts:48`. |
| 2 | `tests/browser-automation/profile-manager.test.ts:98` | HARNAIS : lit `mockFs.writeFile.mock.calls[0]`, qui reste vide car l'écriture passe par `writeJsonAtomic` (`profile-manager.ts:48`). |
| 3 | `tests/browser-automation/profile-manager.test.ts:108` | HARNAIS : même ancien point d'observation `mockFs.writeFile`; le chemin réel est `writeJsonAtomic` (`profile-manager.ts:48`). |
| 4 | `tests/browser-automation/profile-manager.test.ts:119` | HARNAIS : inspecte encore le payload de `mockFs.writeFile`; le contrat réel transmet l'objet à `writeJsonAtomic` (`profile-manager.ts:48`). |
| 5 | `tests/browser-automation/profile-manager.test.ts:132` | HARNAIS : même mock d'écriture obsolète ; aucune écriture `fs.writeFile` n'est attendue après MEM1 (`profile-manager.ts:48`). |
| 6 | `tests/browser-automation/profile-manager.test.ts:153` | HARNAIS : vérifie `mockFs.readFile`; la production délègue à `readJsonAtomic` (`profile-manager.ts:58`). |
| 7 | `tests/browser-automation/profile-manager.test.ts:176` | HARNAIS, pas défaut `null.savedAt` : le mock `readFile` est ignoré, le lecteur atomique renvoie `null` au fallback (`atomic-write.ts:256-297`), puis la garde de production retourne `null` (`profile-manager.ts:59`). |
| 8 | `tests/browser-automation/profile-manager.test.ts:203` | HARNAIS : vérifie l'appel de `mockFs.readFile`, absent du contrat réel ; l'appel doit être observé sur `readJsonAtomic` (`profile-manager.ts:58`). |
| 9 | `tests/browser-automation/profile-manager.test.ts:342` | HARNAIS : assertion de chemin branchée sur `mockFs.writeFile`; la sanitation aboutit au chemin de `writeJsonAtomic` (`profile-manager.ts:47-48`). |
| 10 | `tests/browser-automation/profile-manager.test.ts:352` | HARNAIS : même observation `mockFs.writeFile`; la sanitation reste testée sur l'argument de `writeJsonAtomic` (`profile-manager.ts:47-48`). |
| 11 | `tests/browser-automation/profile-manager.test.ts:362` | HARNAIS : même observation `mockFs.writeFile`; les points, espaces et autres caractères sont testés via le chemin atomique (`profile-manager.ts:47-48`). |
| 12 | `tests/browser-automation/profile-manager.test.ts:372` | HARNAIS : même observation `mockFs.writeFile`; la prévention de traversal est testée via le chemin de `writeJsonAtomic` (`profile-manager.ts:47-48`). |
| 13 | `tests/browser-automation/profile-manager.test.ts:382` | HARNAIS : même observation `mockFs.writeFile`; les caractères spéciaux sont testés via le chemin de `writeJsonAtomic` (`profile-manager.ts:47-48`). |

L'erreur non gérée provenait aussi du harnais : les deux tests constructeur aux lignes initiales `40-45` et `49-53` lançaient `save()` sans `await`, alors que l'ancien mock ne neutralisait plus l'écriture atomique. Le réalignement attend désormais les promesses et supprime cette fuite asynchrone.

## Corrections

Seul le test a été modifié ; aucune correction de production n'était justifiée.

- `tests/browser-automation/profile-manager.test.ts` mocke explicitement `readJsonAtomic` et `writeJsonAtomic`, tout en conservant `fs/promises` pour `mkdir`, `readdir` et `unlink`.
- Les assertions d'écriture conservent le chemin exact sanitisé, le profil complet (`name`, cookies, stockages, `savedAt`), le mode `{ mode: 0o600 }`, et l'intervalle de l'horodatage.
- Les assertions de lecture vérifient le chemin exact et le fallback `null`; le test de date fournit maintenant un objet déjà décodé par le lecteur atomique et conserve la conversion en `Date` du manager.
- Les tests de round-trip modélisent le contrat objet de l'écrivain atomique. Le formatage JSON appartient à `writeJsonAtomic`, tandis que les tests manager vérifient désormais le contrat d'appel qui lui est réellement confié.
- Les casts `any` préexistants du test ont été remplacés par `string[]`, donnant un ESLint ciblé sans avertissement.

## Preuves

Après correction :

```text
HOME=~/DEV/cb-memfix1-2026-09-04/_qa/memfix1/home npx vitest run tests/browser-automation/profile-manager.test.ts
1 fichier, 28 passed, 0 failed, 0 erreur non gérée

HOME=~/DEV/cb-memfix1-2026-09-04/_qa/memfix1/home npx vitest run tests/browser-automation tests/utils
46 fichiers, 738 passed, 3 skipped, 0 failed (741 tests comptés)

HOME=~/DEV/cb-memfix1-2026-09-04/_qa/memfix1/home npx tsc --noEmit -p .
code 0

HOME=~/DEV/cb-memfix1-2026-09-04/_qa/memfix1/home npx eslint src/browser-automation/profile-manager.ts tests/browser-automation/profile-manager.test.ts
code 0, 0 erreur et 0 avertissement

git diff --check
code 0
```

Preuve par mutation, chaque mutation a été appliquée temporairement dans `src/browser-automation/profile-manager.ts`, testée, puis restaurée par patch : sanitation supprimée → 7 échecs sur 28 ; mode `0600` muté en `0644` → 7 échecs sur 28 ; `savedAt` muté en `new Date(0)` → 1 échec sur 28. La production est revenue à son contenu initial et le test final est vert.

## Bilan (10 lignes maximum)

13 échecs sur 13 étaient des harnais périmés ; 0 défaut de production MEM1.
Le rapport a été créé avant inspection et le chantier réservé dans Fable5.
Le test profile-manager est réaligné sur `readJsonAtomic`/`writeJsonAtomic`.
Les assertions de chemin, payload, date, fallback et permissions 0600 sont conservées.
Les deux `save()` constructeur sont attendus, supprimant l'erreur non gérée.
Mutation sanitation : 7 échecs ; mutation mode : 7 échecs ; mutation date : 1 échec.
Vitest browser-automation + utils : 46 fichiers, 738 passés, 3 skips attendus.
`tsc` : code 0 ; ESLint ciblé : code 0 ; `git diff --check` : code 0.
Aucun fichier de production ne reste modifié ; aucun push ni service touché.
