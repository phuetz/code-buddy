# Catalogue des fonctionnalités

`buddy catalog status` produit un tableau Markdown ; `--json` produit le même état structuré.

L'inventaire `inventory.json` nomme les fonctionnalités suivies, leurs fichiers de code et les maillons attendus entre un point d'entrée et l'implémentation. Le générateur vérifie chaque fichier et chaque extrait de code à la lecture. Il retire les commentaires avant la recherche des maillons. Cette analyse statique établit un raccordement déclaré dans le code ; elle ne prouve pas que les prérequis, permissions ou services externes permettent une exécution sur une machine donnée.

Chaque état vaut `vrai`, `faux` ou `inconnu`. Une source ou un maillon annoncé et absent donne `faux`. Une information non déclarée donne `inconnu`. Une preuve d'exécution ne vaut pour `TESTÉE EN SITUATION` que si sa révision est celle du code courant. Une preuve plus ancienne reste affichée dans `lastProof`. Un échec récent à la révision courante donne `faux`.

La version installée est confirmée seulement lorsque la commande s'exécute depuis le paquet npm installé. Un lancement depuis un checkout ou un export de test garde `DÉPLOYÉE` à `inconnu`. Le paquet contient cet inventaire et `docs/preuves/` ; les chemins `src/*.ts` sont alors vérifiés dans les modules `dist/*.js` correspondants.

Une preuve est un JSON dans `docs/preuves/` : `schemaVersion: 1`, `featureId`, `kind` (`integration` ou `field`), `result` (`passed` ou `failed`), `date` ISO, `revision` Git, `artifact` relatif au dépôt et `summary`. La trace doit être un fichier non vide sous `docs/preuves/` ou `tests/integration/`, sans sortie du dépôt. Le champ `proofs` d'une entrée de l'inventaire accepte les mêmes champs hors `featureId` et `schemaVersion`. Un test défini mais jamais exécuté ne constitue pas une preuve de fonctionnement.

Le générateur ajoute les commandes CLI enregistrées dans `src/index.ts` et les noms d'outils déclarés dans `src/tools/metadata.ts`. Une entrée ainsi découverte ne prouve pas à elle seule l'existence de l'implémentation ou du chemin d'exécution de l'outil : ces états restent `inconnu`. L'inventaire explicite couvre cinq fonctionnalités de bout en bout, représentatives des entrées CLI, outil, route et canal. Son champ `discoveryKey` évite de doubler une entrée découverte. Les fonctions internes et les entrées non détectables statiquement demandent encore une entrée explicite.
