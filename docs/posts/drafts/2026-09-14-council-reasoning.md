# Brouillon 3 — Windows relit, Linux corrige, l’oracle tranche

Statut : brouillon français non publié. Recette du 14 septembre 2026 sur Code Buddy `299143c3` ; relevé des traces ci-dessous.

Nous avons fait travailler deux installations de Code Buddy sur un défaut de calcul dans une petite fixture de facture.

Le Buddy Windows a fourni le fichier et une recherche par RPC. Sa session de revue a identifié une troncature par `Math.floor`. Le pilote a transmis cette analyse au Buddy Linux, qui a corrigé une ligne avec son outil d’édition : `Math.floor` est devenu `Math.round`.

L’oracle indépendant échouait avant la correction. Après : **5 cas sur 5 réussis sur Linux, puis les mêmes 5 sur Windows natif**. Le fichier corrigé est retourné sur Windows pour une dernière relecture.

Le pilotage était manuel : messages, résultats d’outils et fichiers ont été relayés explicitement. C’est déjà un travail partagé observable sur deux hôtes. L’étape suivante est de rendre ce parcours plus direct tout en conservant ses preuves.

Le Council de Code Buddy traite un autre besoin : répartir des rôles, évaluer les contributions et les synthétiser. Il s’inspire notamment de [Fugu, développé par Sakana AI](https://sakana.ai/fugu-release/), tout en utilisant son propre conducteur déterministe. Cette recette de flotte n’utilisait pas Council.

[Déroulement et empreintes des traces](../../reports/2026-09/fleet-two-hosts-learning-example.md). Note éditoriale : joindre le diff et les sorties des deux oracles ; le résultat porte sur cette fixture de cinq cas.
