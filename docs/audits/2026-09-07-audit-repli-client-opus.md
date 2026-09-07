# Audit adversarial — repli de fournisseur vers modèle local (cœur du client)

- Date : 2026-09-07
- Auditeur : Claude Opus (contexte frais, relecture adversariale)
- Worktree : `~/DEV/cb-audit-failover-2026-09-07`, branche `audit/failover-client-opus-2026-09-07`
- HEAD : `c94033686`
- Cible : `src/codebuddy/client.ts`, `src/codebuddy/provider-handoff.ts`,
  `src/providers/provider-failover-policy.ts`, `src/providers/provider-health.ts`,
  `src/utils/stream-stall-guard.ts`, `src/agent/execution/agent-executor.ts`
- Lot audité : `9fe7669d5` (élagage des outils au handoff), `9b28e4ef7` (pré-filtre par fenêtre),
  `a9d7eeabc` (`ProviderFailoverExhaustedError`), `5b46f3772` (annonce), `3ae522b9c` (alias),
  `68e40ced9` (cap 6 outils), `e738178a5` (cible effective locale)

> Rapport écrit au fil de l'eau (session à budget de temps contraint). Les sections
> non encore remplies portent la mention TRAVAIL EN COURS.

## 1. Byte-identique sans variable d'environnement

TRAVAIL EN COURS

## 2. État partagé (`activeFallback`, concurrence)

TRAVAIL EN COURS

## 3. Élagage des outils et cohérence du transcript

TRAVAIL EN COURS

## 4. Diagnostic et fuite de secrets

TRAVAIL EN COURS

## 5. Alias `CODEBUDDY_LLM_FAILOVER`

TRAVAIL EN COURS

## 6. Suites (vitest, tsc)

TRAVAIL EN COURS

## Tableau de synthèse

TRAVAIL EN COURS

## Bilan

TRAVAIL EN COURS

VERDICT: TRAVAIL EN COURS
