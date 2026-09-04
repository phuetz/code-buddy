# Rapport DGM3 — Extension du banc de capacités de l'auto-amélioration (15 scénarios)

Date : 2026-09-04
Auteur : Antigravity (Mission DGM3)
Branche : `feat/dgm3-benchmark-15-2026-09-04`
Dépôt : `~/DEV/cb-dgm3-2026-09-04`

## 1. Contexte et Objectifs
Dans le cadre de la proposition 2 de l'audit DGM2 (`docs/reports/2026-09/AUDIT-DGM2.md`), le banc de capacités initialement limité à 3 scénarios minimaux (`npm-test-path-filter`, `esm-js-extension-imports`, `logger-not-console`) doit être étendu à 15 scénarios réels fondés sur les invariants documentés du dépôt (`CLAUDE.md`, `docs/agents.md`, `AGENTS.md`).

Objectifs opérationnels :
1. Extension à 15 scénarios réels, orthogonaux et non-triviaux, avec métadonnées (`id`, `query`, `expectIncludes` ≥ 2 termes, `description`, `source`).
2. Analyse et adaptation du proposeur (`src/agent/self-improvement/proposer.ts`) : audit du gabarit, proposition d'une voie opt-in LLM `CODEBUDDY_SELF_IMPROVE_PROPOSER=llm` via `resolveCommandProvider` sans régression ni activation par défaut.
3. Preuves complètes : tests unitaires dédiés rouge -> vert, suite vitest globale `tests/agent/self-improvement`, typecheck `tsc`, eslint, `git diff --check`, et démonstration CLI en environnement isolé.

## 2. Journal des modifications
- Initialisation du rapport avant inspection.
