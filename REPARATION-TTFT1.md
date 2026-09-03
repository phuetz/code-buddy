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

## Tour réel Ollama local à 0 €

À effectuer après l’implémentation, sous réserve que l’instance Ollama locale soit disponible et non occupée.

## Vérifications finales

À compléter.
