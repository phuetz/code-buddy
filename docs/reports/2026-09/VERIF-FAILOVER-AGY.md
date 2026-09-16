# Rapport de vérification croisée : repli de fournisseur (Grok) et correctif stall cible locale

- Date : 2026-09-06
- Branche : `fix/failover-handoff-2026-09-06`
- Auteur vérification : Antigravity (AGY)
- Mission : AGY-VERIF-FAILOVER

## 1. Contexte et objectifs

Vérification croisée du lot de 7 commits de Grok (`fix/failover-handoff-2026-09-06`) :
- Handoff de contexte vers modèle local / fenêtre étroite (≤ 32 k).
- Pruning des outils (≤ 6 outils, tool_search, clôture des tool_calls orphelins).
- Saut préventif des cibles trop petites avec journal exact.
- Diagnostic d'épuisement (`ProviderFailoverExhaustedError`) préservant l'erreur 429 originelle et chaque tentative.
- Annonces unifiées (PWA + compagnon) et alias déprécié `CODEBUDDY_LLM_FAILOVER`.
- Correctif du calcul adaptatif du budget premier token lorsque la cible effective du repli est locale.

## 2. Tableau de vérification

*(En cours d'inspection et de tests)*

## 3. Clôture par le pilote (session agy expirée pendant `npm run build`)

Correctif du point 5 laissé non commité par agy, repris ici : `CodeBuddyClient` mémorise la cible active de repli (`activeFallback`, `getCurrentProvider()`, `getCurrentBaseUrl()`, `isEffectiveTargetLocal()`), `resolveFirstTokenStallTimeoutMs(tokens, env, { targetIsLocal })` et `withStallGuard` accepte un budget de premier token PARESSEUX (fonction) évalué au moment de l'attente — donc après la bascule. Non-régression : origine cloud sans bascule ⇒ 120 s (test conservé).

Preuves pilote : `npx vitest run tests/utils/stream-stall-guard.test.ts tests/codebuddy/provider-failover.test.ts tests/codebuddy/provider-handoff.test.ts tests/agent/execution` → 14 fichiers / 232 tests verts ; `npx tsc --noEmit -p tsconfig.json` → 0. Essai réel (chatgpt 429 → ollama 27B avec outils) lancé en arrière-plan, résultat dans `_qa/live/live-27b.log`.
