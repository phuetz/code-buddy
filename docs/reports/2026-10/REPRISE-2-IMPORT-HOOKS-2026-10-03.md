# Seconde reprise de l’import des hooks — 03/10/2026

Les trois rapports et la mission ont été lus intégralement avant modification. Malgré la première relecture favorable, les cinq bloquants des contre-revues Grok/Gemini sont acceptés et traités. Même branche `feat/import-hooks-2026-10-03`, départ `c9ca0c1e2`, mission `b7a1b34e8`, correctif `14eb4de76`. Scanner partagé laissé intact.

| Bloquant | Traitement | Preuve |
|---|---|---|
| Shell copié : backticks, secrets, glob/tilde | Politique propre aux scripts shell ; syntaxe non prouvée en quarantaine ; aucun motif perdu | Cas adversariaux et mutations des expansions, printf, contrôles et grammaire ; 6 payloads CLI en quarantaine, activation refusée |
| Vérification après activation échouant ouvert | Scanner partagé à chaque exécution, sur fichiers et octets capturés ; erreurs de bundling propagées | Manifestes activés/re-hashés : refus ; mutant runtime rouge ; vrai buddy -p bloqué sur le manifeste forgé |
| Descendant setsid après délai PreCompact | Superviseur Linux child-subreaper : groupe + tous descendants adoptés tués/réapés, pipes non bloquants | Deux cas PreCompact, mutants rouges ; 10 mesures réelles, 0 survivant |
| Commande native asynchrone ignorant SIGTERM | Même supervision dure ; refus de commande sans capacités, timeout PreToolUse fermé | Avec/sans setsid : mutants rouges ; 10 mesures réelles, 0 survivant ; refus simulé hors Linux |
| Résolution package.json hors bundle | Champs de chargement/code en quarantaine ; métadonnées passives remplacées par type seul | Main absolu/relatif, exports/imports/bin/scripts, parents implicites/racine ; deux mutations rouges ; cas CLI refusé à l’activation |
| Réserves | Chemin secret reconstruit refusé avant mise à jour d’outil ; copie privée des octets vérifiés ; JSON invalide/signal échoue fermé. Alias -a infirmé (Commander ne déclare que --apply), détection défensive conservée | Mutants spécifiques rouges ; CLI réel refuse -a |

Rectification lors de la troisième reprise : les contrôles ci-dessous précédaient l’ajout du document de preuves. Ils ne validaient pas le commit documentaire final `e15d4b7ec`. La revue indépendante a reproduit 1 100 tests verts, 1 rouge et 3 ignorés à cette révision ; le rouge concernait un chemin personnel dans ce rapport. Le chemin est retiré sans modifier le garde d’hygiène. Voir la [troisième reprise](REPRISE-3-IMPORT-HOOKS-2026-10-03.md) pour la barrière après tous les ajouts.

Barrière avant ajout documentaire : typecheck complet 0 ; lint complet 0 erreur / 2 601 avertissements ; tests ciblés 1 101 verts / 3 ignorés, 49 fichiers verts et 1 ignoré. 41 nouveaux tests de contre-revue ; 17 mutations tuées avec 41 assertions rouges et sources restaurées. Jamais la suite complète.

20 mesures réelles de processus : 309–448 ms, aucun descendant survivant. Deux manifestes d’attaque préexistants encore activés dans le worktree ont été préservés à l’identique hors du répertoire chargé ; la première passe élargie les bloquait correctement. Barrière verte après isolation, sans suppression de preuve.

ECC local cloné dans un HOME neuf : 24 handlers, 0 admissible / 9 quarantaines / 15 refus. Mode rapport : snapshots HOME/workspace/ECC inchangés. Les vrais buddy -p avec Ollama qwen3:4b-instruct prouvent SessionStart, PreToolUse (redirection effective de view_file) et SessionEnd. Les hooks de recette et le manifeste forgé ont été désactivés après mesure.

Rapport détaillé avec tableau, sorties brutes, scripts et SHA-256 remis dans le dossier d’échange convenu, hors dépôt public, avec son sous-répertoire de preuves. Aucun push ni tâche autonome de fond.

## Ce que je n'ai pas pu vérifier

Windows/macOS réels non exécutés ; les handlers de commande y sont refusés. Linux nécessite Python3, /proc et child-subreaper ; cette politique statique n’est pas une sandbox contre un compte système compromis. PreCompact exécuté avec vrais processus et tests de producteur, pas une compaction déclenchée dans une conversation modèle. Aucun hook ECC admissible activé ; aucune CI distante, intégration de la lane parallèle, suite complète, build ou packaging. Les familles natives HTTP/prompt/agent ne sont pas importées et restent hors de cette reprise. Le JSON CLI omet le résultat d’outil bloqué : les traces stderr, la sonde réelle et la réponse modèle prouvent ici le refus ; ce défaut d’observabilité n’est pas corrigé.
