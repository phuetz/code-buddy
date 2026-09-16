# Audit du cycle de vie `ServerBridge.start` / `stop` concurrents — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Fichiers : `cowork/src/main/server/server-bridge.ts`, `cowork/tests/server-bridge-lifecycle.test.ts` (nouveau), ce rapport, ligne de coordination. Correction préalable du lot JWT : `cowork/tests/server-bridge-jwt-coldstart.test.ts` et `COWORK-SERVER-JWT-COLDSTART-AUDIT-OPUS-2026-09-14.md`
- Non touché : noyau, renderer, packaging, installation, rebuild, Electron, vrai profil, services. Les modifications JWT sont conservées.

## 0. Correction préalable du lot JWT

La priorité réelle est **`JWT_SECRET` hérité du shell, puis secret Settings, puis fichier** : `if (persisted.jwtSecret && !process.env.JWT_SECRET)` n'applique Settings que si le shell n'a rien fourni. Le rapport JWT annonçait l'inverse, et son test vérifiait chaque source séparément sous un nom inversé.

- **Test** renommé « uses the shell secret first, then the Settings secret, and creates no file for either ». Il couvre désormais **les deux sources renseignées** : le secret du shell est utilisé aux trois étapes et reste dans `process.env`, aucun fichier n'est créé.
- **Mutation** : Settings écrasant le shell (`&& !process.env.JWT_SECRET` retiré) → 1 rouge (cas deux sources) ; restaurée. Suite JWT 9/9.
- **Contrat** inchangé. Rapport JWT et coordination corrigés, avec mention explicite de l'erreur initiale.

## Verdict

**Défauts réels reproduits** sur le code avant ce lot (JWT compris) :

| Scénario | Observé avant correction |
| --- | --- |
| S1 `stop()` pendant `startServer` (serveur déjà créé) | `stop()` se résout **immédiatement** avec `running: false`, puis `start()` publie `running: true` ; `status().running = true` ; serveur 1 **jamais fermé** ; `cognitionPort` publié |
| S2 `stop()` pendant l'init de la base | `stop()` immédiat, puis boot complet : serveur créé et publié |
| S3 `stop()` pendant l'import du store Settings | boot complet malgré l'arrêt (`db:initialize`, `load:server`, `startServer:1:created`), `running: true` |
| S4 `start()` pendant un `stop()` en cours | `start()` rend **immédiatement** `running: true` (état périmé), puis le stop se termine : état final arrêté, **aucun nouveau serveur**, redémarrage avalé |
| S5 deux `stop()` concurrents | `stopServer` appelé **deux fois** sur le même serveur ; erreur parasite `server 1 is already closed` |
| S6 `start()` explicite après un stop pendant le boot | aucun nouveau serveur (le premier n'a jamais été fermé) |
| S8 échec de la fermeture tardive | aucune fermeture tardive tentée : le stop ne voit pas le serveur |
| S7 deux `start()` concurrents | **déjà correct** : un seul boot partagé |

Cause : `stop()` ne regardait que `this.instance`, `null` pendant tout le boot ; `start()` ne connaissait ni les arrêts demandés ni les arrêts en cours.

## Harnais

`cowork/tests/server-bridge-lifecycle.test.ts`, bloc « ServerBridge start/stop lifecycle — real core-loader, fake core server with held steps, no listener ».

- **Isolation** : `vi.resetModules()` à chaque instance ; `HOME` et `userData` en `/tmp` ; `NODE_ENV=production`, `JWT_SECRET` fourni, aucun fichier de secret ; `electron` mocké.
- **Import Settings retenu** : `configStore` injecté par `vi.doMock` à chaque instance, pour pouvoir retenir l'import dynamique (première attente de `start()`). *Un premier essai avec `vi.mock` hissé ne réexécutait pas la fabrique après un test précédent : le scénario S3 expirait sans rien prouver ; corrigé avant toute conclusion.*
- **Faux noyau** : vrai `core-loader`, faux `dist` par test.
  - `database-manager.initialize()` retenable ;
  - `startServer` **crée** le serveur puis attend une étape retenable (un serveur existe déjà avant la résolution) ;
  - `stopServer` retenable, refuse une double fermeture et peut échouer une fois sur demande ;
  - aucune écoute réseau.
- **Preuve de non-résolution** : `settle()` laisse passer 20 tours de `setImmediate`.
- **Observation des états finaux** : fichier temporaire, supprimé après usage.

## Correction (`server-bridge.ts`)

- **`generation`** : incrémentée de façon synchrone par **chaque** `stop()`. `start()` la capture à son appel.
- **`start()`** :
  - après l'import Settings, retour sans rien démarrer si un stop a été demandé depuis l'appel ;
  - attend un `stop()` en cours, ou un boot annulé, avant de démarrer à nouveau (redémarrage explicite), puis revérifie la génération ;
  - le boot mémorise sa génération (`bootGeneration`) et la vérifie après l'init de la base et après le chargement du module serveur : si annulé, retour **avant de créer le serveur** (journal `start cancelled by a stop request before the core server was created`). *Précision de la contre-relecture (`COWORK-SERVER-BOOTSTRAP-RECHECK-OPUS-2026-09-14.md`) : aucun contrôle n'existait entre la fin de l'import du module base et `getDatabaseManager()`/`initialize()`. Un stop pendant cet import déclenchait encore une nouvelle init. Contrôle ajouté ; une init déjà commencée n'est pas annulée.*
  - après `startServer` : si annulé, **`closeLateServer`** ferme effectivement le serveur créé, sans le publier (journal `stop requested during start; closed the server on host:port`) ;
  - si cette fermeture échoue, le serveur est encore en marche : il reste **publié** avec `lastError = stop requested during start, but closing the server failed: …`, et un `stop()` ultérieur peut réessayer.
- **`stop()`** :
  - partage un stop déjà en cours (`stopInFlight`) ;
  - s'il y a un boot en cours, attend qu'il se termine (fermeture tardive comprise) et renvoie son état, sans répondre « arrêté » avant ;
  - sinon, arrêt normal (`stopInstance`, corps inchangé de l'ancien `stop`).
- **Refactor** : `publish()` factorise la publication ; type `StartedServer` extrait.
- **Inchangés** : résolution JWT, init de la base, message et comportement d'un échec d'arrêt normal.
- **Effets non annulés**, par construction : une init de base déjà faite (singleton idempotent) et un serveur déjà créé, que l'on ferme.

## Tests (8, nouveaux)

1. S1 : stop non résolu tant que le boot n'a pas fini ; `start` et `stop` répondent `running: false` ; serveur 1 fermé, fermé une seule fois ; `cognitionPort` nul.
2. S2 : stop pendant l'init de la base → aucun `startServer`, aucun serveur.
3. S3 : stop pendant l'import Settings → aucun événement noyau, aucun serveur.
4. S4 : start pendant un stop → non résolu avant la fin du stop, puis serveur 2 en marche, serveur 1 fermé, `cognitionPort` du serveur 2.
5. S5 : deux stops → une seule fermeture, pas d'erreur.
6. S6 : start explicite après un stop pendant le boot → serveur 2 en marche.
7. S7 : deux starts concurrents → un seul serveur.
8. S8 : fermeture tardive en échec → `running: true` avec l'erreur, serveur non fermé ; le stop suivant le ferme.

## Validation

Toutes les commandes sont lancées depuis `cowork/`, Node 24.14.1.

| Contrôle | Résultat |
| --- | --- |
| Suite cycle de vie sur le code avant correction | **7 rouges / 1 vert** (S7) |
| `npx vitest run tests/server-bridge-lifecycle.test.ts tests/server-bridge-jwt-coldstart.test.ts tests/embedded-mode.test.ts` | 3 fichiers, **56/56** |
| Suite cycle de vie rejouée 10 fois | 10/10 vertes (8/8 chaque fois) |
| M1 stop n'attend pas le boot | 3 rouges (S1, S2, S8) |
| M2 pas de contrôle après `startServer` | 3 rouges (S1, S6, S8) |
| M3 pas de contrôle après l'import Settings | 1 rouge (S3) |
| M4 start n'attend pas un stop en cours | 1 rouge (S4) |
| M5 fermeture tardive en échec oubliée | 1 rouge (S8) |
| M6 stops concurrents non partagés | 1 rouge (S5) |
| Restauration après mutations | empreinte SHA-256 identique |
| `npx eslint --max-warnings 0`, `npm run lint -- --max-warnings 0` (pont et 2 tests) | 0 erreur, 0 avertissement |
| `npx tsc --noEmit -p tsconfig.json` | 0 erreur dans `server-bridge.ts` ; 20 erreurs préexistantes, inchangées, dans 4 fichiers du noyau |
| `tsc --noEmit --strict` ponctuel sur les 2 tests | OK |
| `git diff --check` | propre |
| Vrai `~/.codebuddy/.jwt_secret` | inexistant (vérifié sans lecture) |
| Modules partagés, `find -newerct 2026-09-14 02:58` hors caches Vite/Vitest | aucun changement |
| `/tmp`, journaux temporaires, fichier d'observation | supprimés |

## Limites et observations

- **Faux noyau, sans Electron ni vrai serveur** : l'écoute réelle et la fermeture d'un vrai `http.Server` ne sont pas exercées.
- **Arrêt normal en échec** (préexistant, hors scénario concurrent) : `stopInstance` efface l'instance même quand `stopServer` échoue, donc un serveur peut rester en marche tout en étant déclaré arrêté. La fermeture tardive, elle, garde le serveur suivi en cas d'échec. Asymétrie signalée, non modifiée dans ce lot. *Fermé ensuite par `COWORK-SERVER-STOP-FAILURE-OPUS-2026-09-14.md` : conservation selon que le serveur écoute encore, pour l'arrêt normal comme pour la fermeture tardive.*
- **`lastError`** n'est pas effacée par un arrêt réussi : comportement préexistant, inchangé.
- **IPC** : les appels passent par `server-ipc.ts`, non modifié ; le contrat `ServerStatus` est inchangé.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/src/main/server/server-bridge.ts` (contient aussi les changements JWT)
- `cowork/tests/server-bridge-lifecycle.test.ts`
- `cowork/tests/server-bridge-jwt-coldstart.test.ts` (test de priorité corrigé)
- `docs/reports/2026-09/COWORK-SERVER-LIFECYCLE-AUDIT-OPUS-2026-09-14.md`
- `docs/reports/2026-09/COWORK-SERVER-JWT-COLDSTART-AUDIT-OPUS-2026-09-14.md` (priorité corrigée)
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot, ligne JWT corrigée)
