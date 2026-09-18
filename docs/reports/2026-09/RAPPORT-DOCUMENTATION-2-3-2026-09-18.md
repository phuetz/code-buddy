# RAPPORT — Documentation utilisateur 2.3.0 (Vérifiée par exécution réelle)

- **Date :** 2026-09-18
- **Agent :** Grok 4.6 (Session Grok, medium)
- **Worktree :** `worktree cb-doc23-2026-09-18`
- **Branche :** `work/doc23-2026-09-18`
- **Livrable principal :** `<dépôt privé de passation>/20260918-documentation-2-3/RAPPORT.md`
- **Contraintes respectées :** PAS de commit, pas de `rm -rf`, pas de publication npm, `package.json` non modifié (reste en 2.2.0).

---

## 1. Contexte et correction de la première passe

Lors de la première passe, la documentation avait été rédigée sur une branche basée directement sur `origin/main` (`b5c50c189`, v2.2.0), sur laquelle les nouvelles commandes (`buddy deploy`, `buddy provision db-auth`, `buddy sessions list`, etc.) n'étaient pas encore présentes. Le risque de documenter des commandes non testées s'était donc réalisé.

Pour corriger ce défaut conformément à la consigne, les branches de fonctionnalités locales ont été fusionnées dans ce worktree :
1. `feat/deploy-2026-09-17` (déploiement un clic Cloudflare Pages / Netlify)
2. `feat/supabase-2026-09-17` (provisionnement base SQL et authentification)
3. `feat/recents-2026-09-17` (historique unifié CLI / Cowork / mobile)
4. `feat/cowork-folder-2026-09-17` (instructions de dossier dans Cowork)
5. `feat/expo-2026-09-17` (gabarit mobile Expo / React Native)
6. `feat/figma-2026-09-17` (import de maquettes Figma vers React)
7. `audit/self-improvement-2026-09-17` (découverte des compétences créées)
8. `fix/watchers-2026-09-18` (résilience à la saturation des observateurs inotify)
9. `feat/demarrage-2026-09-18` (`work/demarrage-2026-09-18` étant inexistante en local, `feat/demarrage-2026-09-18` a été fusionnée)

Après fusion propre, les liens vers `node_modules` ont été configurés et `npm run build` a été exécuté avec succès (code de sortie 0, génération du runtime manifest et des compétences embarquées).

Chaque commande documentée a ensuite été **réellement exécutée** via le binaire compilé (`node dist/cli-boot.js`).

---

## 2. Preuves d'exécution réelle des commandes

### 2.1 Déploiement un clic (`buddy deploy`)

#### Aide générale et liste des plateformes
```bash
$ node dist/cli-boot.js deploy --help
Usage: buddy deploy [options] [command]

One-click web publish (dry-run by default) and cloud config generators

Options:
  -h, --help                 display help for command

Commands:
  run [options] [dir]        Build and publish a static/build web project
                             (simulation by default; nothing is sent)
  platforms                  List supported cloud platforms
  init [options] <platform>  Generate deployment config for a platform
  nix [options]              Generate Nix flake configuration
  help [command]             display help for command
```

```bash
$ node dist/cli-boot.js deploy platforms

One-click web publish (buddy deploy run) — target in .codebuddy/deploy.json:

  cloudflare-pages   Cloudflare Pages via wrangler (if already installed)
  netlify            Netlify via netlify-cli (if already installed)

Config generators (buddy deploy init) — not an upload:

  fly         Fly.io — globally distributed apps
  railway     Railway — instant deployments
  render      Render — zero-config cloud
  hetzner     Hetzner Cloud — European VPS
  northflank  Northflank — Kubernetes PaaS
  gcp         Google Cloud Platform
  nix         Nix flake — declarative installation

Usage: buddy deploy run [--apply]   |   buddy deploy init <platform>
```

#### Aide de `buddy deploy run`
```bash
$ node dist/cli-boot.js deploy run --help
Usage: buddy deploy run [options] [dir]

Build and publish a static/build web project (simulation by default; nothing is
sent)

Arguments:
  dir         Project directory (default: ".")

Options:
  --dry-run   Show the exact plan without uploading (default)
  --apply     Really upload (requires .codebuddy/deploy.json target + official
              CLI + token)
  --json      Print the report as JSON (secrets never included)
  -h, --help  display help for command
```

#### Simulation sans fichier de configuration
```bash
$ node dist/cli-boot.js deploy run
One-click deploy — simulation (nothing sent)
Root: worktree cb-doc23-2026-09-18
Duration: 4 ms
  [error] config: No deploy target configured. Create .codebuddy/deploy.json with "target": "cloudflare-pages" or "netlify". Nothing was sent.
Error: No deploy target configured. Create .codebuddy/deploy.json with "target": "cloudflare-pages" or "netlify". Nothing was sent.
Rollback:
  Configure a target first (.codebuddy/deploy.json).
No deploy target configured. Create .codebuddy/deploy.json with "target": "cloudflare-pages" or "netlify". Nothing was sent.
```
*Code de sortie : 1. Rien n'est envoyé.*

#### Simulation avec cible Cloudflare Pages sans CLI `wrangler`
```bash
$ node dist/cli-boot.js deploy run /tmp/test-deploy-cf
[2026-09-17T23:45:27.166Z] ⚠️ WARN  [one-click-deploy] missing CLI for cloudflare-pages
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
Root: /tmp/test-deploy-cf
Duration: 8 ms
  [ok] config: target=cloudflare-pages outputDir=dist
  [error] tool: wrangler is not installed. Install Cloudflare Wrangler locally in the project (npm i -D wrangler) — Code Buddy will not download or install it.
Error: wrangler is not installed. Install Cloudflare Wrangler locally in the project (npm i -D wrangler) — Code Buddy will not download or install it.
Rollback:
  Cloudflare Pages can restore a previous deployment (rollback) when wrangler supports it; otherwise redeploy the previous build directory.
  $ wrangler pages deployment list --project-name test-app
  $ wrangler pages deployment rollback <previous-deployment-id> --project-name test-app
```
*Code de sortie : 1.*

#### Simulation avec cible Netlify sans CLI `netlify`
```bash
$ node dist/cli-boot.js deploy run /tmp/test-deploy-net
[2026-09-17T23:45:30.306Z] ⚠️ WARN  [one-click-deploy] missing CLI for netlify
One-click deploy — simulation (nothing sent)
Target: netlify
Root: /tmp/test-deploy-net
Duration: 12 ms
  [ok] config: target=netlify outputDir=dist
  [error] tool: netlify CLI is not installed. Install it locally in the project (npm i -D netlify-cli) — Code Buddy will not download or install it.
Error: netlify CLI is not installed. Install it locally in the project (npm i -D netlify-cli) — Code Buddy will not download or install it.
Rollback:
  Netlify restoreSiteDeploy republishes a previous deploy id. Keep the last successful deploy_id from the report.
  $ netlify api listSiteDeploys --data '{"site_id":"<site-id>"}'
  $ netlify api restoreSiteDeploy --data '{"site_id":"<site-id>","deploy_id":"<previous-deploy-id>"}'
```
*Code de sortie : 1.*

#### Simulation avec CLI présent mais jeton manquant
```bash
$ node dist/cli-boot.js deploy run /tmp/test-deploy-cf
[2026-09-17T23:45:32.011Z] ⚠️ WARN  [one-click-deploy] missing token for cloudflare-pages
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
Root: /tmp/test-deploy-cf
Duration: 5 ms
Token: CLOUDFLARE_API_TOKEN missing
  [ok] config: target=cloudflare-pages outputDir=dist
  [ok] tool: /tmp/test-deploy-cf/node_modules/.bin/wrangler
  [error] token: Missing Cloudflare token. Set CLOUDFLARE_API_TOKEN (or CF_API_TOKEN) in the environment or `buddy secrets set CLOUDFLARE_API_TOKEN <value>`. The value is never written to the project.
```
*Code de sortie : 1.*

#### Simulation complète réussie (CLI et jeton présents)
```bash
$ CLOUDFLARE_API_TOKEN=fake-token node dist/cli-boot.js deploy run /tmp/test-deploy-cf
[2026-09-17T23:45:33.618Z] ℹ️ INFO  [one-click-deploy] dry-run cloudflare-pages (nothing sent)
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
Root: /tmp/test-deploy-cf
Duration: 3 ms
Token: CLOUDFLARE_API_TOKEN present (env)
  [ok] config: target=cloudflare-pages outputDir=dist
  [ok] tool: /tmp/test-deploy-cf/node_modules/.bin/wrangler
  [ok] token: CLOUDFLARE_API_TOKEN present (env)
  [planned] build: would run project script "build" → npm run build
  [planned] output: would require directory dist
  [planned] upload: not sent (dry-run) → wrangler pages deploy dist --project-name test-app --commit-dirty=true
Rollback:
  Cloudflare Pages can restore a previous deployment (rollback) when wrangler supports it; otherwise redeploy the previous build directory.
  $ wrangler pages deployment list --project-name test-app
  $ wrangler pages deployment rollback <previous-deployment-id> --project-name test-app
```
*Code de sortie : 0.*

#### Priorité de la simulation si `--apply` et `--dry-run` sont passés simultanément
```bash
$ CLOUDFLARE_API_TOKEN=fake-token node dist/cli-boot.js deploy run /tmp/test-deploy-cf --apply --dry-run
[2026-09-17T23:45:38.043Z] ℹ️ INFO  [one-click-deploy] dry-run cloudflare-pages (nothing sent)
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
...
  [planned] upload: not sent (dry-run)
```
*La simulation l'emporte toujours.*

---

### 2.2 Provisionnement base SQL et authentification (`buddy provision`)

#### Aide
```bash
$ node dist/cli-boot.js provision --help
Usage: buddy provision [options] [command]

Provision database and authentication onto a generated web project

Options:
  -h, --help         display help for command

Commands:
  db-auth [options]  Overlay versioned SQL, a typed client, and
                     sign-up/sign-in/sign-out pages (simulation by default)
  help [command]     display help for command
```

```bash
$ node dist/cli-boot.js provision db-auth --help
Usage: buddy provision db-auth [options]

Overlay versioned SQL, a typed client, and sign-up/sign-in/sign-out pages
(simulation by default)

Options:
  --target <supabase|local>  Backend: hosted Supabase (CLI+token required) or
                             local Postgres container
  --dir <path>               Generated web project directory (default: ".")
  --name <slug>              Project slug (default: directory basename)
  --apply                    Write files (default: simulation / dry-run)
                             (default: false)
  --json                     Print the plan as JSON (secret file bodies
                             omitted) (default: false)
  --supabase-cli <bin>       Supabase CLI executable name (default: "supabase")
  --token-env <name>         Environment variable that holds the Supabase
                             access token (value never passed as a flag)
                             (default: "SUPABASE_ACCESS_TOKEN")
  -h, --help                 display help for command
```

#### Exécution sans `--target`
```bash
$ node dist/cli-boot.js provision db-auth
error: required option '--target <supabase|local>' not specified
```
*Code de sortie : 1.*

#### Simulation avec `--target local`
```bash
$ node dist/cli-boot.js provision db-auth --target local
[2026-09-17T23:45:46.165Z] ℹ️ INFO  provision db-auth: dry-run 14 files for cb-doc23-2026-09-18 (local)
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Simulation (no files written)
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Target: local
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Project: cb-doc23-2026-09-18
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Directory: worktree cb-doc23-2026-09-18
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Migrations:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - db/migrations/0001_init.sql  (pending, version 0001_init)
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Files:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create db/migrations/0001_init.sql
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/lib/database.ts
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/AuthApp.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/pages/SignIn.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/pages/SignUp.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/pages/SignOut.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/README.md
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/main.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - update .gitignore
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - update .env.example
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create .env.local  [secrets omitted]
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/index.css
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create docker-compose.yml
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create db/README.md
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Warnings:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - Local compose file is written; containers are not started.
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Next:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - Re-run with --apply to write these files (still no remote project, still no docker start).
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - Keys are never printed; .env.local is gitignored.
```
*Code de sortie : 0.*

#### Échec `--target supabase` sans jeton
```bash
$ node dist/cli-boot.js provision db-auth --target supabase
[2026-09-17T23:45:48.259Z] ❌ ERROR Supabase access token missing. Set SUPABASE_ACCESS_TOKEN (or CODEBUDDY_SUPABASE_ACCESS_TOKEN) in the environment; do not pass the value on the command line. {"code":"MISSING_TOKEN"}
```
*Code de sortie : 1.*

#### Échec `--target supabase` avec jeton mais sans binaire `supabase`
```bash
$ SUPABASE_ACCESS_TOKEN=xxx node dist/cli-boot.js provision db-auth --target supabase
[2026-09-17T23:45:50.266Z] ❌ ERROR Supabase CLI "supabase" was not found on PATH. Install it locally; Code Buddy will not download it or create a remote project. {"code":"MISSING_CLI"}
```
*Code de sortie : 1.*

#### Succès `--target supabase` avec jeton et binaire
```bash
$ SUPABASE_ACCESS_TOKEN=xxx node dist/cli-boot.js provision db-auth --target supabase --supabase-cli /bin/true
[2026-09-17T23:45:52.289Z] ℹ️ INFO  provision db-auth: dry-run 13 files for cb-doc23-2026-09-18 (supabase)
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Simulation (no files written)
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Target: supabase
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Project: cb-doc23-2026-09-18
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Directory: worktree cb-doc23-2026-09-18
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Migrations:
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - supabase/migrations/0001_init.sql  (pending, version 0001_init)
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Warnings:
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - No remote Supabase project will be created. Token is used only as a presence check.
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Next:
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - Re-run with --apply to write these files (still no remote project, still no docker start).
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - Keys are never printed; .env.local is gitignored.
```
*Code de sortie : 0.*

---

### 2.3 Historique unifié (`buddy session`)

#### Aide
```bash
$ node dist/cli-boot.js session --help
Usage: buddy session|sessions [options] [command]

Manage saved sessions

Options:
  -h, --help                    display help for command

Commands:
  list|ls [options]             List recent saved sessions
  search [options] <query...>   Search saved sessions by content
  resume [options] [sessionId]  Resume a saved session by ID or partial ID;
                                without an ID, pick among recent sessions
  last                          Resume the most recently used session
  help [command]                display help for command
```

#### Liste vide et liste avec sessions indexées
```bash
$ node dist/cli-boot.js session list
No sessions found.
```

```bash
$ CODEBUDDY_SESSIONS_DIR=/tmp/test-cb-home/sessions node dist/cli-boot.js session list
Recent sessions (1):

  test-123 - Test Session Documenter 2.3
    1 messages | 9/18/2026 2:00:00 AM
    origin: cli

Use `buddy sessions resume <id>` to resume a session
```
*Affiche l'origine de la session (`cli`, `cowork`, `mobile`).*

#### Reprise d'une session valide
```bash
$ CODEBUDDY_SESSIONS_DIR=/tmp/test-cb-home/sessions node dist/cli-boot.js session resume test-123
Resuming session: Test Session Documenter 2.3 (test-123)
   1 messages, last accessed: 9/18/2026, 2:00:00 AM
   Recap (local, no model call): 0 user / 0 assistant turns, 0 tool call(s)
```
*Code de sortie : 0.*

#### Échec de reprise d'une session inconnue
```bash
$ node dist/cli-boot.js session resume non-existent-id
[2026-09-17T23:47:33.394Z] ❌ ERROR Session not found: non-existent-id

Recent sessions:
```
*Code de sortie : 1.*

---

### 2.4 Import Figma (`buddy figma`)

#### Aide
```bash
$ node dist/cli-boot.js figma --help
Usage: buddy figma [options] [command]

Import a Figma file export into React screens (local JSON, or file key + token
at call time)

Options:
  -h, --help        display help for command

Commands:
  import [options]  Parse a Figma REST JSON export (or fetch a file with a
                    caller-supplied token) and generate React screens
  help [command]    display help for command
```

```bash
$ node dist/cli-boot.js figma import --help
Usage: buddy figma import [options]

Parse a Figma REST JSON export (or fetch a file with a caller-supplied token)
and generate React screens

Options:
  --json <file>         Path to a Figma REST API file JSON export (no network)
  --file-key <id>       Figma file key; requires a token at call time
  --token <token>       Figma personal access token (never stored; FIGMA_TOKEN
                        / CODEBUDDY_FIGMA_TOKEN also accepted)
  --out <dir>           Output directory for generated React + CSS
  --design-system <id>  Optional vendored design-system id to apply (e.g.
                        spotify, figma)
  --dry-run             Parse and report without writing files (default: false)
  -h, --help            display help for command
```

#### Simulation locale à partir d'un export JSON (`--dry-run`)
```bash
$ node dist/cli-boot.js figma import --json tests/figma/fixtures/simple-screen.json --dry-run
Figma import: 1 screen(s), 0 component(s), 0 skipped
  screen Login → src/screens/Login.tsx
Dry run — no files written. Pass --out <dir> to generate.
```
*Code de sortie : 0. Exécution 100 % hors ligne sans appel réseau.*

#### Erreur d'arguments manquants
```bash
$ node dist/cli-boot.js figma import
figma import failed: Provide --json <file> or --file-key <id> (with a token at call time)
```
*Code de sortie : 1.*

#### Erreur de jeton manquant avec `--file-key`
```bash
$ node dist/cli-boot.js figma import --file-key 12345678
figma import failed: A Figma personal access token must be passed at call time (--token, FIGMA_TOKEN, or CODEBUDDY_FIGMA_TOKEN). It is never stored.
```
*Code de sortie : 1.*

---

### 2.5 Gabarit mobile Expo (`expo-rn`)

Vérification de l'inexistence de la commande `buddy expo` :
```bash
$ node dist/cli-boot.js expo --help
# Affiche l'aide racine de Code Buddy — "expo" n'est pas une commande CLI.
```
L'accès s'effectue via l'outil d'agent `scaffold_app` (`template: "expo-rn"`) ou via l'Atelier d'applications Cowork (mots-clés d'intention : `expo`, `mobile`, `react native`, `android`, `ios`, `apk`).

---

### 2.6 Performance de démarrage de la CLI (`cli-boot.js`)

```bash
$ time node dist/cli-boot.js --version
2.2.0

real    0m0.035s
user    0m0.027s
sys     0m0.008s
```
Temps total inférieur à 40 ms grâce au chargement paresseux des modules Commander.

---

## 3. Synthèse des limites (« Ce que chaque fonction ne fait pas »)

Conformément à la consigne, la documentation détaille explicitement ce que chaque fonction **ne fait pas** :

1. **`buddy deploy run` :**
   - N'installe pas `wrangler` ni `netlify-cli`.
   - N'envoie rien sans l'option explicite `--apply`.
   - Si `--apply` et `--dry-run` sont passés ensemble, `--dry-run` gagne.
   - Ne crée pas de compte Cloudflare ou Netlify, de domaine ni d'enregistrement DNS.
   - Ne déploie pas sur Fly, Railway, Render, Hetzner, Northflank, GCP ou Nix (générateurs de configuration uniquement).
   - N'exécute pas de commande shell arbitraire pour `buildScript` (nom de script strict).
   - Ne passe jamais de jeton en argument de processus (variables d'environnement enfant uniquement).
   - Ne déclenche pas de rollback automatique en cas d'échec.
   - Ne permet pas à `outputDir` de sortir de la racine du projet.

2. **`buddy provision db-auth` :**
   - Ne crée aucun projet, organisation ou base de données distante sur Supabase.
   - Ne démarre pas les conteneurs Docker (fournit le `docker-compose.yml` sans exécuter `docker compose up`).
   - N'applique pas les migrations SQL sur une base de données active.
   - N'écrase pas une migration déjà marquée appliquée (`MIGRATION_APPLIED`).
   - N'écrit aucun fichier sans `--apply`.
   - N'affiche aucun secret en clair dans les logs ou le terminal.
   - N'accepte pas de jeton d'accès sur la ligne de commande.
   - Ne télécharge ni n'installe la CLI Supabase.

3. **Historique unifié (`buddy session`) :**
   - Ne copie pas les corps de messages dans l'index (métadonnées uniquement).
   - Ne synchronise pas les sessions via un serveur cloud distant.
   - Ne modifie pas la base SQLite de Cowork (accès strictement en lecture seule).
   - N'échoue pas si SQLite ou Cowork est absent (repli silencieux sur le SessionStore CLI).
   - Ne fusionne pas les historiques de profils différents (`CODEBUDDY_PROFILE`).
   - Ne bloque pas en attente de saisie interactive sans TTY (sortie immédiate en code 1).
   - Ne reprend pas de session en cas de préfixe d'identifiant ambigu.

4. **Import Figma (`buddy figma import`) :**
   - Ne stocke pas les jetons d'accès personnels sur le disque.
   - Ne fait aucun appel réseau si un fichier `--json` est fourni.
   - Ne convertit pas les formes vectorielles arbitraires en géométries SVG complexes (nœuds non gérés ignorés/marqués).
   - N'est pas accessible au compagnon vocal (interdiction stricte de l'outil).

5. **Gabarit Expo (`expo-rn`) :**
   - N'ajoute pas de sous-commande CLI `buddy expo`.
   - Ne crée pas de compte Expo / EAS ni de session cloud.
   - Ne lance aucun build distant sur EAS.
   - Ne produit pas de fichier binaire natif APK ou IPA.
   - Ne publie pas sur l'App Store ni Google Play.
   - Ne fonctionne pas hors ligne lors d'une première installation sans cache npm local.
   - Ne se déploie pas via `buddy deploy run`.

---

## 4. Commandes documentées non exécutées et motifs

Toutes les commandes documentées ont été exécutées au minimum dans leur mode d'aide et leur mode de simulation. Les seules exécutions non menées jusqu'au bout en mode réel (`--apply`) sont :

1. **`buddy deploy run --apply` (vers Cloudflare Pages ou Netlify en production) :**
   - *Motif :* `wrangler` et `netlify-cli` ne sont pas installés sur la machine, aucun jeton de compte cloud réel n'est configuré, et la consigne de mission interdit strictement toute publication externe. La simulation complète a été exécutée et validée.
2. **`buddy provision db-auth --target supabase --apply` (vers un compte Supabase réel) :**
   - *Motif :* La CLI officielle Supabase n'est pas installée sur la machine hôte, aucun jeton de compte hébergé n'est fourni, et l'outil ne crée de toute façon pas de projet cloud distant. La simulation complète (`--target local` et `--target supabase`) a été exécutée et validée.
3. **`buddy expo` :**
   - *Motif :* Cette commande n'existe pas en CLI ; l'accès au gabarit `expo-rn` s'effectue via l'outil d'agent `scaffold_app` ou Cowork App Studio.
4. **Interface graphique Cowork interactive :**
   - *Motif :* Environnement de terminal Linux headless sans serveur d'affichage X11/Wayland actif ; les tests unitaires et le code sous-jacent ont été vérifiés via vitest.

---

## 5. Fichiers mis à jour

- `docs/one-click-deploy.md`
- `docs/provision-db-auth.md`
- `docs/unified-history.md`
- `docs/expo-mobile-template.md`
- `docs/whats-new-2.3.md`
- `CHANGELOG.md` (section `[2.3.0] (unreleased)` ajoutée sans modifier `package.json`)
- `<dépôt privé de passation>/20260918-documentation-2-3/RAPPORT.md`
