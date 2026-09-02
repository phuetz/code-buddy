# Réparation R14 — Mémoire collective, council, recherche simple

Date : 2026-09-02
Dépôt : `/home/patrice/DEV/cb-repar-connaissance-2026-09-02`
Branche : `fix/repar-connaissance-2026-09-02`
Agent : Grok 4.6

Audit source : `AUDIT-A-REPARER.md` (exécution réelle, clone `cb-exec-b-2026-09-02`).

## Périmètre

1. CKG injecté hors sujet (3 FAIL) — injection par pertinence (`recallHybrid` sur le message utilisateur), bornée, protégée de la troncature du prompt système.
2. Council à un seul membre — diagnostiquer le pool résolu ; corriger le défaut ou expliquer clairement pourquoi un seul siège.
3. `research` simple sans aucune source — conserver au minimum les URL consultées en fin de rapport.

## Journal

### 1. CKG injecté hors sujet — FAIT

**Cause.** `formatCollectiveContext` appelait déjà `recallHybrid`, mais :
- un nœud YouTube récent (wrapper « mémoire collective ») pouvait saturait le budget de 600 caractères et `break` empêchait d’y faire tenir le nœud pertinent ;
- la troncature du prompt système (`slice` en tête) coupait tout ce qui n’était pas au tout début, y compris une section collective placée trop tard.

**Correctif.**
- Fusion `recall()` (mêmes mots que `research recall` en repli) + `recallHybrid` ; si le mot-clé trouve un nœud, les voisins hors sujet (sans token thématique partagé) sont exclus.
- Empaquetage borné, une ligne tronquée à ~280 caractères.
- Section injectée **avant** les blocs facultatifs du prompt système, et `truncateSystemPromptPreservingReserved` la réserve.
- Dans `injectInitialContext`, le bloc CKG est le premier extra.

**Tests rouge → vert**

```
# avant correctif
FAIL  injects an on-topic ingested node and skips a recent off-topic one
AssertionError: expected '' to contain 'Diffusion-Based Audio Inpainting'
FAIL  keeps the reserved collective-knowledge section when the system prompt is truncated
AssertionError: expected "vi.fn()" to be called at least once
Tests  2 failed | 64 passed

# après
npx vitest run tests/memory/collective-knowledge-graph.test.ts tests/memory/ckg-hybrid-mmr.test.ts tests/services/prompt-builder.test.ts tests/agent/execution/context-pipeline-ckg-gate.test.ts
Test Files  4 passed (4)
Tests  75 passed (75)
```

`npx tsc --noEmit -p tsconfig.json` exit 0  
`npx eslint src/memory/collective-knowledge-graph.ts src/services/prompt-builder.ts src/agent/execution/context-pipeline.ts tests/memory/collective-knowledge-graph.test.ts tests/services/prompt-builder.test.ts` exit 0

### 2. Council à un seul membre — FAIT

**Sonde du pool résolu** (appel réel 0 €, `listActiveLlmModelPool`) :

```
CODEBUDDY_COUNCIL_POOL=full (default)
CODEBUDDY_COUNCIL_TRIAGE=(unset)
registry.all=5 primary=null
  registry chatgpt model=gpt-5.6-sol local=false apiKey=yes cost=0
  registry agy-cli ... apiKey=yes cost=0
  registry ollama model=gemma4-moe-rag:latest local=true apiKey=yes cost=0
  registry lemonade ... apiKey=yes cost=0
  registry grok model=grok-4-latest local=false apiKey=yes cost=0.5
pool=37 withApiKey=37
  chatgpt (6): gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4, gpt-5.4-mini
  agy-cli (11): …
  grok (5): grok-4-latest, grok-4-1-fast, grok-code-fast-1, grok-3-fast, grok-3-mini
  ollama (10): gemma4-moe-rag:latest, … (plafond 10 locaux)
  lemonade (5): …
```

**Cause.** Ce n’est pas un pool vide. L’audit a lancé `council --count 1 --models "chatgpt/gpt-5.6-sol"`. `--count 1` est un plafond documenté (défaut 3). En plus, le filtre `--models` comparait la chaîne entière `chatgpt/gpt-5.6-sol` au provider OU au modèle, donc **0 correspondance** → le filtre était ignoré (pool intact) → `pickDiverse` prenait le 1er classé (`gpt-5.4-mini`, bonus cheap + `fast`).

**Correctif.** `matchCouncilCandidate` accepte `provider/model` et `provider:model`. Un conseil à 1 siège affiche pourquoi (`--count`, taille du pool, filtre).

**Tests rouge → vert**

```
# avant
expected [ 'gpt-5.4-mini' ] to deeply equal [ 'gpt-5.6-sol' ]
describeCouncilPanel is not a function

# après
npx vitest run tests/council/council-engine.test.ts tests/commands/council-conductor.test.ts
Test Files  2 passed (2)
Tests  26 passed (26)
```

`npx tsc --noEmit -p tsconfig.json` exit 0  
`npx eslint src/council/council-engine.ts src/council/types.ts src/commands/council.ts tests/council/council-engine.test.ts tests/commands/council-conductor.test.ts` exit 0

### 3. `research` simple sans source — FAIT

**Cause.** Le mode non-interactif (`timeout` ⇒ pas de TTY) appelle `runDirectResearch` : un seul `client.chat` **sans recherche web**, donc 8 060 octets et 0 URL. `--deep` a un pipeline search→scrape→citations.

**Correctif.** La recherche simple consulte `WebSearchTool.searchStructured`, passe les URL au modèle, et ajoute toujours une section `## Sources` en fin de rapport (URL dédupliquées).

**Tests rouge → vert**

```
# avant
TypeError: appendDirectResearchSources is not a function
TypeError: runDirectResearch is not a function
Tests  4 failed

# après
npx vitest run tests/commands/research/direct-sources.test.ts tests/commands/research/deep-flag.test.ts tests/commands/research/integer-options.test.ts
Test Files  3 passed (3)
Tests  13 passed (13)
```

`npx tsc --noEmit -p tsconfig.json` exit 0  
`npx eslint src/commands/research/index.ts tests/commands/research/direct-sources.test.ts` exit 0

## Commits

1. `080b19068` `fix(memory): injecter la mémoire collective par pertinence`
2. `efb951398` `fix(council): honorer --models provider/modèle et expliquer un siège unique`
3. `fix(research): conserver les URL consultées en recherche simple`

## Ouvert

Rien de bloquant dans le périmètre R14. Un `council` sans `--count 1` siège jusqu’à 3 IA (défaut) sur le pool de 37. Le mode `--deep` est inchangé.

---
