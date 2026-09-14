# Échec d'arrêt normal du serveur embarqué Cowork — Claude Opus, 2026-09-14

- Agent : Claude Opus 5, piloté par Codex
- Worktree : `~/DEV/cb-cowork-build-opus-2026-09-14`, branche `fix/cowork-build-opus-2026-09-14`, base `d579f26ec`, **aucun commit ni push**
- Fichiers : `cowork/src/main/server/server-bridge.ts`, `cowork/tests/server-bridge-lifecycle.test.ts`, `cowork/tests/server-bridge-jwt-coldstart.test.ts`, ce rapport, ligne de coordination (renvois ajoutés dans les rapports cycle de vie et JWT)
- Lu sans modification : `src/server/index.ts` (`stopServer`)
- Non touché : noyau, renderer, packaging, installation, rebuild, Electron, vrai profil, service persistant. Modifications JWT et cycle de vie conservées.

## Verdict

**Défaut réel reproduit, y compris avec un vrai `http.Server` loopback.** Quand `stopServer` rejetait, `stopInstance` effaçait l'instance dans un `finally`, sans savoir si le serveur écoutait encore. Sur un vrai serveur `127.0.0.1` (port 0), démontage en échec avant `server.close()`, code d'avant correction :

```
OBSERVE {"stopped":{"running":false,"error":"teardown failed before closing the HTTP server"},"firstPort":46505,"firstStillListening":true,"firstStillAnswers":"ok","secondStart":{"running":true,"port":34943},"realServersListening":[true,true],"stopAfterSecondStart":{"running":false,"error":null,"listening":[true,false]}}
```

- le pont annonçait `running: false` alors que le premier serveur **répondait encore** ;
- `start()` créait un **second serveur réel** : deux écoutaient ;
- le `stop()` suivant ne fermait que le second : le premier restait **ouvert, orphelin et hors suivi**.

Corrigé : après un rejet, le pont regarde si le serveur écoute encore.
- **Encore vivant** : instance, statut (`running: true`), port et `cognitionPort` conservés, avec l'erreur. `start()` ne crée pas de second serveur, et un `stop()` ultérieur réessaie.
- **Déjà fermé** : le serveur est oublié avec l'erreur, pour qu'un `start()` puisse démarrer au lieu de rester bloqué.

## Lecture du noyau (`src/server/index.ts` `stopServer`)

Deux familles d'échec, aux conséquences opposées :
1. **Serveur vivant.** Dans l'exécuteur de la `Promise`, les étapes `stopFleetHeartbeat()`, `unwire…Bridge()`, `closeAllConnections()` et `closeDesktopWebSocket()` s'exécutent **avant** `server.close()` ; une exception synchrone rejette la promesse sans fermer le serveur.
2. **Serveur déjà fermé.** `server.close(cb)` renvoie `ERR_SERVER_NOT_RUNNING` (« Server is not running. ») : garder l'instance serait mensonger et bloquerait tout redémarrage.

## Correction (`server-bridge.ts`)

- **`isStillListening(server)`** : `server.listening` quand c'est un booléen (vrai `http.Server`), sinon `address() !== null`. Si rien n'est lisible, le serveur est **supposé vivant** : oublier un serveur vivant est la direction dangereuse.
- **`stopInstance()`** :
  - succès : l'instance est oubliée et **`lastError` remis à `null`** (un nouvel essai réussi n'affiche plus l'échec précédent) ;
  - rejet avec serveur vivant : `lastError = <message>`, instance conservée, journal `stop failed; the server is still running:` ;
  - rejet avec serveur fermé : `lastError = <message>`, instance oubliée, journal `stop failed; the server is no longer listening:`.
- **`closeLateServer()`** (lot cycle de vie) : même règle. Le serveur tardif n'est publié avec l'erreur que s'il écoute encore.
- **Refactor** : `forgetInstance()` factorise l'effacement ; type `CoreHttpServer` (`close`, `address`, `listening?`).
- **Stops simultanés** : ils partagent déjà une seule opération (`stopInFlight`, lot cycle de vie). Les deux appelants reçoivent le même statut d'échec, et une seule fermeture est tentée.
- **Inchangés** : format de `lastError` pour un arrêt normal (message brut), contrat `ServerStatus`, IPC, JWT.

## Harnais

`cowork/tests/server-bridge-lifecycle.test.ts` :
- **Faux noyau** `held` : les faux serveurs exposent `listening` et `address()` (`null` une fois fermés) ; `closeThenFail` ferme puis rejette comme `ERR_SERVER_NOT_RUNNING`.
- **Variante `http`** : faux noyau sans API, noyau ni fournisseur. `startServer` crée un **vrai `http.Server`** sur `127.0.0.1:0` (réponse `ok`, `Connection: close`) ; `stopServer` peut lever **avant** `server.close()`, puis appelle `server.close(cb)` comme le noyau.
- **Fermeture garantie** : `afterEach` coupe les connexions et ferme tout serveur réel resté ouvert. Aucun service persistant.
- **Isolation** : `HOME` et `userData` en `/tmp`, `electron` mocké.

## Tests ajoutés (14 au total dans le fichier)

Faux noyau, étapes retenues, sans écoute :
1. Échec d'arrêt → `running: true`, erreur, `cognitionPort` conservé ; `start()` → pas de second serveur ; nouvel essai → fermé, erreur `null` ; `start()` → serveur 2.
2. Deux stops simultanés en échec → même statut d'échec, une seule tentative ; nouvel essai → fermé.
3. Rejet alors que le serveur est fermé → `running: false`, erreur `Server is not running.` ; `start()` → serveur 2.
4. Fermeture tardive (stop pendant `startServer`) qui ferme puis rejette → pas de publication, erreur explicite ; `start()` → serveur 2.

Vrai `http.Server` loopback, port 0 :

5. Démontage en échec → le pont rapporte `running: true` et le même port ; le serveur **répond toujours** `ok` ; `start()` ne crée pas de second serveur ; nouvel essai → `listening: false` et **`ECONNREFUSED`** ; `start()` → nouveau serveur qui répond.
6. Serveur fermé derrière le pont → `stopServer` rejette avec `Server is not running.` → `running: false`, `ECONNREFUSED` ; `start()` → nouveau serveur qui répond.

## Couverture JWT complétée (`server-bridge-jwt-coldstart.test.ts`, 11 tests)

Contrat inchangé.
- **Compatibilité 32** : un secret persisté de **32 caractères non hex** est réutilisé tel quel (même fichier, journal « loaded persisted », valeur absente des journaux). À **31 caractères**, il est remplacé avec « too short (31 characters) ».
- **Échec du rename** (bouchon `fs.renameSync`, EPERM sur `.jwt_secret`) : secret éphémère, journal EPERM, **dossier vide** (temporaire supprimé, aucun fichier final) ; le démarrage à froid suivant persiste un secret différent.

## Validation

Toutes les commandes sont lancées depuis `cowork/`, Node 24.14.1.

| Contrôle | Résultat |
| --- | --- |
| Nouveaux tests sur le code avant correction | 3 rouges (faux noyau échec, simultanés, vrai `http.Server`) ; les cas « déjà fermé » et la couverture JWT passaient déjà |
| `npx vitest run tests/server-bridge-lifecycle.test.ts tests/server-bridge-jwt-coldstart.test.ts tests/embedded-mode.test.ts` | 3 fichiers, **64/64** |
| Suite cycle de vie (vrai loopback compris) rejouée 10 fois | 10/10 vertes (14/14 chaque fois) |
| N1 instance toujours oubliée après échec | 3 rouges (échec, simultanés, vrai `http.Server`) |
| N2 serveur fermé jamais oublié | 2 rouges (fermé faux noyau, fermé vrai `http.Server`) |
| N3 serveur tardif fermé publié quand même | 1 rouge |
| N4 arrêt réussi gardant l'erreur précédente | 3 rouges |
| J1 seuil strict `> 32` | 1 rouge (compatibilité 32) |
| J2 temporaire non supprimé | 2 rouges (rename, ENOSPC) |
| Restauration après mutations | empreinte SHA-256 identique |
| `npx eslint --max-warnings 0`, `npm run lint -- --max-warnings 0` (pont et 2 tests) | 0 erreur, 0 avertissement |
| `npx tsc --noEmit -p tsconfig.json` | 0 erreur dans `server-bridge.ts` ; 20 erreurs préexistantes inchangées (noyau) |
| `tsc --noEmit --strict` ponctuel sur les 2 tests | OK |
| `git diff --check` | propre |
| Vrai `~/.codebuddy/.jwt_secret` | inexistant (vérifié sans lecture) |
| Modules partagés, `find -newerct 2026-09-14 03:06` hors caches Vite/Vitest | aucun changement |
| `/tmp`, fichier d'observation, journaux temporaires | supprimés |

## Limites

- **Pas de vrai `stopServer` du noyau** (sensoriel, flotte, WebSocket) : la variante `http` en reproduit la forme. Pas d'Electron. Node 24 seulement.
- **Connexions keep-alive** : un vrai `server.close()` attend leur fin. Le serveur d'essai répond `Connection: close` ; une fermeture qui ne se termine jamais (promesse pendante) n'est pas un rejet et reste hors périmètre.
- **Serveur qui n'expose ni `listening` ni `address()` exploitable** : supposé vivant après un rejet. Un nouvel essai d'arrêt reste possible, un `start()` renvoie l'état suivi.

## Passation

Fichiers de ce lot, à ajouter nommément :
- `cowork/src/main/server/server-bridge.ts`
- `cowork/tests/server-bridge-lifecycle.test.ts`
- `cowork/tests/server-bridge-jwt-coldstart.test.ts`
- `docs/reports/2026-09/COWORK-SERVER-STOP-FAILURE-OPUS-2026-09-14.md`
- `docs/reports/2026-09/COWORK-SERVER-LIFECYCLE-AUDIT-OPUS-2026-09-14.md` (renvoi)
- `docs/reports/2026-09/COWORK-SERVER-JWT-COLDSTART-AUDIT-OPUS-2026-09-14.md` (renvoi)
- `docs/FABLE5-CODEX-COORDINATION.md` (ligne de ce lot)
