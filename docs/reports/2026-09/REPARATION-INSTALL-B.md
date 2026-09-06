# Rapport de réparation AGY-INSTALL-B — Audit Installateur Inconnu

- Date : 2026-09-06
- Branche : `fix/install-b-2026-09-06`
- Worktree : `~/DEV/cb-install-b-2026-09-06`

## 1. Objectifs de la mission
Fermeture des points B relevés dans `docs/audits/2026-09-06-audit-installateur-inconnu-opus.md` :
- B-2 : Run figé `[RUNNING]` et trajectoire vide (tokens/durée à 0).
- B-7 : Traces d'erreurs et chemins absolus exposés par défaut côté serveur.
- B-5 : `buddy sensory status` sans URL testée ni option `--server-url` / `CODEBUDDY_SERVER_URL`.
- B-4 : Recommandation `npm install better-sqlite3` inadaptée en global dans `buddy doctor`.
- B-8 + B-3 (doc) : Documentation du jeton d'authentification (`buddy fleet token` / `buddy token`), `--allow-scripts` et dépendances natives.

## 2. Journal d'avancement
*(En cours d'initialisation)*

## 3. Clôture par le pilote (session agy expirée pendant les preuves finales)

Commits agy : `01ed8d75f` (B-2 `endedAt` + métriques), `a17fcc0bf` (B-7 `details.stack` masqué dès que l'auth est active), `16ee82923` (B-5 URL testée + `--server-url`/`CODEBUDDY_SERVER_URL`), `f717d681b` (B-4 conseil SQLite selon le mode d'installation), `e5c188fb5` (B-8/B-3 doc jeton, `buddy token`, `--allow-scripts`). Reliquat non commité repris ici : nettoyage lint (imports inutilisés, échappement de regex).

Preuves relancées par le pilote : `npx tsc --noEmit -p tsconfig.json` → 0 ; `npx eslint --quiet` sur les fichiers touchés → 0 ; `npx vitest run tests/observability tests/doctor tests/server/error-handler*.test.ts tests/server/middleware tests/commands/sensory*.test.ts tests/cli` → 54 fichiers / 330 tests verts (HOME isolé `_qa/pilot/home`).
