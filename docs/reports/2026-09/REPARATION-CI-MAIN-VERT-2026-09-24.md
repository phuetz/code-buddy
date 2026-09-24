# Réparation — CI de `main` rouge sur macOS et Windows (24/09/2026)

Branche `fix/ci-main-vert-2026-09-24`, départ `c2d9d754d`. Commits locaux, ni push ni fusion.
Mesures faites sous Linux, dans un conteneur sans réseau, HOME et USERPROFILE jetables.
Aucun poste macOS ni Windows n'a été utilisé : ce qui touche à ces systèmes est déduit du code,
des journaux de CI et de simulations sous Linux, et le dit.

## 1. macOS — `consolidated-audit.test.ts:151`, `expected false to be true`

Cause (code) : `fdInside()` prouvait l'emplacement d'un descripteur ouvert par
`realpathSync('/proc/self/fd/<n>')`. macOS n'a pas de `/proc` : l'appel lève, la fonction rend
`false`, chaque correctif est refusé (« open file is outside the audited roots ») et
`fixed.passed` vaut `false`. `buddy security audit --fix` ne corrigeait donc rien sous macOS.

Correctif : sur toutes les plateformes, le descripteur (`fstat`) et le chemin (`lstat`) doivent
désigner le même inœud, et le chemin rester sans lien symbolique sous une racine auditée ;
Linux lit en plus `/proc/self/fd`, toujours en échec fermé.

Preuve : `tests/security/consolidated-audit-sans-proc.test.ts` rend `/proc` inaccessible et
audite en `platform: 'darwin'`. Contre l'ancienne logique, il échoue avec
`".: open file is outside the audited roots"`.

## 2. Windows — `catalogue-routes-http-b.test.ts`, « ne laisse dans git que les fichiers du catalogue »

Cause (journal) : `git status` a vu `.gk18-pr-SVYhHu/…` (bin/gh, remote.git, work/), le dossier
que `pr-fail-closed.test.ts` crée à la RACINE du dépôt, pendant qu'il tournait dans un autre
worker (fin du test catalogue 10:21:05.40, fin de `pr-fail-closed` 10:21:06.25 après 4,7 s).

Correctif : `main` a déplacé `pr-fail-closed` sous `os.tmpdir()` (07caa25e3). Vingt-deux autres
fichiers (36 appels) créaient aussi un dossier à la racine ; les dossiers de travail qui doivent
rester dans le dépôt passent par `repoScratchRoot()` (`tests/helpers/tmp.ts`), soit le dossier
`tmp/` ignoré par git. `tests/hygiene/repo-scratch-dirs.test.ts` interdit le motif ; contre le
code de départ (`c2d9d754d`), il listait les 38 sites.

## 3. Windows, instable — `rm` d'un dossier temporaire encore tenu (ENOTEMPTY)

Vu sur la CI de la PR #226 : `mobile-ws-resume.test.ts:153` (sans `maxRetries`) et
`tool-handler-filter.test.ts:59` (AVEC `maxRetries: 10`).

`maxRetries` ne couvre pas un écrivain tardif : la suppression récursive de Node parcourt les
enfants une seule fois, puis ne relance que le `rmdir` final (`_rmdirSync` de
`internal/fs/rimraf`). Un fichier créé après ce parcours fait échouer toutes les relances.

- `removeTestDir()` / `removeTestDirAsync()` refont toute la suppression sur
  ENOTEMPTY/EBUSY/EPERM/EACCES, puis lèvent une erreur qui liste les entrées restantes ;
  `removeTmpDir()` garde son contrat (journal, sans échec) avec les mêmes passes.
- `RunStore.whenStreamsClosed()` attend la fermeture des journaux terminés par `endRun()` ou
  détruits par `dispose()` (qui ne suivait pas les flux déjà terminés).
- `mobile-ws-resume` attend la fin du tour serveur : la réponse part AVANT la persistance du
  tour et la relecture de la session.
- Une sonde de préchargement (`/proc/self/fd`, watchers, cwd des enfants, écritures après
  suppression) a relevé, sur toute la suite sous Linux, 24 sites de démontage tenus ; les
  démontages sont passés par ces aides. Les sites restants sont des étapes de scénario.

## Non traité ici

- Windows, shard 5/6 : `C:\Users\runneradmin\.codebuddy\memory.md` créé par un test (garde
  `no-repo-writes`). Reproduit sous Linux en simulant `os.homedir()` Windows (qui lit
  `USERPROFILE`), non attribué par la trace fs. Relève de l'isolation globale du HOME des tests.
- `render-native-fashion-clip.test.ts` : `loadTemplates()` lit les gabarits en `Promise.all`,
  l'erreur dépend de l'ordonnancement quand deux gabarits requis manquent.
