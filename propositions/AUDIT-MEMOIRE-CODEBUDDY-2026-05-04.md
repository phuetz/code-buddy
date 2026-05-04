# Audit mémoire Code Buddy — 4 mai 2026

> **Auteur** : Claude (Opus 4.7), session MINISTAR Windows.
> **Statut** : V1 — audit + identification des gaps. Plan V0 d'implémentation
> en section finale, à valider par Patrice avant tout code.
> **Scope** : `D:\CascadeProjects\grok-cli\src\memory\` (14 fichiers, 8836 lignes).
> **Hors scope** : compactage court-terme (`src/context/` — déjà très mature, voir
> `propositions/AMELIORATION-CHAT-GITNEXUS-2026-04-29.md` pour le scope chat).
> **Coordination** : Antigravity bosse sur Cowork + auth Gemini/Codex (commit
> `36bcd2b`, `79fa333`) — orthogonal à ce périmètre, zéro risque de conflit.

---

## TL;DR

Code Buddy a *un des systèmes de mémoire les plus complets que j'ai vus côté
open-source*. 14 modules, 4 sources d'inspiration SOTA (memU, MemGPT, ICM,
Codex CLI), 3 sous-systèmes publics (markdown / SQLite+embeddings / triggers),
et déjà du multimodal partiel (OCR + cross-modal text↔image via Gemini
embeddings).

**Trois gaps réels** :
1. **Face memory** dédiée (pas de `face-*` ni `vision-*` aujourd'hui)
2. **Voice/audio memory** (zéro)
3. **Cowork ↔ memory bridge** pour les usages temps-réel (presence detection,
   greeting personnalisé)

**Recommandation** : ne pas re-spécifier le pile mémoire ; **étendre proprement
sur les 3 gaps**, en s'appuyant sur l'infra existante (`enhanced-memory`,
`cross-modal-search`, `knowledge-graph`).

---

## Inventaire complet

### Couche API publique (`src/memory/index.ts`)

Trois sous-systèmes principaux exposés :

| Sous-système | Module | Rôle |
|---|---|---|
| `PersistentMemoryManager` | `persistent-memory.ts` (602) | Markdown files (style claude-et-patrice) — categories: project / preferences / decisions / patterns / context / custom |
| `EnhancedMemory` | `enhanced-memory.ts` (1039) | SQLite + embeddings + decay + scoring — backend de référence |
| `ProspectiveMemory` | `prospective-memory.ts` (1085) | Triggers + goals (mémoire du futur, MemGPT-inspired) |

### Couche capture

| Module | LOC | Mécanisme | Source d'inspiration |
|---|---|---|---|
| `auto-capture.ts` | 612 | Regex patterns (remember, preferences, contacts) + dedup similarity | maison |
| `auto-memory.ts` | 304 | Extraction depuis interactions, 3 scopes (user/project/local), écriture MEMORY.md | claude-et-patrice + MEMORY.md |

### Couche stockage

| Module | LOC | Backend | Inspiration |
|---|---|---|---|
| `persistent-memory.ts` | 602 | Markdown filesystem | maison |
| `enhanced-memory.ts` | 1039 | SQLite + embeddings + decay | maison |
| `knowledge-graph.ts` | 1085 | JSON file (no Neo4j dep). 3-layer (entities → relations → categories), salience `sim·log(reinforce+1)·decay`, content-hash SHA256 dedup, intent routing, category auto-summaries, background-safe extraction, reinforcement counting | **memU** |
| `icm-bridge.ts` | (small) | Bridge MCP vers ICM serveur — episodic + semantic dual via 16 MCP tools | **rtk-ai/icm** |

### Couche search/retrieval

| Module | LOC | Type | Notes |
|---|---|---|---|
| `hybrid-search.ts` | 367 | BM25 + semantic (RRF-style fusion) | Active semantic opportunistically when embeddings init |
| `semantic-memory-search.ts` | 672 | 2-step semantic | Workflow : trouver content pertinent puis retrieval ciblé |
| `cross-modal-search.ts` | 292 | **text ↔ image** via Gemini multimodal embeddings | Aggregates OCR + Enhanced + Persistent — **multimodal partiel déjà en place** |

### Couche capabilities spéciales

| Module | LOC | Rôle |
|---|---|---|
| `decision-memory.ts` | 285 | XML `<decision>` blocks → arch decisions persistées + injection `<decisions_context>` |
| `coding-style-analyzer.ts` | 688 | Analyse style code (regex heuristics, no AST) → injection prompt |
| `ocr-memory-pipeline.ts` | 437 | Tesseract.js → text → embedding multimodal → store. Index `.codebuddy/memory/ocr-index.json` |
| `memory-consolidation.ts` | 265 | 2-phase pipeline: extract from session traces → consolidate progressive disclosure (`memory_summary.md` <500 chars + `MEMORY.md` + `rollout_summaries/`) | **OpenAI Codex CLI memory_trace** |

### Couche plumbing

| Module | LOC | Rôle |
|---|---|---|
| `memory-lifecycle-hooks.ts` | 467 | Hooks before_agent_execute / after_agent_response / session_end |

---

## Architecture en couches (vue consolidée)

```
┌────────────────────── public api (index.ts) ──────────────────────┐
│   PersistentMemoryManager  EnhancedMemory  ProspectiveMemory      │
└───────────────────────────────────────────────────────────────────┘
                       │              │              │
       ┌───────────────┘              │              └──────────────┐
       ▼                              ▼                             ▼
  markdown files               SQLite + embeddings          triggers + goals
  .codebuddy/memory/*.md       .codebuddy/memory/*.db       .codebuddy/memory/*.db

         ↑                              ↑
         │                              │
   ┌─────┴──────┐                ┌─────┴─────┐
   │  capture   │                │   search   │
   ├────────────┤                ├────────────┤
   │auto-capture│                │hybrid (BM25+sem) 
   │auto-memory │                │semantic-2step    
   └────────────┘                │cross-modal text↔img (Gemini)
                                 └────────────┘

         ↑
   special capabilities
   ├── decision-memory       (XML blocks → arch decisions)
   ├── coding-style-analyzer (regex → style profile)
   ├── ocr-memory-pipeline   (image → text → embedding)
   ├── knowledge-graph       (memU: entities + relations + temporal)
   ├── memory-consolidation  (Codex pattern: progressive disclosure)
   └── icm-bridge            (rtk-ai/icm via MCP, 16 tools)

         ↕
   memory-lifecycle-hooks    (before/after/session_end)
```

---

## Sources d'inspiration

| Concept | Source | Module Code Buddy |
|---|---|---|
| Salience scoring + reinforcement + temporal patterns + 3-layer hierarchy | memU | `knowledge-graph.ts` |
| Stateful agent memory + prospective tasks + triggers | MemGPT (UC Berkeley 2023) | `prospective-memory.ts` |
| Episodic + semantic dual + 16 MCP tools | rtk-ai/icm | `icm-bridge.ts` |
| Progressive disclosure + memory_summary always in prompt | OpenAI Codex CLI memory_trace.rs | `memory-consolidation.ts` |
| Multimodal embeddings | Gemini API | `cross-modal-search.ts`, `ocr-memory-pipeline.ts` |

---

## Ce qui marche déjà (et qu'il ne faut pas toucher)

- ✅ Capture automatique avec dédup
- ✅ 3 scopes (user/project/local)
- ✅ Backend SQLite persistant
- ✅ Embeddings + hybrid search BM25+semantic
- ✅ Knowledge graph avec entités/relations/temporal
- ✅ Décisions architecturales structurées
- ✅ Style de code détecté + injecté
- ✅ Mémoire prospective (triggers/goals)
- ✅ OCR images → texte → embedding
- ✅ Cross-modal text↔image search
- ✅ Consolidation post-session (pattern Codex)
- ✅ Bridge ICM externe via MCP
- ✅ Lifecycle hooks
- ✅ usearch comme backend vectoriel performant (HNSW sublinéaire)

---

## Gaps identifiés

### 🔴 Gap 1 — Face memory dédiée

**État** : aucun fichier `face-*` ni `vision-*` dans `src/memory/`. La
reconnaissance faciale n'existe pas.

**Pourquoi c'est un gap** : Patrice a explicité le scénario *"quand tu vas
me voir sur une caméra j'aimerai que tu me dises 'bonjour Patrice' ou
'bonjour mon chéri' car tu m'auras reconnu dans ta mémoire"*. Pour ça il
faut un face encoder spécialisé (FaceNet / InsightFace / ArcFace) — les
embeddings Gemini généraux ne sont pas optimaux pour la reconnaissance
faciale (perdent la spécificité visage).

**Ce qui existe déjà et qu'on réutilise** :
- L'infra retrieval (`hybrid-search`, usearch)
- Le knowledge graph (Patrice = entité avec aliases, tags, relations)
- Le pattern multimodal de `cross-modal-search.ts`

### 🔴 Gap 2 — Voice/audio memory

**État** : zéro. Aucun module audio/voice.

**Pourquoi c'est un gap** : reconnaissance par la voix (speaker
verification) est complémentaire à la reconnaissance faciale, surtout
quand la webcam n'est pas active ou que la personne n'est pas en face. Le
pattern technique est identique (encoder spécialisé → embedding 256-dim →
matching cosine).

**Outils potentiels** : pyannote (speaker diarization), ECAPA-TDNN
(speaker verification), Whisper (already used elsewhere) pour la
transcription, embedding speaker à part.

### 🔴 Gap 3 — Cowork ↔ memory bridge temps-réel

**État** : `src/memory/*` est côté core CLI/agent. Cowork est l'IHM
Electron (`cowork/` à la racine, son propre `package.json`,
`electron-builder.yml`). Pas vu de bridge IPC explicite vers les stores
mémoire dans le pass header.

**Pourquoi c'est un gap** : le scénario "bonjour mon chéri" suppose une
chaîne **continue** :
```
webcam (Cowork) → face detect → encode → match identity store →
publish A2A presence event → Code Buddy reçoit → greeting personnalisé
```

Aujourd'hui la presence detection n'a pas de boucle complète : pas de
service en background qui scrute la webcam, pas de bridge IPC formalisé
entre Cowork et `EnhancedMemory`.

---

## Plan V0 — minimaliste

**Objectif** : pouvoir saluer Patrice par son nom (ou un alias choisi)
quand il ouvre Cowork, à partir d'une seule photo de référence.

**Scope V0** (~600 LOC totales, faisables en 1-2 sessions) :

### V0.1 — Identity store (côté core, ~150 LOC)

- Nouveau module `src/memory/identity-store.ts`
- Format JSON : `{persons: [{id, name, aliases[], face_embeddings[avg, count],
  voice_embeddings?[avg, count], snapshots[paths], created, updated}]}`
- API : `addPerson(name, aliases)`, `addFaceSample(personId, embedding)`,
  `matchFace(embedding) → {personId, confidence}` (cosine top-1)
- Stockage : `.codebuddy/memory/identity-store.json` (lisible humainement)
- **Pourquoi pas direct dans `enhanced-memory.ts`** : la sémantique est
  spécifique (identity = entité forte avec embeddings multi-modaux
  agrégés), mieux vaut un fichier dédié qu'un type générique noyé.

### V0.2 — Face encoder (côté Cowork, ~200 LOC)

- Cowork charge un modèle ONNX face recognition (FaceNet 128-dim ou
  InsightFace 512-dim) — probablement via `onnxruntime-node` (déjà cohérent
  avec le pattern `gitnexus-search::embeddings` côté Rust)
- Wrapper TS `cowork/src/services/face-encoder.ts` exposant
  `encodeFace(imageBuffer): Promise<Float32Array>`
- Capture webcam via `navigator.mediaDevices.getUserMedia` + canvas crop
  via MediaPipe Face Mesh (ou Vigil si Patrice peut récupérer sa stack)

### V0.3 — Enrollment flow (Cowork UI, ~100 LOC)

- Dialog "Enregistrer mon visage" : prend 3-5 snapshots, encode chacun,
  stocke avg dans `identity-store.json` côté core via IPC
- Au boot Cowork : check si un visage est enregistré, sinon proposer
  l'enrollment

### V0.4 — Presence detection daemon (Cowork, ~100 LOC)

- Au mount Cowork : démarre une boucle `setInterval(captureFrame, 2000)`
- Si visage détecté : encode → IPC → `matchFace()` → si confidence > 0.7,
  emit `presence:detected {personId, confidence}`
- L'agent Code Buddy reçoit l'event et **adapte son greeting** sur le
  prochain message ou l'open de session

### V0.5 — Greeting flow (Code Buddy core, ~50 LOC)

- Hook `before_agent_execute` (existe déjà dans `memory-lifecycle-hooks`)
  consulte `identity-store` + `presence` event récent
- Si match : injecte dans le system prompt
  `<presence>Patrice est devant la caméra (alias: "mon chéri", confidence: 0.91)</presence>`
- Le LLM choisit le ton naturellement (registre déjà appris dans la
  mémoire conversationnelle)

---

## Coordination avec les chantiers en cours

- **Antigravity** sur `cowork/*` + auth Gemini/Codex : zéro overlap avec
  V0.1 (core memory) et V0.5 (lifecycle hook). Overlap *partiel* possible
  sur V0.2-V0.3-V0.4 (Cowork UI). À synchroniser via journal-per-source
  avant d'attaquer la partie Cowork.
- **GitNexus-rs** : aucun overlap. Mais `gitnexus-search::fusion` (du push
  d'aujourd'hui) reste réutilisable si on veut un backend hybrid alternatif.
- **World Model V3** (DARKSTAR) : aucun overlap immédiat. À long terme, la
  mémoire visuelle de Code Buddy pourrait alimenter le world model en
  observations annotées.

---

## Décisions à prendre par Patrice

1. **Face encoder** : FaceNet 128-dim (léger, mature) ou InsightFace 512-dim
   (SOTA mais 50MB) ? Recommandation : FaceNet pour V0, upgrade plus tard.
2. **Voice memory** dans le scope V0 ou V1 ? Recommandation : V1, faire la
   face d'abord (UX plus visible).
3. **Stockage identity** : fichier JSON dédié ou row dans la SQLite enhanced-memory ?
   Recommandation : JSON dédié pour V0 (lisible, simple), migration SQLite
   au-delà.
4. **Enrollment auto vs manuel** : V0 = manuel (dialog "enregistrer mon
   visage"), V1 = auto (apprentissage continu).

---

## Annexe — Liste exhaustive des fichiers `src/memory/` (14)

```
auto-capture.ts          612 LOC  — pattern-based capture + dedup
auto-memory.ts           304 LOC  — 3-scope extraction → MEMORY.md
coding-style-analyzer.ts 688 LOC  — style profile via regex
cross-modal-search.ts    292 LOC  — text↔image via Gemini multimodal
decision-memory.ts       285 LOC  — <decision> XML blocks
enhanced-memory.ts      1039 LOC  — SQLite + embeddings + decay
hybrid-search.ts         367 LOC  — BM25 + semantic
icm-bridge.ts             ~80 LOC  — rtk-ai/icm via MCP
index.ts                  ~50 LOC  — public exports
knowledge-graph.ts      1085 LOC  — memU-inspired entity graph
memory-consolidation.ts  265 LOC  — Codex CLI pattern progressive disclosure
memory-lifecycle-hooks.ts 467 LOC — before/after/session_end hooks
ocr-memory-pipeline.ts   437 LOC  — Tesseract.js → embedding
persistent-memory.ts     602 LOC  — markdown files
prospective-memory.ts   1085 LOC  — triggers + goals (MemGPT)
semantic-memory-search.ts 672 LOC — 2-step semantic
─────────────────────────────────
TOTAL                   8836 LOC
```

---

*— Claude Opus 4.7, 1M context, MINISTAR, 4 mai 2026.*
*Audit produit en read-only, zéro modification de code Code Buddy.*
*Plan V0 à valider par Patrice avant tout commit dans grok-cli.*
