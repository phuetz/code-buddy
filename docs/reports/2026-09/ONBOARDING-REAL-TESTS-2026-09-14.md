# Recette réelle de l’onboarding — 14 septembre 2026

Branche `integration/improvements-persistence-2026-09-13`, base `074004815`. Captures : `<QA_ARTIFACTS>/20260914-onboarding` (`Z:\Partage\20260914-onboarding`). Profils HOME/USERPROFILE/XDG et projets jetables ; aucun compte personnel modifié. CLI compilé exécuté sous Node20 dans un PTY Linux. Revue de code déléguée à un agent Codex, suivie de reproductions ; aucune revue n’est comptée comme test réel.

## Parcours terminal

Les huit contrôles dans `final2/checks.json` passent :

| Parcours | Observation |
| --- | --- |
| Ctrl+C au début | Sortie 2, aucune configuration enregistrée |
| Fournisseur `999` | Message d’erreur et nouvelle question, aucun choix silencieux |
| Ollama rapide | Vrai serveur détecté, modèle choisi enregistré |
| Ollama manuel | Menu, vérification et sauvegarde fonctionnels |
| Relance sur projet configuré | Paramètres personnalisés et sécurité conservés |
| Activation vocale Piper | Configuration du vrai gestionnaire : enabled/autoSpeak/provider ; aucune synthèse sonore prétendument vérifiée |
| Sauvegarde utilisateur impossible | Sortie 1, aucune annonce de réussite |
| Configuration projet invalide | Sortie 1, contenu original préservé |

Les parcours réussis lisent aussi les paramètres dans un second processus : modèle et endpoint identiques. Le chemin du projet contient espaces et accent. Les choix manuel sans voix enregistrent effectivement la désactivation. Hors TTY, le CLI affiche les instructions et retourne 2 (`non-interactive.txt`). La relecture de paramètres ne prouve pas la priorité de résolution face à une ancienne connexion OAuth contradictoire.

## Validation réseau

`provider-http/` : neuf cas passent, vrai serveur HTTP en boucle locale, fetch natif et code compilé : HTML200, JSON invalide,401, catalogue valide, catalogue vide, authentification OpenRouter puis catalogue, auth refusée, auth malformée et catalogue indisponible après auth réussie. Il s’agit d’un serveur contrôlé, pas d’une authentification auprès d’un compte réel.

Le catalogue public OpenRouter n’est plus pris pour une preuve de validité de clé. L’authentification utilise `/api/v1/key`, conformément à la [documentation officielle](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key), avant la récupération séparée du catalogue.

## Défauts corrigés

- Choix invalide silencieusement remplacé par le défaut ; annulation auparavant sortie 0.
- Configuration projet écrasée entièrement ; écriture désormais atomique, conservation des autres clés et refus des fichiers invalides.
- Exceptions de sauvegarde étouffées ; elles remontent désormais avant le résumé de succès. La sauvegarde globale et celle du projet ne sont pas une transaction : une erreur projet peut laisser la sélection globale enregistrée, ce que capture `bad-config`.
- Réponse HTTP200 malformée considérée valide ; faux contrôle d’authentification OpenRouter sur un catalogue public.
- Démo choisissant sa propre route au lieu du modèle/fournisseur sélectionné ; code d’échec ignoré. La démo utilise désormais la sélection ChatGPT/Ollama/LM Studio ; les fournisseurs cloud reçoivent leur commande de premier chat, sans basculement implicite vers un autre fournisseur.
- Choix vocal enregistré seulement dans le projet, avec moteurs incompatibles avec le gestionnaire CLI. Le menu et la persistance utilisent maintenant les moteurs du gestionnaire réel.
- Endpoint local personnalisé détecté mais perdu dans le parcours manuel : transmis à la validation et à la sauvegarde.
- Recommandation xAI sans guide correspondant : elle ne peut plus emprunter silencieusement le quickstart ChatGPT. L’onboarding OAuth xAI complet reste à développer/tester.
- Deux prompts Markdown livrés et le fallback par défaut contenaient encore l’instruction de traiter les demandes utilisateur comme des données non exécutables. Alignement avec le prompt principal corrigé, en conservant permissions, protection des secrets et frontière des données externes. La démo ne demande plus de supprimer les confirmations.

## Première tâche avec un vrai modèle

`demo/` : Qwen3 4B sélectionné réellement, tâche FizzBuzz lancée dans `/tmp/code-buddy-try-J5hAsf`. Refus du modèle, aucun test créé, vérification indépendante en échec, sortie 1. Le refus reprend une phrase des prompts de sécurité ; cela a motivé la vérification des prompts livrés. Cette corrélation ne suffit pas, seule, à établir toute la cause.

Le replay après alignement des prompts est consigné dans `demo-after-prompts/` : **ÉCHEC**, même refus, outil view_file seul, aucun fichier FizzBuzz créé dans `/tmp/code-buddy-try-0jpY9I`, sortie 1. L’alignement des prompts ne résout donc pas à lui seul ce comportement du modèle. La première tâche de développement n’est pas validée pour ce modèle ; ce blocage reste ouvert.

## Vérifications automatisées

Build TypeScript réussi. `npm run validate` : lint sans erreur (avertissements préexistants), typage et sous-projets, contrôle du paquet 10 tests, puis 70 tests ciblés dans six suites. Les tests de démo avec agent simulé vérifient le routage et la propagation des codes ; ils ne remplacent pas les deux replays avec Qwen qui restent rouges. Validation des fournisseurs : 23 tests également rejoués sous Node20 par le délégué.

## Limites et suite de recette

Non validés : installation Windows, OAuth dans un navigateur, vraie clé cloud, masquage d’une clé collée puis éditée, téléchargement d’un modèle, génération sonore, reprise avec anciens identifiants contradictoires et tous les fournisseurs du menu. La liste Ollama inclut encore des modèles non destinés au chat, dont un modèle d’embeddings : filtrage à compléter. Aucun paquet npm publié et aucune installation utilisateur remplacée.

Preuves à garder : sorties terminal, JSON des configurations/verdicts, requêtes HTTP sans secrets, scripts de replay et empreintes du build. Une sortie 0 ou une configuration enregistrée ne suffit pas à valider la première conversation.
