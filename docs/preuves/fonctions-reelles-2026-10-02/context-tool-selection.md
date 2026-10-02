# context-tool-selection — recette du 2 octobre 2026

État : **Testée localement**. Décision : **a** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

La sélection directe utilisait une liste minimale qui omettait tool_search.

Conserver tool_search par défaut dans le sélecteur et dans getRelevantTools, son appelant public. Le replay du premier paquet a détecté l’oubli de ce second chemin ; test public rouge puis vert ajouté.

[Protocole, validation et limites](README.md).

Fichiers du correctif : `src/tools/tool-selector.ts`, `tests/tools/tool-selector-discovery.test.ts`, `src/codebuddy/tools.ts`.

## Avant

### tools-selection

```text
{"selectedTools":["view_file","bash","self_evolution","self_describe","file_search","json_query","dep_inspect","search","peer_tool_invoke","search_files","read_file","git"],"scores":{},"classification":{"categories":["file_search","file_read","git"],"confidence":0.4,"keywords":["read","search"],"requiresMultipleTools":true},"reducedTokens":2590,"originalTokens":55603,"confidence":1}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### tools-selection

```text
$ node tools.mjs selection
{"selectedTools":["view_file","bash","tool_search","self_evolution","self_describe","file_search","json_query","dep_inspect","search","peer_tool_invoke","search_files","read_file"],"scores":{},"classification":{"categories":["file_search","file_read","git"],"confidence":0.4,"keywords":["read","search"],"requiresMultipleTools":true},"reducedTokens":2223,"originalTokens":55603,"confidence":1}

EXIT=0
```

## Portée précisée après contre-revue

La preuve concerne l’API publique `getRelevantTools`, pas un tour complet de l’agent. Pour cette requête et `maxTools:12`, la sélection garde 12 outils : `tool_search` prend la place de `git`. C’est le coût du maintien de la découverte dans ce budget ; `view_file` et `bash` restent présents. Le test de régression vérifie ces invariants. Les profils lite et compact du harnais restent hors périmètre et inchangés.

`alwaysInclude` désigne des outils obligatoires, pas une liste d’exclusion : un outil absent de cette liste peut être retenu par son score. Les outils indisponibles dans la liste d’entrée ne sont jamais inventés. Le test explicite distingue ces deux contrats.
