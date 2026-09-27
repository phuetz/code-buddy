# Inventaire des fonctionnalités — 27 septembre 2026

Branche : `sol/inventaire-fonctionnalites-2026-09-27`, départ `300496c3122db544c9a803d95ba7bce7784bbb66` (`origin/main`). Commits de contenu : `6ee17ced4` (catalogue, preuves et vitrine) et `c3875d0cd` (fixture de confidentialité). Travail sous `_qa/inventaire/`, avec HOME et projet jetables. Seul Ollama local a été appelé comme fournisseur. Chaque serveur de preuve a écouté `127.0.0.1`, puis s'est arrêté.

## Décompte

L'inventaire explicite passe de 5 à **91 fonctionnalités majeures**. Chacune a un identifiant, un domaine, un bénéfice français et anglais, des `codePaths` et des `entrypoint.checks`. Les **91/91** ont du code et un raccordement statique retrouvés. Les 247 noms découverts automatiquement restent hors de ces affirmations : leur implémentation est encore inconnue.

| Domaine | Total | Testées | Échec | Raccordées seulement |
|---|---:|---:|---:|---:|
| Agent et outils | 15 | 3 | 0 | 12 |
| Fournisseurs et bascule | 6 | 1 | 0 | 5 |
| Contexte et mémoire | 7 | 1 | 0 | 6 |
| Flotte | 7 | 0 | 0 | 7 |
| Serveur et API | 11 | 4 | 0 | 7 |
| Cowork | 5 | 0 | 0 | 5 |
| Auto-amélioration et DGM | 6 | 1 | 0 | 5 |
| Sensoriel et compagnon | 7 | 0 | 0 | 7 |
| Vidéo et médias | 6 | 0 | 0 | 6 |
| Sécurité | 7 | 1 | 0 | 6 |
| CLI et parcours | 14 | 4 | 1 | 9 |
| **Total** | **91** | **15** | **1** | **75** |

États exclusifs ci-dessus. En cumul : 91 codées, 91 raccordées, 15 testées en situation, aucune déployée confirmée. L'échec actuel est `cli-run`. Les 75 autres ont une raison de non-vérification dans l'[audit statique](../../preuves/verification-statique.md). `buddy catalog status --json` compilé rend 338 lignes au total et zéro avertissement.

## Parcours réellement exécutés

- Agent : Ollama `qwen3:4b-instruct` a appelé `read_file` sur un `package.json` factice, reçu `7.3.1`, puis répondu `7.3.1`. Cela prouve le tour et l'outil, pas la qualité générale du modèle.
- Catalogue et CLI : `catalog status --json` analysé (91/91 raccordées), `config show`, `skills list`, `insights` exécutés sous HOME isolé.
- Sessions : un tour Ollama a créé une session ; `session list` l'a retrouvée ; `--resume` a répondu à la question suivante avec `7.3.1` et journalisé la reprise.
- Cron et coffre : tâche factice créée, listée puis retirée ; secret factice créé, listé masqué, relu et retiré avec une clé de test. Aucune tâche planifiée n'a été exécutée.
- DGM : `improve bench --run` a évalué un scénario sur Ollama. Statut `ok`, **score 0**. Aucun progrès d'auto-amélioration n'est revendiqué.
- HTTP : `/api/health` a rendu 200 et `degraded` (source sale pendant le travail). Sur serveur local `--no-auth`, `/api/chat` a répondu `READY` via Ollama ; `/api/memory` et `/api/sessions` ont créé puis relu des données factices (POST 201, GET 200). Tous les serveurs ont terminé avec code 0.

Les [preuves d'exécution](../../preuves/) contiennent commandes, sorties utiles et codes de retour sans chemin de HOME personnel ni identifiant. Il s'agit de la CLI compilée du checkout, pas d'un paquet npm installé.

## Fonctionnalités annoncées dans la doc mais introuvables ou cassées

| Annonce | Constat vérifié | Conséquence |
|---|---|---|
| `buddy run replay` rejoue les lectures d'outils enregistrées (`CLAUDE.md`, aide CLI) | Un run réel contient `tool_call read_file` et `tool_result read_file ok` dans `buddy run show`, mais `buddy run replay` répond « No replayable tool events found ». `src/observability/run-viewer.ts` filtre `view_file` et `file_read`, sans `read_file`. [Trace](../../preuves/inventaire-cli-run-echec.log). | Rejeu de l'alias présenté au modèle cassé malgré un code de sortie 0 ; entrée `cli-run` marquée en échec. |
| Le Guardian Agent terminerait l'ordre d'approbation (`CLAUDE.md`) | `src/security/guardian-agent.ts` existe, mais `src/utils/confirmation-service.ts` n'appelle pas `evaluateToolCall`. | Ne pas le présenter comme contrôle actif des outils. |
| `CODEBUDDY_COMPANION_CORE` activerait la couche relationnelle (`CLAUDE.md`) | `src/companion/core-adapter.ts` existe et a un test isolé, mais aucun appelant de production. | Adaptateur non utilisable par le processus courant. |
| `companion-boot` serait branché au serveur (commentaire du module) | `src/server/companion-boot.ts` n'est pas importé par le serveur. Les boucles vivantes passent par `companion-loops.ts` depuis le heartbeat. | Commentaire faux ; cela ne prouve pas une panne du compagnon entier. |
| Assembleur à `src/agent/film/film-assemble.ts` | Fichier absent ; `film-producer.ts` importe `src/tools/video/film-assemble.ts`. | Chemin documentaire périmé ; aucun montage réel testé ici. |

Autres écarts documentaires relus dans la cartographie Grok : `CLAUDE.md` annonce 2.0.0/v1.8.0 alors que `package.json` vaut 2.2.0, et omet la stratégie fournisseur AGY. Ni `CLAUDE.md` ni le README n'ont été modifiés dans ce chantier.

## Vérifications

- `npm run build` : code 0.
- `npx tsc --noEmit` : code 0.
- `npx vitest run tests/catalog/status.test.ts` : 16/16 verts avec le chargeur Vite `runner` et une copie temporaire de configuration dans `_qa/inventaire/`.
- `npx vitest run tests/security/donnees-personnelles.test.ts` : 40/40 verts après remplacement d'une adresse privée de fixture par l'adresse documentaire `198.51.100.2` ; test Cowork concerné : 6/6 verts.
- `buddy catalog status --json` compilé : 91 entrées explicites, 338 totales, zéro avertissement, 15 preuves positives et un échec actuel.

Le Vitest standard échouait à écrire sa configuration transitoire dans `node_modules/.vite-temp` monté en lecture seule. Le chargeur `runner` seul révélait un `__dirname` absent de la configuration ESM ; sa copie temporaire remplace ce symbole par `process.cwd()` sans modifier le fichier suivi.

## Ce que je n'ai pas pu vérifier

- Aucun paquet npm installé, push, fusion ou déploiement : les 91 états `DÉPLOYÉE` restent inconnus.
- Cowork/Electron, Windows/macOS, Android, Telegram, caméra, micro, GPU, vidéo/ffmpeg et services médias n'ont pas été lancés.
- Aucun fournisseur payant ni identifiant réel ; pas de bascule multi-fournisseur, de sessions de pairs ni d'outils distants testés sur deux hôtes.
- DGM : un seul scénario de benchmark (score 0) ; pas de variante évolutive, cycle d'amélioration, skill ou outil généré validé.
- Serveur : seules santé, chat, mémoire et sessions ont été exercées ; `--no-auth` limité au loopback. Authentification de production et autres routes non vérifiées.
- Les 247 noms détectés automatiquement n'ont pas été audités individuellement. Suite Vitest complète et lint complet non lancés.
