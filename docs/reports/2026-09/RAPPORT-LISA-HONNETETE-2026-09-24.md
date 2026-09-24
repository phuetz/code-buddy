# Rapport de mission — Lisa, honnêteté d'abord (étape 1 du plan d'autonomie)

> Ouvert le 24/09/2026 avant toute inspection, selon la règle du dépôt.
> Branche `fix/lisa-honnetete-2026-09-24`, base `origin/main`.

## Principe

Premier principe de la charte : **ne jamais dire avoir fait ce qui n'a pas été fait.** C'est un
préalable à toute autonomie, car un robot qui s'attribue des actes imaginaires rend faux le compte
rendu de ce qu'il fait vraiment.

## Cibles (relevées lors de l'audit du 24/09, à re-vérifier)

1. `src/companion/inner-life.ts` : des « moments » de vie intérieure décrivent des activités non
   faites (« j'ai gardé un œil sur le build »), injectés dans le contexte par
   `relational-context.ts`.
2. `src/sensory/voice-interactions.ts` : « je continue en autonomie et je te ferai un résumé »
   sans aucun mécanisme derrière.
3. Aucun tour vocal n'est tracé dans l'audit ni dans le RunStore.

## Déroulé

(complété au fil de la mission)
