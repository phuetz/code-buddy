# Réparation CIFIX2 — CI GitHub verte

Date de départ : 2026-09-04 (Europe/Paris)

Clone : `~/DEV/cb-cifix2-2026-09-05`

Branche : `fix/cifix2-ci-verte-2026-09-05`

Base annoncée : HEAD de `codex/audit-systeme-nerveux-2026-09-01`

## État initial communiqué

Run GitHub : `33911350696`, PR #149.

- Ubuntu Node 22 et Node 20 : 8 fichiers rouges, 22 tests rouges ; typecheck et lint verts.
- Catégories annoncées : build `dist` absent (16), Chromium absent (4), Piper/aplay absent (1), Ollama absent (1), fuseau horaire (1), régressions produit (0).
- Security Audit : 1 entrée non allowlistée (`browserslist`), totaux annoncés `low=22, moderate=12, high=16, critical=0, total=50`.
- TESTWRITE1 est annoncé vert et hors périmètre de correction.

## Choix et correctifs

### R1 — build et `dist`

Choix : déplacer `Build project` avant `Run tests` dans la matrice CI. Le build existait déjà après les tests ; il n’y a donc pas de build supplémentaire sur la durée totale du job, mais le contrat devient honnête et `dist/index.js` est présent avant DOC1. Le build local mesuré a duré 51,00 s au premier passage puis 49,93 s au passage final.

`runCli()` échoue maintenant explicitement si le fichier manque : `dist/index.js est absent — construire d’abord : npm run build`. Une mutation réversible du répertoire `dist` a produit 16 échecs DOC1 avec ce message, puis le build a restauré l’arbre. Avec le build présent, DOC1 est à 23/23.

### R2 — Chromium

`.github/workflows/ci.yml` installe `npx playwright install --with-deps chromium` après `npm ci`, uniquement pour `ubuntu-latest`. Les six shards Windows, les jambes macOS/Windows `continue-on-error` et le reste de la matrice sont inchangés.

`tests/helpers/cifix2-dependencies.ts` centralise `chromiumExecutableExists()` et imprime le chemin attendu et la commande d’installation. Les quatre zones Chromium sont gardées par `describe.skipIf` : GK30, les deux GK21, et le test widget Telegram imbriqué. L’assertion `/sendPhoto` et l’upload multipart restent inchangés.

### R3 — Piper et Ollama

Le même helper expose `hasPiper()` (binaire, modèle, lecteur audio) et `hasOllamaModel()` (liste `/api/tags`, modèle exact/préfixe). Chaque absence imprime un motif ; aucun appel réel n’est converti en succès muet. GK23 et GK10 sont gardés seulement quand leur prérequis manque.

### R4 — fuseau foyer

`resolveHouseholdClock()` existait déjà et utilise `CODEBUDDY_TIMEZONE` avant le fuseau de l’hôte. Le test GK36 épingle donc le foyer à `Europe/Paris`, restaure l’environnement après chaque cas, et rejoue le même 08:00 sous `TZ=UTC` et `TZ=Europe/Paris`. Les deux verdicts sont non nuls ; le fichier passe 19/19 dans les deux exécutions.

### R5 — Security Audit

Le bump ciblé non cassant est prouvé par le lockfile : `browserslist` 4.28.4 → 4.28.9 ; override `npm` 11.19.0 → 11.19.1, qui embarque `tar` 7.5.22 et `undici` 6.28.0 ; `undici` racine passe à 6.28.0. Le bump a aussi supprimé le `undici` 5.29.0 imbriqué de `@ai-sdk/provider-utils` sans balayage global.

Après ces bumps, l’allowlist ne contient plus d’entrée morte ou expirant le 2026-09-21 ; les 10 high encore live sont conservés avec leur justification et expiry 2026-11-19. Les entrées mortes signalées par le gate ont été retirées, dont `xlsx`, les entrées OpenTelemetry/RN devenues stale et les entrées `npm`/`tar`/`undici` traitées par bump. Le gate local est sorti 0 : `low=21, moderate=11, high=10, critical=0, total=42`, 10 high documentés, aucun high non documenté.

## Fichiers `dist/index.js` hors DOC1

`rg` trouve 13 fichiers de test au total avec `dist/index.js`, dont DOC1 et les 12 fichiers énumérés par la mission (la mention « 13 autres » est donc une discordance de comptage). Les 12 passent 258/258 : `scaffold-app-tool`, `unit/templates`, `security/npm-pack-contents`, `scripts/install-relative-launcher`, `unit/init-project`, `unit/context-loader`, `daemon/learning-cron-job`, `analytics/repo-explainer`, `cloud/cloud-task-subprocess`, `templates/project-scaffolding`, `agent/self-improvement/delegation-facts`, `channels/pro/text-formatter`.

Ils vérifient des chemins de templates, des métadonnées, des argv injectés, des fixtures ou du texte formaté ; ils ne lancent pas `node dist/index.js` du checkout. `npm-pack-contents` utilise `npm pack --dry-run` pour la liste du dépôt mais n’exige pas la présence de l’entrée et crée son propre `dist/index.js` dans une fixture temporaire pour le cas `.npmignore`. Aucun de ces verts n’est donc un faux passage de DOC1.

## Preuves réellement exécutées

- Lot exact avant correctif, HOME QA imposé : `7 fichiers / 21 tests rouges`, `49 passés`, `1 ignoré`, durée 171,83 s sur cette machine. L’écart avec le run GitHub `8/22` vient du fuseau local Europe/Paris qui faisait passer GK36 ; la reproduction `TZ=UTC` initiale était 17/18 et rouge à la ligne 319.
- Lot exact après, Chromium réel mais Ollama présent et Piper absent : `1 fichier / 1 test rouge`, `70 passés`, `1 ignoré`, durée 175,23 s. La rouge est GK10 à `/repo` après `/help`, donc la garde n’a pas masqué une défaillance quand Ollama était disponible.
- Quatre fichiers Chromium avec Chromium 1208 présent : `4 fichiers / 28 tests passés`.
- Lot exact avec HOME/PATH appauvris, Chromium/Piper/Ollama absents : `3 fichiers passés`, `65 tests passés`, `7 ignorés`, `0 rouge`; les trois motifs de garde sont imprimés.
- `TZ=UTC` et `TZ=Europe/Paris` sur GK36 : `19/19` dans chaque cas.
- `npm run build` : exit 0 ; `node dist/index.js --help` : exit 0.
- `tests/unit/client.test.ts` + `tests/unit/codebuddy-client.test.ts` : `170/170`.
- Tests des 12 autres fichiers `dist/index.js` : `258/258`.
- `node scripts/ci-audit-gate.mjs` : exit 0 ; `git diff --check` : exit 0 ; YAML parse : OK ; ESLint ciblé : 0 erreur, 1 avertissement `no-explicit-any` préexistant dans `telegram.test.ts`.
- `TESTWRITE1` n’a pas été modifié et aucun run n’a produit d’erreur du global setup ; les deux fichiers `.codebuddy` gardés n’ont pas été touchés.

## Limites et durée

Le `node_modules` du clone est un lien préexistant vers `~/code-buddy/node_modules`. Aucun `npm ci` n’a été lancé afin de ne pas supprimer ou réécrire le dépôt original interdit en écriture. `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` a résolu le lockfile sans toucher ce lien ; les tests provider et le typecheck ont été exécutés sur l’arbre existant. Chromium de preuve a été téléchargé uniquement dans `_qa/cifix2/home` (14,81 s, sans paquets système) ; le temps `--with-deps` du runner GitHub n’est pas mesurable localement.

Le run Ubuntu de référence était à 634,83 s. Le build déplacé coûte environ 50 s mais ne s’ajoute pas au total puisqu’il existait déjà ; l’installation Chromium ajoute le téléchargement et les dépendances système du runner. Estimation prudente du job Ubuntu après patch : environ 650–700 s, à confirmer par le prochain run GitHub.

## Commits

- R1 : `ce1c9190d` — `fix(ci): build before tests and guard built cli`
- R2 : `2276bfdcb` — `test(ci): guard optional chromium coverage`
- R3 : `be094217a` — `test(ci): guard local Piper and Ollama journeys`
- R4 : `0b22c6434` — `test(companion): pin household timezone in gk36`
- R5 : `4e5ed3b06` — `fix(security): refresh audited dependency tree`
- Documentation/coordination : commit final après cette relecture.
