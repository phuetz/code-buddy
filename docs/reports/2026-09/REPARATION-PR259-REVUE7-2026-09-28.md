# Reprise de la septième relecture de sécurité PR #259

Branche `fix/securite-2-3-0`, départ `12b58bc58`, correctif `4ef620504`. Relecture indépendante lue en entier. Essais faits sous `_qa/securite-reprise/` avec un HOME isolé et des valeurs `FAKE-*` ; aucun identifiant réel ouvert. Aucun push ni fusion.

| Bloquant ou réserve | Traitement | Preuve rouge avant → verte après |
|---|---|---|
| **B8 — `git show`, `git log -p`, `git grep` et `git stash show -p` rendaient un `.env` suivi, même supprimé du disque** | Le validateur Bash précontrôle les chemins des objets et des révisions Git avant de laisser sortir le contenu. Il refuse aussi un blob désigné par sa seule empreinte et un fichier secret passé à `git grep -f`. Le vrai `BashTool` ne renvoie plus le faux jeton. | Première exécution de `tests/security/reprise-7-git-history.test.ts` : **13 échecs / 20 tests**, dont `BashTool` qui restituait `FAKE-GIT-HISTORY-259`. Le test du blob puis celui du chemin Git cité avec espaces ont chacun échoué avant leur correctif. Suite finale : **26/26 verts**, dont secrets historiques, dépôt explicite `git -C`, `cd`, options Git, chemins ordinaires et vrai `BashTool`. |
| **C2 voisin — `git diff` avec chemin cité contenant des espaces** | Précontrôle de `git diff --name-only -z` avec les arguments réels, résolution du dépôt, puis classification des chemins effectivement modifiés. | Le test `git -C "other repo with spaces" diff` a échoué avant correction ; il passe avec les 26 tests finaux. `git diff` sur un changement sans secret garde un usage légitime. |
| **Réserve réelle — recherche récursive bloquée par un `.env.test` de dépendance ou un `.env.local` public** | Exception limitée aux fichiers réguliers ≤ 4 Kio, hors HOME privé, dont chaque entrée est une paire publique reconnue sans nom de clé sensible. Un jeton, une valeur inconnue, un lien ou une lecture directe restent refusés. | Test rouge initial pour `node_modules/pkg/.env.test` ; test `.env.local` rouge avant l'exception ciblée. Après correction, `grep -r bonjour .` passe avec les deux fixtures publiques, puis est refusé après substitution de `API_KEY=FAKE-*`. `cat .env.test`/`.env.local` reste refusé. |
| **Réserve de documentation — portée de la garde `.env` et Git** | `CHANGELOG.md` et `CLAUDE.md` détaillent les commandes Git contrôlées, l'exception étroite de recherche récursive et la frontière de l'analyse textuelle Bash. | Diff documentaire dans `4ef620504` ; le rapport ne promet pas la protection de toute la plomberie Git ni des chemins calculés par le shell. |

Le point « `cat .env.example` demande une confirmation » dépend du mode d'approbation du vrai `BashTool` ; le validateur statique accepte ce chemin public. Il n'y a pas de refus de secret à corriger dans cette observation. Le test garde des commandes Git ordinaires autorisées (`git show` sans secret, `--stat`, `git log --oneline`, `git grep` limité à `notes.txt`).

Vérifications finales avec le HOME fictif : `npm test -- --configLoader runner tests/security tests/bash tests/unit/git-tool.test.ts tests/tools/video/video-understanding.test.ts` **79 fichiers / 1 429 tests verts** ; `npx vitest run --configLoader runner tests/security/donnees-personnelles.test.ts` **40/40** ; `npx tsc --noEmit`, ESLint ciblé et `git diff --check` sans erreur.

## Ce que je n'ai pas pu vérifier

- La suite complète (~27 000 tests), le parcours d'un vrai modèle, Ink et Cowork n'ont pas été exécutés.
- Windows et macOS n'ont pas été exécutés ; les essais couvrent Linux et les commandes Git citées dans cette relecture.
- La plomberie Git restante (`cat-file -p`, `format-patch`, `archive`, filtres et commandes non listées) n'a pas fait l'objet d'une revue exhaustive. Un chemin de projet entièrement calculé par un shell reste hors du filtre textuel sans sandbox native, déjà documenté dans les reprises précédentes.
- Aucun fournisseur réseau réel ni déploiement n'a été sollicité.
