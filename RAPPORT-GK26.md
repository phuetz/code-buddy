# RAPPORT-GK26 — La porte de revue des diffs (`CODEBUDDY_DIFF_REVIEW`) en vrai

Mission : exercer **pour de vrai** la porte de revue des diffs (`CODEBUDDY_DIFF_REVIEW=static|full`, boucle de révision) dans un dépôt jouet, via l'agent headless (Ollama) et les cinq surfaces d'écriture.

- Clone autorisé : `/home/patrice/DEV/cb-repar-jumeaux-5-2026-09-02` uniquement
- Branche : `fix/gk26-diff-review-reel-2026-09-03`
- HEAD au départ : `5e7639b42` (`Merge GK22 (skills en vrai : import, quarantaine, exchange signé, curation) into codex/audit-systeme-nerveux-2026-09-01`)
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection de `src/review/` (loi mission)
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts` (le lanceur `~/.local/bin/buddy` pointe vers `~/code-buddy`, interdit)
- HOME temporaire : `_qa/gk26/home`. Aucune écriture dans le vrai `~/.codebuddy`.
- Relecteur `full` : Ollama local `qwen3.8:27b` (aucune API payante)

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local uniquement.
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Original `~/code-buddy` interdit. HOME temporaire dans le clone seulement.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `5e7639b42`. Arbre propre. Réservation du chantier dans `docs/FABLE5-CODEX-COORDINATION.md`. Inspection de `src/review/` **pas encore commencée**.

## Scénarios à exercer (contrat mission)

| # | Mode | Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|---|---|
| S1 | static | diff sain via `str_replace` | appliqué transactionnellement | *à mesurer* | | |
| S2 | static | `multi_edit` sain | appliqué | *à mesurer* | | |
| S3 | static | `apply_patch` sain | appliqué (pas partiel) | *à mesurer* | | |
| S4 | static | `create_file` / `write_file` sain | appliqué | *à mesurer* | | |
| S5 | static | chemin hors base | rejeté fail-closed | *à mesurer* | | |
| S6 | static | TOCTOU : fichier modifié entre proposition et application | rejeté | *à mesurer* | | |
| S7 | full | relecteur annote/rejette un diff qui supprime un test | non appliqué ; annotations en erreur | *à mesurer* | | |
| S8 | full + revise | `CODEBUDDY_DIFF_REVIEW_REVISE=true` : révision re-passe la porte | journal JSONL avec lignée | *à mesurer* | | |
| S9 | — | `rollbackAppliedDiff()` | état restauré | *à mesurer* | | |
| S10 | full | relecteur mort | fail-closed, pas « accepté » | *à mesurer* | | |

## Défauts (rouge → vert)

*Aucun encore : inspection non commencée.*

## Preuves

*À coller après les parcours réels.*
