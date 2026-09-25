# Reprise DGM — identité des publications

Chantier réservé sur `feat/dgm-catalogue-carte-2026-09-25` au 25 septembre 2026.

Le rapport et les sorties brutes de cette passe sont livrés dans le répertoire de reprise du pilote. Cette note de dépôt ne contient aucun chemin ni donnée d'exploitation.

État initial : `b8cba9491`, arbre propre. Correctif source : `17c011c36`. Trois nouveaux tests reproduisent la fusion, le rejet et la déduplication de publications distinctes partageant un titre : 3 rouges avant, 11 verts après, 3 rouges avec le mutant qui assimile deux identifiants arXiv distincts. Deux flux ne sont réunis que par un identifiant bibliographique partagé, dont le DOI pour arXiv/Europe PMC.

Le banc annoté de 20 requêtes a été lancé sur une copie vérifiée du même ledger avant et après. Ses sorties JSON sont identiques : précision top-5 après filtrage 0,09, deux abstentions. Ce correctif d'identité n'améliore pas le score de ce jeu ; la mesure ne montre aucun changement de classement sur les 20 requêtes.

Les sorties brutes et les résultats de la validation finale figurent dans le rapport externe. Limite : les lignes déjà fusionnées par l'ancienne version ne peuvent pas être séparées sans retourner aux données sources.
