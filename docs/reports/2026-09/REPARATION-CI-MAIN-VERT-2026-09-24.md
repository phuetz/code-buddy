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

## Reprise après revue (même jour)

La revue indépendante a refusé la première version : la classe ENOTEMPTY n'était pas refermée,
et le garde-fou des dossiers à la racine avait un angle mort.

- **Sonde déterministe** : un préchargement ralentit `fs.close()` (fermeture lente, comme sous
  un runner Windows chargé) et fait échouer en ENOTEMPTY, comme Windows, tout `rm` récursif
  d'un dossier dont le processus tient encore un fichier. Éprouvée d'abord sur le cas connu :
  l'ancien `tool-handler-filter` tombe à chaque tirage, avec le même `run_…/events.jsonl` que la
  CI ; la version corrigée passe.
- Sur toute la suite, elle trouve quatorze fichiers au démontage RunStore fautif (la revue en
  citait huit). Tous attendent maintenant `whenStreamsClosed()` puis `removeTestDir()`.
- **Défaut produit** trouvé au passage : `RunStore.pruneOldRuns()` supprimait le dossier d'un
  run purgé 20 ms après `destroy()`, en avalant l'erreur ; sous Windows ce dossier n'était
  jamais purgé. La suppression attend maintenant la fermeture du journal.
- `repo-scratch-dirs.test.ts` voit aussi `join(process.cwd(), '.x-')` avec `join` importé
  seul ; les sept sites de `tests/tools/video` passent par `repoScratchRoot()`.
- Vus par la sonde mais hors du motif RunStore, non traités : fichiers servis par un serveur
  HTTP de test (`mobile-pwa`, `gpu-media-worker-server`, `peer-tool-bridge`,
  `fleet-loopback-smoke`), `mcp-server-approval`, `logging:56`, et l'étape volontaire de
  `skill-import-command-lifecycle:248`.

## Seconde reprise, après contre-revue (même jour)

- **Purge d'un run terminé** : `endRun()` retire le journal de `handles` dès `ws.end()`, avant
  que le fichier ne soit relâché ; un `startRun()` dans le même tour purgeait alors ce run sans
  attendre (la version précédente de ce correctif avait supprimé les 20 ms de marge). Les
  fermetures sont suivies par run et `pruneOldRuns()` attend celle du run qu'il retire, actif
  ou terminé. Test dédié dans `run-store-streams-closed.test.ts`, qui suit chaque descripteur
  ouvert jusqu'à la fin réelle de sa fermeture.
- **Même classe dans les démontages** : sous fermeture lente de 3 s, 58 tests du runner
  agentique échouaient en ENOTEMPTY sur `events.jsonl`, l'`afterAll` de `logging.test.ts` sur
  ses journaux, et `policy-evals` laissait ses dossiers. `runAgenticCodingCell` attend la
  fermeture du journal du RunStore qu'il possède ; `Logger.close()` rend une promesse résolue à
  la fermeture du fichier ; ces tests l'attendent au lieu d'un délai fixe. `log-rotation`
  n'écrit plus à la racine du dépôt.

## Après la fusion de la #228 dans main (même jour)

La #228 (audit macOS et fuites des tests) a été fusionnée avant cette branche et traite une
partie du même sujet. La fusion de `main` garde sa version partout où elle se recoupe :

- **Section 1 remplacée par le correctif de main.** `fdInside()` de main lit d'abord
  `/proc/self/fd`, puis, s'il est illisible, prouve l'identité (même périphérique et même
  inœud que le chemin réel, chemin réel sous une racine). L'approche par plateforme décrite
  en section 1 n'est plus dans le code, et Linux sans `/proc` n'est plus en échec fermé : la
  preuve d'identité suffit, comme sous macOS. `consolidated-audit-sans-proc.test.ts` reste,
  adapté : il vérifie de bout en bout que les deux appelants (fichier corrigé et manifeste de
  sauvegarde) passent le bon chemin à `fdInside()`, ce que le test unitaire de main
  (`consolidated-audit-fd-inside.test.ts`) ne voit pas.
- **Dossiers de travail.** Les onze tests que la #228 a envoyés sous `os.tmpdir()` y restent.
  Les trois qu'elle a mis sous `_qa/tmp` avec une copie locale de `qaTmpBase()` utilisent
  `repoScratchRoot()`, pour un seul mécanisme.
- **Propres à cette branche, conservés** : fermeture des journaux RunStore avant purge et
  avant suppression, runner agentique et `Logger.close()`, `removeTestDir()`, garde-fou
  `repo-scratch-dirs`, et les autres tests déplacés hors de la racine.

## Non traité ici

- Windows, shard 5/6 : `C:\Users\runneradmin\.codebuddy\memory.md` créé par un test (garde
  `no-repo-writes`). Reproduit sous Linux en simulant `os.homedir()` Windows (qui lit
  `USERPROFILE`), non attribué par la trace fs. Relève de l'isolation globale du HOME des tests.
- `render-native-fashion-clip.test.ts` : `loadTemplates()` lit les gabarits en `Promise.all`,
  l'erreur dépend de l'ordonnancement quand deux gabarits requis manquent.
