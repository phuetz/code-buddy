# SPEC — Plafond de coût fleet (audit 2026-07-16)

Worktree git du repo **Code Buddy** (TypeScript strict ESM, Vitest). Branche : `fix/fleet-cost-cap`.

## Règles du repo (OBLIGATOIRES)
- Imports `.js` même depuis `.ts`. Pas de `any`. `logger` en prod. Tests sous `tests/`. FAIL-CLOSED.
- Opt-in de comportement raisonnable : les plafonds s'appliquent avec un DÉFAUT conservateur mais
  configurable ; ne casse pas les tests fleet existants (un budget par défaut généreux + surchargeable).
- Conventional Commits (`fix(security): …` / `feat(fleet): …`). Avant commit : `npm run typecheck` (0)
  + tests ciblés verts. Ne commite jamais SPEC-*.md ni node_modules. NE MODIFIE PAS CLAUDE.md.

## Problème
`src/fleet/peer-chat-bridge.ts` sert `peer.chat` et `peer.chat-session.continue` en appelant
`client.chat` (preuve audit : ~l.214-221 et ~l.455-462) **sans aucun plafond coût/tokens**, et
`src/fleet/cost-tracker.ts` (qui expose déjà `isWithinBudget()` + `charge()` + `getCostTracker()`)
est **mort : zéro importeur**. Un peer authentifié peut vider les crédits / la clé API du peer local
en boucle.

## Fix — câbler le cost-tracker + plafonds sur les appels entrants
1. **Plafond tokens par appel entrant** : dans `peer-chat-bridge.ts`, sur CHAQUE `client.chat` servi à
   un peer, imposer un `maxTokens` par défaut si l'appelant n'en fournit pas (ou plafonner celui fourni)
   via `CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL` (défaut raisonnable, ex. 4096). Le peer distant ne doit pas
   pouvoir demander une génération illimitée.
2. **Budget coût** (câbler `cost-tracker.ts`) :
   - AVANT le `client.chat` entrant : estimer le coût max (`estimatedUsd` depuis maxTokens × le tarif du
     modèle — réutilise le calcul de coût existant du repo si présent, sinon une table simple/常 heuristique
     conservatrice) et appeler `getCostTracker().isWithinBudget(estimatedUsd, budget)`. Si `!allowed` →
     **refuser** la requête peer avec une erreur claire (`FLEET_BUDGET_EXCEEDED` + reason), fail-closed.
   - APRÈS le `client.chat` : `getCostTracker().charge({ peer, provider, model, usd, tokensIn, tokensOut,
     ... })` avec le coût RÉEL calculé depuis l'usage retourné.
   - Le budget vient de `CostBudget` (défaut `DEFAULT_BUDGET` = maxDailyUsd 5 / maxSagaUsd 1) surchargeable
     par env : `CODEBUDDY_FLEET_MAX_DAILY_USD` / `CODEBUDDY_FLEET_MAX_SAGA_USD`. Un budget non configuré ⇒
     défauts conservateurs (PAS illimité).
3. Applique la même protection au chemin `peer.chat-session.continue` (même bridge) — c'est aussi un
   `client.chat` entrant.
4. Journalise (logger) chaque refus budget et chaque charge (montant, peer, restant).

## Tests exigés (`tests/fleet/peer-cost-cap.test.ts`)
- `maxTokens` par défaut appliqué : un `peer.chat` sans maxTokens ⇒ le `client.chat` reçoit le plafond
  (`CODEBUDDY_FLEET_MAX_TOKENS_PER_CALL`), un maxTokens excessif fourni ⇒ plafonné.
- Budget dépassé ⇒ la requête peer est **refusée** avant l'appel LLM (spy : `client.chat` non appelé),
  erreur `FLEET_BUDGET_EXCEEDED`.
- Budget OK ⇒ appel effectué PUIS `charge()` appelé avec le coût réel (tokens de l'usage mocké).
- `peer.chat-session.continue` protégé de la même façon.
- Sans configuration ⇒ défauts conservateurs actifs (pas de bypass).
- Transport/CostTracker injectés/mockés selon le pattern des tests fleet existants (pas de vrai LLM,
  pas de vrai WebSocket).

## Critères de done
- `npm run typecheck` : 0. Tests ciblés + `npm test -- tests/fleet` (existants) verts.
- Un peer ne peut plus provoquer de génération illimitée ni dépasser le budget.
- `docs/fleet/cost-caps.md` : court doc (env vars, défauts, comportement fail-closed). Commits Conventional.

## Interdits
- Ne touche pas au garde SSRF (autre vague). Ne modifie pas le format du ledger cost existant.
- Pas de budget illimité par défaut. Ne casse pas les bridges peer existants (peer.chat one-shot doit
  toujours fonctionner sous le budget).
