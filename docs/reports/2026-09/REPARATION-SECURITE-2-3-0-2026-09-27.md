# Réparation sécurité avant la 2.3.0 — 2026-09-27

Branche `fix/securite-2-3-0`, départ `origin/main` `300496c31`. Source : audit de sécurité
de la révision `300496c31` (onze constats : un bloquant, cinq « à corriger vite », cinq mineurs).

## Tableau constat → correctif → test

| # | Constat | Correctif | Test (rouge avant → vert après) |
|---|---|---|---|
| 1 | La liste blanche d'isolation (`strictMode: false`) laisse les outils lire `~/.codebuddy/codex-auth.json` et les autres identifiants, sans confirmation ; lecture et écriture confondues | `src/security/secret-files.ts` : liste de refus unique, contrôlée **avant** le workspace et la liste blanche, même avec `--allow-outside`, sur le chemin lexical ET résolu (liens). Branchée dans `WorkspaceIsolation.validatePath` (view_file, str_replace, create, multi_edit, apply_patch via la VFS), `search` + recherche avancée (exclusions ripgrep + filtre des résultats), outils d'image, `peer.tool.invoke`, validateur bash. Liste blanche système en **lecture seule** hors dossiers temporaires. Consentement : `CODEBUDDY_ALLOW_SECRET_FILE_READ=true` (opérateur, jamais pour un pair) | `tests/security/secret-files-guard.test.ts` sur un HOME fabriqué (`_qa/securite-2-3-0/home`, faux jetons) : 27 cas rouges sur l'ancien code, 47/47 verts |
| 1b | Contre-revue indépendante : `csv_preview`, `diff_files` et `delegate_agent` (agents PDF/Excel/archive) lisent un fichier sans passer par la VFS ; bash ne voyait pas `cd ~/.codebuddy && cat server.env` | même garde `checkSecretFileAccess` dans les trois outils ; bash résout les jetons relatifs contre la dernière cible de `cd`/`pushd` ; `validateWithIsolation` accepte le mode d'accès | `secret-files-guard.test.ts` : 5 cas rouges sur le commit précédent, 55/55 verts |
| 2 | App Studio : environnement complet transmis à `npm install` / shell | **Non dupliqué** : la PR #255 (liste blanche d'environnement `child-env.ts`, préparation du `cwd` par le processus principal) le couvre. Restent hors #255 : `shell: true`, `npm install` sans `--ignore-scripts`, `safeJoin` sans `realpath` | — |
| 3 | `buddy server` écoute sur `0.0.0.0` | `DEFAULT_HOST = '127.0.0.1'`, l'option `--host` n'écrase plus `HOST` ; exposition explicite `--host 0.0.0.0` / `HOST=0.0.0.0` | `tests/server/securite-2-3-0-serveur.test.ts` (adresse réelle de la socket) |
| 4 | `trust proxy` inconditionnel : `X-Forwarded-For` choisit la clé de limite ; `DEFAULT_SERVER_CONFIG` avec secret connu et `*` | `trust proxy` seulement pour `CODEBUDDY_TRUSTED_PROXIES` ; plus de secret ni de `*` par défaut ; secret vide refusé par `verifyToken` | même fichier : 4 requêtes à en-tête tournant → 200, 200, 429, 429 |
| 5 | Bash : le filtre de chemins ne voit pas `$HOME` / `${HOME}` ; `GH_PAT`, `*_HEADERS`, proxy avec mot de passe transmis | `expandHomeReferences` avant le contrôle des chemins protégés ; chemins d'identifiants refusés (`findCredentialPathInCommand`) ; `ShellEnvPolicy` retire `*_PAT`, `*_HEADERS` et les proxys `user:pass@` | `secret-files-guard.test.ts` (10 commandes refusées, 6 usages courants acceptés ; politique d'environnement) |
| 6 | Repli VFS (isolation coupée) : `realpath` seulement si le fichier final existe | résolution par le plus proche ancêtre existant, échec fermé si non résoluble ; commentaire aligné sur le `if` | `tests/services/vfs-repli-lien-parent.test.ts` |
| 7 | JWT sans `exp` accepté | `exp` numérique obligatoire | `securite-2-3-0-serveur.test.ts` |
| 8 | WebSocket `status` sans authentification révèle version et compteurs | réponse minimale `{connectionId, authenticated:false}` avant authentification | idem (vraie socket) |
| 9 | `avatar.sync` ignore `anonymousRemote` | refus `REMOTE_AUTH_REQUIRED`, comme `chat` | idem (rouge prouvé : l'ancien code renvoyait `avatar:sync`) |

## Changements de comportement (documentés dans `CLAUDE.md` et `docs/deployment.md`)

- `buddy server` n'est plus joignable du réseau sans `--host 0.0.0.0` (ou `HOST=0.0.0.0`) :
  un pair de flotte, la PWA mobile par Tailscale ou un conteneur doivent l'ajouter.
- Un reverse proxy doit être déclaré dans `CODEBUDDY_TRUSTED_PROXIES` pour que `X-Forwarded-For` compte.
- Les outils de l'agent refusent la lecture d'un `.env` de projet (les modèles `.env.example`,
  `.sample`, `.template` restent lisibles ; la création par `create` reste permise).
- Écrire sous `~/.codebuddy` (ou un cache d'outils) par les outils fichier de l'agent est refusé.

## Vérifications

- `npx tsc --noEmit` : 0 erreur. ESLint des fichiers touchés : 0.
- Suites ciblées : sécurité, fleet, outils, serveur, config, doctor, services, unit, agent,
  commandes, skills, interpréteur, compagnon — vertes, hors échecs préexistants listés ci-dessous.
- Échecs constatés aussi sur `origin/main` sans ce diff : `tests/hygiene/home-isolation.test.ts`
  (XDG sous un TMPDIR lié) ; `tests/security/donnees-personnelles.test.ts` (adresse de réseau
  local dans `cowork/tests/preview-probe-service.test.ts`, fichier hors de ce chantier). Les deux
  tests `catalogue-routes-http-*` exigent un arbre git propre : rouges tant que des fichiers
  n'étaient pas commités, sans rapport avec le code.

## Ce qui reste

- Agent d'archive : l'extraction écrit dans le dossier de l'archive sans passer par la règle
  d'écriture (seule la lecture de l'archive est désormais filtrée).
- Un `.npmrc` / `.netrc` / `.pypirc` de projet est refusé en lecture partout (il porte souvent
  un `_authToken`) ; choix assumé, à assouplir si un usage légitime le demande.
- `WebhookServer` (non utilisé dans `src/`) suit aussi le nouveau bind loopback par défaut.

- App Studio : `shell: true`, `npm install --ignore-scripts`, `realpath` dans `safeJoin` (après la #255).
- `list_directory` liste encore les NOMS de fichiers hors workspace (pas leur contenu).
- `/metrics` reste public (le bind loopback en limite l'exposition).
- Durée maximale des JWT non imposée (seule la présence d'`exp` l'est).
- Le validateur bash reste une barrière textuelle : un chemin fabriqué à l'exécution par un
  interpréteur lui échappe ; le confinement est `CODEBUDDY_NATIVE_SANDBOX`.
