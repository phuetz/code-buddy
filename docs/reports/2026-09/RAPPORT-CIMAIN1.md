# Rapport CIMAIN1 — CI GitHub de `main`

Date : 2026-09-04

Dépôt audité : `~/DEV/cb-cimain1-2026-09-04`

Branche : `fix/cimain1-ci-main-2026-09-04`

Référence : `8e2da7d6de0431213c800f5e3cc8f7a36d949785`

## Verdict

Le rouge CI n'est pas un unique défaut Vitest. Deux régressions de tests sont
déjà fermées sur `codex/audit-systeme-nerveux-2026-09-01`, le test film est
fermé par `7a14945cd`, et deux familles restent réellement ouvertes sur
`main` : le script de balayage d'installation n'est pas portable et le test
d'environnement du shell interactif n'est pas adapté à PowerShell sous
Windows. Le test macOS PTY est, à ce stade, un problème de runner/binaire
`node-pty` non reproductible ici.

Le rapport a été créé avant toute inspection du dépôt. Aucun code source n'a
été modifié pendant cet audit ; seuls ce rapport et la réservation de
coordination ont été écrits. Aucun push, service, API payante, reset, prune ou
suppression n'a été effectué.

## 1. Journaux GitHub réels

`gh run view 33313831114 --log-failed` n'a pas fonctionné depuis ce clone :
`failed to determine base repo: none of the git remotes ...`. Le repli demandé
a fonctionné pour les six jobs :
`gh api repos/phuetz/code-buddy/actions/jobs/<job-id>/logs`. Les réponses étaient
du texte de log (BOM/ANSI/CRLF selon l'OS), pas des ZIP ; `unzip` n'était donc
pas applicable. Copies locales, conservées sous
`~/DEV/cb-cimain1-2026-09-04/_qa/cimain1/ci-logs/`.

Jobs inspectés :

| OS / Node | Job | Fichiers rouges exacts | Résumé Vitest du run observé |
|---|---:|---|---|
| Ubuntu / 20.x | `99263540411` | `tests/commands/utility-commands.test.ts`, `tests/scripts/balayage-installation.test.ts`, `tests/unit/bash-tool.test.ts` | 3 fichiers ; 48 tests échoués, 35 511 passés, 40 ignorés ; 1 734 fichiers |
| Ubuntu / 22.x | `99263540523` | mêmes 3 fichiers | mêmes comptes |
| macOS / 20.x | `99263540473` | `tests/commands/utility-commands.test.ts`, `tests/scripts/balayage-installation.test.ts`, `tests/security/interactive-bash-env-injection.test.ts`, `tests/tools/video/film-assemble.test.ts`, `tests/unit/bash-tool.test.ts` | 5 fichiers ; 57 échoués, 35 502 passés, 40 ignorés ; 1 734 fichiers |
| macOS / 22.x | `99263540520` | mêmes 5 fichiers | mêmes comptes |
| Windows / 20.x | `99263540474` | `tests/scripts/balayage-installation.test.ts`, `tests/security/interactive-bash-env-injection.test.ts` | premier shard : 2 fichiers ; 12 échoués, 6 286 passés, 28 ignorés ; 289 fichiers |
| Windows / 22.x | `99263540485` | mêmes 2 fichiers | mêmes comptes |

Windows s'arrête au shard `1/6` et rejoue ce shard une fois ; les deux
apparitions des fichiers dans le log sont donc le premier essai et le retry,
pas deux listes de rouges distinctes. `Security Audit` (`99263540286`) est
vert. `Build and Package` (`99265114178`) est sauté car il dépend de `test`.

Le détail par fichier confirmé dans les logs est : Ubuntu = 2 + 7 + 39 = 48,
macOS = 2 + 11 + 4 + 1 + 39 = 57, Windows = 7 + 5 = 12.

## 2. Reproduction locale dans le clone

Commandes exécutées sur `main` avec le Node courant `v24.14.1` :

```text
npm run typecheck
exit 0 — tsc principal puis tsconfig.darkstar-identity.json, 0 erreur

npm run lint
exit 0 — 0 erreur, 2 441 warnings ESLint (8 potentiellement corrigeables)

HOME=~/DEV/cb-cimain1-2026-09-04/_qa/cimain1/home npx vitest run
exit 1 — 8 fichiers échoués, 1 725 passés, 1 ignoré (1 734)
          55 tests échoués, 35 532 passés, 12 ignorés (35 599)
          1 erreur non gérée ; durée 101,79 s
```

Le `npx` du clone résout actuellement Vitest par le lien non suivi
`node_modules -> ~/code-buddy/node_modules`. Le processus est resté dans le
clone, et ce lien n'a pas été remplacé ou supprimé. Le premier contrôle de
`git status` de `~/code-buddy` était propre ; pendant l'audit, des
modifications étrangères sont apparues dans `src/agent/streaming/` et
`src/config/model-tools.ts` ainsi qu'un test non suivi. Elles n'ont pas été
touchées et ont ensuite été commités en parallèle sous `5236e8e3f`. Le dernier
`git status` de l'original est propre, avec la branche à deux commits d'avance.

Liste locale exacte :

| Fichier | Tests échoués | Cause observée |
|---|---:|---|
| `tests/agent/tool-handler-trust-skills.test.ts` | 2 | `HOME` isolé : annulation utilisateur puis credential absent au lieu de la garde de confiance |
| `tests/commands/hermes-commands.test.ts` | 3 | navigateur Playwright absent du cache du `HOME` isolé |
| `tests/commands/utility-commands.test.ts` | 2 | mock sans export `summarizeDoctorChecks` |
| `tests/gpu-worker/panoworld-runner.test.ts` | 6 | `ModuleNotFoundError: No module named 'PIL'`, puis le cas d'annulation dépasse 20 s |
| `tests/security/donnees-personnelles.test.ts` | 1 | timeout 20 s dans la suite complète ; le ciblage isolé passe |
| `tests/tools/lessons-tools.test.ts` | 1 | `npx tsc --noEmit` depuis un répertoire temporaire vide dépasse 60 s avec le `HOME` isolé |
| `tests/unit/bash-tool.test.ts` | 39 | mock du parser shell incomplet : `Command blocked: Shell parser failed unexpectedly` |
| `tests/unit/misc-tools-part2.test.ts` | 1 | timeout du chemin réel clipboard/VFS ; aucune erreur CI correspondante |

Le ciblage demandé en contrôle de la donnée personnelle a donné `1 fichier,
1 test, exit 0` en 4,77 s. Un probe Python avec le même `HOME` échoue bien sur
`ModuleNotFoundError: No module named 'PIL'`. Un probe `npx tsc --noEmit` dans
un répertoire de travail vide est sorti par `timeout` avec le code 124. Le
probe Playwright retourne explicitement `Executable doesn't exist at
~/DEV/cb-cimain1-2026-09-04/_qa/cimain1/home/.cache/ms-playwright/...`.

Une tentative supplémentaire avec `CI=1` a été arrêtée sans résumé : elle est
restée bloquée après les quatre premiers fichiers rouges. Elle n'est pas
utilisée pour les comptes ci-dessus.

## 3. Causes et classement

### Défauts déjà fermés sur la branche d'audit (catégorie a)

- `tests/commands/utility-commands.test.ts` : le log exact est
  `No "summarizeDoctorChecks" export is defined ... mock`. Le mock est aligné
  par `26e9713c9 test(commands): align doctor mock with summary contract`.
- `tests/unit/bash-tool.test.ts` : les 39 cas s'arrêtent avant tout spawn sur
  `Command blocked: Shell parser failed unexpectedly`. Le mock
  `parseShellCommand` est ajouté par `d38d1a5a3 test(bash): mock shell parser in
  unit suite`.
- `tests/tools/video/film-assemble.test.ts` sous macOS : le log montre
  l'argument réel en `~/.../private/var/...` alors que le fixture attend la
  forme lexicale `~/.../var/...`, à la ligne 642. Le changement de contrat du
  test et de l'orchestration est porté par `7a14945cd fix(video): fermer D1-D7
  des faux succès sans artefact`. `f1b3a7833` ne ferme pas ce cas précis : il
  corrige une autre assertion de chemin.
- `tests/agent/tool-handler-trust-skills.test.ts` est un rouge local dû au
  `HOME` imposé, pas un rouge CI de ce run. L'isolation des watchers et du faux
  home est portée par `3e2ea85eb fix(skills): harden directory watchers`.

Les recherches lecture seule demandées dans `~/code-buddy` (`git log
--oneline -S...`) ont confirmé ces commits. Aucun fichier n'a été écrit dans
ce dépôt original.

### Dépendances de l'environnement (catégorie b)

- Les trois tests Hermes de navigateur et les six tests PanoWorld sont des
  tests locaux de ressources réelles. `main` contient déjà les gardes
  `it.skipIf(process.env.CI)` / `describe.skipIf(process.env.CI)` du commit
  `b015847d8`; ils ne sont pas dans les six listes CI. Avec `CI` absent et un
  `HOME` vierge, le navigateur et le site Python utilisateur ne sont
  naturellement pas disponibles.
- Le timeout `tests/security/donnees-personnelles.test.ts` est local et
  disparaît en ciblage ; il n'est pas dans les logs CI. Il ne justifie pas un
  changement de code sans reproduction stable.
- Le timeout Clipboard local n'est pas dans les logs CI et dépend du backend
  graphique/clipboard de la machine. Le test n'isole pas `spawn('xclip', ...)`
  alors qu'il attend sa fermeture ; la preuve est insuffisante pour classer
  cela comme défaut CI.
- Le macOS `interactive-bash-env-injection.test.ts` échoue quatre fois sur
  `PTY execution failed: posix_spawnp failed` alors que `main` résout déjà
  `/bin/bash` absolument (`src/tools/interactive-bash.ts:205-207`). Ce cas
  demande une reproduction macOS ou un diagnostic du binaire `node-pty`; je le
  classe environnement/runner, pas correction aveugle.
- `TaskVerifyTool` local utilise réellement `spawnSync('npx', ['tsc',
  '--noEmit'], workDir)` ; avec un `HOME` neuf et un `workDir` vide, `npx` est
  sorti avec 124. C'est un rouge local de contexte, non un rouge de la CI.

### Défauts encore ouverts (catégorie c)

- `tests/scripts/balayage-installation.test.ts` est rouge sur les six jobs.
  Le script force `PATH=/usr/bin:/bin` puis lance un `node` nu aux lignes
  120-122. Les runners Actions placent Node dans le toolcache, pas
  nécessairement dans ce PATH ; l'extraction devient vide et la garde de la
  ligne 143 retourne 2. Le même script force aussi `timeout` nu : macOS donne
  exactement `env: timeout: No such file or directory`, ce qui explique 11/13
  tests rouges contre 7/13 sur Ubuntu et Windows. Aucun commit de
  `codex/audit-systeme-nerveux-2026-09-01` après la référence ne touche ce
  script (`git log ... -- scripts/balayage-installation.sh` est vide).
  C'est un défaut de portabilité encore ouvert, commun aux six jobs.
- `tests/security/interactive-bash-env-injection.test.ts` sous Windows est
  rouge cinq fois : le test construit des commandes avec des quotes POSIX,
  tandis que `getShellConfiguration()` sélectionne volontairement
  PowerShell. Le log exact contient `ParserError` et `Unexpected token` sur
  les chemins quotés. Aucun commit après la référence ne touche cette paire
  source/test. Le correctif doit rendre le fixture conscient du shell réel ou
  exécuter explicitement le test Bash ; un skip global ferait perdre la
  couverture sécurité.

Aucun correctif de catégorie c n'a été appliqué : le balayage exige une
  décision portable sur la résolution de `node` et l'absence de `timeout` sur
  macOS, et le test Windows exige une commande PowerShell correctement formée.
  Ces changements sont petits en surface mais non vérifiables sur les deux
  plateformes depuis cette machine ; les modifier à l'aveugle ne serait pas
  sûr.

## 4. Voie la plus courte vers une CI verte

1. Porter d'abord les deux commits unitaires `26e9713c9` et `d38d1a5a3`.
   Pour le film, porter le comportement/test de `7a14945cd` après revue : le
   commit ferme bien le rouge mais touche dix fichiers, donc un cherry-pick
   aveugle est plus risqué qu'un portage de l'assertion et de ses dépendances.
2. Intégrer les lots d'hygiène déjà vérifiés avant de relancer la suite :
   TESTWRITE1 (`98537d9e5`), PERSONA1 (`bb86daa36`) et IDLINKS1
   (`6b53c7c98`). Ils empêchent les tests de toucher le vrai `~/.codebuddy`
   et rendent cohérent le `HOME` isolé ; ils ne remplacent pas les deux
   corrections CI ouvertes.
3. Corriger `scripts/balayage-installation.sh` en résolvant les exécutables
   avant `env -i` et en fournissant un timeout portable (ou en installant et
   exposant explicitement GNU `timeout` sur macOS). Ajouter un test de PATH
   sans Node dans `/usr/bin` et un test sans `timeout`.
4. Corriger le fixture interactif Windows selon
   `getShellConfiguration()` et reproduire le macOS PTY sur un runner macOS.
   Ne pas masquer la famille par une exemption CI sans conserver une suite
   sécurité équivalente.

La fusion de toute la branche d'audit est la voie opérationnelle la plus
rapide si sa revue globale est acceptée ; les cherry-picks nommés minimisent
le risque de régression mais demandent un portage manuel pour le film et les
deux défauts encore ouverts. Une simple exemption macOS/Windows pourrait
laisser passer le workflow puisque ces jobs sont `continue-on-error`, mais
elle ne rendrait pas le job `test` complet ni `Build and Package` réellement
vert ; elle est donc déconseillée comme solution finale.

## 5. Vérifications et état de passation

- `npm run typecheck` : exit 0, principal + Darkstar.
- `npm run lint` : exit 0, 0 erreur, 2 441 warnings préexistants.
- Vitest complet requis avec `HOME=~/DEV/cb-cimain1-2026-09-04/_qa/cimain1/home` : exécuté, exit 1, comptes consignés ci-dessus.
- `CI=1` avec le même `HOME` : tentative interrompue sans résumé ; non comptée.
- `git diff --check` : exit 0.
- Fichiers suivis sales étrangers préservés : `.codebuddy/agent-memory/alice/MEMORY.md`.
- Dans `~/code-buddy`, fichiers étrangers apparus pendant l'audit puis
  commités en parallèle sous `5236e8e3f` :
  `src/agent/streaming/message-reducer.ts`, `src/config/model-tools.ts` et
  `tests/agent/streaming/message-reducer-thinking-parts.test.ts`.
- Artefacts non suivis préservés : `~/DEV/cb-cimain1-2026-09-04/_qa/`, `branch/`, `feature-branch/`, `node_modules` et le répertoire du rapport.
- Décisions humaines restantes : accepter le portage des commits d'audit,
  choisir le correctif portable du balayage et valider la stratégie Windows/macOS.

## Bilan en dix lignes

1. Les six journaux CI ont été téléchargés par `gh api` et inspectés.
2. Ubuntu échoue sur utility, balayage et Bash ; macOS ajoute PTY et film.
3. Windows échoue sur balayage et le fixture PowerShell du shell interactif.
4. Les comptes CI exacts sont 48, 57 et 12 tests rouges selon le job.
5. Le clone passe typecheck et lint, mais lint conserve 2 441 warnings.
6. Vitest local isolé donne 8 fichiers et 55 tests rouges.
7. Trois rouges CI sont fermés par `26e9713c9`, `d38d1a5a3` et `7a14945cd`.
8. Hermes, PanoWorld et plusieurs timeouts locaux sont des dépendances d'environnement.
9. Le balayage et le fixture Windows restent ouverts ; le PTY macOS doit être reproduit.
10. Aucun code source n'a été changé ; `git diff --check` sort à 0.
