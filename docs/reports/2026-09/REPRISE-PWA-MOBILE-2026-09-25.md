# Reprise de la PWA mobile — 25 septembre 2026

Départ : `9af526e7e`, branche `jules/cb-mobile-pwa-2026-09-25`.

Le rapport de revue est repris constat par constat. Les sorties brutes et le patch initial sont conservés dans le dossier de livraison du pilote. État source : cinq constats à traiter. État candidat : `13b79e53a`, correctifs locaux. État déployé : aucun.

Vitest exclut la suite Playwright et une commande dédiée l'exécute. Le délai après quatre échecs est passé de 16 s à un plafond de 5 s ; le test ciblé est rouge avant, vert après, rouge avec le mutant. Les icônes sont désormais livrées dans les sources, avec un test qui ne les fabrique plus. L'inventaire présente la PWA comme couverture automatisée et le lockfile conserve `undici` 6.29.0, déjà présent sur la branche principale.

Les tests DOM et actifs sans socket passent (56 tests distincts). Le type-check principal réussit et le lint ciblé ne présente aucune erreur. Dans la barrière locale, les tests qui ouvrent un port loopback et l'E2E échouent sur `listen EPERM` ; ce résultat ne prouve pas la reconnexion dans le navigateur.

## Ce que je n'ai pas pu vérifier

Le replay navigateur et les suites serveur avec socket attendent la barrière du pilote. Windows et un téléphone physique ne sont pas exécutés ici.
