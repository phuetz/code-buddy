# Audit du démarrage à froid du serveur embarqué Cowork (JWT_SECRET) — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Fichiers : `cowork/src/main/server/server-bridge.ts`, `cowork/tests/server-bridge-jwt-coldstart.test.ts` (nouveau), ce rapport, ligne de coordination
- Lu sans modification : `src/server/index.ts`, `src/server/types.ts`, `src/server/middleware/auth.ts`, `src/server/routes/a2a-protocol.ts`, `src/agent/hermes-protocol-gateways.ts`, `cowork/src/main/utils/core-loader.ts`, `cowork/src/main/utils/logger.ts`, `cowork/src/main/tools/hermes-protocol-gateways-bridge.ts`, `cowork/tests/mocks/electron.ts`
- Non touché : prepare/prebuild/libc (gelés), autres modules main, workflows, noyau, installation, rebuild, Electron, profil réel, service, compte, commit, push. Aucun secret affiché, aucun port ouvert.

## Verdict

**Invariants d'ordre confirmés** :
- à froid, sans `JWT_SECRET` du shell, le secret est résolu, généré et persisté **avant** le premier `loadCoreModule` (base, puis serveur) ;
- priorité `JWT_SECRET` hérité du shell, puis secret Settings, puis fichier (source : `if (persisted.jwtSecret && !process.env.JWT_SECRET)` ; *corrigé le 2026-09-14 : une première version de ce rapport inversait shell et Settings*) ;
- repli éphémère si le dossier ne peut pas être créé ;
- aucun secret dans la console ni dans le fichier de journal.

**Trois défauts de persistance reproduits**, tous corrigés dans `server-bridge.ts` :

1. **Fichier `.jwt_secret` vide ou blanc** : le noyau était chargé avec `JWT_SECRET=""`. Le démarrage échouait (`SECURITY ERROR: JWT_SECRET environment variable must be set in production`) alors que le journal affirmait « loaded persisted JWT_SECRET ». Le serveur ne démarrait plus tant que le fichier n'était pas supprimé à la main.
2. **Écriture interrompue** (disque plein, crash entre la création et l'écriture) : `writeFileSync(<chemin final>)` crée et tronque le fichier avant d'écrire. Le premier démarrage passait en éphémère mais laissait un fichier **vide** ; le démarrage à froid suivant tombait dans le défaut 1, de façon permanente.
3. **Fichier tronqué** (`abc123`) : le serveur démarrait **silencieusement avec un secret HMAC de 6 caractères**.

## Lecture de l'ordre et des gardes (noyau, lecture seule)

- **Garde de production** : `src/server/index.ts` `getJwtSecret()` lève sous `NODE_ENV=production` sans `JWT_SECRET`. Elle s'exécute **à l'appel** de `startServer()` (`jwtSecret: userConfig.jwtSecret ?? getJwtSecret(...)`), pas au chargement du module. Aucun `throw` ni capture top-level de `JWT_SECRET` n'existe dans `src/**/*.ts`.
- **Commentaires périmés** : le commentaire de `server-bridge.ts` (corrigé ici), AGENTS.md et `docs/cowork/06-troubleshooting.md` décrivent encore une garde « au chargement ». Les deux documents sont hors périmètre et restent inchangés.
- **Captures au chargement** : `DEFAULT_CONFIG.jwtSecret` (`src/server/index.ts:177`) est écrasé par `getJwtSecret()` dans `startServer`. `DEFAULT_SERVER_CONFIG.jwtSecret = process.env.JWT_SECRET || 'change-me-in-production'` (`src/server/types.ts:107`) n'a **aucun usage** dans `src` : export mort, sans effet à l'exécution, signalé seulement. Les autres lectures (mobile, websocket, desktop) ont lieu à l'appel.
- **Imports précoces** : sur les 124 entrées noyau chargées par Cowork (analyse statique du `dist` d'intégration), deux atteignent l'auth :
  - `server/index.js`, chargé par le pont après le secret ;
  - `agent/hermes-protocol-gateways.js` (`hermes-protocol-gateways-bridge.ts`, à la demande), via `routes/a2a-protocol.js → middleware/index.js → middleware/auth.js`.

  L'auth peut donc être **importée** avant le démarrage du serveur, mais sans effet : aucun de ces modules ne lit le secret au chargement (`auth.ts` lit `config.jwtSecret` à la vérification).
- **Sondes pre-build-check sous `NODE_ENV=test`** : elles ne rencontreraient de toute façon aucune garde au chargement, puisque la garde est à l'appel.

## Harnais

Fichier `cowork/tests/server-bridge-jwt-coldstart.test.ts`. Vitest `pool: forks`, donc un processus neuf par fichier. Pour chaque démarrage :
- `vi.resetModules()` et nouvel import de `server-bridge` ;
- `HOME`, `USERPROFILE` et `XDG_*` dans un dossier `/tmp` propre au scénario, `app.getPath('userData')` et `getAppPath()` mockés vers ce dossier ;
- `NODE_ENV=production`, `JWT_SECRET` supprimé (sauf scénario shell) ;
- `configStore` mocké, vrai `core-loader` avec `CODEBUDDY_ENGINE_PATH` vers un **faux `dist` unique** ;
- faux `database/database-manager.js` et `server/index.js` qui journalisent `JWT_SECRET` au chargement ; `startServer` applique la garde de `getJwtSecret()` et renvoie un faux serveur (port 43210), **sans écoute** ;
- vrai logger Cowork : console capturée et fichier de journal relu.

Noms des blocs :
- « ServerBridge cold start under NODE_ENV=production — **real filesystem and core-loader, fake core database/server modules, no listener** » ;
- « ServerBridge cold start under NODE_ENV=production — **simulated ENOSPC on the secret write (fs.writeFileSync stub), fake core modules** ».

## Reproduction avant correction (code `HEAD`)

```
REPRO empty file -> {"status":{"running":false,…,"error":"SECURITY ERROR: JWT_SECRET environment variable must be set in production."},"events":[{"event":"load:database","jwtSecret":"","nodeEnv":"production"},{"event":"load:server","jwtSecret":"","nodeEnv":"production"}],"loadedLog":true}
REPRO truncated file -> {"status":{"running":true,"port":43210,…,"error":null},"secretsSeen":["abc123","abc123","abc123"]}
REPRO first start -> {"status":{"running":true,…},"secretLen":128,"leftover":"\"\""}
REPRO next cold start -> {"status":{"running":false,…,"error":"SECURITY ERROR: JWT_SECRET environment variable must be set in production."},"events":[{"event":"load:database","jwtSecret":""…},{"event":"load:server","jwtSecret":""…}]}
```

Suite finale exécutée sur le `server-bridge.ts` de `HEAD` (restauré ensuite, empreinte SHA-256 identique) : **5 rouges** (vide, blanc, tronqué, message de lecture impossible, écriture interrompue) et **4 verts** (génération avant chargement, réutilisation, priorités, dossier bloqué). Les invariants d'ordre étaient donc déjà corrects.

## Correction (`server-bridge.ts`)

- **`persistJwtSecret()`** : `mkdirSync`, fichier temporaire `.<pid>.<aléa>.tmp` créé en exclusif (`flag: 'wx'`, `mode: 0o600`) dans le même dossier, puis `renameSync` vers `.jwt_secret`. En cas d'échec, le temporaire est supprimé et l'erreur d'origine remontée. Le chemin final n'est jamais vide ni partiel.
- **Contenu persisté** :
  - valeur rognée de 32 caractères ou plus (seuil « weak » de `src/security/security-audit.ts`) : reprise telle quelle, comme avant, y compris un secret non hexadécimal fourni volontairement ;
  - valeur vide ou plus courte : journal `persisted JWT_SECRET is empty|too short (N characters); replacing it` (longueur seule, jamais la valeur), nouveau secret de 128 hex, persistance atomique.
- **Lecture impossible** (EACCES…) : secret éphémère, fichier non touché, journal `could not read the persisted JWT_SECRET, using ephemeral fallback` au lieu de l'ancien « failed to persist ».
- **Inchangés** : `failed to persist JWT_SECRET, using ephemeral fallback`, `minted and persisted new JWT_SECRET`, `loaded persisted JWT_SECRET`, priorité shell > Settings > fichier, résolution avant tout `loadCoreModule`.
- **Commentaire** : corrigé (la garde du noyau est dans `startServer`).

## Tests (9, tous nouveaux)

Vrai système de fichiers, vrai `core-loader`, faux modules noyau, sans écoute :
1. Génération à froid : 128 hex, mode `0600`, dossier ne contenant que `.jwt_secret` ; ordre `load:database → load:server → startServer`, avec le secret déjà présent aux trois étapes ; serveur (factice) démarré ; secret absent des journaux.
2. Secret persisté réutilisé sans réécriture.
3. Priorité shell, puis Settings : chaque source seule, puis **les deux renseignées** (le secret du shell est utilisé aux trois étapes et `process.env.JWT_SECRET` reste celui du shell), aucun fichier créé. *Test renommé et complété le 2026-09-14 (« uses the shell secret first, then the Settings secret, and creates no file for either ») ; la première version portait un nom inversé et ne testait pas les deux sources ensemble.*
4. à 6. Fichier vide, blanc, tronqué (`it.each`) : remplacé par un secret valide, serveur démarré, message avec la longueur seule, pas de « loaded persisted », nouveau secret absent des journaux.
7. Dossier `.codebuddy` impossible à créer (fichier ordinaire à sa place) : secret éphémère, démarrage, journal sans secret.
8. Fichier illisible (`chmod 000`, ignoré sous Windows ou en root) : secret éphémère, fichier intact (mode `0000`), message de lecture.

Panne d'écriture simulée (bouchon `fs.writeFileSync`), faux modules noyau :

9. ENOSPC pendant l'écriture : premier démarrage éphémère avec journal ENOSPC et **dossier vide** (ni fichier final ni temporaire) ; le démarrage à froid suivant génère et persiste un secret valide et démarre.

## Validation

Toutes les commandes sont lancées depuis `cowork/`.

| Contrôle | Résultat |
| --- | --- |
| `npx vitest run tests/server-bridge-jwt-coldstart.test.ts tests/embedded-mode.test.ts` | 2 fichiers, **48/48** |
| Suite sur `server-bridge.ts` de `HEAD` | 5 rouges, 4 verts ; fichier corrigé restauré (SHA-256 identique) |
| M1 écriture directe non atomique | 1 rouge (ENOSPC) ; restaurée |
| M2 longueur minimale non vérifiée | 3 rouges (vide, blanc, tronqué) ; restaurée |
| M3 nettoyage du temporaire supprimé | 1 rouge (ENOSPC) ; restaurée |
| M4 (correction du 2026-09-14) Settings écrasant le shell (`&& !process.env.JWT_SECRET` retiré) | 1 rouge (cas deux sources) ; restaurée ; suite JWT 9/9 |
| Couverture complétée (voir `COWORK-SERVER-STOP-FAILURE-OPUS-2026-09-14.md`) | secret de 32 caractères non hex gardé, 31 remplacé ; échec du `rename` (temporaire supprimé, éphémère, persistance au démarrage suivant) ; suite JWT 11/11 ; mutations seuil strict et temporaire non supprimé rouges |
| `npx eslint --max-warnings 0` et `npm run lint -- --max-warnings 0` sur les 2 fichiers | 0 erreur, 0 avertissement |
| `npx tsc --noEmit -p tsconfig.json` (Cowork) | 0 erreur dans `server-bridge.ts` ; 20 erreurs préexistantes dans 4 fichiers du noyau (`os-sandbox`, `archive-tool`, `document-generator`, `document-tool`) |
| `tsc --noEmit --strict` ponctuel sur le test | OK |
| `git diff --check` | propre |
| Vrai profil : `~/.codebuddy/.jwt_secret` | inexistant (stat seul, contenu jamais lu) : aucun test n'y a écrit |
| Modules partagés, `find -newerct 2026-09-14 02:42` hors caches Vite/Vitest | aucun changement |
| `/tmp` | aucune fixture résiduelle |

## Limites

- **Pas d'Electron réel ni de vrai serveur du noyau** : la garde de production est reproduite dans le faux `server/index.js` à partir du source lu. Node 24.14.1 seulement.
- **Windows** : `renameSync` remplace un fichier existant ; non exécuté ici, et le test du fichier illisible y est ignoré.
- **Concurrence** : deux processus Cowork générant en même temps donneraient toujours « le dernier renommage gagne », comme avant. Cowork prend un verrou d'instance unique ; non traité.
- **Secret de 32 caractères ou plus mais faible** : repris tel quel (choix de compatibilité pour un secret fourni volontairement). L'audit sécurité du noyau le signale déjà.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/src/main/server/server-bridge.ts`
- `cowork/tests/server-bridge-jwt-coldstart.test.ts`
- `docs/reports/2026-09/COWORK-SERVER-JWT-COLDSTART-AUDIT-OPUS-2026-09-14.md`
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot)

Documentation à mettre à jour par son propriétaire : AGENTS.md (§ Cowork, `JWT_SECRET runtime fallback`) et `docs/cowork/06-troubleshooting.md` décrivent une garde « au chargement » ; la garde est dans `startServer`.
