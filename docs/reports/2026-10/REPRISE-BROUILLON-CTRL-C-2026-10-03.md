# Reprise — brouillon annulé par Ctrl+C

2026-10-03, Codex. Même worktree et branche `feat/brouillon-ctrl-c-2026-10-03` ; départ propre `ee19884e8`. Correctif de reprise : `d42972103`.

Mission de reprise rédigée et chantier réservé avant modification des sources. La mission d'origine et les deux rapports ont été lus intégralement : la revue indépendante conclut PRÊT, puis Gemini rejette quatre interactions. Objectif : un test dédié par bloquant, reproduction avant correction, traitement des réserves avérées, mutations, recette PTY, barrières typecheck/lint/tests. Aucun push ni tâche de fond.

## Bloquant → traitement → preuve

| Bloquant Gemini | Traitement | Preuve |
| --- | --- | --- |
| **B1 — Flèche bas effacerait définitivement le texte restauré** | L'effacement allégué est contesté : `navigateHistory('down')` renvoie `null` à l'index −1, et le hook ne modifie le texte que si le retour est non nul. Aucun `clearInput()` dans cette branche. Le défaut réel est le blocage du déplacement multiligne : seule la première Flèche haut après restauration peut contourner cette navigation ; les déplacements du curseur désarment ce raccourci. | Test dédié `B1: Down preserves a restored single-line draft...` **vert sur l'ancien code**, 1/1 (`B1-suppression-contestee-ancien-code.log`). Test distinct `B1: Down moves within...` rouge avant (curseur 0 au lieu de 4), vert après. Mutation B1 : 1 rouge. PTY : le curseur descend sur `@image-qa.png` sans perdre les lignes. |
| **B2 — Flèche bas perd le brouillon après un aller-retour historique** | À la restauration, `setOriginalInput(draft)` conserve le texte comme saisie courante de l'historique en mémoire. Le cache d'annulation reste consommé ; le retour normal à la saisie courante n'est pas une deuxième restauration du cache. L'ancien test qui attendait une saisie vide a été corrigé. | `B2: Down returns to the restored draft...` rouge avant, vert après ; second cas d'aller-retour rapide. Mutation supprimant `setOriginalInput(draft)` : 1 rouge. Même PTY sur `ee19884e8` **échoue exactement sur B2**, puis passe sur le correctif. |
| **B3 — Ctrl+R puis Ctrl+C remplace le travail en cours par une correspondance** | Une recherche active possède Ctrl+C avant la logique d'annulation du brouillon. Le texte renvoyé par `cancelReverseSearch()` et le curseur initial sont restaurés ; le brouillon annulé précédent reste intact. Échap, Entrée, Backspace et les flèches sont également traités avant les raccourcis ordinaires, conformément aux branches de recherche déjà présentes mais auparavant court-circuitées. | `B3: Ctrl+C cancels reverse search...` utilise le **vrai HistoryManager** : `npm start` est affiché, puis `mon travail` revient avec son curseur initial et le brouillon antérieur reste récupérable. Rouge avant, vert après ; mutation B3 : 1 rouge. PTY : correspondance réelle, retour à `MON_TRAVAIL_QA`, puis récupération de `BROUILLON_RECHERCHE_QA`. |
| **B4 — Ctrl+C quitte pendant une recherche sur saisie vide** | La recherche active est annulée avant tout appel à `onEmptyInterrupt`. Un ref synchronisé avec l'état React couvre aussi Ctrl+R puis Ctrl+C avant le prochain rendu. La sortie sur saisie vide reste disponible une fois la recherche fermée. | Deux tests dédiés B4 (séparé et rafale), rouges avant et verts après. Mutation B4 : **2 rouges**. PTY : processus vivant après l'annulation sur saisie vide ; les lettres `v` puis `i` sont de nouveau saisies normalement. Le double Ctrl+C final quitte avec exit 0. |

Code principal : `src/hooks/use-enhanced-input.ts` ; régressions : `tests/hooks/cancelled-input-navigation.test.tsx` (12 cas, vrai hook React, vrai moteur de recherche, fichiers dans un profil jetable). Le cache annulé n'est ajouté ni à l'historique persistant ni aux messages envoyés. Le balayage du profil réel ne retrouve aucun des trois marqueurs de travail/annulation.

## Réserves → traitement → preuve

| Réserve | Traitement et preuve |
| --- | --- |
| Test de consommation trop faible | Ajout d'un cas qui envoie un autre message, remet l'historique normal à zéro puis presse Flèche haut. Il échoue si `discardCancelledDraft()` est retiré de l'envoi ; il ne peut plus être satisfait par la seule présence du message envoyé dans l'historique. |
| Double Échap vers `/undo` consommait un brouillon en attente | Défaut confirmé. La commande interne de rewind appelle `handleDirectCommand('/undo', false)` ; seuls les envois utilisateur consomment le cache. Test par le vrai stdin Ink, avec dispatch simulé ; mutation retirant `false` : 1 rouge. |
| Collage et Ctrl+C dans le même bloc stdin | Défaut réel, antérieur au correctif initial. Le hook décompose le texte et les Ctrl+C dans leur ordre d'arrivée ; le caractère de contrôle n'est plus inséré dans le brouillon. Test via **un seul** `stdin.write('burst paste\nsecond line\x03')` d'Ink ; mutation retirant cette décomposition : 1 rouge. |
| Aide `/help` et `/shortcuts` incohérente | Textes Ctrl+C/Échap et navigation alignés dans `core-handlers.ts`, guide actualisé. Test des vrais résultats des deux handlers. Aucun changement annoncé à des raccourcis hors de ce périmètre. |
| Sortie immédiate en confirmation ou sélection de modèle | Comportement conservé : la mission décrit le double Ctrl+C sur une **saisie non vide**, pas un délai global de sortie. Deux tests Ink prouvent la sortie au premier Ctrl+C sur ces écrans. Ils passent également sur le code avant reprise : aucune régression à corriger. |
| Option `exitOnCtrlC: false` non verrouillée par les seuls tests unitaires | Option correcte et inchangée. La recette CLI utilise le vrai `src/index.ts`, sans forcer l'option dans un montage de test. Ses contrôles échoueraient si le premier Ctrl+C quittait. Cette garde reste une recette PTY exécutée, et non un test de configuration textuel dans Vitest. |
| Écran d'erreur qui démonterait le handler | Aucune panne de ce type n'est démontrée dans les revues. Les ErrorBoundary actuelles de `ChatHistory` et `McpStatus` protègent des enfants ; `useInputHandler` est installé au niveau de `ChatInterfaceWithAgent`, en dehors de ces frontières. Pas de changement spéculatif. Un démontage complet de ce handler reste non testé, donc aucune garantie générale n'est ajoutée. |

## Vérifications exécutées

- Avant correction : 7 rouges / 9 nouveaux tests initiaux. Rejeu plus complet du code `ee19884e8` avec les nouveaux tests hook/Ink : **10 rouges et 23 verts / 33** (`rejeu-code-avant.log`).
- Après correction et restauration des mutations : **11 fichiers, 485 tests verts**, exit 0 (`tests-finaux.log`). Les verrous qui exercent réellement le geste sont les 25 cas des deux fichiers de hooks React et les 23 cas du câblage Ink ; les anciens tests simulant localement des fonctions restent des contrôles de compatibilité, sans être présentés comme preuves du hook.
- **7 mutations détectées**, chacune avec patch et sortie rouge conservés sous `mutations/` ; B4 fait tomber deux cas, les six autres font tomber leur cas ciblé. Sources restaurées en `finally` après chaque essai.
- `npm run typecheck` : **exit 0**, y compris gpuNode-identity et companion-core.
- `npm run lint` : **exit 0, 0 erreur, 2 601 avertissements**. ESLint ciblé final : exit 0, 4 avertissements sur des lignes préexistantes ; nouveaux tests du brouillon sans avertissement.
- Compilation du script Python et `git diff --check` : verts.
- Application réelle Linux, `node --import tsx src/index.ts`, profils temporaires et modèle Ollama **qwen3:4b-instruct** : réponse `HISTORIQUE_QA` observée avant et après. Aucun dialogue d'outil observé dans ce parcours de saisie.
- PTY avant reprise : scénario interrompu sur le retour historique B2 (recette exit 1), puis processus arrêté par le nettoyage supervisé. L'exit 0 de ce nettoyage ne constitue pas une réussite de la recette.
- PTY après : **19 contrôles verts**, dont B1–B4, cache consommé, double Ctrl+C, sortie spontanée du processus à 0 et absence des marqueurs dans les fichiers du profil. Aucun nettoyage forcé nécessaire après ce succès.

Commande des tests :

```sh
npm test -- --configLoader runner tests/hooks/cancelled-input-navigation.test.tsx tests/hooks/cancelled-input-draft.test.tsx tests/hooks/slash-input-runtime.test.tsx tests/hooks/input-handler-queue.test.tsx tests/ui/cli-input-runtime.test.ts tests/unit/use-input-history.test.ts tests/unit/use-enhanced-input.test.ts tests/unit/use-input-handler.test.ts tests/hooks/input-handler.test.ts tests/unit/core-handlers.test.ts tests/unit/history-manager.test.ts
```

Recette :

```sh
python3 scripts/verify-cancelled-draft-pty.py --entry src/index.ts --navigation-review --out <nouveau-dossier>
```

Le témoin utilise une copie isolée de `ee19884e8` sous `/tmp`. Les traces `pty-avant-reprise/` et `pty-correctif-1/` contiennent les entrées, sorties ANSI/asciicast, sorties texte et contrôles nommés. `preuves-pty.json` et `mutations-resultats.json` résument les preuves. Tout est déposé dans `<partage>/20261003-cb-brouillon-ctrlc/reprise-1/sol61/`. Les anciennes preuves de la première mission et des revues sont conservées.

Application du skill local `code-buddy` pour choisir l'entrée TypeScript réelle et forcer Ollama dans un profil jetable. Aucun serveur, agent délégué, cron, workflow autonome ou commande détachée lancé. Les processus de recette ont tous terminé ; les profils temporaires ont été nettoyés. Revue automatique et snapshots désactivés dans ces profils. Aucune publication ni push.

## Ce que je n'ai pas pu vérifier

- Windows, PowerShell, Windows Terminal, macOS et leurs presse-papiers natifs : non exécutés.
- Images binaires ou pièces jointes natives : le compositeur Ink examiné ne les gère pas ; les références de fichiers textuelles sont conservées.
- Suite complète du dépôt, Cowork Electron, paquet npm reconstruit et CI distante : non exécutés. Le typecheck et la CLI TypeScript réelle sont vérifiés.
- Démontage complet du handler par un écran d'erreur : non reproduit ; pas de garantie générale sur de futurs écrans.
- Vrai rollback de checkpoint par `/undo` : non exécuté ; le routage du double Échap et la conservation du cache sont testés avec le dispatch simulé, indépendamment des effets du moteur de checkpoints.
- Requêtes/réponses HTTP exhaustives du fournisseur et Ctrl+C pendant une génération encore active : non capturés/rejoués. Les réponses du modèle et les actions de saisie sont vérifiées dans les traces du terminal, après la fin du tour.

Livraison locale en commits français, fichiers ajoutés nommément. Le rapport externe donne les deux commits de reprise et l'état Git final.
