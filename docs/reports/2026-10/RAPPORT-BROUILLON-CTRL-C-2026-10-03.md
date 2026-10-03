# Mission — restaurer un brouillon effacé par Ctrl+C

Date : 2026-10-03. Agent : Codex. Branche : `feat/brouillon-ctrl-c-2026-10-03`.
Base propre : `70bcab004` (origin/main fourni). Correctif : `99202cbb4`.

## Mission rédigée avant modification des sources

Garder en mémoire volatile le dernier brouillon annulé, puis le restaurer avec Flèche haut lorsque la saisie est vide. Consommer le brouillon restauré ou envoyé ; préserver historique, navigation multiligne et comportement de sortie. Examiner les images et pièces jointes réellement prises en charge.

Le chantier a été réservé dans `docs/FABLE5-CODEX-COORDINATION.md` avant modification des sources. Vérifications prévues : vrais hooks React, mutation, essai Linux en PTY avec profil temporaire, `npm run typecheck`, `npm run lint`, tests ciblés. Aucun push ni tâche de fond.

## Lecture et comportement retenu

- L'effacement Ctrl+C se trouve dans `src/hooks/use-enhanced-input.ts`, appelé par `use-input-handler.ts`. `use-input-history.ts` possède l'historique des messages et un index de navigation, tous deux en mémoire. Un autre gestionnaire fournit l'historique persistant des messages envoyés et la recherche Ctrl+R.
- `src/index.ts` activait `exitOnCtrlC: true` : dans l'application réelle, Ink quittait dès le premier Ctrl+C. Aucun mécanisme temporisé de double Ctrl+C n'a été trouvé. Le double Échap de 500 ms déclenchant `/undo` est distinct et reste inchangé.
- Le compositeur Ink (`ChatInput`, hooks et `ChatInterface`) possède uniquement une chaîne de texte et un curseur. Aucun état de pièces jointes ou collage binaire d'images n'est câblé dans ce parcours. `src/input/multimodal-input.ts` contient un lecteur d'image du presse-papiers séparé, sans appel depuis le compositeur. Les chemins et références d'images présents dans le texte sont conservés à l'identique ; aucune prise en charge nouvelle des images binaires n'est annoncée.

Ctrl+C sur un texte non vide, même constitué d'espaces, remplace le brouillon annulé précédent puis vide la saisie. Flèche haut sur saisie strictement vide restaure ce texte exact une seule fois, avec le curseur à la fin. La pression suivante entre dans l'historique, même après un collage multiligne ; après modification du texte restauré, les flèches retrouvent leur navigation multiligne habituelle.

La navigation historique est remise au point de départ lors de l'annulation, sans supprimer ses entrées. Restaurer ou envoyer consomme le brouillon annulé ; les envois passant par la complétion des commandes le consomment aussi. Une saisie non vide n'est jamais écrasée par ce brouillon.

Le cache est un `useRef` propre à chaque instance du hook : aucune sérialisation, écriture de fichier ou ajout à l'historique lors de l'annulation/restauration. L'historique des messages effectivement envoyés conserve son fonctionnement existant. Ctrl+C sur saisie vide appelle la sortie Ink : deux Ctrl+C successifs annulent puis quittent. Les fenêtres de confirmation et le sélecteur de modèles conservent la sortie Ctrl+C. L'aide et le guide sont actualisés.

## Vérifications exécutées

| Vérification | Résultat |
| --- | --- |
| `npm run typecheck` | Exit 0, y compris gpuNode-identity et companion-core |
| `npm run lint` | Exit 0 ; 0 erreur, 2 601 avertissements du dépôt |
| ESLint ciblé final | Exit 0 ; 3 avertissements sur des lignes inchangées, nouveau test sans avertissement |
| Tests ciblés | 8 fichiers, 321 tests verts ; 13 nouveaux cas des vrais hooks React + 3 cas du câblage Ink |
| Mutation supprimant la sauvegarde | 11 échecs / 12 tests exécutés ; code restauré dans `finally`, puis suite verte |
| PTY sur application d'origine | Brouillon visible, puis premier Ctrl+C quitte avec exit 0 ; restauration impossible |
| PTY sur application modifiée | Collage multiligne, annulation, restauration, historique suivant, consommation et double Ctrl+C vérifiés ; exit 0 |
| Profil temporaire réel | Marqueur du brouillon annulé absent de tous les fichiers du profil |
| Réponse du vrai modèle local | `qwen3:4b-instruct` via Ollama répond `HISTORIQUE_QA`, constaté avant et après |
| Script Python / diff | Compilation Python et `git diff --check` verts |

Commande des tests :

```sh
npm test -- --configLoader runner tests/hooks/cancelled-input-draft.test.tsx tests/hooks/slash-input-runtime.test.tsx tests/hooks/input-handler-queue.test.tsx tests/ui/cli-input-runtime.test.ts tests/unit/use-input-history.test.ts tests/unit/use-enhanced-input.test.ts tests/unit/use-input-handler.test.ts tests/hooks/input-handler.test.ts
```

`--configLoader runner` évite l'écriture Vite dans le `node_modules` partagé, monté en lecture seule. Le premier lancement sans cette option échouait avant les tests (`EROFS`). La mutation représentative et sa sortie rouge sont livrées sous `mutation-sauvegarde.patch` et `mutation-sauvegarde-rouge.log` ; elle remplace `cancelledDraftRef.current = input` par `null`. Une première mutation exploratoire d'inversion de garde (12 rouges) est conservée également.

Recette reproductible : `python3 scripts/verify-cancelled-draft-pty.py --entry src/index.ts --out <nouveau-dossier>`. Le témoin `--before` utilise une copie isolée de HEAD initial sous `/tmp`, sans modifier les sources en cours. Pas de serveur ajouté, délégation, cron, workflow autonome ou commande détachée. Chaque processus CLI est supervisé et terminé ; les profils temporaires sont nettoyés. La revue automatique et les snapshots sont désactivés dans ces profils, la vérification npm utilise un cache synthétique frais.

Traces : `<partage>/20261003-cb-brouillon-ctrlc/sol61/`. `pty-avant` et `pty-apres-3` contiennent entrées, sorties ANSI/asciicast, texte et étapes assertées. `controle-captures.json` confirme les deux réponses du modèle et l'absence de dialogue d'outil observé. Aucun appel d'outil n'était nécessaire pour cette recette de saisie ; les requêtes HTTP du modèle ne sont pas interceptées. Les premiers essais échoués sont conservés : résolution de tsx depuis le profil temporaire, puis emploi de `/status`, qui contourne l'historique du hook via le menu de commandes. Ces erreurs de recette ont été corrigées avant la preuve finale.

## Ce que je n'ai pas pu vérifier

- Windows/PowerShell/Windows Terminal, macOS et les presse-papiers natifs de ces plateformes : non exécutés.
- Restauration d'images binaires ou de pièces jointes natives : le compositeur Ink examiné ne les gère pas.
- Suite complète du dépôt, Cowork Electron, paquet npm reconstruit et CI distante : non exécutés ; les tests ciblés et l'application TypeScript réelle ont été exécutés.
- Trace HTTP exhaustive des appels/résultats du fournisseur : non capturée ; les réponses du modèle sont vérifiées dans les sorties terminal.

Livraison locale en commits français, fichiers ajoutés nommément. Aucun push. Le rapport utilisateur final dans le partage donne les deux commits et l'état Git après passation.
