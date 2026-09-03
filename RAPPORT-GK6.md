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

## Inspection (à compléter)

*(vide — le code produit n’a pas encore été lu)*

## Banc AVANT (à coller)

*(vide)*

## Index et parité (à coller)

*(vide)*

## Banc APRÈS (à coller)

*(vide)*

## Bascule défaut (à coller)

*(vide)*

## Vérifications (à coller)

*(vide)*

## Commits

*(vide)*

## Bilan

*(à écrire en fin de mission, ≤ 10 lignes)*
