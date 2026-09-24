# Rapport de mission — carte fonctionnalités ↔ code ↔ recherche pour la DGM

> Ouvert le 24/09/2026 avant toute inspection, selon la règle du dépôt.
> Branche `feat/carte-fonctionnalites-dgm-2026-09-24`, base `origin/main`.

## Demande

« Continue à valider que Code Buddy fonctionne bien. Il se cartographie avec Code Explorer ? Pour
relier la liste des fonctionnalités au code et aux articles de recherche trouvés, pour faire
fonctionner la Darwin Gödel Machine. »

## Constats de départ (mesurés)

- L'index Code Explorer de `code-buddy` datait du **2 août 2026** (commit `6092cbe98`) et avait été
  construit sur un arbre de travail, pas sur `main`. Le réindexage automatique est opt-in
  (`CODEBUDDY_CODE_EXPLORER_AUTOINDEX`), donc éteint.
- L'inventaire des fonctionnalités (`docs/INVENTAIRE-FONCTIONNALITES.md`) ne cite ni fichiers ni
  tests ni articles. Sa version avec les preuves du 24/09 est dans la PR #222, non fusionnée.
- Les articles de recherche sont dispersés : 34 références arXiv distinctes dans 14 fichiers de
  `docs/` et `src/`, sans lien avec l'inventaire.
- `docs/reports/2026-09/AUDIT-DGM2.md` : le point faible de la DGM est son signal de mesure,
  `capability-benchmark.ts`, qui ne vérifie que la présence de sous-chaînes dans des leçons. La DGM
  ne sait pas quelles fonctionnalités existent, lesquelles sont prouvées, ni quels tests les
  mesurent.

## Déroulé

1. **Réindexation** de `main` (commit `76b513ccf`) avec `code-explorer analyze --force --include-docs` :
   4 min 50 s, 2,2 Go de mémoire au pic, 7 335 fichiers, 155 298 nœuds, 1 050 documents.
2. **Défaut d'outillage trouvé en l'utilisant** : le serveur MCP de Code Explorer branché sur la
   session Claude Code lançait l'ancien binaire `gitnexus 0.1.0`, qui lit un autre registre
   (`~/.gitnexus/`, figé au 19/08). Il répondait « Repository not found » sur tout index récent. La
   CLI `code-explorer 0.1.1` voyait bien le nouvel index. Configuration locale corrigée (hors
   dépôt). Code Buddy lui-même sonde `code-explorer` avant `gitnexus` et n'était pas touché.
3. **Cartographie** des 54 fonctionnalités de l'inventaire (version de la PR #222) par trois
   agents avec la CLI Code Explorer. Chaque chemin a été vérifié sur le disque. Résultat : 0
   fonctionnalité sans code, 0 sans test.
4. **Vérification des 40 articles** cités dans le dépôt, sur arxiv.org. **Deux citations étaient
   fausses** (vérifié moi-même sur les pages arXiv, pas seulement par l'agent) :
   - ShinkaEvolve était cité `2509.14364`, un article de géométrie algébrique ; c'est `2509.19349`.
     C'était dans l'audit DGM2 lui-même. Corrigé, avec une note qui garde la trace de l'erreur.
   - TurboQuant était cité `2401.12428`, un compilateur pour accélérateurs en mémoire ; c'est
     `2504.19874`. Corrigé dans `src/providers/turboquant-provider.ts`.
5. **Écart de l'inventaire** : 12 fonctionnalités activées par une variable d'environnement
   n'étaient pas marquées 💤. La carte suit le code (`offByDefault: true` dès qu'une variable
   l'active). Le plus notable : la revue de diff est `off` par défaut, alors que l'inventaire dit
   que « toute écriture passe par une revue ».

## Ce qui est livré

- `docs/feature-map.json` : pour chacune des 54 fonctionnalités, le code, les tests, le niveau de
  preuve, l'interrupteur, les articles (lien `cited` ou `implements`, avec l'endroit du dépôt qui
  l'établit), et les doutes. Le fichier contient aussi les 40 articles, titres vérifiés sur arXiv.
- `src/agent/self-improvement/feature-map.ts` : schéma strict, validation contre le dépôt,
  classement des cibles (preuve la plus faible d'abord ; une fonctionnalité sans code n'est pas une
  cible mais une façade à signaler), résumé.
- `buddy improve map [--targets N] [--check] [--json]`.
- `tests/agent/self-improvement/feature-map.test.ts` : le schéma, la validation, le classement, et
  **la carte réelle du dépôt**, qui doit rester sans dérive (un fichier déplacé fait échouer le
  test).

## Ce que la DGM gagne, et ce qui reste à brancher

La carte donne à la boucle d'auto-amélioration trois choses qu'elle n'avait pas :
- une **cible** : la fonctionnalité la moins prouvée ;
- une **garde** : les tests de cette fonctionnalité, à rejouer avant de garder un changement ;
- un **ancrage** : les articles dont elle implémente le mécanisme.

Comme les scénarios de référence, la carte est curatée hors de la boucle : la DGM la lit, elle ne
l'écrit jamais. **Pas encore branché** : `engine.ts` ne consulte pas encore `selectFeatureTargets`.
Ce branchement (choisir la cible, donner l'ancrage au proposeur, rejouer les tests de garde dans
la porte empirique) fera l'objet d'une PR séparée, une fois la carte relue par le mainteneur.
