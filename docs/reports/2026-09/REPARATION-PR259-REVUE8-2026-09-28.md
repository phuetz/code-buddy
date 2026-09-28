# Reprise de la huitième relecture de sécurité PR #259

Branche `fix/securite-2-3-0`, départ `35e19e67e`, correctif `2e22d21fe`. Relecture n°8 et mission lues en entier. Les dépôts d'essai et le HOME sont sous `_qa/` avec des jetons `FAKE-*` ; aucun identifiant réel n'a été ouvert. Aucun push ni fusion.

| Bloquant ou réserve | Traitement | Preuve rouge avant → verte après |
|---|---|---|
| **B8 résiduel — option globale avant `show`/`log`/`grep`/`diff`/`stash`** | Un parseur unique consomme les options globales Git avant d'identifier la sous-commande. Il gère les valeurs séparées ou intégrées de `-C`, `-c`, `--git-dir`, `--work-tree`, `--namespace`, `--exec-path` et autres options connues, ainsi que les drapeaux de pagination et de pathspec. Les requêtes de précontrôle reprennent les options qui changent la résolution du dépôt ou des révisions. Une configuration susceptible de modifier le précontrôle est refusée pour une sortie de contenu. | Nouveau test paramétré : **36 échecs / 45 tests avant correction**, dont `git -p show`, `--paginate`, `--namespace=`, `--literal-pathspecs`, `--no-replace-objects`, `--exec-path=`, `-C` et `-c` intégrés. Suite finale n°8 : **52/52 verts** ; passe n°7 : **26/26 verts**. Le vrai `BashTool` refuse `git -p show` et `git --namespace=x show` sans renvoyer `FAKE-GIT-GLOBAL-259`. `--git-dir` + `--work-tree` pointant vers un autre dépôt secret est également refusé. |
| **B8 résiduel — autres sous-commandes imprimant un objet Git** | `archive`, `format-patch`, `whatchanged -p` et `diff-tree -p` passent par un précontrôle des chemins des objets ou commits visés ; une requête non analysable échoue fermée. | Les quatre commandes étaient vertes pour l'attaquant avant correction et rendaient le `.env` suivi. Tests finaux : **4/4 refus** dans le dépôt secret, **4/4 autorisations** dans le dépôt ne contenant que `notes.txt`. Le vrai `BashTool` refuse `archive` et `format-patch --stdout` sans restituer le faux jeton. |
| **Option globale inconnue** | Refus immédiat avant l'analyse du sous-commande, y compris quand le dépôt ne contient aucun secret. | `git --option-inventee show` et `git --option-inventee=valeur status` : **2 rouges avant, 2 verts après**. Les options informatives connues (`--version`, `--help`, etc.) et `git -c user.name=Essai status` restent autorisées. |
| **Documentation de la portée** | `CHANGELOG.md` et `CLAUDE.md` décrivent la grammaire des options globales, les sous-commandes ajoutées et la limite de la plomberie non inspectée. | Diff documentaire dans `2e22d21fe` ; aucune promesse de protection de tous les appels Git ou des chemins entièrement calculés par le shell. |

Vérifications finales sous HOME fictif : `npm test -- --configLoader runner tests/security tests/bash tests/unit/git-tool.test.ts tests/tools/video/video-understanding.test.ts` **80 fichiers / 1 481 tests verts** ; `npx vitest run --configLoader runner tests/security/donnees-personnelles.test.ts` **40/40** ; `npx tsc --noEmit`, ESLint ciblé et `git diff --check` sans erreur.

## Ce que je n'ai pas pu vérifier

- La suite complète (~27 000 tests), le parcours d'un vrai modèle, l'interface Ink et Cowork n'ont pas été exécutés.
- Windows et macOS n'ont pas été exécutés. Les essais Git et le vrai `BashTool` ont été vérifiés sous Linux seulement.
- Les autres commandes de plomberie Git (`cat-file -p`, `rev-list`, `merge-tree`, filtres, dépôts liés) n'ont pas fait l'objet d'une inspection exhaustive. Un chemin de projet entièrement calculé par le shell reste hors du filtre textuel sans sandbox native ; c'est un résidu déclaré des reprises précédentes.
- Aucun fournisseur réseau réel ni déploiement n'a été sollicité.
