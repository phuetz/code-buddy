# Exemple TOML et port de passerelle

Branche `feat/outillage-config-2026-09-24`, départ `6f1d39908`, correctif `8170f087f`. Rien n'est poussé ni fusionné. Le profil réel n'a pas été ouvert.

État source : `6f1d39908`. État candidat : `8170f087f`, non déployé. État déployé : inchangé.

`docs/config.toml.example` est de nouveau produit par `renderTomlExample`. Chaque table n'est ouverte qu'une fois, et une clé qui est déjà une table n'est pas aussi une valeur. `parseTOML`, `assessUserConfigText` et `runConfigValidate` acceptent le fichier livré. Un parseur TOML standard le lit aussi : `gateway` est une table `bind`, `port`, `auth_mode`, et l'alias `exemple` est une table `model`, `provider`, `base_url`, plus une chaîne.

`gateway.port` porte dans le schéma, dans l'exemple et dans le rapport de `config set` la mention DIAGNOSTIC NON APPLIQUÉ. La clé reste enregistrable. Elle ne change pas l'écoute.

Les valeurs d'exemple qui empêchaient le contrôle du catalogue ont été ajustées : un prix n'est plus un tableau, une taille de contexte n'est plus 0, et l'alias `exemple` vise `grok-4` chez `openai` au lieu de se désigner lui-même.

Barrière réseau fermé : rouge 3 échecs sur 26, vert 26 sur 26, mutant du générateur 2 échecs sur 26, mutant du libellé 1 échec sur 26. `tests/config` : 543 tests, code 0. Typecheck principal : seulement les deux `TS2307` de `@phuetz/companion-core`, fichier non modifié. Lint ciblé : 0. Aucune ligne ajoutée ne contient un chemin privé ni une adresse RFC 1918.
