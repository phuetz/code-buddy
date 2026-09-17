# Temps de démarrage de la CLI Code Buddy

- Date : 2026-09-18
- Agent : Grok 4.6
- Worktree : `worktree cb-demarrage-2026-09-18`
- Branche : `feat/demarrage-2026-09-18` (base `origin/main` `b5c50c189`)
- Contraintes respectées : pas de commit, pas de `rm -rf`
- Node : v24.14.1
- HOME de mesure : `_qa/demarrage-cli/home` (isolé, gitignoré)

## Méthode (reproductible)

Premier affichage utile = premier octet stdout (ou trame PTY) contenant le marqueur du scénario, mesuré avec `time.perf_counter()` dans le parent. Neuf runs après deux échauffements. Médiane.

Commande exacte :

```bash
python3 <dépôt privé de passation>/20260918-demarrage-cli/measure.py \
  --label LABEL --runs 9 --warmup 2 \
  --cli CHEMIN_ENTRY
```

Avant (binaire npm = `dist/index.js`) :

```bash
python3 <dépôt privé de passation>/20260918-demarrage-cli/measure.py \
  --label before --runs 9 --warmup 2 \
  --cli worktree cb-demarrage-2026-09-18/dist/index.js
```

Après (binaire npm = `dist/cli-boot.js`) :

```bash
python3 <dépôt privé de passation>/20260918-demarrage-cli/measure.py \
  --label after --runs 9 --warmup 2 \
  --cli worktree cb-demarrage-2026-09-18/dist/cli-boot.js
```

Environnement figé par le script : `HOME` / `TMPDIR` sous `_qa/demarrage-cli/`, `NO_COLOR=1`, clés API et `OLLAMA_HOST` retirés. Cwd = `_qa/demarrage-cli/work`.

| Scénario | Marqueur du premier affichage utile |
|---|---|
| `--help` | `Pour commencer` |
| `--version` | premier octet non vide (`2.2.0`) |
| `whoami` | `ChatGPT:` |
| session interactive sans fournisseur | `No AI provider` (message d’accueil, niveau error) |

Surcharge process `node -e "process.stdout.write('ok\n')"` : médiane **29,1 ms** (plancher).

JSON brut : `before/timing.json`, `after/timing.json`.

## Chiffres avant / après

Médiane de 9 runs, même machine, même script. Temps jusqu’au premier affichage utile (TTFB) et jusqu’à la fin du processus.

| Scénario | TTFB avant | TTFB après | Gain TTFB | Sortie avant | Sortie après |
|---|---:|---:|---:|---:|---:|
| `--help` | 73,6 ms | 52,4 ms | **29 % (−21 ms)** | 79,5 ms | 56,6 ms |
| `--version` | 78,8 ms | 25,0 ms | **68 % (−54 ms)** | 82,8 ms | 26,9 ms |
| `whoami` | 125,7 ms | 80,3 ms | **36 % (−45 ms)** | 131,9 ms | 84,6 ms |
| interactif (sans fournisseur) | 350,7 ms | 253,9 ms | **28 % (−97 ms)** | 357,4 ms | 261,8 ms |

`--version` après est au plancher Node (~25–29 ms) : le processus n’évalue plus Commander.

Sorties `--help` / `--version` / `whoami` : **octets identiques** avant/après (`diff` vide).

## Attribution (traces, pas une lecture)

Chargeur ESM `node --import …/trace-loader.mjs` + `strace -e openat` sur `--help` / `whoami`.

### `--help` avant (45 modules, graphe statique de `src/index.ts`)

Ouverts pour rien à ce stade :

- `node:http` / `node:https` — uniquement pour `globalAgent.destroy()` à l’arrêt. Import isolé `node:http` : **18,8 ms**.
- `provider-detector` → `provider-catalog` → `chatgpt-models` → `installation-id`
- `model-provider-compat`
- `headless-options` → `output-sanitizer`
- `output-schema-validator`, `model-listing`, `first-run`, `atomic-write`
- balayage `/tmp` (`sweepStaleCodebuddyTemp`) à l’évaluation du module

`PERF_TIMING` sur `src/index.ts` est trompeur : `STARTUP_TIME` est pris **après** les imports ESM (hissés). `imports-start: 1ms` ne compte pas le graphe.

### `whoami` avant (+50 modules vs `--help`)

`import("./providers/codex-oauth.js")` tirait en tête :

- le paquet `open` (détection de navigateur : `default-browser`, `is-wsl`, `is-docker`, `run-applescript`, …) alors que `whoami` ne fait que lire `codex-auth.json`
- `node:http` pour le serveur OAuth de `login`

Puis `settings-manager` → zod + js-yaml + fs-extra (toujours nécessaire pour la ligne Local).

### Session interactive avec clé (une trace `PERF_TIMING`, pas une médiane à 9)

| Phase | Temps |
|---|---|
| Auto-detected | 268 ms |
| lazy `CodeBuddyAgent` | **676 ms** (fin à 974 ms) |
| bandeau « Starting Code Buddy… » | **1116 ms** (imprimé *après* la création de l’agent) |
| Ink + ChatInterface | +237 ms après l’agent |
| `ui-render` | 1293 ms |
| indexation workspace | après le rendu, en fond |

Le bandeau utile était donc retardé par le graphe agent. Après changement : médiane 9 runs jusqu’à « Starting Code Buddy… » = **296 ms**. Ce n’est **pas** un avant/après à 9 runs des deux côtés ; le 1116 ms n’est qu’un échantillon. Non compté dans le tableau principal.

## Changements (aucun comportement observable visé)

1. **`src/cli-boot.ts`** — entrée `bin` (`buddy` / `code-buddy`). `--version` / `-V` seuls lisent `package.json` et écrivent la version. Le reste `import('./index.js')`.
2. **`src/index.ts`** — plus d’import statique de `node:http`/`https`, headless, listing modèles, first-run, schema, atomic-write, détecteur de fournisseur, compat modèle. Chargés au moment de l’usage. Balayage `/tmp` sauté pour `--help`/`--version` seuls (le prochain run durable le fait encore). Bandeau interactif **avant** le graphe agent ; `renderers` + agent + React/Ink/ChatInterface en parallèle.
3. **`src/providers/codex-oauth.ts`** — `open` et `node:http` uniquement dans `loginInteractive` / bind du callback. `whoami` / `hasCodexCredentials` ne les chargent plus.

`install.sh` continue d’exécuter `dist/index.js` (test d’installeur figé). `npm i` / le champ `bin` passent par `cli-boot.js`. `node dist/index.js --version` reste correct via Commander, juste plus lent.

## Ce qui reste coûteux, et pourquoi

- **`--help` ~52 ms** : il faut encore évaluer `src/index.ts` (fichier énorme) et enregistrer toutes les commandes Commander + chalk/logger + TOML (`getHiddenCliCommands` change réellement la liste d’aide). Un cache de texte d’aide casserait cette liste.
- **`whoami` ~80 ms** : `settings-manager` tire encore zod / js-yaml / fs-extra pour la ligne Local.
- **TUI avec fournisseur** : le module `CodeBuddyAgent` (~0,7 s de graphe) reste sur le chemin critique du **rendu Ink**. On a avancé le bandeau, pas le premier frame TUI. Découper l’agent serait un autre chantier.
- **Plancher Node ~25–29 ms** par process.

## Non-régression

- `diff` `--help` / `--version` / `whoami` : identique.
- Tests ciblés (FORCE_COLOR retiré, sinon Node pollue stderr) : `cli-boot`, `help-output`, `first-run`, `headless-empty-response`, `headless-output-flags`, `codex-oauth`, `codex-oauth-e2e` — **43/43**.
- `headless-exit-code` « provider failure → exit 1 » : rouge **isolé** aussi sur `origin/main` (stash) ; **vert dans la suite complète**. Flocon d’environnement, pas une régression de ce lot.
- Suite complète : `env -u FORCE_COLOR -u OLLAMA_HOST -u CODEBUDDY_PROVIDER npm test` — **2218 fichiers verts / 6 skip**, **39083 tests verts / 33 skip / 1 todo**, 603 s, exit 0.
- `npx tsc --noEmit` : 0. ESLint des fichiers touchés : 0.

## Fichiers

- `src/cli-boot.ts` (nouveau)
- `src/index.ts`, `src/providers/codex-oauth.ts`
- `package.json` / `package-lock.json` (`bin`)
- `tests/cli/cli-boot.test.ts`
- traces : `Partage/20260918-demarrage-cli/traces/`
