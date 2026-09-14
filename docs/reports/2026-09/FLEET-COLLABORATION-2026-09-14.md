# Coopération multi-instance — 14 septembre 2026

## Résultat livré

`buddy fleet check --config fleet.json` vérifie les pairs authentifiés et leur fournisseur configuré sans requête de modèle. `buddy fleet collaborate "but" --config fleet.json` lance 2–8 contributions en parallèle et une synthèse attribuée. La configuration est réutilisable entre processus CLI ; elle contient uniquement les noms des variables portant les JWT.

Les échecs de connexion, d'autorisation, de modèle, de réponse ou de synthèse restent visibles ; un résultat partiel sort avec le code 1. Les connexions sont fermées, y compris sur annulation. Cette commande produit un travail d'analyse commun, pas des modifications distantes de fichiers.

Un défaut du RPC existant a été reproduit puis corrigé : un JWT valable avec `fleet:listen`, mais sans `peer:invoke`, déclenchait un message d'erreur non corrélé. Le client attendait son timeout. Le serveur renvoie désormais `peer:response` avec l'identifiant de la requête et `FORBIDDEN`. Le test multi-processus est passé du timeout rouge au refus immédiat vert.

## Travail réel confié aux pairs

À la demande de Patrice, deux vrais processus Code Buddy ont examiné les sources du nouveau parcours :

| Pair | PID de l'essai | Fournisseur / modèle | Mission |
|---|---:|---|---|
| securite | 594674 | Ollama / qwen2.5:7b-instruct | Connexions, validation, sécurité |
| coordination | 594675 | Ollama / qwen3:4b-instruct | Coordination, annulation, délais et tests |

Les deux modèles ont réellement inféré via Ollama ; aucun résultat simulé dans cet essai. Les processus utilisaient des homes temporaires, des ports loopback distincts et des secrets JWT distincts. Le premier pair a ensuite reçu les deux contributions et produit leur synthèse. Les processus temporaires ont été arrêtés après l'essai ; aucun service habituel n'a été reconfiguré.

Le relevé complet et les empreintes SHA256 des fichiers examinés sont dans le Partage Samba convenu : `20260914-travail-reel-flotte.json`.

### Revue des retours par Codex

La communication et la synthèse ont réussi ; la qualité des diagnostics des petits modèles locaux était insuffisante pour accepter leurs correctifs automatiquement. Les six défauts annoncés n'étaient pas reproduits :

- Le trim du rôle, les limites de longueur et la validation du type existaient déjà ; `role.trim()` sans affectation proposé par le pair n'aurait rien changé.
- `new URL` et le contrôle du protocole géraient déjà les cas cités ; retirer des balises HTML d'une URL n'était pas un correctif approprié.
- `provider.methods` cité par le pair n'existait pas dans la source : le contrôle portait sur `info.methods`.
- Le but vide était déjà rejeté avant connexion.
- Les délais de connexion et d'authentification étaient séparés du délai des appels de modèle ; le timeout de requête n'était pas ramené à 10 secondes.

Les propositions de tests ont été retenues : but vide/blanc/trop long avant réseau, endpoint WebSocket avec relais, normalisation de `/` vers `/ws`, conservation du délai de modèle de 300 secondes avec un but à sa taille maximale. Elles renforcent les régressions sans introduire les changements erronés proposés. La consigne de synthèse demande maintenant de confronter les affirmations au code et de signaler celles qui ne sont pas étayées. Cette consigne ne constitue pas une garantie de qualité.

## Vérifications

- Tests unitaires : validation, jetons manquants, vrai parallélisme des contributions, synthèse, échecs partiels, annulation, nettoyage et absence de secrets/contrôles terminal dans les sorties.
- Test multi-processus : deux vrais serveurs et des fournisseurs HTTP déterministes pour une preuve reproductible ; PIDs distincts, réponses distinctes réunies, session conservée après reconnexion, refus du jeton de l'autre serveur et refus corrélé du droit manquant.
- Régressions Fleet : transport, sessions, outils distants et salons signés.
- CLI compilé : aide des deux commandes, configuration obligatoire et code 1 en l'absence de jeton.
- Validation finale et paquet : résultats inscrits au tableau de coordination avant passation.

Les tests locaux ne prouvent pas encore la connectivité entre les machines physiques Windows/Linux de Patrice. Leur pare-feu, leurs adresses, leurs jetons et leurs fournisseurs sont à vérifier avec `fleet check`. La procédure figure dans `docs/fleet-collaboration.md` et une copie est déposée dans Partage.
