# Réparation E17 — Cowork : défauts restants des audits « inconnu »

## Cadre et état initial

- Mission : E17, exécutée le 3 septembre 2026 dans le seul clone autorisé
  `/home/patrice/DEV/cb-exec-d-2026-09-02`.
- Branche : `fix/cowork-inconnu-3-2026-09-03` ; HEAD initial :
  `facea986446db20cfcb63085be0344756e8c6122`.
- Le présent rapport a été créé avant la première inspection, conformément à la
  consigne de mission.
- État initial : le dépôt avait déjà les non-suivis `RAPPORT-EXEC-D.md`,
  `REPARATION-E13.md`, `_audit-projet/` et `_qa/`. Ils n'ont été ni supprimés ni
  incorporés aux commits de correction E17.
- Aucun push, API payante, service systemd ou `DISPLAY=:10` ; aucune écriture
  dans `~/code-buddy` ni hors du clone autorisé.

Pendant l'exécution, l'index contenait aussi un grand nombre d'artefacts E13
préexistants. Chaque commit E17 a donc été construit avec `git commit --only` et
des chemins nommés. L'index étranger a été préservé tel quel.

## Sources consultées

- Protocole et réservation : `docs/FABLE5-CODEX-COORDINATION.md:1-31`.
- Audit E12 :
  `git show audit/cowork-inconnu-2-2026-09-02:RAPPORT-E12.md | nl -ba`, en
  particulier les lignes 271 (D9) et 276-278 (D14-D16).
- Audit E16 :
  `git show audit/cowork-inconnu-2-2026-09-02:RAPPORT-E16.md | nl -ba`, lignes
  51, 90-98 (D22 encore ouvert ; D14/D15 annoncés corrigés ; D9/D16 ouverts).
- La commande demandée
  `git show audit/cowork-inconnu-2-2026-09-02:REPARATION-E13.md` échoue avec
  `fatal: path 'REPARATION-E13.md' exists on disk, but not in
  'audit/cowork-inconnu-2-2026-09-02'`. `git ls-tree` confirme que cette
  révision ne contient que `RAPPORT-E12.md` et `RAPPORT-E16.md`. Le fichier local
  non suivi `REPARATION-E13.md` a été lu comme repli, sans lui attribuer la
  provenance de la branche d'audit.
- D22 : `cowork/src/renderer/components/UniversalPreviewRail.tsx:31-87`,
  `cowork/e2e/chat-flow.spec.ts:38-199`,
  `cowork/tests/chat-flow-e2e-contract.test.ts:5-45`,
  `cowork/tests/chat-view-width-layout.test.ts:15-38`.
- D9 : `install.sh:23-33,228-340`, `docs/install.md:16-66`,
  `tests/scripts/install-relative-launcher.test.ts:7-104`.
- D14 : `cowork/src/main/nav-server-bind.ts:3-50`,
  `cowork/src/main/nav-server.ts:202-219`,
  `cowork/tests/nav-server-bind.test.ts:18-47`.
- D15 : `cowork/package.json:26-40`, `cowork/scripts/prepare-husky.cjs:1-24`,
  `cowork/tests/prepare-husky.test.ts:7-31`.
- D16 : `package.json:54-78`, `package-lock.json`,
  `tests/config/npm-allow-scripts.test.ts:5-36`.

## E16 geste 7 / D22 — compositeur visible après chaque tour

### Cause et correction

Le rail universel était monté ouvert et occupait une largeur fixe de 460 px.
Dans le panneau Chat du dock, déjà réduit quand le contexte est ouvert, cette
largeur ramenait la conversation et son compositeur à zéro. Le rail démarre
maintenant replié (`useState(false)`). Son bouton d'ouverture reste présent et
les aperçus de fichier ou d'artefact continuent de l'ouvrir automatiquement.

Le scénario Playwright lance un vrai serveur HTTP OpenAI-compatible local sur
un port éphémère, vérifie explicitement que le port est supérieur à 3100, envoie
deux messages successifs et attend les deux réponses. Il ne simule pas le retour
par un événement renderer.

### Preuve rouge puis verte

Build de la version antérieure avant le rouge : `npx vite build`, code 0,
43,71 s. Puis :

```sh
env -u DISPLAY HOME="$PWD/../_qa/e17-e2e-home" \
  TMPDIR="$PWD/../_qa/e17-e2e-tmp" \
  COWORK_E2E_TMP_ROOT="$PWD/../_qa/e17-e2e-tmp" \
  xvfb-run -a --server-args='-screen 0 1440x900x24' \
  npx playwright test e2e/chat-flow.spec.ts --reporter=line
```

Avant correction : échec sur `expect(followUpComposer).toBeVisible()`, aucun
élément trouvé après 20 s ; 1 test échoué, code 1, 55,18 s.

Après correction, la même commande avec
`COWORK_E17_CHAT_SCREENSHOT="$PWD/../_qa/shots/e17-two-turn-chat.png"` donne
1 test passé en 14,5 s, code 0, durée murale 15,21 s. La capture 1400×900 montre
les deux bulles utilisateur, les deux bulles assistant et le compositeur encore
visible : [`_qa/shots/e17-two-turn-chat.png`](_qa/shots/e17-two-turn-chat.png),
SHA-256 `05d892e83761f56ed8d95ac47d670adec05d7fae92815326d12cf8c4f3c1fd7f`.
La capture rouge est
[`_qa/shots/e17-d22-red.png`](_qa/shots/e17-d22-red.png), SHA-256
`fae8f9caab9c8021c4f79d1cd76687532a1253c4ad456f197bcc4033a464a60a`.

Commit : `bd1f789a2 fix(cowork): keep composer visible after each turn`.

## D9 — wrapper `buddy` relocalisable

### Cause et correction

Le champ `bin` npm était déjà relatif au paquet, mais l'installeur ne créait un
chemin utilisateur prioritaire que lors du repli npm local. Un ancien
`~/.local/bin/buddy` contenant le chemin absolu d'un checkout pouvait donc
rester le premier `buddy` du `PATH`.

L'installeur crée désormais `~/.codebuddy/bin/buddy`. Ce petit wrapper calcule
son propre répertoire à l'exécution et appelle
`.code-buddy-package/dist/index.js`. Le lien `.code-buddy-package` est relatif
au répertoire du wrapper et est rafraîchi à chaque installation. Aucun chemin
absolu de la machine n'est écrit dans le wrapper ; un fichier non géré situé à
cet emplacement n'est jamais écrasé. `~/.codebuddy/bin` est ajouté au début du
`PATH`, sans modifier ni supprimer l'ancien wrapper.

Le test isolé fabrique un préfixe npm réaliste, un vieux wrapper absolu qui sort
avec le code 99 et un faux paquet qui répond `2.0.0-test`. Il vérifie le lien
relatif, l'absence du chemin de travail et de `CODEBUDDY_ROOT`, l'exécution du
bon paquet, la priorité dans le profil et un second passage idempotent.

- Rouge : `env TMPDIR="$PWD/_qa/e17-d9-test-tmp" npx vitest run
  tests/scripts/install-relative-launcher.test.ts` — lanceur absent, 1 échec,
  code 1, 1,60 s.
- Vert : même test — 1/1 passé, code 0, 1,09 s ; second passage également
  couvert dans le test.
- Syntaxe POSIX : `sh -n install.sh` — code 0.

Commit : `5bda1b5cf fix(installer): install package-relative buddy launcher`.

## D14 — collision du port NavServer

D14 était déjà corrigé dans la base par `010601665 fix(cowork): bind NavServer
on the next port when 19888 is taken`. Le code essaie 19888 à 19897 et le test
d'intégration ouvre réellement un serveur occupant le premier port avant de
vérifier que NavServer écoute sur le suivant. Le test demandé n'était donc pas
absent et aucun commit artificiel n'a été ajouté.

Preuve : `cd cowork && npx vitest run tests/nav-server-bind.test.ts
tests/prepare-husky.test.ts` — incluse avec D15, 2 fichiers, 4 tests passés,
code 0, 0,93 s.

## D15 — Husky hors dépôt Git

D15 était déjà corrigé dans la base par `a97ca2717 fix(cowork): skip husky
prepare when cowork is not a git root`. `cowork/package.json` appelle le script
dédié ; celui-ci sort avec le code 0 et un message clair lorsque `cowork/.git`
n'existe pas. Le test couvre à la fois cette sortie et le câblage du script
`prepare`. La preuve commune D14/D15 ci-dessus est verte ; aucun test manquant.

## D16 — npm 11 `allowScripts`

### Rouge, politique et preuve fraîche

Dans un clone frais sans politique, `npm install --no-audit --no-fund` sous npm
11.17.0 a installé 1848 paquets, code 0, 105,20 s, puis signalé exactement 19
scripts non couverts. `npm approve-scripts --allow-scripts-pending --json` a
confirmé leurs versions.

Les 19 manifestes installés ont été relus par une extraction de leurs seuls
scripts `preinstall`, `install`, `postinstall` et `prepare` (`REVIEWED=19`). Ils
correspondent aux compilations/téléchargements de binaires attendus (Sharp,
SQLite, ONNX, ripgrep, esbuild, node-pty, tree-sitter, usearch, etc.) ou aux
étapes déclarées de préparation. `package.json` les autorise tous avec une clé
épinglée à la version exacte ; les trois versions Sharp sont distinctes. Le test
de contrat exige l'objet exact et un total de 19 entrées.

Preuve après le commit, dans un nouveau `git clone --no-hardlinks --branch
fix/cowork-inconnu-3-2026-09-03 . _qa/e17-d16-green-clone` :

```sh
env HOME="$PWD/../e17-d16-green-home" \
  npm_config_cache="$PWD/../e17-d16-green-cache" \
  TMPDIR="$PWD/../e17-d16-green-tmp" \
  npm install --no-audit --no-fund
```

Résultat : 1848 paquets installés, code 0, 73,44 s, aucun avertissement
`allowScripts`. La commande de contrôle
`npm approve-scripts --allow-scripts-pending --json` renvoie
`{"allowScripts": []}`. Les avertissements de peer-dependencies et de paquets
dépréciés, sans rapport avec D16, restent visibles et ne sont pas présentés
comme réglés.

Le `npm install` frais ne modifie la copie de `package.json`; il expose toutefois
un écart de licence préexistant dans le lock racine (`MIT` contre `BUSL-1.1`).
Cet écart indépendant n'a pas été intégré à E17.

Commit : `0d9f21749 fix(deps): approve pinned npm install scripts`.

## Vérifications finales

| Vérification | Résultat |
| --- | --- |
| `npx vitest run tests/config/npm-allow-scripts.test.ts` (racine) | 1 fichier, 1 test passé, code 0, 142 ms |
| `cd cowork && npx vitest run tests/chat-flow-e2e-contract.test.ts tests/chat-view-width-layout.test.ts tests/new-shell-single-composer.test.ts tests/nav-server-bind.test.ts tests/prepare-husky.test.ts` | 5 fichiers, 11 tests passés, code 0, 0,68 s |
| `cd cowork && npm run typecheck` | code 0, 19,33 s |
| `cd cowork && npx vite build` (dernière commande de build) | code 0, 27,38 s ; 5394 modules renderer, 4257 modules main, 6 modules preload |

Le build garde les avertissements non bloquants déjà présents : données
Browserslist anciennes, taille de certains chunks et imports à la fois statiques
et dynamiques. Aucune suite exhaustive de ~27 000 tests n'a été lancée : la
mission demandait des Vitest Cowork ciblés, le typecheck Cowork et le build Vite.

## Commits et reliquats

- D14 préexistant vérifié : `010601665`.
- D15 préexistant vérifié : `a97ca2717`.
- D22 : `bd1f789a2`.
- D9 : `5bda1b5cf`.
- D16 : `0d9f21749`.
- Documentation et captures : commit de passation contenant le présent rapport.

Les défauts D9, D14, D15, D16 et D22 visés par E17 sont fermés dans le périmètre
testé. Restent hors périmètre : l'écart de licence du lock, les avertissements
npm/Vite décrits ci-dessus et les artefacts E13 déjà indexés par un autre travail.
