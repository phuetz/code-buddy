# Reprise PWA mobile — lot 84

Branche : `jules/cb-mobile-pwa-2026-09-25`. Correctif produit et tests : `74a96cd82`.

Le client ferme le WebSocket, efface le jeton de session et arrête les tentatives automatiques lorsqu'une erreur arrive pendant l'authentification. Trois tests distincts couvrent `AUTH_FAILED`, `UNAUTHORIZED` et `RATE_LIMITED`. Le cache du service worker passe à v14 pour livrer le script corrigé aux PWA installées.

Le délai de reconnexion du test navigateur passe de 15 à 30 secondes. Une sonde exécute la fonction de backoff du client : cinq tentatives peuvent placer la reconnexion suivante à 17 secondes. Le délai global du scénario passe à 90 secondes.

Avant correction : deux tests de refus d'authentification rouges et sonde de délai rouge. Après correction : trois tests ciblés verts, 73 tests UI sans socket verts ; les mutants sans fermeture du socket et avec délai de 15 secondes redeviennent rouges. Sur onze suites mobiles complètes, 90 tests passent, 28 échouent et 20 sont ignorés ; le refus `listen EPERM` de la barrière locale et des erreurs en cascade empêchent un verdict vert côté serveur. Le navigateur E2E ne peut pas démarrer pour la même raison. Type-check complet 0 ; lint complet 0 erreur, avec 2552 avertissements préexistants. Le rejeu sur le dernier commit est consigné dans le dossier de livraison.

Aucun push, aucune fusion ni déploiement.
