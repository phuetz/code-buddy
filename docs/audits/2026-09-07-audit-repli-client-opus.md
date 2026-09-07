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

## 1. Byte-identique sans variable d'environnement — TIENT

Preuve par lecture, chemin par chemin (drapeau absent ⇒ `isDeclaredProviderFallbackEnabled()`
retourne `false` sans aucune I/O : elle ne lit que `process.env`,
`src/providers/provider-failover-policy.ts:46-52`).

| Point de couture | Ligne | Comportement drapeau absent |
| --- | --- | --- |
| `chat()` porte d'entrée | `src/codebuddy/client.ts:754` | `usesDeclaredFailover(opts) && isProviderUnavailable(...)` — le `&&` court-circuite, `isProviderUnavailable` (donc la lecture de `provider-health.json`) n'est **jamais** appelée |
| `chat()` retour au primaire | `src/codebuddy/client.ts:763` → `:563` | `maybeReturnToOriginal` sort à la première ligne (`if (!this.usesDeclaredFailover(opts) …) return;`) avant tout accès disque |
| `chat()` catch | `src/codebuddy/client.ts:774-777` | tombe sur `chatWithProviderFallback` — le chemin Hermes historique, inchangé par le lot |
| `chatStream()` porte d'entrée | `src/codebuddy/client.ts:1053` | même court-circuit |
| `chatStream()` retour au primaire | `src/codebuddy/client.ts:1064` | même sortie anticipée |
| `chatStream()` catch | `src/codebuddy/client.ts:1085-1089` | tombe sur `chatStreamWithProviderFallback`, inchangé |
| Élagage des outils | `src/codebuddy/provider-handoff.ts:283` | `prepareFailoverHandoff` n'a que deux appelants, `client.ts:967` et `client.ts:1253`, tous deux **à l'intérieur** de `chat*WithDeclaredFailover` |
| Sonde réseau / registre | `src/codebuddy/client.ts:903` | `this.defaultDeclaredChain ??= resolveDefaultFailoverProviders(...)` est paresseux et n'est atteint que depuis `listDeclaredFailoverCandidates`, elle-même appelée uniquement depuis les deux méthodes de repli. `buildActiveLlmRegistry` (import dynamique) n'est donc jamais chargé |
| Cible effective locale | `src/codebuddy/client.ts:686-693` | `activeFallback` est `undefined`, puis `usesDeclaredFailover()` court-circuite ⇒ retombe sur `isLocalLlmProvider()`, exactement l'expression d'avant le lot |
| Avertissement d'alias | `src/providers/provider-failover-policy.ts:36-38` | `warnLegacyLlmFailoverAlias` sort si le legacy n'est pas vrai |

`npx tsc --noEmit -p tsconfig.json` : **exit 0**.

Conclusion : aucun nouveau chemin, aucune sonde, aucune lecture de
`~/.codebuddy/provider-health.json` quand les deux variables sont absentes. **TIENT.**

### Observation adjacente (drapeau ON seulement) — C

`agent-executor.ts:1658-1660` rappelle `client.isEffectiveTargetLocal()` à **chaque** tour de
stream. Drapeau ON, cette fonction fait un `readProviderHealthSnapshot()` →
`readFileSync` **synchrone** sur `~/.codebuddy/provider-health.json`
(`src/providers/provider-health.ts:162-171`, `:196`). Une I/O bloquante par tour sur le
thread principal : négligeable en volume, mais c'est le genre de coût qui se paie en
latence perçue sur un poste chargé. Aucun cache mémoire n'est interposé. Sans gravité,
à noter.

## 2. État partagé (`activeFallback`, concurrence)

TRAVAIL EN COURS

## 3. Élagage des outils et cohérence du transcript

TRAVAIL EN COURS

## 4. Diagnostic et fuite de secrets

TRAVAIL EN COURS

## 5. Alias `CODEBUDDY_LLM_FAILOVER` — TROU B

`src/providers/provider-failover-policy.ts:46-52` :

```ts
export function isDeclaredProviderFallbackEnabled(env = process.env): boolean {
  const declared = isTruthyEnv(env.CODEBUDDY_PROVIDER_FALLBACK);
  const legacy = isTruthyEnv(env.CODEBUDDY_LLM_FAILOVER);
  if (legacy && !declared) warnLegacyLlmFailoverAlias(env);
  return declared || legacy;
}
```

- **`CODEBUDDY_LLM_FAILOVER=true` seul ⇒ même chemin.** Confirmé : c'est un OU strict, un
  seul point de décision, consommé par le seul `usesDeclaredFailover` (`client.ts:550-552`).
  Une dépréciation est journalisée une fois (verrou `legacyAliasWarned`, réinitialisable
  pour les tests). **TIENT.**
- **Valeurs contradictoires.** Il n'y a **pas** de précédence : c'est un OU. Donc
  `CODEBUDDY_PROVIDER_FALLBACK=false` + `CODEBUDDY_LLM_FAILOVER=true` ⇒ **le repli est
  ACTIF**, et le legacy l'emporte silencieusement sur le nom canonique posé à `false`
  (l'avertissement de dépréciation ne se déclenche même pas dans ce cas, puisque
  `declared` est `false` ⇒ `legacy && !declared` est vrai… si, il se déclenche ; mais il
  dit « utilisez `CODEBUDDY_PROVIDER_FALLBACK=true` », pas « votre `false` est ignoré »).
- Cause : `isTruthyEnv` n'a que deux états (vrai / pas-vrai). `=false` n'est pas un
  « éteindre », c'est un « pas allumé ». Il n'existe donc **aucun coupe-circuit par
  variable d'environnement** : le seul vrai coupe-circuit est l'option de code
  `opts.disableProviderFallback` (`client.ts:551`), inaccessible à l'exploitant.
- La documentation du lot (`CLAUDE.md`, en-tête de `provider-failover-policy.ts`) décrit
  l'alias comme « a deprecated alias of the same flag (one path) » — vrai, mais elle ne
  dit nulle part qu'un `CODEBUDDY_PROVIDER_FALLBACK=false` explicite est sans effet face à
  un ancien `CODEBUDDY_LLM_FAILOVER=true` resté dans un `.bashrc` ou une unité systemd.

**Gravité B** (pas de perte de données ni de fuite ; surprise d'exploitation sur un poste
où l'ancien nom traîne, et impossibilité de désarmer sans éditer l'environnement).
**Correctif suggéré** (hors périmètre de cette session) : rendre `CODEBUDDY_PROVIDER_FALLBACK`
tri-état — une valeur explicitement fausse (`false`/`0`/`off`) désarme, y compris l'alias.

## 6. Suites (vitest, tsc)

TRAVAIL EN COURS

## Tableau de synthèse

TRAVAIL EN COURS

## Bilan

TRAVAIL EN COURS

VERDICT: TRAVAIL EN COURS
