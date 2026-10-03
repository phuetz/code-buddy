# Seconde reprise du brouillon Ctrl+C — mission du 2026-10-03

Départ : `502012aa3`, branche `feat/brouillon-ctrl-c-2026-10-03`, worktree propre.
Revue lue intégralement : `Partage/20261003-cb-brouillon-ctrlc/reprise-1/revue/RAPPORT.md`.

Traiter le bloquant : après restauration multiligne, Flèche bas en dernière ligne doit préserver le prochain Haut vers l’historique. Ajouter une régression rouge avant correction. Renforcer les preuves de déplacement du curseur, de Ctrl+R/Ctrl+C sur un même callback et de fin réelle du tour modèle dans le PTY ; préciser l’aide. Vérifier avec mutation, tests ciblés, typecheck, lint et CLI réel en profil temporaire. Commits en français, ajouts nommés, aucun push ni tâche de fond ; état Git vide à la livraison.

Rapport et traces : `Partage/20261003-cb-brouillon-ctrlc/reprise-1/reprise-1/sol61/`.

## Traitement et preuves

| Point de la revue | Traitement | Preuve |
| --- | --- | --- |
| Bloquant : Bas sans déplacement après restauration multiligne désarme Haut | Retrait de l’effacement prématuré du drapeau dans la branche multiligne. Le setter du curseur le retire toujours lors du déplacement réel. | Test `a no-op Down after multiline restoration preserves the next Up into history` rouge sur `502012aa3`, vert après ; réintroduction de la ligne fautive détectée. PTY sur la base : échec `next_up_after_noop_down_uses_history`. |
| Réserve B1 : le test ne distinguait pas le rôle du setter | Ajout d’un geste utilisateur indépendant : restauration, Gauche, Haut déplace dans le texte. | Test `moving Left after multiline restoration resumes Up within the draft` ; retirer l’effacement dans le setter fait afficher `sent` à la place de `abc\ndef`. |
| Réserve B4 : récupération du nouveau callback entre deux frappes | Capture du callback avant Ctrl+R, puis Ctrl+C brut sur cette même closure. | Mutation retirant la lecture locale du ref détectée : `onEmptyInterrupt` est appelé. |
| Aide trop large Up/Down | Ligne dédiée `Up (empty)` pour la restauration ; guide précisant Bas sans déplacement. | Test de la sortie réelle du handler `/shortcuts`. |
| PTY : un ancien Ready ou du texte en génération pouvait valider la fin | Émulation ANSI via pyte 0.8.2 installé dans `/tmp` ; bulle d’assistant, usage et écran Ready sans génération stables une seconde. | Captures `model-completed-screen.txt`, réponse `model-answer.txt`, cast et journal d’événements. La conformité à l’écho ne conditionne pas un test de navigation. |

Les trois mutations sont rouges par assertions comportementales, puis le source est restauré exactement. Les traces sont dans le nouveau dossier de partage, sans remplacement des rapports antérieurs.

## Vérification

`npm run typecheck` : exit 0. `npm run lint` : exit 0, 0 erreur, 2 601 avertissements préexistants. Les onze fichiers ciblés : 487 tests verts ; les tests des véritables hooks et de l’intégration Ink sont les preuves de comportement, pas les 487 pris indistinctement. Syntaxe Python et `git diff --check` vérifiés.

CLI Linux réel : source `src/index.ts`, profil temporaire, Ollama existant `qwen3:4b-instruct`. La base échoue au contrôle Haut après Bas sans déplacement, après une réponse `HISTORIQUE_QA` effectivement terminée. Premier essai après correction interrompu par le prédicat trop strict d’écho : le modèle avait répondu un refus et l’écran était Ready. Cette trace est conservée, pas comptée verte. Le rejeu final, acceptant toute bulle d’assistant terminée, passe 19/19 contrôles, sortie 0, y compris le nouveau parcours, B1–B4, double Ctrl+C, consommation et absence des marqueurs sur disque. Relecture ANSI des deux premières traces : sept et six écrans avec réponse mais interface occupée sont correctement rejetés.

Dossiers de traces : `pty-avant`, `pty-apres` (premier essai non validé) et `pty-apres-rejeu` (vert). `pyte==0.8.2` est une dépendance de recette installée dans `/tmp`, pas une dépendance applicative ; installation et invocation figurent dans le script. Aucun service ni tâche détachée créé. Les processus de recette ont tous terminé ; celui de la base et celui de l’essai non validé ont été arrêtés par le nettoyage supervisé du script.

## Livraison locale

Correctif `157e52945` — `fix(saisie): préserver Haut après Bas sans déplacement`. Ajouts nommés, aucun push ; coordination libérée dans le commit de passation. Rapport détaillé et sommes SHA-256 dans le nouveau dossier de partage.

## Ce que je n'ai pas pu vérifier

Windows, PowerShell, Windows Terminal, macOS et leurs presse-papiers ; Cowork, suite complète et CI distante ; paquet npm publié ; images binaires (le compositeur Ink porte du texte, `@image-qa.png` est une référence textuelle) ; un écran d’erreur démontant le handler ; rollback réel `/undo` ; annulation pendant une génération et trafic HTTP exact. La recette utilise le source TypeScript avec un profil temporaire et un modèle Ollama existant, sans service créé ni tâche de fond.
