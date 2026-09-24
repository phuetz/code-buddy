# Remise à zéro — fusion de origin/main

24 septembre 2026. Branche `feat/reset-sessions-messagerie-2026-09-23`, fusion `22913727e` de `origin/main` (`8b04099f4`) après `8d6f70e3b`, puis deux commits d'essais. Commits locaux uniquement : pas de push, pas de fusion vers main.

Les deux côtés avaient réécrit `src/config/toml-config.ts`. La fusion garde les deux intentions. `[session_reset]` est sérialisé par `emitFlatSection`, comme `[ui]`, `[agent]` et `[middleware]` : les clés de la source sont préservées, aucune section par défaut n'est ajoutée en réécriture, un mode inconnu redevient `none`, les nombres sont tronqués et une valeur non finie n'est pas écrite. Le chargement lit le fichier utilisateur par `configFile()`, la règle documentée de main (`CODEBUDDY_CONFIG`, puis `CODEBUDDY_HOME`, puis `HOME`), et le projet par la même lecture qui enregistre les fichiers illisibles ou inanalysables. La relecture faite juste avant une remise à zéro vise ce même fichier utilisateur. Les profils appliqués et la configuration utilisateur préservée de main restent intacts.

Après la fusion, trois essais du banc de configuration échouaient et d'autres passaient à vide : le banc n'écrivait le fichier utilisateur que sous `HOME`, alors que `vitest.setup.ts` fixe `CODEBUDDY_HOME` pour chaque fichier d'essai. Le banc sépare désormais `HOME` et `CODEBUDDY_HOME`, vérifie le fichier réellement lu, et couvre le cas d'un fichier utilisateur inanalysable au chargement puis réparé. Des mutants qui relisent l'ancien chemin sous `HOME`, qui oublient l'échec d'un fichier utilisateur ou qui rétablissent l'ancien sérialiseur font chacun échouer un essai.

Le détail et les preuves sont hors du dépôt public.
