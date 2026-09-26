# Reprise Ruche — contre-revue du 25 septembre 2026

État source : branche `feat/ruche-agents-2026-09-25`, commit `088c2d7e0`, arbre propre avant reprise. État candidat : commits locaux `4817ce07d`, `c07296be2`, `0d717f52a`, sans push ni fusion. État déployé : aucun.

Snapshot du diff source : `git diff 6715ab53d..088c2d7e0 --stat` donne 12 fichiers et 909 lignes ajoutées. Patch source conservé dans le dossier de livraison sous `PATCH-AVANT.patch`.

Constats de la section 2 de la contre-revue : une décision de bail pouvait être émise par deux arbitres indépendants ; un accord pour un effet pouvait être consommé avant un autre effet. Le premier commit ajoute les tests de reproduction. L'export de ce commit donne 2 échecs sur 12 tests Ruche ; une sonde supplémentaire de l'ancienne API montre exactement que la callback substituée s'exécute. Le correctif exige une clé publique d'arbitre Ed25519 épinglée, cesse de générer automatiquement sa clé privée et refuse les décisions locales et RPC hors de cet arbitre. Le garde d'approbation reçoit un descripteur `{ action, target, parameters? }` et compare sa forme canonique à la demande avant consommation.

Le candidat passe 13 tests ciblés sur 2 fichiers. Le mutant qui supprime la comparaison d'effet échoue sur 1 test exécuté ; celui qui rétablit la création et la décision d'un arbitre propre à chaque profil échoue sur 1 test exécuté. Les sorties brutes sont dans `preuves/` du dossier de livraison. Le typecheck du premier candidat a trouvé trois erreurs TS18048 dans la reconstruction des approbations ; elles sont corrigées dans `0d717f52a`. Vérification complète du commit final à consigner après sa création.

Le chemin demandé pour l'export jetable est en lecture seule dans ce bac à sable. Les exports ont été placés sous `/tmp`, avec `HOME` et `USERPROFILE` jetables ; les sorties brutes sont conservées dans le dossier de livraison. Le lien global vers les dépendances rendait le cache temporaire de Vite non inscriptible ; chaque entrée de `node_modules` pointe vers la dépendance demandée et seul `.vite-temp` est un dossier local jetable.
