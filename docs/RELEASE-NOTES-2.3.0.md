# Code Buddy 2.3.0 — notes de version / release notes

Version datée du 1er octobre 2026.

## Français

### Ce qui change

- **Premier contact.** L'aide et les erreurs du terminal guident mieux l'installation et les commandes disponibles. Le premier démarrage avec Ollama recommande un modèle sachant appeler des outils. `buddy config set`, `patch` et `unset` fonctionnent sans session interactive.
- **Travail quotidien.** Les sessions récentes du terminal, de Cowork et du mobile apparaissent ensemble. App Studio conserve les versions par projet, aide à corriger une génération, cible un élément de l'aperçu, affiche les journaux du serveur de développement et exporte le site. La recherche peut ingérer RSS/Atom, dépôts GitHub et modèles Hugging Face.
- **Nouveaux parcours.** `buddy deploy run` prépare Cloudflare Pages ou Netlify en simulation par défaut ; `--apply` est nécessaire pour déployer. `buddy provision db-auth` prépare les fichiers Postgres et d'authentification, également sans les appliquer par défaut. L'import Figma génère des composants React et un gabarit Expo est disponible dans App Studio.
- **Sécurité et fiabilité.** Les lecteurs intégrés et les archives refusent davantage de chemins d'identifiants, notamment sous Windows et sur les volumes macOS insensibles à la casse. Le serveur local écoute sur `127.0.0.1` par défaut, les JWT mal formés sont refusés, et les commandes Bash reçoivent un environnement filtré. `buddy security audit` examine le profil, les skills et MCP. Le verrouillage des dépendances corrige `fast-uri`, `undici` et `brace-expansion`. Les prix des modèles viennent d'une table commune ; de nouveaux budgets YOLO Cowork démarrent à 100 $ et 400 tours, sans modifier les budgets déjà enregistrés.
- **Vidéo et outils.** `understand_video` borne les appels externes et libère les processus après transcription afin de rendre la main. `buddy lsp diagnostics` ferme son serveur après la réponse ; les déclencheurs des skills intégrés et les reprises de la veille vidéo ont été corrigés.
- **Visibilité.** `buddy catalog status --json` expose l'état des fonctionnalités et leurs preuves ; les campagnes P5, P6 et P7 ajoutent des parcours vérifiés. Le navigateur comprend mieux certaines consignes d'action en français, et plusieurs échecs d'outils sont désormais affichés explicitement.

### Installer et vérifier

```sh
npm install -g @phuetz/code-buddy@2.3.0
buddy --version
buddy doctor --offline
buddy catalog status --json
```

Node.js 20 ou plus récent est requis. Aucun format de données ne demande une migration manuelle connue. Si vous utilisez un répertoire de profil dédié, définissez `CODEBUDDY_HOME` avant le lancement : les données du compagnon suivent maintenant ce répertoire. Vérifiez votre URL Ollama personnalisée après la mise à jour ; les chemins de configuration utilisent désormais une base commune. Les nouvelles fonctions de déploiement nécessitent les outils et comptes du fournisseur ciblé uniquement lors de `--apply`.

### Limites connues

- La protection statique du shell ne couvre pas toutes les lectures récursives ou les chemins construits à l'exécution. Un secret suivi par Git peut encore être lu via les objets Git ; ne stockez pas de secret dans un dépôt accessible à l'agent. Cette garantie est reportée à une version ultérieure.
- Les états du catalogue reflètent le niveau de preuve disponible. Une entrée inconnue n'est pas une preuve de panne ou de bon fonctionnement.
- `buddy provision db-auth` ne crée pas de service distant ni n'exécute les migrations SQL ; `buddy deploy run` ne crée pas de compte, de DNS ou de retour arrière automatique. L'import Figma ne convertit pas toutes les formes vectorielles ; le gabarit Expo ne construit pas de binaire natif.
- Les vérifications Linux du candidat ne remplacent pas les contrôles Windows, macOS et des services externes.

## English

### What changes

- **Getting started.** CLI help and input errors provide clearer guidance. First run with Ollama recommends a tool-capable model. `buddy config set`, `patch` and `unset` work without an interactive session.
- **Daily work.** Recent CLI, Cowork and mobile sessions appear together. App Studio keeps project versions, helps repair generated output, targets preview elements, shows development-server logs and exports the site. Research ingest accepts RSS/Atom feeds, GitHub repositories and Hugging Face models.
- **New workflows.** `buddy deploy run` prepares Cloudflare Pages or Netlify deployment in dry-run mode by default; `--apply` is required to publish. `buddy provision db-auth` prepares Postgres and authentication files without applying them by default. Figma import generates React components, and App Studio offers an Expo starter.
- **Security and reliability.** Built-in readers and archives reject more credential paths, including Windows paths and paths on case-insensitive macOS volumes. The local server binds to `127.0.0.1` by default, malformed JWTs are rejected, and Bash commands receive a filtered environment. `buddy security audit` checks profile, skill and MCP settings. The dependency lockfile fixes `fast-uri`, `undici` and `brace-expansion`. Model prices use one sourced table; new Cowork YOLO budgets start at $100 and 400 turns without changing saved budgets.
- **Video and tools.** `understand_video` bounds external calls and releases processes after transcription so the command can return. `buddy lsp diagnostics` closes its server after responding; bundled skill triggers and video-watch retries were corrected.
- **Visibility.** `buddy catalog status --json` reports feature states and evidence, with P5/P6/P7 real-use evidence added. The browser handles some French action instructions better, and several tool failures are now reported explicitly.

### Install and verify

```sh
npm install -g @phuetz/code-buddy@2.3.0
buddy --version
buddy doctor --offline
buddy catalog status --json
```

Node.js 20 or newer is required. No known data format needs a manual migration. If you use a dedicated profile directory, set `CODEBUDDY_HOME` before launch: companion data now follows it. Check custom Ollama URLs after upgrading because configuration paths now share one base URL. Deployment tools and provider accounts are needed only when applying a deployment.

### Known limits

- Static shell filtering cannot cover every recursive read or runtime-built path. A secret committed to Git may still be read from Git objects; do not keep secrets in a repository accessible to the agent. A stronger guarantee is deferred.
- Catalog states represent available evidence. An unknown entry proves neither failure nor success.
- `buddy provision db-auth` does not create a remote service or execute SQL migrations; `buddy deploy run` does not create accounts, manage DNS or roll back automatically. Figma import does not convert every vector shape, and the Expo starter does not build native binaries.
- Linux candidate checks do not establish Windows, macOS or external-service behavior.

For exact change references, see the [2.3.0 changelog](../CHANGELOG.md#230-2026-10-01) and the [feature boundaries](whats-new-2.3.md).
