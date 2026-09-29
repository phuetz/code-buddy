# Reprise de la troisième relecture — PR #259

Le 27 septembre 2026, sur `fix/securite-2-3-0`, après `cfb87b892`.
Correctif : `40854eb61 fix(securite): fermer les lectures de secrets et accès anonymes`.
Relecture intégrale : `revue-259/reprise-sol/reprise-1/revue/RAPPORT.md`.
Les journaux cités ci-dessous se trouvent dans `revue-259/reprise-sol/reprise-1/reprise-1/sol/` du partage. Tous les secrets et HOME utilisés pendant les essais sont fictifs, sous `_qa/` ou `/tmp`.

## Bloquant et réserves traitées

| Constat | Traitement | Preuve rouge avant / verte après |
|---|---|---|
| **B3 : `codebase_replace` lit et modifie `prod.env` et `secrets.json`.** | Énumération des chemins sans lire les contenus, exclusion par `checkSecretFileAccess` avant `rg -l`, puis nouvelle vérification avant lecture et écriture. Un fichier ordinaire reste modifiable. | `tests/security/codebase-replace-secret.test.ts` : `rouge-codebase-final.log` **2/2 échecs** sur `cfb87b892` ; `vert-codebase.log` **2/2 réussites**. |
| `todo_scan` peut rendre une ligne de secret avec un marqueur personnalisé ; `merge_conflicts` peut envoyer un conflit secret au résolveur IA ou le réécrire. La réserve « pas de divulgation de contenu » était donc fausse pour ces cas. | Garde sur les chemins avant balayage, lecture, délégation IA et écriture. | `tests/security/reader-reservations.test.ts` : `rouge-reserves.log` **2/2 échecs** ; `vert-reserves.log` **2/2 réussites**. |
| `bug_finder`, `code_stats`, `bundle_analyze` divulguent respectivement motifs, noms et tailles de fichiers secrets. La navigation LSP peut transmettre un tel fichier au serveur de langage. | Exclusion des chemins secrets avant lecture, analyse et requête de navigation LSP. | `reader-reservations.test.ts` : `rouge-autres-lecteurs.log` **3 échecs sur 5** ; `rouge-bundle.log` **1 échec ciblé** ; `vert-autres-lecteurs.log` **6/6 réussites**. |
| `lsp_rename` peut ouvrir un fichier secret en entrée ou par les éditions retournées par le serveur. | Vérification du chemin initial et de chaque cible avant modification ; conversion correcte des URI `file:` absolues. | `tests/unit/lsp-rename.test.ts` : `rouge-lsp-rename.log` **2 échecs sur 22** ; `vert-lsp-rename.log` **22/22 réussites**. |
| Le daemon lançait son serveur sans authentification sur `0.0.0.0`. | Bind par défaut limité à `127.0.0.1` pour la commande cachée du daemon ; documentation de l'accès distant. | `tests/commands/daemon-security.test.ts` : `rouge-daemon.log` **1/1 échec** ; `vert-daemon.log` **1/1 réussite**. |
| `/api/metrics` et `/metrics` détaillés étaient publics ; `/api/metrics/reset` était aussi accessible sans authentification. | Routes détaillées montées après l'authentification ; remise à zéro réservée à la portée `admin`. Le résumé de santé `/api/health/metrics` reste public et documenté. | `tests/server/securite-2-3-0-serveur.test.ts` sur une socket locale : `rouge-metriques.log` **1/1 échec** ; `vert-metriques.log` **1/1 réussite** ; `vert-serveur-final.log` **11/11 réussites**. Le test vérifie 401 anonyme, 403 jeton chat, 200 admin. |
| `peer.tool.invoke` avec `list_directory` révélait les noms `prod.env` et `secrets.json`. | Filtrage de chaque entrée avec `classifySecretPath`, en conservant les noms ordinaires. | `tests/fleet/peer-tool-bridge.test.ts` : `rouge-pair-noms.log` **1/1 échec** ; `vert-pair-noms.log` **1/1 réussite**. |

## Vérifications complémentaires

- Tests ciblés : `vert-cibles.log`, **150/150** ; le test `bundle_analyze` ajouté ensuite est compris dans `vert-securite-final.log`, **1192/1192** sur 66 fichiers de `tests/security`.
- `npm test -- --configLoader runner tests/security/codebase-replace-secret.test.ts tests/security/reader-reservations.test.ts tests/security/donnees-personnelles.test.ts` : `vert-npm-cibles.log`, **48/48**. Le lancement sans `--configLoader runner` échoue avant les tests car Vite tente d'écrire dans `node_modules/.vite-temp`, monté en lecture seule ici.
- `npx vitest run tests/security/donnees-personnelles.test.ts` : `vert-donnees-personnelles.log`, **40/40**.
- `npx tsc --noEmit` : `tsc-final.log`, code de sortie 0. ESLint ciblé : `eslint.log`, aucune erreur, un avertissement préexistant dans `tests/unit/lsp-rename.test.ts`.
- Tests HTTP voisins `tests/server/catalogue-routes-http-a.test.ts` et `tests/server/api-server.test.ts` : **42/42** sur un worktree temporaire propre au commit `40854eb61` (`vert-http-propre.log`). Le premier passage sur le worktree en cours donnait 41/42 uniquement parce que son test de propreté Git voyait les modifications non encore committées (`vert-http-voisin.log`).
- `CLAUDE.md`, `CHANGELOG.md` et `docs/deployment.md` précisent le bind du daemon, l'authentification des métriques et la garde des lecteurs.

## Ce que je n'ai pas pu vérifier

- Windows et macOS natifs, Electron/Cowork, la suite complète d'environ 27 000 tests et un vrai cycle d'agent avec fournisseur externe.
- Le confinement natif `CODEBUDDY_NATIVE_SANDBOX` et les chemins Bash dont tous les caractères sont calculés à l'exécution ; cette limite du filtre textuel reste ouverte.
- Un audit exhaustif de tous les lecteurs de fichiers du dépôt, les services réseau distants et les déploiements existants du daemon. Aucun vrai identifiant du propriétaire ni fichier `.env` personnel n'a été ouvert ; aucun push, fusion ou déploiement n'a été fait.
