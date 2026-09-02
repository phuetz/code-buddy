# Réparation E18 — fermeture des points D5 à D11

Rapport initialisé avant toute inspection du dépôt, conformément à la mission E18.

## Journal de vérification

| Point | Rouge | Correctif | Vert | Commit |
|---|---|---|---|---|
| D5 | `npx vitest run tests/scripts/package-lifecycle.test.ts` : 1 échec ; clone frais : `ENOENT ... codebuddy-runtime.json`, exit 1 | `package.json` : `prepack` exécute `npm run build`, retire les sourcemaps puis génère le manifeste | Test ciblé PASS ; clone neuf issu de `726d29587` : `npm pack` exit 0, manifeste et tarball produits | `726d29587` |
| D6 | Test Commander rouge et route réelle initialement ChatGPT OAuth malgré `CODEBUDDY_PROVIDER=ollama`; démos locales 1.5B/4B non vertes | `try` accepte `--model`/`--base-url` après le sous-commande, transmet les options injectables et respecte `CODEBUDDY_PROVIDER=ollama` ; sélection exacte du tag Ollama | Tests ciblés 14/14 PASS ; headless affiche `Ollama local (qwen2.5:1.5b-instruct)` puis échoue honnêtement sur la qualité du petit modèle ; qwen3.8:27b atteint timeout 180 s | `050626bd4` |
| D7 | Test initial : `checkTtsProviders` n’était pas exposé ; diagnostic historique conseillait `edge-tts/espeak` | `doctor` sonde le lanceur Pocket (`pocket-tts`/`uvx`) et la présence de `ELEVENLABS_API_KEY`, avec conseil explicite | `npx vitest run tests/doctor/tts-guidance.test.ts` : 1/1 PASS ; `buddy speak --out` sans AudioReader : exit 1 + message clair, aucun WAV | `10ae7977f` |
| D8 | Test documentaire rouge : la doc ne signalait pas la limite `.git` des installations npm pack | Message d’erreur explicite et documentation de la nécessité d’un checkout Git | Test ciblé 6/6 PASS ; commande avec `GIT_DIR=/dev/null` : message explicite, exit Commander 1 | `0130f30f5` |
| D9 | Test registre/GitHub rouge : `--check` ne consultait pas npm, fabriquait la date avec `new Date()` et construisait encore `phuetz/grok-cli` | `--check` lit le nom/version de `package.json`, interroge le dist-tag npm réel avec timeout, refuse une réponse incomplète et corrige le dépôt GitHub | Test ciblé 14/14 PASS ; registre réel : `@phuetz/code-buddy` latest `1.6.1`, date `2026-06-25T13:14:01.864Z` ; CLI exit 0 et affiche ces valeurs | `6e910e76f` |
| D10 | À établir | À faire | À faire | À faire |
| D11 | À établir | À faire | À faire | À faire |

## Défauts non réglés

- D5 réglé et prouvé sur clone neuf issu de `726d29587`.
- D6 réglé côté routage/options ; la démo locale complète reste limitée par les modèles Ollama testés, détail ci-dessous.
- D7 réglé : diagnostic TTS aligné sur Pocket/ElevenLabs ; absence de moteur = message clair et exit 1.
- D8 réglé côté commande et documentation ; commit dédié `0130f30f5`.
- D9 réglé : `--check` ne fabrique plus de version/date et le dépôt/package sont ceux de Code Buddy.

## Commandes, sorties et commits

### D5 — paquet depuis un checkout frais

Rouge avant correctif :

```text
$ npx vitest run tests/scripts/package-lifecycle.test.ts
FAIL — expected prepack to contain `npm run build`; received `node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs --verify`

$ npm pack  # dans _e18/fresh-d5-red, clone sans dist ni manifeste
> @phuetz/code-buddy@2.0.0 prepack
> node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs --verify
ENOENT: no such file or directory, open '.../codebuddy-runtime.json'
npm error code 1
```

Correctif et vert local :

```text
package.json: prepack = npm run build && node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs

$ npx vitest run tests/scripts/package-lifecycle.test.ts
Test Files  1 passed (1)
Tests       1 passed
```

Commit D5 : `726d29587` (`fix(pack): build runtime before npm pack`).

Vert sur le clone neuf `_e18/fresh-d5-green`, après `npm install --ignore-scripts` :

```text
$ npm pack
> @phuetz/code-buddy@2.0.0 prepack
> npm run build && node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs
copy-bundled-skills: 8 skill package(s) → dist/skills/bundled/
Generated Code Buddy runtime manifest: .../_e18/fresh-d5-green/codebuddy-runtime.json
[strip-sourcemaps] removed 2413 *.js.map file(s), freed 19.8 MB from dist/
Generated Code Buddy runtime manifest: .../_e18/fresh-d5-green/codebuddy-runtime.json
npm notice name: @phuetz/code-buddy
npm notice version: 2.0.0
phuetz-code-buddy-2.0.0.tgz
exit 0
```

### D6 — modèle placé après `try`

Rouge :

```text
$ npx vitest run tests/commands/try.test.ts
FAIL — `transmet le modele placé après le sous-commande try`
Test timed out in 20000ms
```

Le test a lancé la démo réelle, preuve que `createTryCommand` ne permettait pas l’injection et ne récupérait pas l’option locale.

Vert :

```text
$ npx vitest run tests/commands/try.test.ts
Test Files  1 passed (1)
Tests       14 passed (14)
```

Preuve Ollama headless (sans sortie réseau payante) :

```text
$ TMPDIR="$PWD/_e18/tmp-d6" OLLAMA_HOST=http://localhost:11434 CODEBUDDY_PROVIDER=ollama LOG_LEVEL=error timeout 180s npx tsx src/index.ts try --model qwen2.5:1.5b-instruct
Code Buddy — coding-agent demo (~60 seconds)
[1/3] Provider: Ollama local (qwen2.5:1.5b-instruct)
...
❌ The demo did not produce a green test. ... Could not find 'fizzbuzz.test.js'
exit 1
```

Le routage et le modèle demandé sont donc prouvés ; la démonstration complète n’est pas déclarée verte avec ce modèle. `qwen3:4b-instruct` a produit un fichier invalide (export ESM), et `qwen3.8:27b` a atteint `timeout 180s`.

### D7 — TTS local absent

Rouge :

```text
$ npx vitest run tests/doctor/tts-guidance.test.ts
FAIL — TypeError: checkTtsProviders is not a function
```

Vert :

```text
$ npx vitest run tests/doctor/tts-guidance.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)

$ TMPDIR="$PWD/_e18/tmp-d7" CODEBUDDY_TTS_ENGINE=audioreader LOG_LEVEL=error timeout 20s npx tsx src/index.ts speak --out _e18/d7-no-tts.wav Bonjour E18
AudioReader is not running at http://localhost:8000
Start the AudioReader HTTP service (default http://localhost:8000), or use --engine pocket.
Tip: use `--engine pocket` for the on-CPU realtime voice, or `--engine voicebox` for the expressive GPU voice.
exit 1
```

Le code conseille désormais Pocket TTS ou ElevenLabs ; `espeak` et `edge-tts` ne sont plus proposés par `doctor` pour cette surface.

### D8 — changelog hors checkout Git

Rouge :

```text
$ npx vitest run tests/commands/changelog.test.ts
FAIL — la documentation ne contenait pas `installation npm pack`
```

Vert :

```text
$ npx vitest run tests/commands/changelog.test.ts
Test Files  1 passed (1)
Tests       6 passed (6)

$ GIT_DIR=/dev/null node --import "$PWD/node_modules/tsx/dist/loader.mjs" --input-type=module -e '... createChangelogCommand({ cwd: "./_e18/no-git-d8" }) ...'
Ce dossier n’est pas un dépôt Git : .../_e18/no-git-d8. La commande `buddy changelog` nécessite un checkout Git ; une installation npm pack n’inclut pas `.git`.
caught: buddy.changelog
```

Le second contrôle force Git à ne pas utiliser le dépôt parent ; l’action Commander reçoit bien `exitCode: 1`. Le message et la documentation ne promettent donc pas un changelog depuis un paquet npm sans historique Git.

Commit D8 : `0130f30f5` (`fix(changelog): explain Git requirement outside a checkout`).

### D9 — `update --check` et registre npm

Rouge :

```text
$ npx vitest run tests/unit/update-tag.test.ts
FAIL  tests/unit/update-tag.test.ts (13 tests | 8 failed)
× constructs correct command for main branch
× constructs correct command for a version tag
× constructs correct command for an arbitrary branch
× --tag main calls execSync with GitHub install command
× --tag v2.0.0 calls execSync with the correct ref
× --from-source maps to --tag main
× uses the registry version and publication date
× reports an unreachable registry without inventing a release
```

Correctif : `--check` utilise le nom réel lu dans `package.json`, appelle `https://registry.npmjs.org/<package>` et ne passe plus par `UpdateChannelManager.getLatestVersion()`, qui pouvait dériver une date courante. Les installations GitHub utilisent aussi `phuetz/code-buddy`.

Vert :

```text
$ npx vitest run tests/unit/update-tag.test.ts
Test Files  1 passed (1)
Tests       14 passed (14)

$ set -o pipefail; curl --fail --silent --show-error --max-time 10 'https://registry.npmjs.org/%40phuetz%2Fcode-buddy' | node -e '...'
registry=npm package=@phuetz/code-buddy latest=1.6.1 date=2026-06-25T13:14:01.864Z

$ LOG_LEVEL=error timeout 15s npx tsx src/index.ts update --check
Channel: stable
Registry: npm
Package: @phuetz/code-buddy
Latest:  1.6.1 (2026-06-25T13:14:01.864Z)
Current: 2.0.0
Registry release is older than the current version: 2.0.0 > 1.6.1
exit 0
```

La commande constate ici que la version locale est supérieure et ne conseille pas de rétrograder.

Commit D9 : `6e910e76f` (`fix(update): check the npm registry for releases`).
