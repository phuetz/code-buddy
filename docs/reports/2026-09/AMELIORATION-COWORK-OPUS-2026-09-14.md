# Amélioration Cowork — écran Fleet et états de connexion (Opus, 2026-09-14)

- **Agent** : Claude Opus 5, piloté par Codex, demande explicite de Patrice.
- **Worktree** : `~/DEV/cb-cowork-improvements-opus-2026-09-14`
- **Branche** : `feat/cowork-improvements-opus-2026-09-14`, base `017ba1aa8`.
- **Périmètre** : `cowork/src`, tests Cowork, ce rapport, ma ligne de coordination.
- **Interdits** : commit/push, publication, compte, API LLM distante, commande robot,
  service/config utilisateur, Electron sur profil réel, `npm install`/rebuild, `src/` hors
  `cowork/`, `src/fleet/rooms` (intégrés séparément par le pilote).

## Statut

**Lot 3 livré au pilote, non commité** (2026-09-14). À la sortie réelle de Cowork, le
`FleetBridge` créé au boot est désormais fermé : délai borné, une seule fois, sans créer de
singleton, sans reconnexion ensuite. Delta du lot 3 : `cowork/src/main/index.ts` (10 lignes
ajoutées, aucune retirée) et deux fichiers nouveaux. Les fichiers de la seconde livraison sont
intacts (empreintes SHA-256 identiques avant et après).

**Lot 2 livré au pilote, non commité** (2026-09-14). Les trois défauts confirmés par la revue
de la première livraison sont corrigés, avec tests rouges → verts (section « Lot 2 »). Les mêmes
quatre fichiers sont touchés, aucun nouveau.

Lot 1 (~01 h 10) : deux problèmes utilisateur corrigés avec tests rouges → verts ; typecheck sans
erreur dans `cowork/src` ; lint ciblé propre ; bundle renderer compilé. Le build Vite complet
échoue sur le bundle main pour une cause d'environnement antérieure (voir « Limites »).

## Fichiers

| Fichier | Nature |
| --- | --- |
| `cowork/src/main/fleet/fleet-bridge.ts` | Correctif P1 + P2 (bridge main). |
| `cowork/src/renderer/components/FleetPanel.tsx` | Correctif P2 (retour du bouton « Reconnect », erreur de liste). |
| `cowork/tests/fleet-bridge.test.ts` | Faux listener fidèle au core (`NOT_AUTHENTICATED`), 8 tests ajoutés. |
| `cowork/tests/fleet-panel-connection.test.tsx` | Nouveau, 4 tests happy-dom. |
| `docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md` | Ce rapport. |
| `docs/FABLE5-CODEX-COORDINATION.md` | Ma ligne de réservation (déjà ajoutée par le pilote, mise à jour). |

Aucun fichier hors `cowork/` et `docs/` modifié ; `src/fleet/rooms` non touché et non inventé.

## Correctifs

### P1 — Connexion perdue mal récupérée, cause invisible (`fleet-bridge.ts`)

- `updateStatus()` ne réécrit plus `lastError` sur les transitions `connecting` / `connected` /
  `disconnected` / `reconnecting` : la cause reste affichée ; seule une authentification réussie
  l'efface.
- `refreshPeerCapabilities()` ne sonde plus `peer.describe` sur un pair non authentifié (ouvrir
  le panneau ne remplace plus la vraie cause par `NOT_AUTHENTICATED`). `refreshCapabilities(peerId)`
  sur un pair déconnecté répond `success: false` avec « not connected (<statut>); reconnect it
  first » au lieu d'un faux succès — le bandeau d'erreur du Command Center l'affiche.
- Événement `exhausted` écouté : statut `error`, message « Auto-reconnect gave up after N
  attempts: <cause> ».
- **Reprise au niveau du bridge** pour les deux cas que le core ne retente pas (échec de la
  première connexion, auto-reconnexion épuisée) : délais 15 s, 30 s, 1 min, 2 min puis 5 min en
  boucle, remis à zéro à l'authentification, timer `unref()`. Pas de reprise si le serveur a
  refusé les identifiants (`AUTH_FAILED` / `INVALID_TOKEN`) : marteler une clé fausse ne sert à
  rien, la cause reste affichée. Annulée par `removePeer`, `shutdown` et par une reconnexion
  manuelle. Délais injectables (`new FleetBridge(send, feed, { recoveryDelaysMs })`), défaut
  inchangé pour `main/index.ts`.

### P2 — Reconnexion manuelle non fiable (`fleet-bridge.ts` + `FleetPanel.tsx`)

- `connectPeer()` partage la tentative en cours (`pendingConnect`) : deux clics, ou un clic
  pendant une reprise planifiée, ne créent plus deux listeners.
- Garde d'identité `isCurrent()` sur tous les handlers : un listener remplacé ou supprimé ne
  repeint plus le statut et ne duplique plus les `fleet.event`. L'ancien listener est détaché
  avant sa déconnexion ; `removePeer` oublie le pair avant de fermer la socket.
- `reconnectPeer()` attend l'issue réelle et renvoie `{ success: false, error }` quand la
  connexion échoue (seul appelant : `FleetPanel`).
- `FleetPanel` : bouton désactivé + icône qui tourne + `aria-busy` pendant la tentative ;
  cause d'échec affichée sous le pair (une seule fois si le bridge rapporte la même) ; rejet IPC
  capturé ; échec de `fleet.list()` affiché (« Could not load peers: … ») au lieu d'un rejet non
  géré et d'un panneau vide. Mises à jour d'état fonctionnelles, effet annulable au démontage
  (règles React `rerender-functional-setstate`, `client-*` du skill Vercel).

## Lot 3 — fermeture du FleetBridge à la sortie réelle d'Electron

### Constat

`FleetBridge.shutdown()` n'était appelé nulle part : `main/index.ts` crée l'instance au boot
(`fleetBridge = new FleetBridge(sendToRenderer)`, variable de module, pas le singleton
`getFleetBridge()`), mais aucun chemin de sortie ne la fermait. Pendant les longues étapes de
nettoyage (sandbox WSL/Lima jusqu'à 30 s chacune), les reprises Fleet restaient armées, et les
sockets n'étaient pas fermées proprement.

Chemins de sortie existants, vérifiés :

| Déclencheur | Chemin | Fermeture Fleet (lot 3) |
| --- | --- | --- |
| Dernière fenêtre fermée (Linux/Windows, macOS dev) | `window-all-closed` → `await cleanupSandboxResources()` → `app.quit()` → `before-quit` voit `isCleaningUp` et laisse sortir | lancée dès le début de `cleanupSandboxResources`, attendue avant `closeLogFile()` |
| Cmd+Q, menu/tray, `app.quit()` au boot raté | `before-quit` (prod) → `preventDefault` → `await cleanupSandboxResources()` → `app.quit()` | idem |
| SIGTERM / SIGINT | `app.quit()` → `before-quit` | idem |
| Tout quit en dev (`VITE_DEV_SERVER_URL`) | chemin rapide synchrone de `before-quit` | `void shutdownFleetBridgeForQuit(fleetBridge)` : désarmement synchrone, fermeture au mieux |

### Correctif

- **Nouveau** `cowork/src/main/fleet/fleet-bridge-lifecycle.ts` :
  `shutdownFleetBridgeForQuit(bridge, timeoutMs = FLEET_BRIDGE_QUIT_TIMEOUT_MS = 3 000)`.
  - `null` → `'no-bridge'`, sans rien créer ; import de `FleetBridge` en type seulement, jamais
    `getFleetBridge()`.
  - Idempotent : une promesse par instance (`WeakMap`), quel que soit le nombre de chemins de
    sortie qui appellent.
  - Borné : course avec un timer `unref()`, effacé à la fin → `'closed'` | `'timed-out'` |
    `'failed'` ; ne rejette jamais ; journalise seulement le dépassement et l'échec (écrire après
    `closeLogFile()` rouvrirait le journal).
  - `FleetBridge.shutdown()` passe `stopped` à vrai avant son premier `await` : reprises et
    tentatives en vol sont désarmées immédiatement, même si la fermeture des sockets dépasse le
    budget.
- `cowork/src/main/index.ts` (seul fichier existant modifié) : import ; dans
  `cleanupSandboxResources()`, appel juste après les arrêts synchrones et avant tout `await`, puis
  `await` du résultat après les autres arrêts et avant `sessionManager.dispose()`/`closeDatabase()`/
  `closeLogFile()`, avec le journal `[App] Fleet bridge closed` ; appel `void` dans le chemin
  rapide dev. Aucune refonte de l'init global, aucune modification de `fleet-bridge.ts`.

### Tests du lot 3 — `cowork/tests/fleet-bridge-quit-lifecycle.test.ts` (nouveau, 9 tests)

`main/index.ts` n'est pas importable en test (effets de boot Electron) : le câblage est vérifié
statiquement, comme `single-mainwindow-sync.test.ts` ; le comportement est vérifié sur le helper
avec un **vrai `FleetBridge`** et un faux listener.

| Test | 1ʳᵉ exécution (sans helper) | 2ᵉ (helper, sans câblage) | Après câblage |
| --- | --- | --- | --- |
| câblage : `cleanupSandboxResources` appelle avant tout `await`, attend avant `closeLogFile()` | rouge (module absent) | **rouge** (-1 : aucun appel) | vert |
| câblage : chemin rapide dev appelle aussi | rouge (module absent) | **rouge** | vert |
| câblage : jamais `getFleetBridge(` + import du helper | rouge (module absent) | **rouge** (import absent) | vert |
| sans bridge → `'no-bridge'`, `getFleetBridge()` lève toujours (aucun singleton), aucun listener | rouge (module absent) | vert | vert |
| vrai bridge (pair joignable + pair en panne) : `'closed'`, socket fermée, 60 s de timers simulés sans nouveau listener, `reconnectPeer` → `Fleet bridge is stopped` | rouge (module absent) | vert | vert |
| deux appels concurrents + un tardif → un seul `shutdown()` | rouge (module absent) | vert | vert |
| `disconnect()` qui ne rend jamais la main : `'timed-out'` à 3 000 ms, erreur journalisée, aucune reconnexion ensuite | rouge (module absent) | vert | vert |
| `shutdown()` qui rejette → `'failed'` journalisé, pas d'exception | rouge (module absent) | vert | vert |
| timer effacé après fermeture (`vi.getTimerCount() === 0`) | rouge (module absent) | vert | vert |

Le rouge significatif est la 2ᵉ exécution : le helper existe, mais `index.ts` ne l'appelle pas.

## Lot 2 — défauts confirmés par la revue du pilote

### D1 — Une tentative en vol pouvait ouvrir une socket après `shutdown()` (`fleet-bridge.ts`)

- `openListener()` s'arrête à chaque point de reprise si le bridge est arrêté ou si le pair a été
  retiré : à l'entrée, après `await loadFleetModule()`, après `await previous.disconnect()`
  (garde commune `abandoned()`, message `Fleet bridge is stopped`).
- `isCurrent()` exige aussi `!stopped` : aucun handler d'un listener ne repeint le pair ni ne
  programme de reprise après l'arrêt.
- `shutdown()` collecte les `pendingConnect`, ferme les sockets, puis attend que ces tentatives
  soient réglées : quand la promesse se résout, plus rien n'est en vol. Chaque tentative s'arrête
  au point de reprise suivant ou échoue sur la socket fermée. `refreshPeerCapabilities()` ne sonde
  plus après l'arrêt.
- Constat annexe : `shutdown()` n'est appelé nulle part dans `cowork/src/main/index.ts`
  (non modifié, voir « Prochain lot »).

### D2 — Un `peer.describe` tardif écrasait un état plus récent (`fleet-bridge.ts`)

- `PeerEntry.statusGeneration` est incrémenté à chaque `updateStatus()`.
- `refreshPeerCapabilities()` capture le listener et la génération avant la requête. Au retour,
  succès comme échec, il revérifie arrêt, identité du pair, listener et génération (`stillAsked()`)
  avant toute mutation. Si l'un a changé, la réponse est ignorée : un `AUTH_FAILED` survenu entre
  temps reste affiché, et une vieille erreur n'entache pas un pair reconnecté.
- Effet voulu : lors d'une reconnexion du core (`authenticated` puis `reconnected`), seule la
  réponse du dernier état s'applique.

### D3 — `FleetPanel` gardait des erreurs de reconnexion obsolètes

- Une erreur de reconnexion porte désormais le `addedAt` du pair pour lequel elle a été émise.
  Elle devient obsolète dès que ce pair s'authentifie (reprise automatique du bridge), disparaît
  ou est réenregistré sous le même id (`isReconnectErrorObsolete`).
- Un effet synchronisé sur `fleetPeers` purge ces erreurs (même objet renvoyé si rien ne change,
  donc pas de rendu superflu) ; le rendu les masque déjà avant l'effet ; à la résolution d'une
  tentative, l'état est relu dans le store (`useAppStore.getState()`) plutôt que dans la capture du
  rendu, ce qui écarte une réponse arrivée après l'authentification, la suppression ou le
  réenregistrement.

### Tests du lot 2

| Test | Avant correctif | Après |
| --- | --- | --- |
| `shutdown with an attempt in flight` › pendant le chargement du module | rouge (2 listeners) | vert |
| › pendant la fermeture de la socket précédente (`disconnect()` différé) | rouge (2 listeners) | vert |
| › reconnexion refusée après arrêt | rouge (`success: true`) | vert |
| › handshake qui échoue après arrêt : ni événement ni reprise (timers simulés) | vert (garde de non-régression) | vert |
| `late peer.describe answers` › `AUTH_FAILED` plus récent conservé (réponse différée) | rouge (`lastError` effacé) | vert |
| › échec tardif après reconnexion ignoré (réponses différées, ordre adverse) | rouge (`peer.describe failed…`) | vert |
| `obsolete reconnect errors` › purge après reprise authentifiée, pas de résurrection sur une nouvelle chute | rouge | vert |
| › échec résolu après authentification ignoré | rouge | vert |
| › pair supprimé puis réajouté sous le même id | rouge | vert |
| › pair réenregistré pendant la tentative | rouge | vert |

Faux listener étendu (`disconnectImpl`, `describeImpl`, `deferred()`), sans changer le
comportement des tests existants.

## Vérifications (exécutées dans `cowork/`)

### Lot 3

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-bridge-quit-lifecycle.test.ts` sans helper | échec d'import (module absent). |
| même commande, helper présent, `index.ts` non câblé | **3 rouges** (câblage) / 6 verts. |
| même commande après câblage | **9/9 verts**. |
| `fleet-bridge-quit-lifecycle` + `fleet-bridge` avec `--sequence.shuffle` | **30/30 verts**. |
| 20 suites Fleet voisines + `fleet-bridge-quit-lifecycle` + `single-mainwindow-sync` + `ipc-registration-selfcontained` | **23 fichiers, 184 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0 src/main/fleet/fleet-bridge-lifecycle.ts tests/fleet-bridge-quit-lifecycle.test.ts` | Propre. |
| `node scripts/lint.cjs src/main/index.ts` | Propre. |
| Prettier `--check` sur les deux nouveaux fichiers | Conforme. |
| `tsc --noEmit -p tsconfig.json` | 0 erreur dans `cowork/src` ; 20 erreurs noyau connues inchangées. |
| `sha256sum` des 4 fichiers de la seconde livraison | Identiques aux empreintes du journal 01:23. |
| Build global | Non relancé (consigne). |

### Lot 2

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-bridge.test.ts` avant correctif | **5 rouges** / 16 verts. |
| même commande après correctif | **21/21 verts**. |
| `… run tests/fleet-panel-connection.test.tsx` avant correctif | **4 rouges** / 4 verts. |
| même commande après correctif | **8/8 verts**. |
| les deux fichiers avec `--sequence.shuffle` | **29/29 verts**. |
| 20 suites Fleet voisines (même liste qu'au lot 1) | **20 fichiers, 149 tests verts**. |
| Reprise après formatage : `fleet-bridge`, `fleet-panel-connection`, `fleet-ipc`, `saga-runner`, `fleet-team-panel-browser-bridge` | **5 fichiers, 69 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0 <4 fichiers>` | Propre. |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 erreur dans `cowork/src` ; les 20 erreurs noyau connues (baseline `d579f26ec`) inchangées. |
| Build Vite complet | Non relancé (échec `alasql`/Flow connu, sur consigne). |

### Lot 1

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-bridge.test.ts` avant correctif | **7 rouges** / 8 verts (les 7 nouveaux attendus ; la garde de suppression passait déjà). |
| même commande après correctif | **15/15 verts**. |
| `… run tests/fleet-panel-connection.test.tsx` avant correctif | **4 rouges** + 1 « Unhandled Rejection: IPC channel closed » réel. |
| même commande après correctif | **4/4 verts**, aucun rejet non géré. |
| 20 suites Fleet voisines (`advanced-command-center`, `companion-gateway-fleet-launch`, `fleet-*`, `saga-runner`, `test-runner-bridge-catalog`) | **20 fichiers, 139 tests verts**. |
| Reprise après formatage : `fleet-bridge`, `fleet-panel-connection`, `fleet-ipc`, `saga-runner`, `fleet-team-panel-browser-bridge` | **5 fichiers, 59 tests verts**. |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | 0 erreur dans `cowork/src` ; 20 erreurs préexistantes dans `../src/tools/document-tool.ts`, `document-generator.ts`, `archive-tool.ts`, `../src/sandbox/os-sandbox.ts` (types `adm-zip` absents du `node_modules` lié), fichiers non touchés. |
| `node scripts/lint.cjs --max-warnings 0 <4 fichiers>` | Propre. |
| Prettier | Nouveau test formaté ; les deux sources et l'ancien test n'étaient pas conformes à HEAD (virgules finales…) : pas de reformatage global, seules mes lignes suivent le style environnant. |
| `node node_modules/vite/bin/vite.js build` | **Échec environnemental** du bundle main : `src/agent/specialized/sql-agent.ts` → `alasql` → `react-native` / `react-native-fs` résolus dans `~/code-buddy/node_modules` (lié), syntaxe Flow non parsable. Sans rapport avec les fichiers modifiés. A laissé `cowork/dist-electron/` (gitignoré). |
| Build renderer seul via l'API Vite (`configFile: false`, plugin React, alias du dépôt, `shimMissingExports`, sortie `/tmp/opus-cowork-renderer-2026-09-14`) | **RENDERER_BUILD_OK** ; la chaîne « Could not load peers » est présente dans le bundle. |

## Limites

- Aucune capture visuelle : pas d'Electron lancé (interdit sur profil réel, bundle main non
  compilable ici). La preuve de rendu est le DOM happy-dom des tests `FleetPanel` sur fixture.
- Le core n'a pas été modifié : la reprise vit dans le bridge Cowork ; la CLI `/fleet` garde le
  comportement du core (pas de reprise après échec initial).
- Non traités (à arbitrer par le pilote) : libellé « vu il y a » de `FleetPanel` recalculé
  seulement au rendu ; pair `authenticated` silencieux depuis plusieurs heartbeats (socket
  semi-ouverte) toujours affiché vert ; double `peer.describe` sur `authenticated` +
  `reconnected` (préexistant).
- Lot 2 : les ordres adverses (réponse `peer.describe` différée, `disconnect()` retenu) sont
  simulés dans le faux listener ; le noyau `FleetListener` réel, corrigé séparément par Codex,
  n'a pas été exercé ici.
- Rien n'est commité ni poussé. Commandes pour le pilote (après revue) :
  `git add cowork/src/main/fleet/fleet-bridge.ts cowork/src/renderer/components/FleetPanel.tsx
  cowork/tests/fleet-bridge.test.ts cowork/tests/fleet-panel-connection.test.tsx
  docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md docs/FABLE5-CODEX-COORDINATION.md`
  puis `git commit -m "fix(cowork): recover fleet peers and keep connection failures visible"`.

## Limites du lot 3

- Pas d'Electron réel : aucune sortie effective observée. Le câblage est prouvé par lecture
  statique du source ; le comportement, par le helper exécuté sur un vrai `FleetBridge`.
- La découverte périodique (`discoveryTimer`, `setInterval` 5 min, et son `setTimeout` initial)
  n'est pas arrêtée à la sortie. Elle ne reconnecte rien (`listPeers()` ne sonde plus un bridge
  arrêté), mais peut encore lancer `discoverPeers()` pendant un long nettoyage (hors périmètre, voir
  ci-dessous).
- `FleetBridge.shutdown()` ferme les sockets l'une après l'autre : au-delà de quelques pairs lents,
  le budget de 3 s est atteint et la sortie continue (l'OS récupère les sockets). Paralléliser
  toucherait `fleet-bridge.ts`, volontairement laissé intact.
- Commande pour le pilote (lot 3 seul, après revue) :
  `git add cowork/src/main/index.ts cowork/src/main/fleet/fleet-bridge-lifecycle.ts
  cowork/tests/fleet-bridge-quit-lifecycle.test.ts docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md
  docs/FABLE5-CODEX-COORDINATION.md` puis
  `git commit -m "fix(cowork): close the fleet bridge when the app quits"`.

## Prochain lot suggéré après le lot 3 (non démarré, en attente de passation)

**Lot 4 — présence Fleet périmée** (point 1 ci-dessous, désormais prioritaire : la fermeture à la
sortie est faite). En option, dans le même lot ou un micro-lot `main` séparé : arrêter
`discoveryTimer` et son premier `setTimeout` au début de `cleanupSandboxResources`, et
paralléliser les `disconnect()` de `FleetBridge.shutdown()` (touche `fleet-bridge.ts`).

## Prochain lot suggéré (non démarré, en attente de passation)

**Lot 3 — présence Fleet périmée + fermeture propre à la sortie**, borné à `cowork/` :

1. **Pair « vert » silencieux.** Un pair `authenticated` dont la socket est semi-ouverte (machine
   en veille, câble tiré) reste vert tant que TCP ne s'en aperçoit pas, alors que les heartbeats
   (30 s) ont cessé. Dériver côté renderer un état « silencieux » quand `lastSeenAt` dépasse
   3 heartbeats (90 s) : `StatusDot`/`PeerRow` du Command Center, `FleetPanel`, `MissionControlView`.
   Ajouter une horloge partagée légère pour que « vu il y a » avance sans événement (aujourd'hui
   figé dans `FleetPanel`). Tests happy-dom sous timers simulés. Aucune reconnexion forcée (un
   pair ancien sans heartbeat ne doit pas osciller).
2. ~~**`FleetBridge.shutdown()` jamais appelé** dans `cowork/src/main/index.ts`~~ — **fait au
   lot 3** (helper borné dédié plutôt que `withTimeout`, qui rejette et ne partage pas l'appel entre
   chemins de sortie).
3. Option : fusionner le double `peer.describe` émis par `authenticated` puis `reconnected`.
   Grâce à la génération du lot 2, la première réponse est déjà ignorée ; il reste une requête
   réseau inutile.

## Journal

### 01:23 — Lot 3 : fermeture réelle du FleetBridge à la sortie (avant toute inspection)

Seconde passe revue et copiée dans la branche d'intégration par Codex. Périmètre du lot 3 : cycle
d'arrêt de `cowork/src/main/index.ts` (+ helper/export FleetBridge éventuel), tests lifecycle
dédiés, rapport, réservation. Interdits ajoutés : `FleetPanel` et ses tests, présence
silencieuse, `cowork/vite.config.ts`/build/config/dépendances (autre Opus), build global.

Base du lot 3 = seconde livraison, empreintes SHA-256 avant toute modification :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/main/fleet/fleet-bridge.ts` | `c7c001b9be300359570e5c985bb4a35e1dd864b6d7526757b5062da0e5cf7ebe` |
| `cowork/src/renderer/components/FleetPanel.tsx` | `a2d5868e749f3be104d4cbee8544d4bb64ddc6718f13fca3f920df8832a17c6c` |
| `cowork/tests/fleet-bridge.test.ts` | `750198f37c4e75a3d71a27ed5224df2dfbfadce6a8256e67276144b03e82562d` |
| `cowork/tests/fleet-panel-connection.test.tsx` | `27955a569a7af12b2dc23ae1f54e57e475d0b0abb18b7c73806cd1af962a3a5d` |
| `cowork/src/main/index.ts` (identique à HEAD) | `c3e82bf963ed1d52e56cc92bd306cd6d2f81d36953b3c11ea2135f5be9999fa4` |

La copie de sauvegarde hors dépôt (`mkdir`/`cp` vers `/tmp`) a demandé une approbation :
non contournée. Choix : ne pas retoucher les fichiers de la seconde livraison, pour que le delta du
lot 3 soit `git diff cowork/src/main/index.ts` plus des fichiers nouveaux.

### 01:11 — Lot 2 : trois défauts confirmés par la revue du pilote (avant toute modification)

Demande : même worktree, mêmes interdits ; noyau `FleetListener` corrigé séparément par Codex
(non touché) ; baseline typecheck `d579f26ec` = 20 erreurs noyau connues ; build complet
`alasql`/Flow connu, non répété.

1. `openListener()` ne revérifie pas `stopped` après `await loadFleetModule()` ni après
   `previous.disconnect()` ; `shutdown()` garde les pairs et ignore `pendingConnect` → une reprise
   en vol peut ouvrir une socket après l'arrêt.
2. `refreshPeerCapabilities()` applique le succès ou l'échec d'un `peer.describe` tardif sans
   revalider listener/génération/statut → une vieille réponse efface un `AUTH_FAILED` récent.
3. `FleetPanel` : `reconnectErrors` survit à une reconnexion automatique authentifiée, à la
   suppression du pair et aux résolutions tardives.

### 00:50 — Diagnostic (lecture du code, avant toute modification)

Base : `node node_modules/vitest/vitest.mjs run tests/fleet-bridge.test.ts` → 7/7 verts.

Constats prouvés par la lecture croisée `cowork/src/main/fleet/fleet-bridge.ts` ↔
`src/fleet/fleet-listener.ts` ↔ `src/channels/reconnection-manager.ts` (core en lecture seule) :

1. **Cause d'échec effacée.** `updateStatus()` écrit `lastError = error` à chaque transition ;
   `disconnected`/`reconnecting`/`connecting` passent `undefined`. Le serveur répond
   `AUTH_FAILED` sans fermer la socket (`handler.ts:728`), puis la termine au délai d'inactivité
   → l'événement `disconnected` efface « Invalid credentials » : le pair apparaît simplement
   « disconnected », sans raison, et le listener ne retentera jamais (erreur terminale).
2. **Abandon silencieux.** Le listener émet `exhausted` après 10 tentatives (~5 min) ; le bridge
   ne l'écoute pas → statut figé sur `reconnecting`/`disconnected`, plus aucune tentative.
3. **Échec initial jamais retenté.** `fleet-listener.ts:313-327` : l'auto-reconnexion n'est armée
   qu'après une première authentification. Le commentaire du bridge (« Listener may have
   scheduled a reconnect — leave it ») est faux : un pair éteint au lancement de Cowork (peer-beta
   en veille, Tailscale pas prêt) reste en `error` jusqu'à un clic manuel, même rallumé.
4. **Reconnexions concurrentes.** Deux `connectPeer()` simultanés (double clic « Reconnect »)
   voient le même ancien listener, créent chacun un nouveau listener ; le premier n'est jamais
   déconnecté → socket fantôme, événements `fleet.event` dupliqués, et les événements tardifs d'un
   listener remplacé écrasent le statut du courant (aucune garde d'identité dans les handlers).
5. **Bouton « Reconnect » muet** (`FleetPanel.tsx`) : ni état en cours, ni erreur ;
   `reconnectPeer()` renvoie toujours `success: true` (l'échec est avalé dans `connectPeer`).
   `fleetApi.list()` sans `catch` → rejet non géré, panneau vide sans explication.

Non retenus (notés pour le pilote) : libellé « vu il y a » de `FleetPanel` recalculé seulement
au rendu ; pair `authenticated` sans heartbeat depuis longtemps (socket semi-ouverte) toujours
affiché vert.

Lot retenu (deux problèmes) :
- **P1 — connexion perdue mal récupérée / erreur invisible** (constats 1-3), dans le bridge.
- **P2 — reconnexion manuelle non fiable** (constats 4-5), bridge + `FleetPanel`.

## Contre-validation du pilote après port sélectif

Les deux premières passes Opus sont assemblées avec les corrections du transport
Fleet décrites dans `COWORK-FLEET-TRANSPORT-2026-09-14.md`. Reprise Cowork :
69/69 tests, lint ciblé propre ; les 20 diagnostics TypeScript sont identiques
à la base. La suite complète du noyau est verte (38 538 tests). Les prochains
lots fermeture Electron et build restent dans leurs worktrees réservés.

Contre-validation lot 3 : cinq suites Cowork, **75/75 verts**, lint ciblé propre ;
`npm run validate -- tests/fleet/fleet-listener.test.ts tests/security/donnees-personnelles.test.ts`
vert (89 tests, plus lint/typechecks/pack). La sortie réelle Electron reste
non testée ; helper et câblage sont vérifiés comme décrit ci-dessus.
