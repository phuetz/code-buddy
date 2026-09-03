# Réparation GK2 — `buddy research --deep` renvoie zéro source

- Début : 2026-09-03 (Europe/Paris)
- Clone autorisé : `/home/patrice/DEV/cb-never-tools-2026-09-02` uniquement
- Branche : `fix/gk2-research-deep-2026-09-03`
- HEAD au départ : `3fcf5a97d` (`docs(voice): consigner les preuves DARK3`)
- Réservation : `f2daaf638` (`chore(gk2): réserver le chantier recherche --deep`)
- Contraintes : aucun push ; aucune API payante (Ollama local `qwen3:4b-instruct` / `qwen3.8:27b` sur `127.0.0.1:11434`) ; aucun service systemd ; aucune écriture hors du clone ni dans `~/.codebuddy` (HOME = `_gk2/home` dans le clone) ; dépôt original `~/code-buddy` interdit ; aucune donnée personnelle ; jamais `DISPLAY=:10` ; ports libres seulement.

Fait mesuré (RECH3, 02/09) : « les deux `buddy research --deep` ont bien été lancés mais ont retourné zéro source ».

## Journal initial

Ce rapport a été créé **avant toute inspection** du code de recherche, conformément à la mission.

### Garde-fous respectés

- Pas de `git push`, `git prune`, `git reset --hard`, `rm -rf`.
- Pas de `git add -A` ni `git commit -a`.
- ComfyUI 8188/8189 non touché.
- Services systemd non touchés.
- `DISPLAY` jamais posé (la session l’avait déjà à `:10.0` ; toutes les commandes ont commencé par `unset DISPLAY`).

### Fichiers lus

- `docs/FABLE5-CODEX-COORDINATION.md` (protocole, réservation GK2)
- `src/commands/research/index.ts`
- `src/commands/research/deep.ts`
- `src/agent/deep-research.ts`
- `src/agent/deep-research-ckg.ts` (surface)
- `src/agent/deep-research-storm.ts` (surface)
- `src/agent/wide-research.ts` (`deepResearch`, `buildDeepBoundaries`)
- `src/tools/web-search.ts`
- `src/tools/web-scrape-tool.ts`
- `tests/agent/deep-research.test.ts`
- `tests/agent/deep-research-loop.test.ts`
- `tests/commands/research/deep-flag.test.ts`
- `tests/tools/web-search-searxng.test.ts`
- `tests/tools/web-search-real.test.ts`

## Reproduction réelle (étages)

HOME isolé : `/home/patrice/DEV/cb-never-tools-2026-09-02/_gk2/home`. Clés payantes absentes de l’environnement. Ollama local joignable (`qwen3:4b-instruct`, `qwen3.8:27b`).

### DuckDuckGo HTML (curl)

```text
curl -sS --max-time 15 -A 'Mozilla/5.0 … Chrome/124…' \
  -o _gk2/ddg.html -w 'http=%{http_code} bytes=%{size_download}\n' \
  'https://html.duckduckgo.com/html/?q=typescript+vitest'
# http=202 bytes=14202
# anomaly-modal: 56   result__a: 0   uddg=: 0
```

**Rouge curl :** page CAPTCHA, parseur `result__a` à 0.

### SearXNG loopback `:8888` (déjà en écoute, non démarré ici)

```text
# GET / → SearXNG 2026.6.8
curl -sS 'http://127.0.0.1:8888/search?q=typescript+vitest&format=json'
# premier appel : 20 results (vitest.dev, …)
# appels suivants : results=[]  unresponsive_engines=
#   brave=Suspended: too many requests
#   duckduckgo=CAPTCHA
#   startpage=Suspended: CAPTCHA
```

`SEARXNG_URL` était **unset** → la chaîne produit n’essayait jamais SearXNG (contrat historique).

### `searchStructured` (axios, HOME isolé, sans clé)

```text
LOG_LEVEL=debug ./node_modules/.bin/tsx _gk2/probe-search.mjs
# Brave MCP not connected
# NO SEARXNG_URL : hits=8 withUrl=8  (DuckDuckGo via axios, ~1,3 s)
# SEARXNG_URL=http://127.0.0.1:8888 : SearXNG resultCount=0 puis DDG 8 hits
# fetchPage https://vitest.dev/ success=true outLen=1462
```

### Pipeline live (LLM volontairement cassé)

```text
SEARXNG_URL=http://127.0.0.1:8888  # moteurs déjà suspendus → 0
# repli DuckDuckGo
SEARCH q="Vitest TypeScript testing framework" in=5 urls=5
SEARCH q="… overview" in=5 urls=5
unique URLs before scrape=7
scrape attempted=7 nonEmpty=7 snippetFallbacks=0 emptyDropped=0 kept=7
STAGE searched {"queries":2,"hits":10,"urls":7}
sources 7
```

### Où les résultats disparaissaient

1. **CLI annonçait un succès à 0 source.** `runDeepResearchPipeline` ne jette jamais ; `synthesize([])` écrit « Aucune source » ; `runDeepResearchCli` loguait `✅ Deep Research complete (0 cited source(s))` et écrivait `Mode: deep` sans `Status: failed`.
2. **Scrape vide → drop.** `collectSources` jetait tout hit dont `scrape()` renvoyait `''`, **même avec un snippet citable**. Test : 5 hits factices + scrape vide → `sources=[]`.
3. **`searchStructured` acceptait des hits sans URL.** Perplexity sans citations (`url: ''`) arrêtait la chaîne avant DuckDuckGo ; Deep Research filtrait ensuite `if (!url) continue` → 0 URL.
4. **SearXNG local non câblé** si `SEARXNG_URL` unset, alors que `:8888` répond. DuckDuckGo HTML (curl) est en CAPTCHA ; 12 requêtes DDG parallèles (plan LLM) vident aussi axios.
5. **Journal d’étage absent / trompeur.** `collecting` était émis *après* la collecte avec le nombre déjà scrapé.

## Tests ROUGE (avant correctif)

```text
./node_modules/.bin/vitest run \
  tests/commands/research/deep-zero-sources.test.ts \
  tests/agent/deep-research-zero-sources.test.ts \
  tests/tools/web-search-structured-empty-url.test.ts
# Test Files  2 failed | 1 passed (puis 3 failed après le cas Perplexity)
# Tests  5 failed | 2 passed
```

Extraits :

```text
FAIL collectSources … keeps snippet content when scrape returns empty
AssertionError: expected [] to have a length of 5 but got +0

FAIL runDeepResearchCli … does not announce a successful report when … 0 sources
AssertionError: expected undefined to be 1  # exitCode
# logs contenaient "✅ Deep Research complete (0 cited source(s))"

FAIL searchStructured … Perplexity returns 5 citation-less answers
AssertionError: expected '' to contain 'ddg-fallback'
```

## Correctifs

| Étape | Changement |
|---|---|
| Collecte | Repli sur le **snippet** si le scrape est vide. |
| Trace | `DeepResearchTrace` : queries / searchHits / hitsWithUrl / uniqueUrls / scrapeAttempted / scrapeNonEmpty / snippetFallbacks / emptyDropped / dedup + erreurs par requête. |
| CLI | 0 source ⇒ `throw formatZeroSourceFailure` ⇒ `Status: failed`, `exitCode=1`, plus de `✅ … (0 cited source(s))`. |
| `searchStructured` | Un hit n’est utilisable que s’il a une URL non vide ; sinon on enchaîne. Tentatives exposées (`getLastStructuredAttempts`). |
| Fan-out | Recherches **bornées** via `mapBatched` (plus 12 DDG en parallèle). |
| Frontière réelle | `buildDeepBoundaries.search` jette un résumé `provider: erreur` si aucune URL utilisable (le catch de `collectSources` le journalise). |
| SearXNG | Découverte fail-open de `127.0.0.1:8888` / `localhost:8888` si `SEARXNG_URL` unset (`CODEBUDDY_SEARXNG_AUTODISCOVER=false` pour couper). |

## Preuves VERT

```text
./node_modules/.bin/vitest run \
  tests/commands/research/deep-zero-sources.test.ts \
  tests/agent/deep-research-zero-sources.test.ts \
  tests/tools/web-search-structured-empty-url.test.ts \
  tests/commands/research/discover-searxng.test.ts \
  tests/agent/deep-research.test.ts \
  tests/agent/deep-research-loop.test.ts \
  tests/commands/research/deep-flag.test.ts \
  tests/commands/research/storm-flag.test.ts \
  tests/tools/web-search-searxng.test.ts \
  tests/agent/wide-research-deep.test.ts
# Test Files  10 passed (10)
# Tests  87 passed (87)

npx tsc --noEmit -p tsconfig.json          # exit 0
npx tsc --noEmit -p tsconfig.gpuNode-identity.json  # exit 0
npx eslint <fichiers touchés> --max-warnings=0      # exit 0
git diff --check                           # propre
```

### `--deep` réel à 0 source = échec explicite (plus un succès)

Sans clé, HOME isolé, Ollama `qwen3:4b-instruct`, SearXNG `:8888` découvert mais moteurs suspendus, 12 requêtes DDG saturées :

```text
  🔎 Search: 0 hit(s) in → 0 unique URL(s) from 12 queries
  📥 Kept 0 source(s) after scrape/snippet fallback
  ❌ Deep Research produced 0 cited source(s)
❌ Deep Research failed: Deep Research produced 0 cited sources — refusing to report success.
Stages: queries=12 searchHits=0 hitsWithUrl=0 uniqueUrls=0 scrapeAttempted=0 scrapeNonEmpty=0 snippetFallbacks=0 emptyDropped=0 dedupKept=0 dedupDropped=0
CLI_EXIT=1
```

### `--deep` réel ≥ 5 sources citées

SearXNG factice loopback (port libre `46669`, JSON à 6 résultats vers des URL publiques) + Ollama `qwen3:4b-instruct`, aucune clé payante, HOME isolé :

```text
fake n 6
Provider: ollama | Model: qwen3:4b-instruct
  📝 4 sub-question(s), 12 search queries (LLM)
  🌐 Collecting up to 12 source(s)...
  [web-search] structured provider {"provider":"searxng","hitsIn":5,"usableUrls":5}  # ×12
  unique URLs before scrape {"uniqueUrls":5}
  scrape stage {"attempted":5,"nonEmpty":5,"snippetFallbacks":0,"emptyDropped":0,"kept":5}
  🔎 Search: 60 hit(s) in → 5 unique URL(s) from 12 queries
  📥 Kept 5 source(s) after scrape/snippet fallback
  ✅ Deep Research complete (5 cited source(s))
CLI_EXIT=0
Duration: 114.8s
```

Rapport tronqué (`_gk2/deep-report.md`, aucune donnée personnelle) :

```markdown
# Deep Research: Vitest TypeScript testing framework
Mode: deep
Provider: ollama
Sources: 5 (0 near-duplicate(s) dropped)
Planner: LLM | Synthesis: LLM

## TL;DR
Vitest handles TypeScript type checking natively by leveraging Vite’s ESM
and TypeScript pipeline, with full type safety during test execution. […]

## Références
[1] Vitest | Next Generation testing framework — https://vitest.dev/
[2] Getting Started | Guide | Vitest — https://vitest.dev/guide/
[3] Writing Tests | Guide | Vitest — https://vitest.dev/guide/learn/writing-tests.html
[4] Configuring Vitest — https://vitest.dev/config/
[5] Vitest GitHub repository — https://github.com/vitest-dev/vitest
```

## Commits

| Commit | Message |
|---|---|
| `f2daaf638` | `chore(gk2): réserver le chantier recherche --deep` |
| `7a2b44a9a` | `fix(research): conserver les hits et échouer à 0 source` |
| lot docs | `docs(gk2): consigner la réparation research --deep` (ce commit) |

## Bilan

Réparé : `--deep` ne proclame plus un succès à 0 source ; les snippets survivent à un scrape vide ; `searchStructured` n’arrête plus la chaîne sur des hits sans URL ; chaque étage est journalisé. Prouvé : tests cibles 87/87 verts ; typecheck racine + GPU exit 0 ; ESLint ciblé exit 0 ; CLI réel exit 1 avec raisons d’étage à 0 hit ; CLI réel exit 0 avec 5 références citées (Ollama `qwen3:4b-instruct`, SearXNG loopback factice + pages publiques). Ouvert : les moteurs du SearXNG opérateur `:8888` étaient suspendus (CAPTCHA/quota) au moment de la mesure — `SEARXNG_URL` ou la découverte loopback restent le chemin local-first ; DuckDuckGo HTML reste fragile sous parallèle élevé.
