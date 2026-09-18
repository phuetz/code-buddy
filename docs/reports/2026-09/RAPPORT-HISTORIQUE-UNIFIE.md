# RAPPORT — Historique unifié CLI / Cowork / mobile

**Date :** 2026-09-17 / 18  
**Agent :** Grok 4.6  
**Worktree :** `worktree cb-recents-2026-09-17`  
**Branche :** `feat/recents-2026-09-17` (base `origin/main` `b5c50c189`)  
**Consignes :** pas de git commit, pas de `rm -rf`, ports jetables, HOME QA `_qa/historique-unifie/`.

## Objectif

Une liste « Récents » cohérente sur CLI, Cowork et mobile ; reprise d’une session quelle que soit son origine. Une session Cowork visible **sans export manuel**.

## Livrable

`Partage/20260917-cowork-comparaison/HISTORIQUE-UNIFIE.md`  
Traces : `Partage/20260917-cowork-comparaison/historique-unifie-traces/`.

## Choix

Lecture SQLite Cowork en lecture seule + cache d’index métadonnées (`version: 1`, reconstructible) + handoff P6 **lazy** à la reprise. Sync métadonnées au `saveSession` Cowork (fail-open). Pas de copie des messages dans l’index.

## Vérifications

- Vitest ciblé : 54/54 (index 4, origine catalogue 1, CLI 8, mobile reprise 5, handoff 3, PWA 33).
- ESLint `--quiet` 0 sur les `.ts` du lot.
- Démo : `buddy sessions list` (cli+cowork), `buddy sessions resume cowork-gui-demo` (handoff 0600), import `cli-import:` dédupliqué, mobile port 44173 liste les deux origines, 401 sans JWT.
- Ports 3000/3001/3055/3056 inchangés.

## État

Lot implémenté, **non commité**.
