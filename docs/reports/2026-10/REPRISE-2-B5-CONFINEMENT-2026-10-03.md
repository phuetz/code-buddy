# Seconde reprise B5 — confinement avec revue éteinte

Worktree `/data/patrice/DEV/cb-write-file-2026-10-03`, branche `fix/write-file-existant-2026-10-03`, départ `3f6940412`. Revue `reprise-1/revue/RAPPORT.md` et mission `reprise-1/sol61/MISSION.md` lues intégralement. Correctif : **`a65a9ab790f14d6daf7d404eec070ed58400c52b`**. Réservation et rapport de mission dans le dépôt créés avant les modifications fonctionnelles.

| Bloquant / défaut | Traitement | Preuve |
|---|---|---|
| **B1 — parent échangé pendant confirmation, revue off : succès et publication hors base** | **Confirmé et corrigé.** La liste blanche du workspace reste distincte de la base de création. `TextEditorTool.create` appelle `assertCreationWithinBase` avant `ensureDir` sur le chemin sans revue. Le callback de `UnifiedVfsRouter.createFile` refait ce contrôle physique avant ouverture du temporaire et avant publication exclusive, en plus de la validation workspace/secrets existante. | `tests/tools/create-file-base-containment.test.ts` : base tmp → autre tmp ; base dépôt → tmp ; base dépôt → autre dossier du workspace hors base. Échange pendant confirmation, cible sous un parent manquant : refus, extérieur et ancien parent vides. Échange après `ensureDir` : refus et extérieur vide. VFS direct : refus. Avant correctif : **5 rouges / 1 vert**. Après : **6 verts**. Mutation retirant le contrôle avant ensureDir : **3 rouges**, répertoire `nested` créé dehors. Mutation retirant le contrôle VFS : **2 rouges**, publication après ensureDir / VFS direct. |
| **Généralisation incorrecte du rapport précédent** | **Rectifiée.** La preuve précédente concernait exclusivement l’échange au checkpoint sous revue static. Elle ne prouvait pas le confinement pendant confirmation sous revue off. Le présent rapport remplace cette affirmation générale par les scénarios précisément exécutés. Les rapports précédents sont conservés comme archives. | Contre-revue lue en entier ; nouvelle régression rouge sur `3f6940412`, puis verte avec les deux gardes. Aucun bloquant actuel contesté. |
| **Intégration : base du processus hôte utilisée pour une session embarquée** | **Corrigée à la cause**, après la première barrière. L’adaptateur transmet `context.cwd` à la création. La base est un paramètre local à chaque appel de `TextEditorTool.create`, utilisé pour résolution, revue et création VFS. Aucun changement de la base du singleton partagé. Sans contexte, la base configurée de l’éditeur reste utilisée. | Les créations relatives et absolues dans la session passent ; les chemins absolus hors base sont refusés ; sans contexte, création dans la base du processus autorisée et cible tmp hors base refusée. Deux créations concurrentes sur le même adaptateur restent dans leurs sessions respectives. Mutation omettant la transmission de base : **4 rouges**. Les anciens cas autorisant une création absolue hors base ou avec une base inexistante ont été remplacés par ces contrats explicites de confinement. |
| **Mutations antérieures que la revue n’avait pas rejouées** | Les dix mutations de la reprise précédente ont toutes été rejouées sur cette reprise, puis les trois nouvelles mutations. | **13/13 détectées**, sources restaurées dans un `finally`. En particulier : G2-intent-lost **1 rouge**, G2-transaction-overwrite **2 rouges**, G2-revision-intent-lost **1 rouge**. Substitutions exactes et sorties dans [mutations.json](traces/mutations.json), journaux `mutant-*.log`. |

La revue actuelle ne liste qu’un bloquant. Ses notes sur les fenêtres synchrones et les plateformes non exécutées restent des limites de vérification ; elles ne sont pas transformées en assertions de sûreté exhaustive. Le défaut documentaire est reconnu, sans contester la mesure adverse.

## Code et comportement

Le contrôle physique commun compare la base réelle avec le plus proche ancêtre existant du parent cible. Il voit ainsi un parent remplacé par un lien, même si `resolvePath` renvoie le même chemin lexical et que sa destination réelle est autorisée dans `/tmp` ou ailleurs dans le workspace. Le contrôle **avant ensureDir** empêche aussi la création de répertoires hors base ; celui du **callback exclusif VFS** protège la reprise après cette pause asynchrone et les appels VFS directs. L’erreur du helper et son commentaire parlent désormais de base de création, avec ou sans revue.

Une création légitime sous parents nouveaux passe toujours. Un lien de parent restant dans la base passe aussi, avec octets exacts vérifiés. L’adaptateur accepte toujours les chemins absolus, tout en vérifiant qu’ils appartiennent à la base de session ; il ne tire jamais une autorisation de la seule liste blanche du workspace. La base d’appel est fournie par le contexte d’exécution, pas par un nouveau paramètre du schéma exposé au modèle.

Aucun overwrite ajouté, aucune confirmation supprimée, aucune exception nouvelle à WritePolicy, aux secrets ou à la revue. Le contrôle supplémentaire se place sur le chemin de création existant ; la transaction revue, ses checkpoints et son rollback restent inchangés. Le code des conseils et du plafond compact garde les régressions antérieures. La création conserve la publication exclusive par lien dur et les permissions 0600 introduites à la reprise précédente ; aucun repli écrasant n’est ajouté.

## Régressions et barrière finale

| Vérification | Résultat et trace |
|---|---|
| Régression B1 avant correction | **5 échecs / 1 réussite**, `traces/avant.log` |
| Premier lot après correction | **83/83**, `traces/apres.log` |
| Première barrière globale | 514/518 ; quatre échecs du fichier cwd révélant la base hôte incorrecte, `traces/validate-final.log` ; cause corrigée, aucun échec ignoré |
| Intégration session avant cas concurrent supplémentaire | **86/86**, `traces/base-session-vert.log` |
| **Tests finaux complets ciblés** | **33 fichiers / 521 tests, exit 0**, `traces/tests-session-final.log` ; arguments exacts dans `traces/tests-session-command.json` |
| **npm run validate** sur le contrôle du paquet | **exit 0**, `traces/validate-session-final.log` : lint, trois typechecks, check:pack, test pack. La reprise automatique des arguments avait sélectionné la première ligne Vitest du log (pack), donc les 33 fichiers ont été rejoués séparément et intégralement |
| npm run lint, dans validate | **0 erreur / 2 601 avertissements**, exit 0 |
| npm run typecheck, dans validate | Principal, identité GPU, companion-core : **exit 0** |
| npm run check:pack et test pack | **11/11 chacun**, exit 0 ; ce ne sont pas des installations du tarball |
| Mutations finales | **13/13 détectées par assertions**, dont les trois liées au présent confinement / contexte |
| git diff --check | exit 0 |

Les 521 tests incluent revue static/full avec client scripté, refus d’écrasement et alias, boucle séquentielle, filtres, confirmations, politique d’écriture, checkpoints, VFS, secrets et isolation. Darwin/Win32 dans ces tests sont des simulations sous Linux. Le mock unitaire d’éditeur n’utilisant pas de vrais fichiers reçoit un mock du nouveau contrôle physique ; les nouvelles preuves de confinement utilisent le vrai filesystem et l’isolement réel. Seules la réponse humaine et la pause ensureDir sont scriptées pour provoquer les courses, sans processus de fond.

## Essais réels buddy loop / Ollama

`ollama list` est recapturé dans `traces/ollama-list.log` ; modèle **qwen3:4b-instruct**, appels d’outils structurés observés. Exécution source via tsx, `HOME=_qa/write-file/home`, fournisseur Ollama forcé, environnement minimal sans clés fournisseurs, `acceptEdits`, revue **off** (valeur par défaut du produit), write policy confirm ; aucune utilisation de `-k`, `-u`, YOLO ou bypassPermissions. Chaque commande est attendue jusqu’à sa sortie, avec borne de 240 s et contrôle de son groupe de processus.

| Essai | Résultat |
|---|---|
| `reprise-2-b5-off` — B5 plus création d’un fichier auxiliaire | **170,56 s**, create_file refusé sur answer.txt → view_file → str_replace_editor → create_file pour created.txt. `answer.txt = B5_OK\n`, nouvelle création réelle `created.txt = CREATED` sans le retour ligne demandé. **verify exit 1**, vérificateur inchangé, loop paused/exit 1. Trace conservée comme échec de la recette auxiliaire ; ne prouve pas ses exigences complètes. Cet essai précède l’intégration finale de la base de session. |
| **`reprise-2-b5-original` — recette B5 d’origine sur sources finales** | **86,87 s**, récupération du refus de création via lecture et édition ; octets exactement **`B5_OK\n`** ; **verify exit 0, B5_VERIFIED**, vérificateur inchangé. CONFIRMED sur les trois tours, mais **loop paused / exit 1** faute de preuve structurée du juge. |

Aucun vérificateur existant n’a été changé pour obtenir le résultat vert : le second essai est un autre projet neuf, avec la recette B5 initiale. Le premier montre une création ordinaire réelle sous revue off, mais son exigence auxiliaire de retour ligne n’est pas satisfaite. L’erreur de contenu du modèle n’est pas attribuée au confinement.

Comme dans les reprises précédentes, le plafond retire write_file et patch du tour réel ; `create_file` est exposé et le prompt autorise ce nom. L’alias write_file reste couvert par les tests. Aucun outil retiré par le profil n’est réintroduit. Aucun résultat `done` / exit 0 n’est revendiqué.

Les traces contiennent commandes/environnement minimal, stdout/stderr, événements et résultats bruts d’outils, vérificateurs, fichiers produits et résumés. Les dix SHA-256 source capturés avant **l’essai final** correspondent au correctif committé (`traces/sources-finales-verifiees.json`). Les runners n’observent aucun groupe de processus résiduel ; tous les sous-processus de cette reprise sont attendus. Aucun push ni tâche de fond lancé ; entretien automatique Git désactivé lors des commits et git init de recette.

Rejeu des mutations : depuis le worktree, `python3 /home/patrice/Videos/Partage/20261003-cb-write-file/reprise-1/reprise-1/sol61/REJOUER-MUTATIONS.py`. Rejeu CLI : définir `B5_REPO` sur ce worktree, puis exécuter `REJOUER-B5.py` avec un nouveau label absent de `_qa/write-file`. `REJOUER-B5-CREATION.py` conserve la variante auxiliaire. Les journaux précédents n’ont pas été écrasés ; dans ce dossier, les journaux des mutants correspondent au dernier rejeu sur le candidat corrigé.

## Ce que je n'ai pas pu vérifier

- Fermeture `done` / exit 0 de buddy loop : l’essai B5 final reste paused malgré le vérificateur confirmé. La variante auxiliaire reste rouge sur le retour ligne de created.txt. Aucun taux de fiabilité du petit modèle mesuré ; qwen3:8b initial non exécuté.
- Toutes les permutations de concurrence : fenêtres synchrones entre validate/open/link, échanges de répertoire à chaque appel système, parent pendant lors de la remontée d’ancêtres, changement de la base elle-même et pannes matérielles non mesurés. Les échanges pendant confirmation et après ensureDir sont provoqués de manière déterministe ; ils ne constituent pas une preuve formelle de toutes les courses filesystem.
- Windows/macOS natifs, CI GitHub, tarball installé, système de fichiers sans liens durs, suite Vitest entière, /undo interactif et interfaces tierces/flotte : non exécutés. Aucun nouveau build dist dans cette seconde reprise ; CLI testée depuis les sources finales.
- Revue full avec un vrai LLM externe, shadow workspace activé et workflow complet d’une interface embarquée : non exécutés. Les tests de revue et de contexte ciblés passent ; la recette réelle reste CLI/Ollama avec revue off.
- État hôte d’un ancien GC Git annoncé dans la mission initiale non certifiable depuis le confinement. Aucun entretien automatique ni travail de fond ajouté dans cette reprise.
