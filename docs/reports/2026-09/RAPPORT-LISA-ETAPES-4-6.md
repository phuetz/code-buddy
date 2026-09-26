# Lisa : étapes 4 à 6

Rapport ouvert le 25 septembre 2026 avant modification de la source. Branche `feat/lisa-etapes-4-6-2026-09-25`, départ `6715ab53d`. Arbre initial propre ; snapshot du diff initial vide (0 octet). Chantier réservé dans le tableau de coordination.

## État

- Source initiale : trois magasins de checkpoints distincts ; `/undo` lisait le magasin persistant alors que Bash créait ses points dans le magasin mémoire. Le chemin Bash en bac à sable retournait avant la création du checkpoint.
- Candidat : magasin durable opt-in pour les fichiers explicitement visés ; ponts des trois gestionnaires ; `/undo` et `buddy lisa annuler` lisent les points Lisa. Pouls opt-in sur le battement existant, capteurs de fichier et Git avant modèle, décision sans outils, autorisation de mandat injectée et refus par défaut. Journal JSONL, résumé du soir et lecture vocale protégée par nom de propriétaire configuré, présence confirmée et appel explicite.
- Déployé : aucun changement. Aucun service activé.
- Drapeaux : `CODEBUDDY_LISA_UNIFIED_CHECKPOINTS=true`, `CODEBUDDY_LISA_PULSE=true`, `CODEBUDDY_LISA_JOURNAL=true` ; modèle de décision configuré explicitement. Sans ces trois drapeaux, le battement suit sa voie initiale.
- Point d'accroche PR #233 : `authorizeAction(action, 'initiative')` retourne une décision et un identifiant de mandat vérifié. En l'absence de cet adaptateur et d'un exécuteur restreint, aucune action proposée n'est exécutée.
- Commits locaux du code et des tests : `7dd39fb37`, `7c3a39a49`, `2a13999a7`. Aucun push ni fusion.
- Capteurs livrés : Git, CI et PR via `gh` opt-in, file de flotte locale, rappels, fichiers de comptage agenda et courriels explicites. Le pouls n'installe ni minuteur ni tâche cron supplémentaire.
- Vingt tests nouveaux et un test ajouté à une suite existante ont été écrits, sans exécution. Ils ciblent le retour arrière, les formes Bash refusées, le réveil par changement, les plafonds, la séparation des effets, les capteurs, le journal et l'identité vocale.

## Vérifications réellement effectuées

- `git diff --check` : `diff check OK`.
- Recherche dans les lignes ajoutées et les nouveaux fichiers : zéro chemin privé, nom d'hôte interdit, adresse privée ou marqueur de réseau personnel.
- Barrière Docker copiée et adaptée ; copie candidate des sources préparée. Rejeu des canaris tenté : code 1, `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Aucun test Vitest, build, rouge/vert/mutant ou rejeu produit n'a suivi.

## Ce que je n'ai pas pu vérifier

Le compilateur TypeScript, ESLint, les tests ciblés et la preuve rouge → vert → mutant n'ont pas pu être lancés dans la barrière Docker requise. Le comportement réel du candidat et celui du service vocal ne sont pas validés. Les trois magasins restent distincts pour leurs opérations historiques sans fichiers explicitement ciblés ; le pont canonique couvre les actions sur fichiers explicites. Le pont de mandat et l'exécuteur restreint de la PR #233 ne sont pas disponibles ici, donc aucune action réversible autonome n'est opérationnelle. La liaison directe à `cron-agent-bridge` et à des fournisseurs d'agenda/courriel vivants reste absente ; leurs comptes proviennent de snapshots explicites.
