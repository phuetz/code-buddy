# Réparation TTFT1 — métriques de latence par tour

Date : 2026-09-03

## Contraintes appliquées

- Dépôt de travail : `/home/patrice/DEV/cb-ttft1-2026-09-03`.
- Aucun accès en écriture à `~/code-buddy`, aucun push, aucune API payante.
- Tout état Code Buddy éventuel sera écrit sous un `HOME` temporaire situé dans le clone.
- Les sorties rouges seront consignées avant chaque correctif, puis les preuves vertes après correction.

## État initial

Rapport créé avant toute inspection du code, conformément à la mission.

## Défauts et réparations

### D1 — aucune mesure TTFT/TTFM persistable et agrégée

Le dépôt ne contient pas le module demandé. Le contrat a d’abord été écrit dans
`tests/observability/turn-metrics.test.ts` : horloge factice, absence de TTFT
sur un échec sans chunk, séparation de deux fournisseurs, ligne JSONL tronquée,
journal sans contenu et coût constant de quatre lectures d’horloge malgré
10 000 appels à `markFirstChunk()`.

Commande rouge (avec `HOME` et `TMPDIR` confinés dans le clone) :

```text
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/observability/turn-metrics.test.ts
FAIL  tests/observability/turn-metrics.test.ts
Error: Cannot find module '../../src/observability/turn-metrics.js'
Test Files  1 failed (1)
Tests  no tests
```

Correctif : `TurnMetricsRecorder` fournit le cycle pur/injectable demandé,
n’appelle l’horloge qu’aux quatre transitions, écrit le journal avec
`O_APPEND`, puis rafraîchit l’état agrégé via `writeJsonAtomic`. Le JSONL est
la source de vérité et son lecteur ignore les lignes invalides/tronquées.

```text
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/observability/turn-metrics.test.ts
Test Files  1 passed (1)
Tests  6 passed (6)
```

### D2 — le routeur ignore les mesures précises et accepte une seule mesure grossière

Le test de consommation donne à `gemma4:31b` trois TTFM réels (700/800/900 ms).
Malgré ce p50 à 800 ms, le sélecteur conserve l’heuristique de taille et choisit
le Qwen 7B. Deux contrats voisins imposent le seuil de trois tours et figent la
sortie complète obtenue avec un journal vide.

```text
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/fleet/model-selector.test.ts
FAIL  tests/fleet/model-selector.test.ts > model-selector — latency-aware selection > prefers measured TTFM p50 after three real streamed turns
AssertionError: expected 'qwen2.5:7b-instruct' to be 'gemma4:31b'
Test Files  1 failed (1)
Tests  1 failed | 11 passed (12)
```

Correctif : `ModelScoreboard.measuredTurnLatency()` charge les agrégats du
journal avec cache par `mtime`, exige trois TTFM complets et expose leur p50.
`selectFastestModel` préfère ce signal précis, conserve ensuite l’ancienne
moyenne council, puis l’heuristique. Un journal vide conserve l’objet de sortie
complet à l’octet JSON près.

```text
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/fleet/model-selector.test.ts tests/fleet/model-scoreboard.test.ts
Test Files  2 passed (2)
Tests  33 passed (33)
```

### D3 — le chemin streaming réel ne pose aucun jalon TTFT/TTFM

Deux tests ferment les deux niveaux du chemin réel : le provider doit ignorer
un chunk vide de rôle, marquer le premier chunk porteur de token puis la fin du
message ; `runTurnLoop` doit transmettre le compteur de jetons à ce point de
mesure unique. Avant correction, ni le provider ni l’exécuteur ne le font.

```text
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/codebuddy/providers/provider-openai-compat.test.ts tests/agent/execution/agent-executor.test.ts
FAIL ...provider-openai-compat.test.ts > measures from request send to the first token-bearing chunk and complete message
AssertionError: expected "endTurn" to be called 1 times, but got 0 times
FAIL ...agent-executor.test.ts > enables precise provider turn metrics from the authoritative runTurnLoop
TypeError: actual value must be number or bigint, received "undefined"
Test Files  2 failed (2)
Tests  2 failed | 148 passed (150)
```

Correctif : `runTurnLoop` transmet un observateur et ses compteurs au client ;
le provider OpenAI-compatible démarre le tour juste avant l’appel SDK, ignore
les chunks de rôle/usage sans token, marque le premier delta texte/raisonnement/
outil, puis le message complet à la fermeture normale du flux. Son `finally`
enregistre aussi les échecs sans fabriquer de TTFT. Le dispatcher porte une
seule option interne, donc les chemins séquentiel et streaming partagent bien
le même `runTurnLoop`.

```text
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/codebuddy/providers/provider-openai-compat.test.ts tests/agent/execution/agent-executor.test.ts
Test Files  2 passed (2)
Tests  150 passed (150)
$ HOME="$PWD/node_modules/.ttft1-home" TMPDIR="$PWD/node_modules/.ttft1-tmp" npx vitest run tests/codebuddy/providers/provider-openai-compat.test.ts tests/agent/execution/turn-metrics-wiring.test.ts
Test Files  2 passed (2)
Tests  11 passed (11)
```

## Tour réel Ollama local à 0 €

À effectuer après l’implémentation, sous réserve que l’instance Ollama locale soit disponible et non occupée.

## Vérifications finales

À compléter.
