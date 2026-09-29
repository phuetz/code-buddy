# Intégration du patch Jules — rejets des écritures vidéo de test

Branche : `jules/cb-rejets-non-geres-tests-20260928`, base `a675d1d13`.

Le patch unique a été appliqué avec `git apply --3way`. Les deux corrections des faux processus `ffmpeg` dans `video-stitch-tool` et `film-output-confinement` sont conservées : un échec de `writeFile` émet maintenant `close(1)` au lieu d'être avalé et suivi de `close(0)`. Deux tests de régression ont été ajoutés dans ces fichiers, sans supprimer, renommer ou affaiblir les tests existants.

Les deux suppressions de `void` dans `film-assemble.test.ts` ont été écartées : les deux handlers de `then` traitaient déjà résolution et rejet ; enlever `void` ne change ni le cycle de vie ni le résultat. Le fichier reste identique à la base après intégration.

## Preuves

- Deux nouveaux tests avec les anciens doubles : 2 échecs, `expected 0 to be 1` ; l'écriture forcée dans un répertoire absent est faussement annoncée réussie.
- Même commande avec les doubles corrigés : 2/2 verts.
- Trois fichiers annoncés par Jules : 63/63 verts, dont les rendus réels `ffmpeg`. Les 61 cas existants restent présents. Le compte de Jules (56 verts, 5 ignorés) dépendait de son environnement où ces rendus étaient ignorés.
- Trois voisins (`film-project`, `long-form-production`, `film-producer`) inclus dans une exécution à 6 fichiers : 99/99 verts.
- `npm run build` : code 0 ; TypeScript, copie des assets et manifeste terminés.
- ESLint ciblé sur les trois fichiers : code 0. `git diff HEAD --check` : code 0.
- Garde des données personnelles : 39/40, dernier cas interrompu par `spawnSync git EPERM` sous confinement avant son assertion. Revue manuelle du diff : seulement tests, rapport et coordination, sans chemin personnel ni secret.

## Limites et verdict

**INTÉGRABLE** pour la correction déterministe des doubles de test. La disparition d'une erreur aléatoire `ENOENT` ou d'un `unhandledRejection` sur l'ensemble de la CI Linux Node 20 n'est pas démontrée : le défaut reproduit ici est un faux code de sortie 0. L'exhaustivité des trois fichiers annoncée par Jules n'a pas été vérifiée sur toute la suite.

Ce que je n'ai pas pu vérifier : CI Linux Node 20 et autres plateformes (hôte Node 24), ferme de build et flake à grande échelle ; garde des données personnelles complète à cause de `spawnSync git EPERM`. Aucun test .NET ni Docker n'est applicable à ce patch TypeScript ; aucun Docker exécuté. Aucun test GUI Avalonia lancé.
