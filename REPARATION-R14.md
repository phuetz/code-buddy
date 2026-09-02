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

---
