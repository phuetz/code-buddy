# RAPPORT — Corrections après contre-revue AGY (session partagée)

**Date :** 2026-09-18  
**Agent :** Grok 4.6  
**Worktree :** `worktree cb-cowork-shared-2026-09-17`  
**Branche :** `feat/cowork-shared-2026-09-17`  
**Base :** `origin/main` `b5c50c189`  
**Source :** `REVUE-AGY-deploy.md` (Antigravity, 18/09/2026)  
**Consignes :** pas de commit, pas de `rm -rf`, pas de publication, ports jetables, rien hors worktree.

## Objectif

Traiter chaque point de la contre-revue indépendante, par gravité : corriger ou démontrer infondé (commande + sortie). Mettre à jour `RAPPORT-SESSION-PARTAGEE.md` § Corrections après contre-revue.

## Verdict

Les six corrections demandées par AGY étaient **fondées**. Toutes sont corrigées et couvertes par un test. Aucun test affaibli, aucune assertion retirée.

## Points

| # | Gravité AGY | Décision | Test de couverture |
|---|---|---|---|
| 1 | Split-brain HTTP (`userId` dans la clé agent) | Corrigé : principal `shared` + `replaceHistory` | `shared-session-llm-context.test.ts` (2 cas) + `http-agent-sessions.test.ts` `replaceHistory reseeds…` |
| 2 | WS hydraté une seule fois | Corrigé : resync si `messageSeq` a avancé | `shared-session.test.ts` `rehydrates a WS agent…` |
| 3 | `grantResumeAccess` hors mutex | Corrigé : `enqueueSessionTurn` | `shared-session.test.ts` `serializes grant behind an in-flight continue…` |
| 4 | `chat` sans `sessionId` orphelin | Corrigé : fallback `state.boundSessionId` | `shared-session.test.ts` `uses the attached boundSessionId…` |
| 5 | Traces démo sous `~/Videos/Partage` | Corrigé : `_qa/session-partagee/traces` | inspection `demo.ts` (plus de `os.homedir`) |
| 6 | Runner réel jamais exercé | Corrigé : suite ci-dessus sans mock du runner HTTP | fichiers listés |

## Preuve

Vitest 7 fichiers / **75/75**. ESLint `--quiet` 0. `tsc --noEmit` : 2 erreurs préexistantes `companion-core` uniquement.

Rapport d’origine mis à jour : `docs/reports/2026-09/RAPPORT-SESSION-PARTAGEE.md` § Corrections après contre-revue.

Aucun commit.
