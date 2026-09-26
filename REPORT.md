# Reprise du test PWA mobile

Le commit initial ajoutait un test Playwright collecté par Vitest, sans corriger les icônes manquantes ni la reconnexion lente. La revue a aussi observé un échec de reconnexion sur cinq passages. Ce rapport remplace la conclusion déterministe du premier essai.

## Correctifs

- Le test navigateur utilise le runner Playwright dédié (`npm run test:e2e`) ; Vitest exclut `tests/e2e`.
- Les icônes PNG référencées par le manifeste et le service worker sont fournies dans les sources. Le test de présence vérifie désormais les fichiers sans les générer.
- Après plusieurs échecs pendant un arrêt du serveur, le délai de reconnexion est plafonné à cinq secondes. Une régression ciblée échoue avec l'ancien plafond de trente secondes.
- L'inventaire qualifie la PWA de couverture automatisée, sans affirmer un usage réel mesuré.
- Le lockfile conserve les versions Playwright de la base et la version `undici` déjà présente sur la branche principale.
- La contre-revue a reproduit le même échec de reconnexion avec les plafonds de 5 s et de 30 s : ce plafond ne résout pas la panne observée. Une connexion WebSocket ouverte mais jamais authentifiée restait bloquée sans événement `close`. Le client ferme maintenant ce socket après 5 s et relance la connexion ; les trames d'un socket remplacé sont ignorées. Le cache du service worker passe à v13 pour diffuser le nouveau client.

## Vérification

La reprise du blocage ajoute deux tests déterministes : socket sans réponse d'authentification et trame tardive d'un ancien socket. Chacun échoue sur l'ancien client, passe après correction et échoue sous mutation. La suite DOM complète compte 53 tests passés. Type-check complet et lint complet passent. La barrière locale interdit l'ouverture d'un port loopback (`listen EPERM`) et le lancement de Chromium ; le test navigateur et les suites serveur qui ouvrent un port restent à rejouer par le pilote. Les sorties brutes sont dans le dossier de livraison privé.

## Ce que je n'ai pas pu vérifier

La reconnexion dans un vrai navigateur après redémarrage du serveur n'a pas pu être exécutée dans cette barrière. Je ne confirme pas un taux de réussite sur cinq passages ni le comportement sur Windows ou téléphone physique.
