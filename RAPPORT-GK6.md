# RAPPORT GK6 — buddy-memory (Rust) Phase 4

Date d’ouverture : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-succes-memory-2026-09-02`
Branche : `feat/gk6-ckg-phase4-2026-09-03`
HEAD à l’ouverture : `3fcf5a97d` (`docs(voice): consigner les preuves DARK3`)

## Garde-fous (rappel)

- Rapport créé **avant** toute inspection du code produit.
- Aucun push, aucun prune, aucun reset --hard, aucun `rm -rf`.
- Aucun `git add -A` / `git commit -a`.
- Aucune API payante. LLM local Ollama `qwen3:4b-instruct` / `qwen3.8:27b` sur 127.0.0.1:11434 autorisé, ou aucun.
- Aucun service systemd. Ports libres seulement. Jamais `DISPLAY=:10`.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone si un test a besoin d’un profil).
- Dépôt original `~/code-buddy` **interdit**.
- Aucune donnée personnelle.

## Mission

Phases 1–3 déjà faites. Phase 4 = rappel sous-linéaire + bascule par défaut mesurée.

1. Banc reproductible AVANT : ledger synthétique de 50 000 nœuds (générateur déterministe, pas de données réelles), `recallHybrid` ×100 requêtes : latence p50/p95, RAM. Tableau.
2. Index : HNSW (crate `hnsw_rs` ou `instant-distance`, licence permissive) sur les embeddings + index inversé pour le mot-clé, persistés dans le snapshot, mis à jour à l’ingestion ; parité de résultats avec le chemin exhaustif (test : top-10 identiques ou recouvrement ≥ 0,9 sur 100 requêtes) ; APRÈS : même banc, gain chiffré.
3. Bascule : `CODEBUDDY_CKG_ENGINE` par défaut sur `rust` SEULEMENT si le binaire est construit et le snapshot chargeable, sinon TS (test des deux chemins, repli sur erreur intact) ; CLAUDE.md et `docs/` mis à jour. Cargo tests + tests TS mémoire verts.

## Journal — ouverture (avant inspection du code produit)

Commandes exécutées uniquement pour situer le clone et réserver le chantier :

```
git status -sb && git branch --show-current && git log -5 --oneline && pwd
```

Sortie :

```
## feat/gk6-ckg-phase4-2026-09-03
feat/gk6-ckg-phase4-2026-09-03
3fcf5a97d docs(voice): consigner les preuves DARK3
ec6cdb99a feat(voice): ajouter le routage Kyutai à deux vitesses
9719f57d0 chore(dark3): réserver le chantier voix locale
d50aee61e Merge EVO1 (notes de version lisibles par Lisa, outil self_evolution, source d'expérience Darwin-Gödel opt-in) into codex/audit-systeme-nerveux-2026-09-01
c053ccd22 docs(self-model): document self evolution
/home/patrice/DEV/cb-succes-memory-2026-09-02
```

Lecture de `docs/FABLE5-CODEX-COORDINATION.md` (protocole + début du tableau) pour réserver le chantier GK6. Aucune lecture de `buddy-memory/src/`, `src/memory/collective-knowledge-graph.ts` ni `buddy-memory-client.ts` à ce stade.

## Lots prévus

| Lot | Objet | Commit prévu |
|---|---|---|
| 0 | Réservation chantier + rapport d’ouverture | `chore(gk6): réserver le chantier CKG Phase 4` |
| 1 | Banc AVANT (générateur 50k, métriques p50/p95/RAM) | `feat(gk6): banc reproductible recallHybrid 50k` |
| 2 | Index HNSW + inversé, snapshot, ingestion, parité | `feat(gk6): index HNSW et inversé sous-linéaire` |
| 3 | Banc APRÈS + gain chiffré | `test(gk6): mesurer le gain de l'index Phase 4` |
| 4 | Bascule défaut rust si binaire+snapshot, sinon TS | `feat(gk6): basculer CKG rust par défaut mesurée` |
| 5 | Docs CLAUDE.md + docs/ + passation | `docs(gk6): documenter Phase 4 et la bascule` |

## Inspection

Fichiers lus après création du rapport :

- `buddy-memory/Cargo.toml`, `README.md`, `src/{main,model,store,embed}.rs`
- `src/memory/collective-knowledge-graph.ts` (engineClient, ingest, recallHybrid)
- `src/memory/buddy-memory-client.ts`
- `tests/memory/buddy-memory-engine.test.ts`

Constat :

- Phases 1–3 présentes : ledger JSONL, snapshot `.snap` v1, JSON-RPC, hybrid ONNX derrière `feature = embeddings`.
- Index inversé mot-clé **déjà** dans `Store::index` (non persisté dans le snapshot, reconstruit au chargement). `recall()` l’utilise.
- `recall_hybrid` (ONNX) scannait **tous** les nœuds — O(N) embeddings + scoring. Sans ONNX, repli keyword.
- `CODEBUDDY_CKG_ENGINE` n’active rust que si la variable vaut exactement `rust`. Défaut = TS.
- Snapshot v1 : `current` / `superseded` / `relations` uniquement.

## Banc AVANT (collé)

Générateur déterministe `buddy-memory/src/synth.rs` (seed 42, 100 clusters, aucun texte réel). Embeddings synthétiques 32-d (hash de tokens, L2). HOME / `~/.codebuddy` non touchés : travail sous `buddy-memory/.gk6-work/`.

Commande :

```
cd buddy-memory && cargo run --release --offline --bin ckg-bench -- --nodes 50000 --queries 100 --mode exhaustive --seed 42 --work /home/patrice/DEV/cb-succes-memory-2026-09-02/buddy-memory/.gk6-work/bench-exhaustive-50k
```

Sortie (exit 0, 73 s) :

```
GK6 CKG bench  mode=exhaustive  nodes=50000  queries=100
  generate 65.7 ms   ledger-write 1758.4 ms   load 723.2 ms
  recallHybrid p50=660.401 ms  p95=999.582 ms  mean=694.406 ms
  RSS start=2.6 MiB  loaded=142.9 MiB  warm=179.7 MiB  after=181.5 MiB
```

| Mode | Nœuds | Requêtes | p50 (ms) | p95 (ms) | mean (ms) | RSS chargé (MiB) | RSS après (MiB) |
|---|---:|---:|---:|---:|---:|---:|---:|
| exhaustive (Phase 3, AVANT) | 50 000 | 100 | **660.401** | **999.582** | 694.406 | 142.9 | 181.5 |

Fumée 2 000 nœuds / 20 requêtes : p50=9.578 ms, p95=23.371 ms, RSS après=10.9 MiB (échelle ~linéaire).

## Index et parité (collé)

Crate `hnsw_rs` 0.3.4 (MIT/Apache). Index inversé persisté dans le snapshot v2 (`index` + `emb_cache`) ; le graphe HNSW est reconstruit depuis les vecteurs au chargement et mis à jour à `remember()`. stdout de `hnsw_rs` (println tous les 50k points) est silencée pour ne pas casser le JSON-RPC.

```
cd buddy-memory && cargo test --offline --lib indexed_hybrid_top10 -- --nocapture
```

```
running 1 test
test store::store_tests::indexed_hybrid_top10_overlaps_exhaustive ... ok
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 51.21s
```

Autres tests d’index : `snapshot_persists_inverted_index_and_embeddings`, `ingest_updates_hnsw_and_inverted_index` verts dans `cargo test --lib` (12/12).

## Banc APRÈS (collé)

Commande :

```
cd buddy-memory && cargo run --release --bin ckg-bench -- --nodes 50000 --queries 100 --mode indexed --seed 42 --work /home/patrice/DEV/cb-succes-memory-2026-09-02/buddy-memory/.gk6-work/bench-indexed-50k
```

Sortie (exit 0) :

```
GK6 CKG bench  mode=indexed  nodes=50000  queries=100
  generate 112.0 ms   ledger-write 3335.1 ms   load 1333.9 ms
  recallHybrid p50=10.372 ms  p95=24.453 ms  mean=12.810 ms
  RSS start=2.7 MiB  loaded=143.2 MiB  warm=309.3 MiB  after=309.3 MiB
```

| Mode | Nœuds | Requêtes | p50 (ms) | p95 (ms) | mean (ms) | RSS après (MiB) |
|---|---:|---:|---:|---:|---:|---:|
| exhaustive (AVANT) | 50 000 | 100 | 660.401 | 999.582 | 694.406 | 181.5 |
| indexed HNSW+inversé (APRÈS) | 50 000 | 100 | **10.372** | **24.453** | 12.810 | 309.3 |

Gain p50 : **×63,7** (660.401 / 10.372). Gain p95 : **×40,9**. RAM +127.8 MiB (graphe HNSW), attendu.

## Bascule défaut (à coller)

*(vide)*

## Vérifications (à coller)

*(vide)*

## Commits

*(vide)*

## Bilan

*(à écrire en fin de mission, ≤ 10 lignes)*
