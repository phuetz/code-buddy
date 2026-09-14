# Commandes courantes du CLI — 14 septembre 2026

Signalement : `/model` semble ne pas fonctionner, après un démarrage Windows où le clavier reste bloqué quelques minutes. Le second problème reste en diagnostic, en attente de la trace Windows déposée par le lanceur fourni dans Partage.

## Correctifs

- Entrée exécute une commande connue saisie entièrement, sans devoir appuyer une seconde fois. Tab complète sans exécuter. Les flèches permettent de choisir explicitement une autre suggestion avant Entrée. Les arguments tapés sont conservés.
- `/model <nom>` modifie le client actif et les limites de contexte/tokenisation via `agent.setModel`, puis sauvegarde le choix. Auparavant, le gestionnaire générique pouvait modifier uniquement un réglage tout en annonçant un changement actif.
- `/models` utilise le même chemin que `/model`. Le choix au clavier conserve ce comportement. Une erreur du changement est affichée sans fausse confirmation ; l'échec de sauvegarde distingue le modèle actif de la préférence non enregistrée.
- Les modèles incompatibles avec le fournisseur actif sont écartés du sélecteur et refusés lors d'un changement manuel. Le modèle courant est inclus et le sélecteur suit sa modification. Huit lignes restent visibles autour de la sélection.
- `/status` et `/model list` affichent le modèle de l'agent courant. Le sélecteur ne se nomme plus « Grok Model » pour les autres fournisseurs ; son rendu ne contient plus un hook conditionnel.
- `/clear` appelle aussi `agent.clearChat()` pour vider la conversation utilisée au prochain appel, en plus des états visuels.

## Parcours réellement vérifié

| Commande / action | Vérification |
|---|---|
| `/help` | Réponse d'aide locale après une seule Entrée |
| `/model` | Ouverture du sélecteur avec une seule Entrée |
| `/models` | Alias testé sur le même gestionnaire actif |
| Tab, flèches, Entrée, Échap | Complétion sans exécution, sélection et fermeture dans React/Ink réel |
| `/model gpt-5.5` | La requête HTTP suivante porte effectivement `model: gpt-5.5` |
| `/status` | Le modèle actif est affiché |
| `/cost` | Tableau de coûts local |
| `/context` | Réponse locale sur le contexte du profil isolé |
| `/tools` | Liste locale ; MCP désactivé dans le test pour ne pas joindre les services personnels |
| `/clear` | Le marqueur du message antérieur est absent des messages de la requête HTTP suivante |
| `/exit` | Sortie normale du CLI compilé sous Node20 |

Le test de bout en bout lance le vrai CLI compilé dans un pseudo-terminal, avec un home temporaire et un serveur HTTP de modèle déterministe en loopback. Seules les deux demandes de conversation appellent le modèle ; les commandes locales n'ajoutent aucun appel.

Validation : `npm run validate` avec sept suites ciblées (208 tests au premier passage, lint/types et 10 contrôles du paquet verts). La dernière régression de compatibilité porte le total à 209, tous verts sous Node20. Les quatre suites de saisie/dispatch passent aussi sous Node20 (28 tests). Build et parcours PTY Node24/Node20 validés.

La validation ne couvre pas chaque sous-commande du catalogue ni les services MCP externes. Elle ne remplace pas le contrôle du clavier au démarrage sous Windows réel. Les diagnostics de revue et les contenus promotionnels doivent conserver cette distinction.
