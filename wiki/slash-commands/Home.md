# Wiki des commandes Code Buddy

140 commandes intégrées. BLOQUE_PREREQUIS : 5 · ECHEC : 12 · PARTIEL : 1 · TESTE_LOCAL : 103 · VALIDATION_SEULE : 19

[Ouvrir le wiki interactif](index.html) — recherche et filtres utilisables hors ligne.

Dans Windows, ouvrir index.html depuis le dossier partagé. Garder les dossiers de captures à leur place relative pour conserver les liens.

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.

| Commande | Usage | Verdict de recette |
| --- | --- | --- |
| [/help](help.md) | Afficher les commandes et leur aide. | TESTE\_LOCAL |
| [/shortcuts](shortcuts.md) | Afficher les raccourcis clavier. | TESTE\_LOCAL |
| [/clear](clear.md) | Effacer l’historique de conversation. | TESTE\_LOCAL |
| [/history](history.md) | Consulter et rechercher l’historique des commandes. | TESTE\_LOCAL |
| [/init](init.md) | Initialiser la configuration du projet et son fichier AGENTS.md. | TESTE\_LOCAL |
| [/reinit](reinit.md) | Supprimer la configuration .codebuddy existante et la réinitialiser. | TESTE\_LOCAL |
| [/features](features.md) | Consulter les fonctionnalités déclarées. | TESTE\_LOCAL |
| [/reload](reload.md) | Recharger la configuration sans redémarrer. | TESTE\_LOCAL |
| [/log](log.md) | Retrouver le fichier journal. | TESTE\_LOCAL |
| [/compact](compact.md) | Résumer la conversation pour libérer du contexte. | TESTE\_LOCAL |
| [/plan](plan.md) | Passer en mode de recherche et de planification. | TESTE\_LOCAL |
| [/ultraplan](ultraplan.md) | Faire construire un plan par plusieurs agents spécialisés. | VALIDATION\_SEULE |
| [/config](config.md) | Consulter et valider la configuration. | TESTE\_LOCAL |
| [/login](login.md) | Se connecter à un fournisseur. | VALIDATION\_SEULE |
| [/logout](logout.md) | Effacer les identifiants enregistrés du fournisseur. | TESTE\_LOCAL |
| [/whoami](whoami.md) | Afficher l’état de connexion du compte. | TESTE\_LOCAL |
| [/fast](fast.md) | Configurer le mode à faible latence. | TESTE\_LOCAL |
| [/model](model.md) | Choisir le modèle ou le routage automatique. | VALIDATION\_SEULE |
| [/mode](mode.md) | Changer le mode de travail de l’agent. | TESTE\_LOCAL |
| [/model-router](model-router.md) | Configurer le routage des modèles. | TESTE\_LOCAL |
| [/switch](switch.md) | Changer de modèle pendant la conversation. | ECHEC |
| [/checkpoints](checkpoints.md) | Lister les points de restauration. | TESTE\_LOCAL |
| [/restore](restore.md) | Restaurer un point de sauvegarde. | VALIDATION\_SEULE |
| [/undo](undo.md) | Annuler les dernières modifications de fichiers. | VALIDATION\_SEULE |
| [/redo](redo.md) | Rétablir des modifications annulées. | VALIDATION\_SEULE |
| [/timeline](timeline.md) | Afficher la chronologie persistante de session. | BLOQUE\_PREREQUIS |
| [/diff](diff.md) | Voir les changements Git ou comparer des points de restauration. | TESTE\_LOCAL |
| [/pr](pr.md) | Créer une demande de fusion GitHub ou GitLab. | VALIDATION\_SEULE |
| [/review](review.md) | Faire examiner les modifications de code. | VALIDATION\_SEULE |
| [/commit](commit.md) | Générer un message et créer un commit. | BLOQUE\_PREREQUIS |
| [/worktree](worktree.md) | Gérer des répertoires de travail Git parallèles. | TESTE\_LOCAL |
| [/test](test.md) | Exécuter les tests du projet. | TESTE\_LOCAL |
| [/lint](lint.md) | Détecter et exécuter les outils de contrôle du code. | TESTE\_LOCAL |
| [/fix](fix.md) | Corriger les erreurs de lint et vérifier les types. | BLOQUE\_PREREQUIS |
| [/debug](debug.md) | Activer ou désactiver les journaux détaillés. | TESTE\_LOCAL |
| [/debug-issue](debug-issue.md) | Demander une analyse de problème dans le code. | ECHEC |
| [/refactor](refactor.md) | Demander des améliorations de structure du code. | VALIDATION\_SEULE |
| [/generate-tests](generate-tests.md) | Générer des tests pour un fichier. | VALIDATION\_SEULE |
| [/tdd](tdd.md) | Activer le développement guidé par les tests. | TESTE\_LOCAL |
| [/ai-test](ai-test.md) | Tester l’intégration du fournisseur IA courant. | ECHEC |
| [/watch](watch.md) | Déclencher des contrôles lorsque les fichiers changent. | TESTE\_LOCAL |
| [/conflicts](conflicts.md) | Détecter et résoudre les conflits Git. | ECHEC |
| [/vulns](vulns.md) | Rechercher des vulnérabilités connues dans les dépendances. | TESTE\_LOCAL |
| [/bug](bug.md) | Analyser statiquement des fichiers pour détecter des bugs. | TESTE\_LOCAL |
| [/explain](explain.md) | Faire expliquer du code ou un fichier. | VALIDATION\_SEULE |
| [/docs](docs.md) | Générer de la documentation. | ECHEC |
| [/docs-generate](docs-generate.md) | Générer une documentation complète du projet. | VALIDATION\_SEULE |
| [/security](security.md) | Consulter les réglages et le tableau de sécurité. | TESTE\_LOCAL |
| [/guardian](guardian.md) | Activer Code Guardian pour une analyse du code. | TESTE\_LOCAL |
| [/security-review](security-review.md) | Lancer une revue de sécurité. | TESTE\_LOCAL |
| [/identity](identity.md) | Gérer les fichiers d’identité et leurs liens. | TESTE\_LOCAL |
| [/pairing](pairing.md) | Gérer les autorisations de contact des canaux de messagerie. | TESTE\_LOCAL |
| [/elevated](elevated.md) | Configurer les opérations privilégiées. | TESTE\_LOCAL |
| [/secrets-scan](secrets-scan.md) | Rechercher des secrets inscrits dans les fichiers. | TESTE\_LOCAL |
| [/policy](policy.md) | Gérer les politiques de sécurité et l’arrêt global. | TESTE\_LOCAL |
| [/add](add.md) | Ajouter des fichiers au contexte. | TESTE\_LOCAL |
| [/context](context.md) | Consulter et gérer le contexte chargé. | TESTE\_LOCAL |
| [/workspace](workspace.md) | Détecter et afficher la configuration de l’espace de travail. | TESTE\_LOCAL |
| [/cache](cache.md) | Gérer le cache des réponses. | TESTE\_LOCAL |
| [/dry-run](dry-run.md) | Prévisualiser les changements sans les appliquer. | TESTE\_LOCAL |
| [/prompt-cache](prompt-cache.md) | Gérer la mise en cache des prompts. | TESTE\_LOCAL |
| [/sessions](sessions.md) | Lister les sessions récentes. | TESTE\_LOCAL |
| [/copy](copy.md) | Copier une réponse, du code ou du texte dans le presse-papiers. | VALIDATION\_SEULE |
| [/branch](branch.md) | Gérer les branches de conversation. | TESTE\_LOCAL |
| [/fork](fork.md) | Créer une branche de conversation. | TESTE\_LOCAL |
| [/branches](branches.md) | Lister les branches de conversation. | TESTE\_LOCAL |
| [/checkout](checkout.md) | Changer de branche de conversation. | TESTE\_LOCAL |
| [/merge](merge.md) | Fusionner une branche de conversation. | VALIDATION\_SEULE |
| [/save](save.md) | Enregistrer la conversation dans un fichier Markdown. | TESTE\_LOCAL |
| [/export](export.md) | Exporter une session. | ECHEC |
| [/export-list](export-list.md) | Lister les fichiers exportés. | TESTE\_LOCAL |
| [/export-formats](export-formats.md) | Afficher les formats d’export disponibles. | TESTE\_LOCAL |
| [/memory](memory.md) | Gérer la mémoire persistante. | TESTE\_LOCAL |
| [/remember](remember.md) | Enregistrer une information dans la mémoire persistante. | PARTIEL |
| [/lessons](lessons.md) | Consulter et gérer les leçons apprises. | TESTE\_LOCAL |
| [/knowledge-graph](knowledge-graph.md) | Consulter le graphe de connaissances persistant. | BLOQUE\_PREREQUIS |
| [/persona](persona.md) | Choisir et gérer les personas de l’agent. | TESTE\_LOCAL |
| [/goal](goal.md) | Définir un objectif persistant et contrôler sa poursuite. | TESTE\_LOCAL |
| [/loop](loop.md) | Poursuivre un objectif avec une vérification indépendante. | TESTE\_LOCAL |
| [/subgoal](subgoal.md) | Gérer les critères de réussite de l’objectif actif. | VALIDATION\_SEULE |
| [/yolo](yolo.md) | Configurer l’exécution automatique avec garde-fous. | TESTE\_LOCAL |
| [/autonomy](autonomy.md) | Régler le niveau d’autonomie. | TESTE\_LOCAL |
| [/permissions](permissions.md) | Gérer les permissions des outils. | TESTE\_LOCAL |
| [/approvals](approvals.md) | Consulter les règles et autorisations apprises. | TESTE\_LOCAL |
| [/heal](heal.md) | Configurer la correction automatique. | TESTE\_LOCAL |
| [/starter](starter.md) | Choisir des packs de skills pour un projet. | ECHEC |
| [/tools](tools.md) | Lister et filtrer les outils disponibles. | TESTE\_LOCAL |
| [/pipeline](pipeline.md) | Exécuter et gérer des pipelines. | TESTE\_LOCAL |
| [/skill](skill.md) | Gérer et activer les skills. | TESTE\_LOCAL |
| [/parallel](parallel.md) | Lancer plusieurs sous-agents en parallèle. | VALIDATION\_SEULE |
| [/agent](agent.md) | Gérer les agents personnalisés. | ECHEC |
| [/subagent](subagent.md) | Découvrir les sous-agents conversationnels prédéfinis. | TESTE\_LOCAL |
| [/swarm](swarm.md) | Faire travailler plusieurs agents spécialisés sur une tâche. | TESTE\_LOCAL |
| [/cost](cost.md) | Consulter les coûts suivis. | TESTE\_LOCAL |
| [/stats](stats.md) | Consulter les statistiques de performance. | TESTE\_LOCAL |
| [/tool-analytics](tool-analytics.md) | Consulter l’utilisation et les performances des outils. | TESTE\_LOCAL |
| [/voice](voice.md) | Configurer la saisie vocale. | TESTE\_LOCAL |
| [/speak](speak.md) | Faire lire un texte à voix haute. | TESTE\_LOCAL |
| [/tts](tts.md) | Configurer la synthèse vocale. | TESTE\_LOCAL |
| [/companion](companion.md) | Configurer les capacités vocales et perceptives du compagnon. | BLOQUE\_PREREQUIS |
| [/theme](theme.md) | Changer le thème de couleurs du terminal. | TESTE\_LOCAL |
| [/avatar](avatar.md) | Changer les avatars de conversation. | TESTE\_LOCAL |
| [/vim](vim.md) | Activer ou désactiver les raccourcis Vim. | TESTE\_LOCAL |
| [/search](search.md) | Rechercher du texte dans le code avec ripgrep. | ECHEC |
| [/todo](todo.md) | Lister les commentaires TODO. | TESTE\_LOCAL |
| [/scan-todos](scan-todos.md) | Rechercher les commentaires adressés à l’IA. | ECHEC |
| [/address-todo](address-todo.md) | Traiter un commentaire adressé à l’IA. | VALIDATION\_SEULE |
| [/workflow](workflow.md) | Gérer les workflows CI/CD. | TESTE\_LOCAL |
| [/hooks](hooks.md) | Gérer les actions déclenchées autour des opérations. | TESTE\_LOCAL |
| [/track](track.md) | Gérer des travaux guidés par une spécification. | TESTE\_LOCAL |
| [/colab](colab.md) | Gérer la collaboration de plusieurs IA. | TESTE\_LOCAL |
| [/script](script.md) | Exécuter un fichier Buddy Script. | TESTE\_LOCAL |
| [/fcs](fcs.md) | Exécuter un fichier FileCommander Script. | TESTE\_LOCAL |
| [/plugins](plugins.md) | Gérer les plugins installés et leur catalogue. | TESTE\_LOCAL |
| [/plugin](plugin.md) | Gérer un plugin avec contrôle du propriétaire. | TESTE\_LOCAL |
| [/team](team.md) | Gérer une équipe d’agents. | TESTE\_LOCAL |
| [/batch](batch.md) | Décomposer un objectif et exécuter ses unités en parallèle. | VALIDATION\_SEULE |
| [/think](think.md) | Configurer le raisonnement ou soumettre un problème. | TESTE\_LOCAL |
| [/status](status.md) | Voir les principaux réglages de la session. | TESTE\_LOCAL |
| [/new](new.md) | Ouvrir une nouvelle conversation. | TESTE\_LOCAL |
| [/grill-me](grill-me.md) | Demander une critique technique du travail récent. | ECHEC |
| [/deepthink](deepthink.md) | Examiner un problème sous plusieurs angles en mode lecture seule. | VALIDATION\_SEULE |
| [/btw](btw.md) | Poser une question annexe sans modifier le contexte de conversation. | TESTE\_LOCAL |
| [/heartbeat](heartbeat.md) | Gérer la revue périodique de HEARTBEAT.md. | TESTE\_LOCAL |
| [/daily-reset](daily-reset.md) | Gérer la réinitialisation quotidienne de conversation. | TESTE\_LOCAL |
| [/share](share.md) | Gérer le partage de session. | TESTE\_LOCAL |
| [/agents](agents.md) | Piloter l’orchestration multi-agent. | TESTE\_LOCAL |
| [/fleet](fleet.md) | Découvrir, interroger et piloter les pairs Code Buddy. | TESTE\_LOCAL |
| [/suggest](suggest.md) | Demander des suggestions liées au projet. | TESTE\_LOCAL |
| [/telemetry](telemetry.md) | Configurer la collecte de télémétrie. | TESTE\_LOCAL |
| [/prompt](prompt.md) | Gérer les prompts personnalisés. | TESTE\_LOCAL |
| [/quota](quota.md) | Consulter les limites et quotas disponibles. | TESTE\_LOCAL |
| [/coverage](coverage.md) | Vérifier la couverture des tests. | TESTE\_LOCAL |
| [/voice-code](voice-code.md) | Configurer la conversion de la voix en commandes ou en code. | TESTE\_LOCAL |
| [/transform](transform.md) | Transformer le code selon une stratégie. | TESTE\_LOCAL |
| [/infra](infra.md) | Consulter l’état des services d’infrastructure. | ECHEC |
| [/dev](dev.md) | Exécuter les workflows de développement guidés. | TESTE\_LOCAL |
| [/replace](replace.md) | Rechercher et remplacer du texte dans plusieurs fichiers. | TESTE\_LOCAL |
| [/cloud](cloud.md) | Gérer les tâches des agents cloud. | TESTE\_LOCAL |
| [/trigger](trigger.md) | Gérer les déclencheurs par webhook. | TESTE\_LOCAL |
