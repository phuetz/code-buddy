# Reprise B5 — traitement des contre-revues, 3 octobre 2026

Worktree `/data/patrice/DEV/cb-write-file-2026-10-03`, branche `fix/write-file-existant-2026-10-03`, départ `94f316319`. Correctif de reprise : `2c34baba8`. Mission initiale, rapport `revue/RAPPORT.md` et contre-revue Gemini lus **intégralement**. La première revue conclut effectivement « PRÊT À FUSIONNER » ; Gemini conclut « REFUSÉ ». Réservation et rapport de mission créés avant modification fonctionnelle. Aucun push ; aucune tâche de fond lancée dans cette reprise ; entretien automatique Git désactivé pour les commits.

| Bloquant / réserve | Traitement | Preuve |
|---|---|---|
| **G1 — revue acceptée qui n’écrirait jamais** | **Contesté sur preuve.** Le contrat existant est `gated: true` = la transaction a déjà écrit ou refusé. Conserver l’absence de seconde écriture évite de contourner la transaction. | Sur le candidat antérieur, les quatre tests G1 statiques passent déjà (`traces/avant.log`). Sur le candidat final : création, strReplace, insert et replaceLines réellement écrits, ledger `applied: true` et checkpoint existant. Revue full avec client scripté acceptant : octets exacts et checkpoint. Mutation du helper renvoyant succès sans application : **4 rouges** (`mutant-G1-no-application.log`). |
| **G2 — création concurrente écrasée** | **Corrigé à plusieurs étapes.** Création exclusive par temporaire ouvert `wx`, puis publication atomique avec `linkSync` (aucun remplacement, aucun fichier destination partiel). L’intention `createOnly` traverse confirmation, construction du diff et révisions ; aucun contenu concurrent lu pour construire la base. `lstat` détecte aussi les liens pendants. La revue ne prend pas de snapshot des créations ; elle inscrit une absence dans le checkpoint uniquement après publication réussie. Un échec ne rembobine donc jamais le concurrent. Contrôles de chemin réévalués avant publication ; confinement dans la base de revue réévalué avant création des parents et application. | Tests G2 avec concurrent pendant confirmation (`off` et `static`), pendant réponse du reviewer `full`, après contrôle des conflits / au checkpoint (fichier et lien secret), pendant révision ; tentative de conversion en suppression refusée. Batch : édition précédente rembobinée, concurrent intact. Parent remplacé par lien extérieur : aucun fichier ni temporaire écrit dehors. Canari synthétique absent des résultats, bases et checkpoints ; test de lecture espionné pour le lien pendant confirmation. **Six mutations G2 rouges** : publication non exclusive, intention perdue, transaction non exclusive, lecture de base concurrente, intention de révision perdue, confinement retiré. |
| **G3 — aucun éditeur sous petit plafond** | **Corrigé.** Réserver une place à l’éditeur avant les priorités du cœur. Plafonds valides 1 à 8, sans dépasser la limite ni créer de schéma absent. Le cœur contient en réalité cinq noms, pas quatre. | Huit cas de plafond × quatre éditeurs (dont alias), et composition avec le vrai `filterToolsForModel/getModelToolConfig('qwen3:4b-instruct')`. `apply_patch` filtré ne revient jamais ; `str_replace_editor` survit. Mutation sans réservation : **6 rouges** (`mutant-G3-editor-starvation.log`). |
| **G4 — dossier / lien existant** | **Corrigé.** `lstat` refuse tous les nœuds avant confirmation ; `FILE_ALREADY_EXISTS` reste réservé au fichier ordinaire, `PATH_ALREADY_EXISTS` aux autres nœuds. Aucun conseil d’édition d’un dossier/lien. La prétendue exception non gérée était déjà capturée par le `catch` de `create` ; le défaut réel était la confirmation inutile et le mauvais flux. | Dossier et lien pendant refusés avant toute demande de confirmation et conservés. Mutation supprimant cette vérification : **2 rouges** (`mutant-G4-entry-check-lost.log`). |
| **G5 — terminologie des alias** | **Clarifié.** `findPrimaryTool(primaryName)` remplace `find(legacy)`. Aucun changement de résolution. Le tableau d’alias nommait historiquement les valeurs « legacy » ; `?? name` est le repli normal pour les outils primaires. | Les trois familles d’alias restent testées avec lecture puis édition réelle : write_file/patch/read_file, create_file/str_replace_editor/view_file, file_write/file_edit/file_read. `patch` désigne str_replace_editor, pas apply_patch. |
| **R1 — conseil qui conduit au refus strict** (première revue) | **Corrigé.** Préférer `apply_patch` lorsqu’il est effectivement exposé, puis les éditeurs directs seulement en son absence. Aucune réinjection d’un outil interdit par le profil. | Test R1 avec deux éditeurs exposés : conseil JSON apply_patch, garde strict refusant str_replace_editor et autorisant apply_patch. Mutation rétablissant l’ancienne préférence : **1 rouge** (`mutant-R1-conseil-strict.log`). Suites existantes de policy, confirmations, filtres et enregistrement apply_patch vertes. |

Les numéros G1–G5 correspondent aux cinq constats Gemini ; R1 à la réserve réelle de l’autre revue. Le renommage G5 est une clarification, pas un blocage fonctionnel inventé. Les dix mutations finales sont décrites avec substitutions exactes et codes de sortie dans [mutations.json](traces/mutations.json). Les sources sont restaurées dans un `finally` à chaque mutation ; le script exige des échecs d’assertion, pas seulement un échec de compilation. Les journaux préliminaires sont conservés, notamment l’ancien `mutant-G2-vfs-overwrite.log` ; seuls les dix éléments de `mutations.json` constituent le rejeu final.

## Pourquoi G1 est contesté

Le contrat était déjà documenté en tête de `src/tools/review-gate-helper.ts` avant cette reprise : `gated: true` signifie « review transaction already wrote (or refused) — the tool must NOT write again ». La chaîne réelle est : `maybeReviewGatedWrite` → `reviewGatedWrite` → `reviewAndApply` → `applyReviewedDiff`. `write-gate.ts` n’annonce `ok: true` que si le verdict accepte **et** que `apply.applied` vaut vrai. `apply-transaction.ts` écrit physiquement, après checkpoint. Les tests G1 mesurent le disque, le ledger et le checkpoint ; ils ne se contentent pas du message de succès. La création exclusive modifie la publication d’une création, sans changer ce contrat pour les éditions. Ajouter un `vfs.writeFile` après une transaction acceptée aurait réalisé une seconde écriture hors transaction.

## Sécurité et portée du correctif

Aucun paramètre overwrite n’est ajouté ; l’ancien refus d’écrasement et le conseil utilisant les seuls noms du tour restent le comportement choisi pour les petits modèles. Confirmation humaine, permissions, write policy et revue restent actives. La revue garde le checkpoint et le rollback ; les créations concurrentes ne sont ni lues comme base, ni inscrites comme contenu à restaurer. La garde des secrets et celle des chemins sont rappelées avant publication. Les canaris des tests sont des données artificielles, aucun profil ni secret réel n’est copié dans les preuves.

La publication par lien exige que le système de fichiers supporte les liens durs ; une impossibilité produit un refus, sans repli vers une écriture écrasante. Le temporaire est créé avec permissions 0600 et supprimé après application/refus. Les nouveaux fichiers conservent ces permissions. Les modifications de fichiers existants gardent leur chemin d’écriture transactionnel habituel.

## Régression avant / après et barrière

Avant correctif : trois fichiers, **12 échecs / 24 réussites** (`avant.log`). Les cas G1 sont déjà verts ; G2, G3, G4 et R1 reproduisent les défauts. Après correction, des scénarios supplémentaires de révision, rollback et confinement ont été ajoutés. Une première barrière a échoué sur le nouveau cas de parent déplacé et deux attentes du mock unitaire ; tous les échecs sont archivés. La garde de confinement a été corrigée et le mock adapté à l’appel exclusif, puis la barrière entière a été rejouée.

| Vérification finale | Résultat |
|---|---|
| `npm run validate -- <26 fichiers / groupes ciblés>` | **exit 0** ; commande exacte en tête de `traces/validate-final.log` |
| `npm run lint` (dans validate) | **0 erreur, 2 601 avertissements**, exit 0 |
| `npm run typecheck` (dans validate) | Typecheck principal, identité GPU et companion-core : **exit 0** |
| `npm run check:pack` (dans validate) | **11/11**, exit 0 |
| Tests ciblés (dans validate) | **26 fichiers / 375 tests verts** |
| Gardes secrets et isolation supplémentaires | **6 fichiers / 137 tests verts**, exit 0 (`gardes-secrets.log`) ; Darwin/Win32 simulés sous Linux |
| Mutations finales | **10/10 détectées** ; au moins une régression avec mutant rouge pour chacun des trois bloquants |
| `git diff --check` | exit 0 |

Les ciblés incluent toutes les suites de revue, les régressions du collecteur de boucle, outils texte, aliases/cwd, confirmations centrales, filtres, WritePolicy, checkpoints et VFS. Aucun échec n’est ignoré pour la barrière finale.

## Deux essais réels Ollama

`ollama list` capturé dans `traces/ollama-list.log` ; modèle **qwen3:4b-instruct**, appels d’outils structurés observés. `HOME` forcé à `_qa/write-file/home`, environnement minimal sans clés des fournisseurs, fournisseur Ollama forcé. Aucun `-k`, `-u`, YOLO ou bypassPermissions. `acceptEdits`, write policy confirm, revue static, `--no-plan --max-turns 3 --max-tool-rounds 8 --verify-cmd 'node verify.mjs'`. Les deux scripts sont attendus jusqu’à la sortie, avec borne et fermeture du groupe de processus ; aucun groupe résiduel constaté par le runner.

| Essai | Résultat mesuré |
|---|---|
| `reprise-b5` | 91,07 s ; create_file refusé → view_file → str_replace_editor ; revue acceptée ; `B5_OK\n` ; verify exit 0 ; loop paused/exit 1 |
| **`reprise-b5-final`** | **142,92 s** ; même récupération sur les sources finales ; ledger `decision: accept`, `applied: true`, checkpoint `cp_musq9bbx_p2o9ai` ; octets `B5_OK\n`, vérificateur inchangé, verify exit 0 ; **loop paused/exit 1** |

Le dernier essai donne `Verifier : CONFIRMED` sur les trois tours. Le juge refuse `done` faute de preuve structurée et, aux tours sans nouvel outil, évoque `tool evidence: none`. La garde n’a pas été désactivée. Nous ne revendiquons donc pas une boucle terminée avec exit 0.

Correction du récit initial : le plafond compact retire **write_file et patch** des huit schémas du tour réel ; le modèle utilise l’outil primaire `create_file`, réellement exposé. Le prompt de reprise autorise explicitement ce cas. La récupération de write_file lui-même est prouvée par les tests d’alias et le test séquentiel ; le dernier essai ne mesure pas un appel write_file absent de sa surface. Le profil qwen3 retire apply_patch avant le plafond ; str_replace_editor reste exposé. En politique strict avec ce seul éditeur direct, l’écriture demeure refusée : aucun outil interdit n’est réintroduit.

Captures : `traces/reprise-b5-final-command.json`, `*-stdout.log`, `*-stderr.log`, `*-runs/`, `*-tool-results/`, `*-diff-reviews.jsonl`, `*-answer.txt`, `*-summary.json`. Les SHA-256 des dix sources capturées avant le dernier essai ont été comparés au candidat final : tous identiques (`sources-finales-verifiees.json`).

Pour rejouer : depuis le worktree, `python3 /home/patrice/Videos/Partage/20261003-cb-write-file/reprise-1/sol61/REJOUER-MUTATIONS.py`. Recette : définir `B5_REPO` sur ce worktree, puis lancer `REJOUER-RECETTE.py` avec un **nouveau label** (le dossier doit être absent). Les journaux de cette livraison sont archivés, sans écraser ceux de la mission précédente.

## Ce que je n'ai pas pu vérifier

- Une fermeture complète de `buddy loop` en `done` / exit 0 : les deux nouvelles recettes restent paused malgré le fichier et le vérificateur corrects. Fiabilité statistique du petit modèle non mesurée ; qwen3:8b initial non installé/testé.
- Revue full avec un vrai LLM externe : tests full sur le moteur réel avec client scripté, recette réelle en static. Aucun accès payant ni réseau fournisseur utilisé.
- Windows/macOS natifs, CI GitHub, paquet publié et interfaces tierces/flotte parsant les erreurs : non exécutés. Les tests Darwin/Win32 sont des simulations sous Linux, pas des validations natives. Aucun nouveau build de dist ni test de tarball installé dans cette reprise.
- Suite Vitest entière, `/undo` interactif et pipeline RAG exhaustif sur tous les modèles : non exécutés. Filtre qwen3 puis plafond testés en composition et observés dans la recette, pas l’ensemble des profils.
- Tous les ordonnancements de concurrence, échanges adversariaux de répertoires à chaque instruction système, pannes matérielles/disque et systèmes de fichiers sans liens durs : non mesurés. Les courses aux pauses asynchrones, au checkpoint, à la revue et à la révision sont provoquées de façon déterministe ; cela ne constitue pas une preuve formelle de tous les scénarios système.
- L’état hôte d’un ancien GC Git annoncé lors de la mission précédente n’est pas certifiable depuis le confinement (PID non visible). Aucun entretien automatique ni tâche de fond n’a été lancé pour cette reprise ; tous ses sous-processus foreground sont attendus.
