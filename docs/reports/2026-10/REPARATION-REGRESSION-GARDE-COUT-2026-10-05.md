# REPARATION — Régression banc 2.3.0 : `max_cost` ne coupe plus la boucle

- **Mission** : `regression-cout-openrouter`
- **Agent** : Grok 4.7
- **Branche** : `fix/cout-openrouter-2026-10-04`
- **Worktree** : `/data/patrice/DEV/cb-cout-openrouter-2026-10-04`
- **Date** : 2026-10-05
- **HOME isolé** : `_qa/regression-cout-openrouter/home`
- **Correctif vérifié** : `168ecbb2c2dc411bff6db85cef64a880d361671e`
- **Aucun push**

## Verdict

Vraie régression du produit, pas du test. Le garde-fou `max_cost` doit de nouveau couper comme sur `origin/main`. Le test n'a pas été modifié.

## Cause prouvée

Le banc (Sonnet, `20261005-sonnet-banc-230`) avait raison sur le symptôme et sur la branche, pas encore sur le mécanisme.

Rejeu du filtre `max_cost = 0.0001` dans `tests/agent/middleware-toml-loop.test.ts` :

| Révision | Résultat |
|---|---|
| `origin/main` `70bcab004f82` (worktree `cb-230-main-ref-2026-10-05`) | 3 passés |
| tête de branche avant correctif `fd771c9a754cb7923328e560af5773adfd2fc01d` | 3 échecs, `expected 1` / `received 4` |
| après correctif `168ecbb2c2dc411bff6db85cef64a880d361671e` | 8/8 sur le fichier entier |

Le serveur factice du test écoute sur `http://127.0.0.1:<port>/v1` et le modèle annoncé est `grok-3-latest` (tarif catalogue 3 $ / 15 $ par million).

Cette branche a changé `CodeBuddyClient.isEffectiveTargetLocal()` : il ne consulte plus `isLocalLlmProvider()` (fournisseur / `OLLAMA_HOST`), il appelle `isLocalRequestUrl(baseURL)`. Cette fonction répond vrai pour **tout** hôte de bouclage (`127.0.0.1`, `localhost`, `::1`).

`CodeBuddyAgent.estimateSessionCostAfter` et `recordSessionCost` passent ce booléen comme `localTarget`. `isKnownZeroTariff` en faisait un tarif connu à 0 $, **avant** la table de prix. Le contrôle d'avant l'outil (`estimateSessionCostLimitReached`, message « Stopping before tool execution ») voyait donc 0 $, qui n'atteint jamais `max_cost = 0.0001`. La boucle continuait jusqu'à `max_turns = 4` : exactement 4 appels.

Ce n'est pas limité au test. Un proxy local, un tunnel ou un double de test qui sert un modèle au catalogue subissait le même aveuglement du plafond.

## Correctif

`localTarget` ne veut plus dire « tarif 0 $ ». Il confirme seulement que la socket est locale. Le 0 $ reste réservé à un slug déjà traité comme runtime local (`llama…`, `ollama/…`, etc.) quand le contexte ne dit pas « fournisseur payant ». Un modèle au catalogue, même joint par `127.0.0.1`, reprend son tarif : le plafond peut couper.

Fichiers : `src/utils/cost-tracker.ts` (`isKnownZeroTariff`), `src/utils/token-display.ts` (`estimateCost`). `isEffectiveTargetLocal()` n'est pas retouché : le délai du premier jeton et le prompt compact des sockets locales restent ceux de la branche.

Conservé : OpenRouter `deepseek/…` payant, ChatGPT OAuth à 0 $, `llama3.2` en bouclage à 0 $, facture `usage.cost` prioritaire. Preuve unitaire ajoutée : `grok-3-latest` sur `http://127.0.0.1:9/v1` coûte plus de 0,0001 $.

Conséquence assumée, identique à `main` pour ces slugs : un modèle local dont le nom n'est pas dans `LOCAL_NO_COST_MODEL_IDS` est estimé au tarif inconnu. Un `max_cost` minuscule peut alors couper une session locale gratuite. Non rejoué contre un vrai Ollama.

## Barrière

`tests/middleware` n'existe pas. Les tests de middleware sont sous `tests/agent`.

```
npx vitest run tests/agent tests/mcp --reporter=verbose
 Test Files  272 passed (272)
      Tests  3272 passed (3272)
   Duration  115.29s
```

Exit code 0.

```
npm run typecheck
```

Exit code 0 (`tsc --noEmit`, `tsconfig.gpuNode-identity`, `packages/companion-core`).

En plus, parce que le calcul de coût n'est pas dans ces deux répertoires : `tests/unit/cost-tracker.test.ts`, `tests/utils/cost-chatgpt-subscription.test.ts`, `tests/utils/cost-openrouter-paid.test.ts` — 3 fichiers, 106 tests, exit 0.

## Ce que je n'ai pas pu vérifier

- La suite Vitest complète (~42 000 tests), Cowork, Windows, macOS, la CI.
- Un appel réel `buddy -p` vers OpenRouter ou Ollama.
- Une session locale dont le slug n'est pas dans la liste « gratuit ».
- Le commit documentaire qui suit le correctif ne change pas le produit ; la barrière a tourné sur `168ecbb2c2dc411bff6db85cef64a880d361671e`.

## Mesure des outils

### LM Resizer

`lm-resizer stats --json` dans le HOME isolé répond `entries: 0` et `exec_history.commands: 0`. Ce n'est pas ce que `exec` a écrit. Le journal réel est `_qa/regression-cout-openrouter/home/.local/state/lm-resizer/exec-history.jsonl` :

| Commande | Brut | Réduit | Filtre |
|---|---:|---:|---|
| vitest `max_cost` sur la branche (rouge) | 4 446 | 4 446 | `lossless:npm-test` |
| vitest coût + boucle après correctif | 5 217 | 5 217 | `lossless:npm-test` |
| vitest coût unitaire (106) | 16 068 | 16 068 | `lossless:npm-test` |
| `npm run typecheck` | 341 | 211 | `native:packages` |
| vitest `tests/agent` `tests/mcp` | 550 068 | 550 068 | `lossless:npm-test` |
| **Total HOME isolé** | **576 140** | **576 010** | 130 octets économisés |

Rejeu `origin/main` (autre HOME, `_qa/regression-cout-openrouter/home-main`) : 2 171 → 2 171, filtre `lossless:npm-test`.

Aucune vue réduite n'a caché une ligne utile : les sorties Vitest n'ont pas été réduites. Le pied « 3 failed / expected 4 to be 1 » puis « 272 passed / 3272 passed » était lisible. `[tee:e458bf95fa9a]` n'est apparu que pour le typecheck ; `tee read` n'a pas été nécessaire.

**Défaut.** `lm-resizer exec -- npx vitest run tests/agent tests/mcp --reporter=verbose` (HOME isolé, `XDG_STATE_HOME` sous ce HOME) enregistre 550 068 → 550 068, n'imprime pas `[tee:…]`, alors que le brut est bien dans `$HOME/.local/state/lm-resizer/tee/ece8ed4e6f7e1f07c48de6b17d5c70cd39ad0786b77a823b3842ae4be21603e1.log`. Dans le même HOME, `lm-resizer stats --json` annonce zéro commande.

### Code Explorer

Index déjà présent, **périmé** : commit indexé `9f3e5afaf`, tête alors `fd771c9a`. Pas de réindexation (l'analyse précédente a duré 234 s).

4 requêtes (`query`) + 1 `status`.

- La requête `CostLimitMiddleware` a donné `src/agent/middleware/cost-limit.ts` : le fichier lu ensuite était le bon, une recherche à l'aveugle a été évitée. Elle n'expliquait pas l'échec.
- La requête `calculateCostExtended` citait les lignes 294-327. Sur la tête courante, ces lignes sont le constructeur de `CostTracker`, plus la méthode. Réponse fausse à cause de l'index périmé. Il a fallu un `grep`.
- La première requête (« where does max_cost stop… ») n'a renvoyé que des fonctions du test, pas le garde-fou.

**Défaut reproductible** : `code-explorer status` (avertissement d'index périmé) puis `code-explorer query "calculateCostExtended resolveCostBilling recordUsage"`. La ligne annoncée pour `calculateCostExtended` ne correspond plus au fichier.
