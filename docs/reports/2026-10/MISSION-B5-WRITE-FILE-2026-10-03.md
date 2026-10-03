# Mission B5 — write_file / create_file sur fichier existant

Branche : `fix/write-file-existant-2026-10-03`, issue de origin/main. Mission réservée dans la coordination le 03/10/2026 par Codex GPT-6.

Demande : comparer une orientation vers un outil réellement exposé dans le tour à un paramètre overwrite explicite. Préserver confirmation, write policy, revue des diffs et checkpoints. Rapport créé avant le correctif.

Constat initial : write_file est un alias de create_file ; TextEditorTool.create refuse les fichiers existants avec un message citant des noms fixes. Le plan de sortie classe ce comportement bloquant B5.

Validation prévue : régression avec mutation rouge, essai réel buddy loop avec verify-cmd et modèle Ollama outillé, HOME isolé `_qa/write-file/home`, sans -k/-u ; typecheck, lint, tests ciblés. Aucune tâche de fond ni push. Traces et rapport final dans le partage autorisé, sous `20261003-cb-write-file/sol61`.

## Décision et preuves

Le choix est un diagnostic de refus qui nomme un outil réellement exposé et donne ses arguments JSON. Aucun paramètre overwrite n’est ajouté. Le message est construit dans l’adaptateur du registre, à partir du code FILE_ALREADY_EXISTS renvoyé par l’éditeur et de exposedToolNames transmis par runTurnLoop. La liste est celle du tour, après sélection, plafond compact et filtrage modèle. Un alias exposé (patch ou file_edit) est préféré à un nom interne absent. Sans éditeur, le diagnostic propose tool_search seulement si cet outil est exposé ; sinon il annonce l’absence d’éditeur.

Pourquoi éviter overwrite : create est actuellement une création protégée, et le dispatch historique prend un checkpoint de création. Autoriser la réécriture demanderait de modifier le schéma, la validation, les lecteurs et les checkpoints dans plusieurs chemins. Ici l’édition emprunte le chemin existant, déjà soumis à confirmation, write policy, checkpoint et revue du contenu résultant. Aucune garde n’est modifiée.

La recette a révélé deux contraintes supplémentaires : le collecteur séquentiel de loop ne recevait pas exposedToolNames lorsque surface est absente ; le plafond compact retirait tous les éditeurs derrière les alias de lecture/création. La correction transmet la liste sur toutes les surfaces et priorise un éditeur disponible dans les huit schémas. apply_patch est préféré, puis str_replace_editor ou son alias si le profil modèle exclut apply_patch. Aucun schéma filtré n’est ajouté. Le profil qwen3:4b-instruct exclut effectivement apply_patch ; il doit donc conserver str_replace_editor.

## Régressions et recette réelle

- Base : huit nouveaux tests B5 rouges sur l’ancien diagnostic ; candidat initial : huit verts. Mutation rétablissant le message et l’absence du code FILE_ALREADY_EXISTS : huit rouges à nouveau, puis source restaurée.
- Parcours séquentiel testé sans surface CLI, avec write_file/patch/read_file : diagnostic patch et fichier intact.
- Plafond compact : nouveau test rouge sur la sélection historique, qui n’incluait aucun éditeur ; limite de huit et absence de réintroduction d’un outil filtré contrôlées.
- Témoin réel avec ancien message : qwen3:4b-instruct, deux refus write_file puis lectures répétées, trois tours, exit 1, fichier B5_OLD inchangé, vérification rouge. Le juge a affirmé une édition absente des appels enregistrés ; cette affirmation n’est pas retenue.
- Diagnostic seul : modèle suit tool_search, mais l’éditeur découvert est éliminé au tour suivant ; essai arrêté par la limite de 240 s, fichier inchangé.
- Priorité apply_patch seule : profil modèle excluant cet outil, même défaut ; essai arrêté par la limite de 240 s, fichier inchangé.

Les sorties des tentatives intermédiaires restent conservées. Une première assertion sur le seul transcript final laissait passer la mutation de câblage ; l’oracle porte maintenant aussi sur le résultat brut, avant post-traitement. Ancienne condition surface CLI : un rouge ciblé. Ancien plafond : un rouge ciblé. Toutes les sources ont été restaurées après chaque mutation.

Le candidat final récupère deux fois l’échec create_file : lecture, refus sans écriture, str_replace_editor avec les arguments indiqués, contenu exact B5_OK suivi d’un saut de ligne, revue accepted (static: static-gate), vérificateur CONFIRMED et vérification externe exit 0. Le vérificateur est resté inchangé (SHA-256). Mode acceptEdits, write policy confirm, revue statique active, environnement sans clé cloud, HOME jetable demandé. Aucun -k/-u ni service démarré en tâche de fond. CLI source via tsx ; acteur qwen3:4b-instruct présent dans ollama list.

**Limite réelle de la boucle : les deux processus sortent 1, paused après trois tours.** Le juge qwen3:4b-instruct ne fournit pas la preuve structurée exigée pour done. Le juge qwen3.5:4b dépasse son délai de 30 s. La garde de preuve n’est ni désactivée ni corrigée dans cette mission B5. L’écriture après refus est prouvée ; une boucle terminée done/exit 0 ne l’est pas. Le modèle n’a pas respecté la consigne expérimentale de premier appel write_file : il a lu puis utilisé create_file. Les alias sont couverts par les tests de récupération réels du registre ; write_file refusé est aussi enregistré dans le témoin.

La première barrière complète a trouvé une assertion historique imposant str_replace_editor dans l’erreur de bas niveau (257 verts / 1 rouge). Le test a été adapté au contrat FILE_ALREADY_EXISTS et renforcé par l’absence d’appel writeFile. Les autres assertions de refus sont conservées. Nouvelle barrière npm run validate ciblée : exit 0, lint 0 erreur (2 601 avertissements), trois typechecks verts, packaging 11/11, 14 fichiers / 258 tests verts, diff-check vert. Correctif : `62ee3c2018ba7864e11eb1807e0f34edf88a2dab`. Rapport et captures détaillés dans le partage autorisé, sous le dossier sol61 de cette mission.

## Ce que je n'ai pas pu vérifier

- Une boucle terminée done/exit 0 : les écritures et les vérifications réussissent, mais les juges maintiennent paused. Ce défaut reste distinct de B5 et aucune garde de preuve n’a été contournée.
- Windows/macOS, CI GitHub, Grok cloud, qwen3:8b (absent de l’inventaire local), tarball publié : non exécutés.
- Revue full par des modèles et restauration interactive /undo : non exécutées ; la recette utilise la revue statique, et la barrière inclut les tests de checkpoints.
- Fiabilité statistique des petits modèles : deux récupérations réussies ne constituent pas une garantie générale. Suite complète non lancée ; les tests sont ciblés.

## Passation

Huit fichiers fonctionnels : TextEditorTool, adaptateur du registre, runTurnLoop, sélection compacte, quatre fichiers de tests. Branche dédiée conservée ; aucun push. Rapport et coordination portent le commit documentaire suivant. Les checkpoints, la confirmation, la write policy et le moteur de revue ne sont pas modifiés.

Incident de maintenance Git : le premier commit a annoncé un gc automatique en arrière-plan. Le PID du verrou n’était plus visible au contrôle depuis le confinement ; son arrêt global n’est pas certifié. Le commit documentaire utilise gc.auto=0 et maintenance.auto=false, sans changer la configuration persistante du dépôt. Aucune commande de service/daemon ni autre tâche de fond volontaire n’a été lancée. Les deux essais finaux de recette ont confirmé l’absence de groupe de processus restant.
