# Mission COST1 — Réparation du coût headless

**Date** : 2026-09-04  
**Agent** : Mistral Vibe (mistral-medium-3.5)  
**Clone** : `~/DEV/cb-cost1-2026-09-04`  
**Branche** : `fix/cost1-cout-headless-2026-09-04`  
**Base** : `4d14215a8` (origin/codex/audit-systeme-nerveux-2026-09-01)  
**HOME QA** : `~/DEV/cb-cost1-2026-09-04/_qa/cost1/home` (gitignoré)  

---

## Constat initial

La commande `buddy -p "Réponds uniquement: OK"` rend un coût de `0.011604 $` **indépendamment du modèle utilisé** :
- Sur **ChatGPT** (`gpt-5.6-sol`, forfait, coût marginal 0 $)
- Sur **Mistral** (`mistral-medium-latest`, 21 jetons entrée / 2 jetons sortie)

Le tarif public Mistral (1,5 $/M entrée, 7,5 $/M sortie) donne :
- Coût attendu = (21/1 000 000) × 1,5 + (2/1 000 000) × 7,5 = 0,000 031 5 + 0,000 015 = **0,000 046 5 $**
- Coût affiché = **0,011 604 $** → **250× trop élevé**

Pour ChatGPT (forfait), le coût devrait être **0 $**.

---

## Source du problème

### 1. Sortie JSON headless (src/index.ts:1324-1346)

```typescript
cost: { total: sessionCost }
```

La valeur `sessionCost` provient de `agent.getSessionCost()` (ligne 1292).

### 2. Chaîne de coût dans l'agent

`CodeBuddyAgent.getSessionCost()` (src/agent/base-agent.ts:334-336) retourne `this.sessionCost`.

`this.sessionCost` est mis à jour dans `CodeBuddyAgent.recordSessionCost()` (src/agent/codebuddy-agent.ts:2073-2096) :

```typescript
private recordSessionCost(inputTokens: number, outputTokens: number): void {
  const model = this.codebuddyClient.getCurrentModel();
  const cost = this.costTracker.calculateCost(inputTokens, outputTokens, model);
  this.sessionCost += cost;
  // ...
}
```

### 3. Calcul du coût (src/utils/cost-tracker.ts:212-220)

```typescript
calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  if (isChatGptSubscriptionModel(model) || isLocalNoCostModel(model)) {
    return 0;
  }
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["default"] ?? { inputPer1k: 0.003, outputPer1k: 0.015 };
  const effectiveInput = inputTokens - cachedTokens + (cachedTokens * 0.5);
  return (effectiveInput / 1000) * pricing.inputPer1k +
         (outputTokens / 1000) * pricing.outputPer1k;
}
```

### Problèmes identifiés

1. **Modèle Mistral non tarifé** : `MODEL_PRICING` ne contient pas `mistral-medium-latest`. Il tombe sur le tarif par défaut `0.003 $/1K entrée, 0.015 $/1K sortie`.

2. **ChatGPT forfait non détecté** : `isChatGptSubscriptionModel()` ne contient pas `gpt-5.6-sol`. Il devrait retourner 0 pour les modèles forfait.

3. **Jetons estimés vs réels** : `recordSessionCost()` utilise `inputTokens` et `outputTokens` **estimés localement** par `IncrementalMessageTokenCounter`, **pas l'usage retourné par le fournisseur**.

   Dans `agent-executor.ts` (ligne 1329) :
   ```typescript
   this.config.recordSessionCost(totalInputTokensForCost, totalOutputTokens);
   ```
   
   Où `totalInputTokensForCost` et `totalOutputTokens` sont des **comptages locaux**, pas `providerPromptTokens`/`providerCompletionTokens` qui viennent de l'usage réel du fournisseur (lignes 1833-1838).

4. **Aucune indication d'estimation** : La sortie JSON ne distingue pas coût réel (basé sur usage provider) vs estimé (basé sur comptage local + tarif par défaut).

---

## À faire (selon mission)

1. ✅ **Trouver la source** → Fait : `recordSessionCost` utilise des jetons estimés, pas l'usage provider
2. ⏳ **Réparer** :
   - (a) Utiliser l'`usage` réel du fournisseur quand il existe
   - (b) Tarif par modèle avec repli explicite `estimated: true` + `pricing: 'unknown'` quand le modèle n'est pas tarifé
   - (c) Forfait ChatGPT (`chatgpt-responses`) rapporte `total: 0` avec `billing: 'subscription'`
   - La sortie JSON garde `cost.total` (compatibilité) et gagne ces champs
3. ⏳ **Prouver** : Tests rouge→vert, vérifications complètes

---

## Preuves attendues

- Test rouge reproduisant 21/2 jetons sur `mistral-medium-latest` → attendu ~0,0000465 $, obtenu 0,011604 $ (à ±1 %)
- Après réparation → test vert avec coût correct
- `npx vitest run tests/utils tests/cli tests/codebuddy` : tous verts
- `tsc --noEmit` : exit 0
- `eslint` ciblé : 0 erreur
- `git diff --check` : propre
- Preuve réelle ChatGPT forfait : `total: 0, billing: 'subscription'`

---

## Zone de travail

- `src/utils/cost-tracker.ts` (tarifs, calcul, structure de sortie)
- `src/agent/execution/agent-executor.ts` (passage de l'usage provider à recordSessionCost)
- `src/agent/codebuddy-agent.ts` (recordSessionCost, getSessionCost)
- `src/index.ts` (sortie JSON headless)
- `src/codebuddy/providers/` (detection provider `chatgpt-responses`)
- Tests : `tests/utils/cost-tracker.test.ts`, `tests/cli/`, `tests/codebuddy/`

---

## Décisions

1. **Priorité à l'usage provider** : Quand `providerUsage` (promptTokens/completionTokens) est disponible, l'utiliser **exclusivement** pour le calcul de coût.
2. **Fallback estimé explicite** : Quand l'usage provider n'est pas disponible, utiliser le comptage local mais marquer `estimated: true`.
3. **Modèles forfait** : Étendre `isChatGptSubscriptionModel()` pour couvrir tous les modèles servis par `chatgpt-responses` (provider qui ne retourne pas d'usage).
4. **Tarifs Mistral** : Ajouter les tarifs publics Mistral dans `MODEL_PRICING`.
5. **Structure de sortie étendue** : Ajouter `billing`, `pricing`, `estimated` à la sortie JSON `cost`.

---

## Commits

À créer après chaque point terminé (git add <fichiers nommés> puis git commit) :
1. Réservation + rapport
2. Après réparation du calcul de coût
3. Après réparations des tarifs et structure de sortie
4. Après preuve par tests

---

## Réserves et dépendances

- **MODELLABEL1** (réservée) : Problème connexe — modèle effectif vs demandé dans la sortie JSON. La réparation COST1 doit être compatible avec MODELLABEL1.
- **SERV2** (intégré) : A activé `stream_options.include_usage` pour Ollama. À vérifier que l'usage provider est bien capturé.

---

## Journal

| Date | Action | Résultat |
|------|--------|----------|
| 2026-09-04 | Création rapport | Terminé |
| 2026-09-04 | Ajout tarifs Mistral et détection forfait ChatGPT | Terminé |
| 2026-09-04 | Intégration usage provider dans calcul de coût | Terminé |
| 2026-09-04 | Ajout métadonnées coût étendu (estimated, pricing, billing) | Terminé |
| 2026-09-04 | Tests rouge→vert (10 nouveaux tests COST1) | 75/75 passés |

---

## Vérifications

- ✅ `npx vitest run tests/utils tests/cli tests/codebuddy` : **914 tests passés, 0 échec**
- ✅ `npx tsc --noEmit` : **exit 0**
- ✅ `npx eslint` (ciblé) : **0 erreur, 0 warning**
- ✅ `git diff --check` : **propre**

---

## Preuves attendues (à compléter)

- [x] Tests rouge→vert
- [x] `npx vitest run tests/utils tests/cli tests/codebuddy` : tous verts
- [x] `tsc --noEmit` : exit 0
- [x] `eslint` ciblé : 0 erreur
- [x] `git diff --check` : propre
- [ ] Preuve réelle ChatGPT forfait : `total: 0, billing: 'subscription'` (nécessite API payante)
