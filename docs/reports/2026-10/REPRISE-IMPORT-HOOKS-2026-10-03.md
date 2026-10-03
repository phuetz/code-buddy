# Reprise de l’import des hooks — 03/10/2026

Revue indépendante et addendum Grok lus intégralement ; trois bloquants acceptés. Mission réservée par `487e5e78e`, correctif `ea349f29a`, branche `feat/import-hooks-2026-10-03`. Insertion conservée dans UserHooksManager ; aucun fichier du scanner partagé modifié, aucune intégration de la lane parallèle.

| Bloquant / réserve | Traitement | Preuve |
|---|---|---|
| Constructeurs/eval via globals calculés | Politique propre aux hooks : calcul d’accès, réflexion, globals et alias de process en quarantaine ; recontrôle des anciens bundles | Charges Function/eval importées en quarantaine et enable refusé ; régressions et mutations rouges |
| Lecture SSH par template | Modules fichier et environnement ambiant interdits ; secrets et écritures de configuration en quarantaine | Clé factice isolée, charge SSH et persistance refusées ; mutants filesystem/environment rouges |
| Descendants PreCompact | Superviseur synchrone POSIX : SIGKILL de tout le groupe, nettoyage à la fermeture | 5 descendants ignorant SIGTERM : timeout 250 ms, retours 291–317 ms, kill(pid,0) confirme disparition ; mutant SIGTERM rouge |
| Stdin inventé | source/reason omis sans valeur réelle ; trigger limité à PreCompact ; champs d’outil limités aux outils | 4 contrats vérifiés ; mutant stdin rouge ; traces de sessions réelles |
| HOME non neuf | Nouvelle recette dans un HOME et projet vierges, avant toute écriture | Contenus, taille, mode et mtime identiques après rapport seul ; HOME toujours vide |
| Bundle altéré autorise l’outil | Blocage PreToolUse sur intégrité/évaluation/timeout/sortie excessive ; commande et dépendances retraduites | Assertions allowed:false et mutants integrity/dependencies rouges |
| Type natif inconnu ou garde illisible | Validation des types, relecture avant outil ; seul ENOENT signifie absence de stockage importé | Vrais buddy -p : BLOQUE pour inconnu/absent/EISDIR ; EACCES injecté et mutant dédié rouge |
| Schéma ECC et root copié | Traduction matcher/hooks et CLAUDE_PLUGIN_ROOT conservée ; extensions d’interpréteurs contrôlées | 65 tests de l’importeur conservés ; traces du bundle local ; mutant extension rouge |

## Vérifications

`npm run typecheck` vert, sous-projets inclus. `npm run lint` : 0 erreur, 2 601 avertissements existants. Sélection `tests/hooks`, `tests/skills`, scanner/pare-feu, frontières et exécuteur agent, garde des données personnelles : **1 060 tests verts, 3 sautés ; 48 fichiers verts, 1 sauté**. Les sauts concernent les skills bundled optionnels absents. Reprise : 31 régressions ; groupe direct des hooks : **126 verts après restauration**. **18 mutations** provoquent des assertions rouges ; sources restaurées. Aucune suite complète.

ECC au commit `ef648e01899ba3e8dc6371642deaaf64b4477775`, nouveau clone local du snapshot déjà acquis : **24 handlers, 0 admis / 9 quarantaines / 15 refus**. Quarantaines : dynamic-require ; refus : Stop 7, async 3, PowerShell 2, MultiEdit 2, Skill 1. Aucun hook ECC activé.

Recette admissible séparée avec vrai `buddy -p`, Ollama qwen3:4b-instruct : désactivé → lecture `DISABLED_REPRISE_CONTROL` ; activé → le hook Read modifie file_path et view_file retourne réellement `ACTIVATED_REPRISE_IMPORTED_HOOK`. SessionStart et SessionEnd observés en stderr depuis les bundles copiés. Les 3 hooks sont ensuite désactivés ; **0 enabled** au bilan. Quatre charges adversariales supplémentaires restent en quarantaine et leurs enable échouent.

Rapport détaillé, tableau de preuves, captures, scripts et SHA-256 dans le partage demandé : `20261003-cb-import-hooks/reprise-1/sol61/RAPPORT.md` et `preuves/`. Les affirmations de la livraison précédente sur les constructeurs et le timeout synchrone étaient trop larges et sont corrigées par cette reprise.

## Ce que je n'ai pas pu vérifier

Windows, macOS, Electron, paquet npm et CI distante non exécutés. Les imports POSIX restent refusés sous Windows ; le runner natif Windows n’a pas été modifié. Compatibilité complète ECC non établie : aucun de ses hooks n’est admissible dans ce snapshot. Lane du scanner partagé non intégrée. Aucun secret réel utilisé ; EACCES du stockage importé est simulé, EISDIR natif réel. PreCompact mesuré via le manager et des processus réels, sans compaction provoquée par le modèle dans buddy -p. Le budget de commande exclut le lancement du superviseur. Le JSON CLI omet les messages d’outil bloqué : refus natifs corroborés par stderr, réponse BLOQUE et tests de la frontière allowed:false.

La politique statique ne constitue pas un confinement OS universel ; les capacités fs/réseau/sous-processus restent en quarantaine même pour des usages légitimes. Aucun service ou agent auxiliaire lancé ; recettes attendues au premier plan, descendants terminés, aucun push.
