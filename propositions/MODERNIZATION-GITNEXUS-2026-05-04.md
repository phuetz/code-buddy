# Modernisation gitnexus-rs — audit & plan

> Audit déclenché par Patrice nuit du 03→04 mai 2026.
> 17% des limites Claude Code restantes au démarrage, exécution sur MINISTAR.
> Objectif : préparer un terrain de modernisation actionnable pour demain.

---

## TL;DR pour Patrice au réveil

- **2 PR ouvertes ce soir, mergeables sans risque** :
  - **#2** : `feat/enrichment-config-exposure` — déjà prêt depuis avant la session
  - **#3** : `chore/modernization-quickwins` — bincode unused supprimé + 11 fichiers clippy auto-fixés (626 tests verts, zéro régression)
- **Rapport ci-dessous** : 3 vagues progressives selon ton temps/énergie.
- **Découverte importante** : `feat/semantic-search` a déjà été mergée (commit `166ca44`). La todo "merger semantic-search" dans `etat_projets.md` est obsolète, à retirer demain.

---

## Inventaire warnings clippy au démarrage (master @ a256fe2)

`cargo clippy --workspace --all-targets` → **27 warnings uniques**, exit 0.

| Crate | # warnings | Auto-fixable | Notes |
|-------|-----------|--------------|-------|
| `gitnexus-db` | 2 | 0 | doc-list overindented + complex type `cycles.rs:116` |
| `gitnexus-search` | 2 | 0 | loop var indexing `mod.rs:198` + Default field assignment `mod.rs:488` |
| `gitnexus-ingest` | 4 | 2 | 2 complex types `config_inventory.rs` + auto: redundant closure + manual prefix strip |
| `gitnexus-mcp` | 2 | 1 | auto: collapsible if + clone vs from_ref |
| `gitnexus-cli` | 12 | 9 | auto: 4× `Iterator::last`, get(0), splitn, range, unused import, unused var ; **NON-auto: 2× too_many_arguments (8/7) sur `enrichment.rs:1275 + :2794`** |
| `gitnexus-desktop` | 5 | 4 | auto: 3× `Iterator::last`, unused Ordering, clone vs from_ref ; non-auto: 3× field assignment outside Default |

**Après PR #3** : **13 warnings uniques restent** (vérifié post-merge sim avec `cargo clippy --workspace --all-targets`), tous nécessitent une décision humaine (refactor de signature, extraction de type alias, ou usage de `Default::default { ..init }` syntax).

---

## Inventaire dépendances workspace (Cargo.toml)

### Vestigial / unused

| Dep | Statut | Action |
|-----|--------|--------|
| `bincode = "1"` | **Aucun crate ne l'importe.** Mention uniquement dans un commentaire de design rationale dans `snapshot.rs`. | ✅ **Supprimée dans PR #3** |

### Versions intéressantes pour bump

Versions courantes connues à janvier 2026. Sans `cargo outdated` installé, vérifier manuellement avant bump :

| Dep | Pinned | Bump candidat | Risque |
|-----|--------|---------------|--------|
| `axum = "0.7"` | 0.7 | 0.8 | **MOYEN** — breaking changes sur tuple ordering des handlers, state extraction. Touche `gitnexus-cli/src/commands/serve.rs`. |
| `tower-http = "0.6"` | 0.6 | 0.7? | Bas — mineur si axum 0.7 reste. À bumper avec axum. |
| `petgraph = "0.6"` | 0.6 | 0.7+ | **MOYEN** — API changes mineures. 1 crate seulement. |
| `lru = "0.12"` | 0.12 | 0.13+ | Bas. |
| `tokenizers = "0.20"` | 0.20 | 0.21? | Bas — vérifier compat ONNX. |
| `tree-sitter = "0.24"` | 0.24 | 0.25? | **HAUT** — Touche les 14 langages. À éviter sauf nécessité. |
| `kuzu = "0.11"` | 0.11 | 0.12? | **HAUT** — pin `cxx-build = "=1.0.138"` à respecter. À ne pas toucher sans test approfondi (LNK2019 sur Windows). |
| `zip = "2"` | 2 | 3? | **MOYEN** — Utilisé pour DOCX export. Test export OPC requis. |

### Pin contraints à conserver (NE PAS toucher)

- `cxx-build = "=1.0.138"` — pin kuzu compat (cf CLAUDE.md Gotchas, dtolnay/cxx#1507)
- `ort = "2.0.0-rc.12"` — vendored ndarray skew vs workspace 0.16, fonctionne via `Tensor::from_array((shape, vec))` tuple form

---

## MSRV et toolchain

- Pinned : **rust-version = "1.75"**, edition 2021
- Possibilité de bumper à 1.80+ pour gagner :
  - `let_chains` stabilisé en 1.88 — utile pour clean les `if let Some(x) = ... { if cond { ... } }`
  - `expect()` macro
  - lazy_cell stable
- **Verdict** : MSRV bump à 1.80 = peu d'impact code, sympa pour readability. Peut être un commit isolé.

---

## Plan en 3 vagues

### Vague A — Quick wins (~30-60 min, faible risque) — *partiellement faite ce soir*

- [x] **Supprimer bincode** (PR #3 commit `605e4c5`)
- [x] **Clippy auto-fixes safe** (PR #3 commit `cccb54a`)
- [ ] **Merge PR #2** (`feat/enrichment-config-exposure`) — 3 commits, exposition knobs config
- [ ] **Merge PR #3** (`chore/modernization-quickwins`)
- [ ] **MAJ etat_projets.md** : retirer ligne "merger feat/semantic-search" (déjà fait), retirer le item #2 "fix html_escape ✅"

### Vague B — Refactors ciblés (~3-6 h, moyen risque)

- [ ] **Resolve les 13 warnings clippy résiduels** — chaque crate, commit séparé
  - `enrichment.rs` `too_many_arguments` (8/7) sur 2 fns : extraire un struct Config (déjà partiellement amorcé avec `EnrichmentConfig`)
  - `cycles.rs` + `config_inventory.rs` : type aliases pour les retours `Vec<(String, Declaration)>` etc
  - Field assignment outside Default : remplacer `let mut x = T::default(); x.field = ...;` par `T { field: ..., ..Default::default() }`
- [ ] **MSRV bump 1.75 → 1.80** + adopter `let_chains` aux 5-10 endroits où il y a un `if let Some + if cond` imbriqué
- [ ] **Bump petgraph 0.6 → 0.7** (1 crate seulement — `gitnexus-core` ?)
- [ ] **Bump lru 0.12 → 0.13** (2 crates — vérifier API peek/get changes)
- [ ] **Installer cargo-outdated en pre-commit ou en CI** : `cargo install cargo-outdated` puis l'ajouter à `.github/workflows/` pour détecter les futurs drift

### Vague C — Modernisation architecturale (~1-3 jours, plus risqué)

- [ ] **Bump axum 0.7 → 0.8** + `tower-http 0.6 → 0.7`
  - Touche `serve.rs` (HTTP transport MCP)
  - Tester end-to-end : `gitnexus serve --http 8080` + curl vers JSON-RPC + SSE keep-alive
- [ ] **Évaluer la promotion `LlmConfig + load_llm_config` en `gitnexus-core::llm::config`** — déjà mentionné dans CLAUDE.md Gotchas comme "tech debt jusqu'à un 4ème caller". Le 4ème caller pourrait arriver avec sub-agents Phase F.
- [ ] **Choisir** : bincode 2.x avec Encode/Decode dérivés OU MessagePack via `rmp-serde` pour remplacer les snapshots JSON. Gain : 5-10× plus petit + 3-5× plus rapide. Coût : refonte snapshot.rs + migration script.
- [ ] **Audit architecture des 35 commands desktop** (`crates/gitnexus-desktop/src/commands/`) — déjà documenté dans memory `project_audit_2026_04` ?

---

## Ce que j'ai PAS pu faire ce soir (manque de tokens / temps)

- `cargo outdated` pas installé sur la machine — comparaison versions faite manuellement, peut être inexacte. Installer demain : `cargo install cargo-outdated`.
- `cargo audit` (vulnérabilités CVE) pas lancé — installer + lancer demain pour avoir l'inventaire sécurité.
- Bench post-PR #3 : pas relancé (pas indispensable pour des changements idiomatiques, mais une comparaison `cargo run --release -- query "..." --hybrid` avant/après serait propre).
- Tests d'intégration desktop (Tauri) : seuls `cargo test --workspace --lib` ont été lancés.

---

## Découvertes en cours d'audit

1. **`feat/semantic-search` est déjà mergée dans master** (`166ca44`). La branche locale `feat/semantic-search` n'a strictement rien de neuf vs master. Peut être supprimée localement avec `git branch -D feat/semantic-search` (non fait — décision Patrice). Aussi, la "TODO résiduelle" dans `next-steps.md` mentionnait :
   - Ajouter `/.omx` et `/.playwright-mcp` au .gitignore → **déjà fait** dans master
   - Cherry-picker docs/inject-architecture + livre/07-le-lab → ces fichiers ne sont plus présents sur la branche `chore/inject-architecture-doc` ? À vérifier.

2. **Master a beaucoup avancé depuis le 26 avril** (date du `next-steps.md`) — ajout de DOCX brand.json, Mermaid via Kroki, validate-docs CLI, big-context fallback, RAG chunk cap. La branche `feat/enrichment-config-exposure` (3 commits ce week-end) apporte la dernière brique de tunabilité enrichment.

3. **Clippy `EXIT=0` malgré 27 warnings** : pas de `-D warnings` dans `[lints]` du workspace. Décision pour Vague C : passer en deny-warnings une fois Vague B complétée.

---

## Commandes utiles pour reprendre demain

```bash
# Aller voir ce qui a été fait
gh pr view 2 --repo phuetz/gitnexus-rs
gh pr view 3 --repo phuetz/gitnexus-rs

# Re-vérifier l'état clippy
cargo clippy --workspace --all-targets 2>&1 | grep "^warning:" | wc -l

# Installer outils manquants
cargo install cargo-outdated cargo-audit

# Lancer les audits
cargo outdated --workspace --root-deps-only
cargo audit

# Si tout OK, merger les 2 PRs
gh pr merge 2 --merge
gh pr merge 3 --merge
```

---

*Rédigé par Claude Opus 4.7 (1M context) — nuit 03→04 mai 2026, MINISTAR.*
*Tokens utilisés ~ raisonnable, reste de marge pour quelques échanges si Patrice répond avant le reset 04h45.*
