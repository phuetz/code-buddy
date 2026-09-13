# Amélioration Cowork — écran Fleet et états de connexion (Opus, 2026-09-14)

- **Agent** : Claude Opus 5, piloté par Codex, demande explicite de Patrice.
- **Worktree** : `~/DEV/cb-cowork-improvements-opus-2026-09-14`
- **Branche** : `feat/cowork-improvements-opus-2026-09-14`, base `017ba1aa8`.
- **Périmètre** : `cowork/src`, tests Cowork, ce rapport, ma ligne de coordination.
- **Interdits** : commit/push, publication, compte, API LLM distante, commande robot,
  service/config utilisateur, Electron sur profil réel, `npm install`/rebuild, `src/` hors
  `cowork/`, `src/fleet/rooms` (intégrés séparément par le pilote).

## Statut

**Lot 4 livré au pilote, non commité** (2026-09-14). Les étiquettes « vu il y a » de Fleet
avancent désormais avec le temps grâce à une horloge partagée (un seul intervalle, arrêté quand
aucun panneau visible ne l'utilise). Un pair authentifié qui n'a rien envoyé depuis plus de trois
heartbeats (90 s) est marqué « silencieux », sans jamais être présenté comme déconnecté ni
reconnecté. Renderer uniquement ; les fichiers `main`, `FleetBridge`, lifecycle et les tests des
lots précédents sont intacts (SHA-256 identiques).

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

## Lot 4 — fraîcheur Fleet dans le renderer

### Constat (lecture du noyau et du renderer)

- Noyau, en lecture seule : `startFleetHeartbeat()` émet `fleet:peer:heartbeat` toutes les 30 s
  (`DEFAULT_INTERVAL_MS = 30_000`, `src/fleet/heartbeat-broadcaster.ts`, non configurable), démarré
  sans condition dès que le WebSocket est actif (`src/server/index.ts:1248`). `/fleet status`
  signale un pair « stale » au-delà de `STALE_THRESHOLD_MS = 90_000`
  (`src/commands/handlers/fleet-handler.ts:171`), et `FleetListener.isStale()` refuse de conclure
  sans premier événement (« can't say stale without a baseline »).
- Bridge Cowork : `lastSeenAt` = heure **locale** de réception de chaque `fleet:*` (heartbeats
  compris) ; aucune notion de silence n'est transmise au renderer.
- Renderer :
  - `FleetPanel` calculait « vu il y a » avec `Date.now()` au seul moment du rendu : le libellé
    restait figé (« just now ») tant que rien ne changeait dans le store, précisément quand un
    pair se tait.
  - `fleet-peer-panel` (`PeerRow`/`PeerDetail` du Command Center) utilisait `formatPeerSeenAt()`,
    qui ne se remettait à jour qu'avec le polling des sagas, et dont `Math.max(0, …)` affichait
    « now » pour un horodatage futur.
  - Aucun écran ne distinguait « authentifié réseau » et « plus rien reçu ».
- Pas de hook horloge existant : `os/util/use-polling.ts` crée un intervalle par composant.
- **`MissionControlView` non adapté, volontairement** : son modèle OS ne connaît que
  `online`/`busy`/`offline` (`os/util/fleet-model.ts`) et n'affiche aucun « vu il y a ». Mapper le
  silence sur `offline` inventerait une déconnexion (interdit) ; ajouter un état toucherait
  `FleetTopologyView`/`PeerCapabilityMatrix` et leurs modèles, hors du lot borné.

### Correctif

- **Nouveau** `cowork/src/renderer/utils/fleet-freshness.ts` (pur) :
  `describePeerFreshness(peer, now)` renvoie l'un de ces états :
  - `never` : aucun événement reçu, donc pas de base de comparaison ;
  - `invalid` : valeur non numérique, NaN, infinie, ≤ 0, ou en avance de plus de 10 s sur
    l'horloge ;
  - `seen` : événement reçu, avec son âge ;
  - `silent` : **uniquement** si le statut est `authenticated` et que l'âge dépasse 90 s.

  `FLEET_HEARTBEAT_INTERVAL_MS = 30_000`, `FLEET_SILENCE_THRESHOLD_MS = 3 × 30 s` (même seuil que
  `/fleet status`), `FLEET_CLOCK_SKEW_TOLERANCE_MS = 10_000` (un tick de retard de l'horloge plus
  une marge). `toSeenAge()` : « à l'instant » < 10 s, puis secondes, minutes, heures, jours.
- **Nouveau** `cowork/src/renderer/hooks/use-shared-now.ts` : `createSharedClock(tickMs)` fournit
  un store externe (`useSyncExternalStore`) :
  - un seul `setInterval`, démarré au premier abonné et effacé au dernier ;
  - une valeur stable entre deux ticks ;
  - au repos, un rafraîchissement paresseux après un tick écoulé, dans les deux sens, pour prendre
    en compte une horloge système reculée.

  `sharedClock` par défaut à 5 s : les libellés et la détection du silence ont au plus 5 s de
  retard.
- **Nouveau** `cowork/src/renderer/components/fleet-peer-freshness.tsx` : `PeerSeenLabel`
  (`data-testid="fleet-peer-seen-<id>"`, `data-freshness`, info-bulle explicative, ton
  d'avertissement seulement si silencieux) et `PeerSilenceNote` (explication dans le détail). Les
  hooks vivent dans ces composants, montés seulement quand le panneau est visible : `FleetPanel`
  renvoie `null` une fois masqué, le Command Center aussi une fois fermé. Aucun abonnement ne
  subsiste donc panneau masqué.
- `FleetPanel.tsx` (delta lot 4 par rapport au lot 2) : import de `PeerSeenLabel` ; suppression du
  `formatRelativeTime` local ; le `<span>` « vu il y a » est remplacé par
  `<PeerSeenLabel peer={peer} className="text-[10px] shrink-0" />`. Les correctifs des lots 1-2
  (reconnexion, erreurs obsolètes) sont inchangés : `fleet-panel-connection.test.tsx` passe, avec
  la même empreinte.
- `fleet-peer-panel.tsx` : `PeerRow` et la statistique « Dernière présence » de `PeerDetail`
  utilisent `PeerSeenLabel` ; `PeerSilenceNote` sous l'erreur éventuelle ; `PeerStat.value` accepte
  un `ReactNode` (compatible avec `fleet-saga-detail.tsx`). Le statut affiché reste `peer.status`.
- `fleet-command-center-helpers.ts` : `formatPeerSeenAt()` supprimé (plus d'appelant, masquait
  les horodatages futurs).
- Locales `en`/`fr`/`zh` : bloc `fleet.freshness` (11 clés) inséré juste avant `fleet.detail`, à la
  même position en `en` et `fr` (le test de structure identique `fr` = `en` passe).
- Aucun statut inventé, aucune reconnexion, aucun changement de routage : `onlinePeers`,
  `routablePeers` et la disponibilité du Command Center sont inchangés.

### Tests du lot 4

`cowork/tests/fleet-freshness.test.ts` (nouveau, pur) :
- alignement lu dans le noyau : `DEFAULT_INTERVAL_MS = 30_000` et `STALE_THRESHOLD_MS = 90_000` ;
- `never`, `seen`, frontière exacte des 90 s (non silencieux) contre 90 s + 1 ms (silencieux),
  5 statuts non authentifiés jamais silencieux, tolérance de 10 s ;
- valeurs invalides : futur lointain, NaN, Infini, 0, négatif, chaîne venue de l'IPC ;
- bornes de `toSeenAge` ;
- horloge : aucun timer sans abonné, un intervalle pour trois abonnés, arrêt au dernier départ,
  valeur stable jusqu'au tick, rafraîchissement au repos après un saut d'horloge en avant ou en
  arrière ;
- 11 clés présentes en `en`/`fr`/`zh`.

`cowork/tests/fleet-freshness-display.test.tsx` (nouveau, happy-dom, `setInterval`/`Date`
simulés, i18n factice qui interpole) :
- `FleetPanel` :
  - « just now » → « 25s ago » → « 1m ago » sans nouvel événement ;
  - pas silencieux à 90 s, silencieux à 95 s (« silent · 1m ago », info-bulle « 90 s ») : statut
    toujours `authenticated`, aucun texte « disconnected », `reconnect` jamais appelé ;
  - un nouvel événement reçu rend le pair frais aussitôt ;
  - pair sans événement → « no events yet » même après 10 min ;
  - futur lointain et NaN → « unknown », léger décalage accepté ;
  - pair déconnecté → « 10m ago », jamais silencieux ;
  - 3 pairs = 3 abonnés et 1 seul timer ; panneau masqué → 0/0 ; réaffiché → 1 ; démonté → 0.
- Command Center : `PeerRow` vieillit et signale le silence ; `PeerDetail` affiche la note tandis
  que le statut reste `authenticated` ; démonter les lignes libère le timer.

| Exécution | Résultat |
| --- | --- |
| 1ʳᵉ (modules absents) | 2 fichiers en échec d'import |
| 2ᵉ (helper, horloge et composant présents, écrans et locales non branchés) | **13 rouges** (10 DOM : aucune étiquette ni abonnement ; 3 locales), 28 verts |
| Après branchement | **41/41 verts** |

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

### Lot 4

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-freshness.test.ts tests/fleet-freshness-display.test.tsx` | voir tableau rouge → vert ci-dessus ; **41/41** au final. |
| mêmes fichiers + `fleet-panel-connection`, `fleet-saga-detail-actions`, `i18n-french-support`, `--sequence.shuffle` | **5 fichiers, 61 tests verts**. |
| 20 suites Fleet voisines + `fleet-bridge-quit-lifecycle` + `single-mainwindow-sync` + `ipc-registration-selfcontained` + `i18n-french-support` + les 2 nouveaux fichiers | **26 fichiers, 233 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0` sur les 3 sources nouvelles, `fleet-peer-panel.tsx`, `FleetPanel.tsx` et les 2 tests | Propre. |
| `node scripts/lint.cjs src/renderer/components/fleet-command-center-helpers.ts` | Propre. |
| Prettier `--check` sur les 5 fichiers nouveaux | Conforme (`fleet-peer-panel.tsx` aussi ; les écarts restants de `FleetPanel.tsx` sont antérieurs au lot). |
| `tsc --noEmit -p tsconfig.json` | 0 erreur dans `cowork/src` ; 20 erreurs noyau connues inchangées. |
| `sha256sum` de `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts`, `index.ts`, `FleetCommandCenter.tsx`, `MissionControlView.tsx`, `fleet-bridge.test.ts`, `fleet-panel-connection.test.tsx`, `fleet-bridge-quit-lifecycle.test.ts` | Identiques à la base du lot 4 (journal 01:31). |
| Build global | Non relancé (consigne). |

Empreintes à la livraison du lot 4 :

| Fichier | Nature | SHA-256 |
| --- | --- | --- |
| `cowork/src/renderer/utils/fleet-freshness.ts` | nouveau, 65 lignes | `290759780fc51a39c83610c1d1aa00e9de495e6a431bff5ee8573e2a09710f10` |
| `cowork/src/renderer/hooks/use-shared-now.ts` | nouveau, 59 lignes | `45593fa84feab2059aa66eceeabb3fdceded80cb99837fd16fded8b6c45e24f6` |
| `cowork/src/renderer/components/fleet-peer-freshness.tsx` | nouveau, 117 lignes | `349764b6a0609e4593edd17a7d9e4f9adbf035faeddc3a0a35149b759ba07739` |
| `cowork/src/renderer/components/FleetPanel.tsx` | modifié (lots 1-2 + 4) | `87eea1cab5a1b9202a58151f780afe5a771708cf280ef7f4b0ad19e97a94f645` |
| `cowork/src/renderer/components/fleet-peer-panel.tsx` | modifié (5 hunks) | `39509a46d25450c4dffa6bb8ec8ed4e28c8abc52a2990c6357afa113057ac0ad` |
| `cowork/src/renderer/components/fleet-command-center-helpers.ts` | modifié (−9 lignes) | `c04580c89654a8c9e590e277fce17901724dd0de893a2dfd1747a36c17f2e3d2` |
| `cowork/src/renderer/i18n/locales/en.json` | +14 lignes | `8ab6c4997abea7926a375db6bc25527acd22831ad32b8cf0c332b9c3220e3fef` |
| `cowork/src/renderer/i18n/locales/fr.json` | +14 lignes | `f55e893d96e7a6b2ecf938d1f9ad3feb9984b88871018eba0803dece68fe5f31` |
| `cowork/src/renderer/i18n/locales/zh.json` | +14 lignes | `030084e5b95596d2fc473d0d83da1e8735e54ea07d80350cb31184311cb90f1c` |
| `cowork/tests/fleet-freshness.test.ts` | nouveau, 218 lignes | `5432f69f15c8be9213ebd64cb24fc0fcf995becdf4587df8b41aec3d78192cfb` |
| `cowork/tests/fleet-freshness-display.test.tsx` | nouveau, 231 lignes | `05a4e13aa9a8a9bc468359fb5ec293e60abbfa3166e0f4cc9193d72611f97a29` |

Empreintes des locales avant le lot 4 : `en` `00dd2f16…12c7`, `fr` `6710df30…0b35`,
`zh` `22ba1357…5845`.

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

## Limites du lot 4

- Pas d'Electron réel ni de capture : la preuve de rendu est le DOM happy-dom sous timers
  simulés.
- Le seuil de 90 s suppose la cadence noyau par défaut de 30 s. Le test lit ces constantes dans
  le noyau et échouera si elles changent ; un pair ancien sans heartbeat serait vu « silencieux »
  sans activité, mais la note dit « peut-être figée », jamais « déconnecté ».
- Au plus 5 s de retard sur le libellé et la détection du silence (résolution de l'horloge
  partagée).
- `MissionControlView` non modifié (voir Constat) ; la disponibilité du Command Center compte
  toujours un pair silencieux comme en ligne et routable (comportement de dispatch inchangé).
- Les autres libellés relatifs hors Fleet (par exemple `formatRelativeTime` de
  `SessionResumeDialog`) ne sont pas branchés sur l'horloge partagée.
- Commande pour le pilote (lot 4 seul, après revue) :
  `git add cowork/src/renderer/utils/fleet-freshness.ts cowork/src/renderer/hooks/use-shared-now.ts
  cowork/src/renderer/components/fleet-peer-freshness.tsx cowork/src/renderer/components/FleetPanel.tsx
  cowork/src/renderer/components/fleet-peer-panel.tsx cowork/src/renderer/components/fleet-command-center-helpers.ts
  cowork/src/renderer/i18n/locales/en.json cowork/src/renderer/i18n/locales/fr.json
  cowork/src/renderer/i18n/locales/zh.json cowork/tests/fleet-freshness.test.ts
  cowork/tests/fleet-freshness-display.test.tsx docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md
  docs/FABLE5-CODEX-COORDINATION.md` puis
  `git commit -m "feat(cowork): show fleet peer freshness and silent authenticated peers"`.
  Attention : `FleetPanel.tsx` porte aussi les correctifs des lots 1-2, déjà en intégration.

## Suite proposée après le lot 4 (non démarrée, en attente de passation)

**Lot 5 — le silence visible là où l'on décide** (renderer seul, sans changer le routage) :
1. Command Center : dans la synthèse de disponibilité, séparer « en ligne » et « dont N
   silencieux », et avertir dans la prévisualisation de route (`FleetRoutePreview`) quand le pair
   recommandé est silencieux ; le dispatch reste inchangé.
2. Mission Control : drapeau optionnel `quiet` sur le modèle OS `Peer` (jamais `offline`), affiché
   par `FleetTopologyView`/`PeerCapabilityMatrix`, avec la même horloge partagée.

Alternative courte côté `main` (si le pilote préfère) : arrêter `discoveryTimer` et son premier
`setTimeout` au début de la sortie, et paralléliser les `disconnect()` de `FleetBridge.shutdown()`.

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

**Lot 4 — présence Fleet périmée** (point 1 ci-dessous) — **fait au lot 4** pour `FleetPanel` et
le Command Center ; Mission Control reporté au lot 5 proposé. En option, dans le même lot ou un micro-lot `main` séparé : arrêter
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

### 01:31 — Lot 4 : présentation de la fraîcheur Fleet (avant toute inspection)

Lot 3 copié et revu en intégration (root vérifie puis commite). Périmètre du lot 4 : renderer
Cowork uniquement (helper/hook pur, horloge partagée, `FleetPanel`, `FleetCommandCenter`,
`MissionControlView` si adaptés), tests dédiés, rapport, réservation. Interdits : `main/index.ts`,
`FleetBridge`, lifecycle, `vite.config.ts`, noyau, dépendances, Electron/profil/services,
install/rebuild, commit/push. Ne jamais inventer « déconnecté » ni forcer une reconnexion.

**Delta du lot 3, mesuré pour la passation** (déjà copié en intégration) :

| Fichier | Delta lot 3 | SHA-256 à la base du lot 4 |
| --- | --- | --- |
| `cowork/src/main/index.ts` | 4 hunks, +10 / −0 (import ; appel au début de `cleanupSandboxResources` ; `await` + journal avant `dispose`/`closeDatabase`/`closeLogFile` ; appel `void` dans le chemin dev de `before-quit`) | `40418d1f401cfb2b72c60f2a33ce54dd6ae19951b124511528b35e8ba3c0777c` |
| `cowork/src/main/fleet/fleet-bridge-lifecycle.ts` | nouveau, 67 lignes | `2df2e5d0b63239db71dd7d1099f656a1c9970733544438f7c2140ef870bb3671` |
| `cowork/tests/fleet-bridge-quit-lifecycle.test.ts` | nouveau, 237 lignes, 9 tests | `ccebdc2e2ee697ebbd6f42363a87609fdb73a46da664855fe2379af307a46791` |

Base des fichiers susceptibles d'être touchés au lot 4 et des correctifs précédents à conserver :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/renderer/components/FleetPanel.tsx` (lots 1-2) | `a2d5868e749f3be104d4cbee8544d4bb64ddc6718f13fca3f920df8832a17c6c` |
| `cowork/src/renderer/components/FleetCommandCenter.tsx` (= HEAD) | `7e84d1220737e7785092a10426586abf25539aea4b203c56bb9a5e9c543be7a9` |
| `cowork/src/renderer/components/fleet-peer-panel.tsx` (= HEAD) | `338986059432fd11bc9a0caa882f441320fe6786fbd72be4c8c73f30560f6cba` |
| `cowork/src/renderer/components/fleet-command-center-helpers.ts` (= HEAD) | `b09486900a3c971289a1899628371789a91dee88a0019fe04d124708982164a5` |
| `cowork/src/renderer/components/os/MissionControlView.tsx` (= HEAD) | `b9e1b5249a248b64063ba6930f47703d2eb80ef0d4f1af379ba1c443e16e1976` |
| `cowork/src/main/fleet/fleet-bridge.ts` (lots 1-2, interdit au lot 4) | `c7c001b9be300359570e5c985bb4a35e1dd864b6d7526757b5062da0e5cf7ebe` |
| `cowork/tests/fleet-bridge.test.ts` | `750198f37c4e75a3d71a27ed5224df2dfbfadce6a8256e67276144b03e82562d` |
| `cowork/tests/fleet-panel-connection.test.tsx` | `27955a569a7af12b2dc23ae1f54e57e475d0b0abb18b7c73806cd1af962a3a5d` |

Refus de permission (non contournés) : `git check-ignore`, `git diff … | grep -c` (comptage de
lignes). La mesure ci-dessus vient du `git diff -U0` du lot 3 et de `wc -l`. `FleetPanel.tsx`
était déjà modifié aux lots 1-2 : son delta propre au lot 4 se lit par comparaison avec la copie
d'intégration du lot 2.

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

## Contre-validation du lot 4 intégré

- Revue indépendante favorable ; 53 tests fraîcheur/panneau/actions, 8 tests
  français, soit **61 tests ciblés verts** ; lint ciblé et typecheck Cowork verts.
- Build Vite complet vert après intégration ; confidentialité sur fichiers
  suivis : **40/40 verts**.
- Chromium réel, fixture IPC, aucune connexion backend : pair authentifié
  silencieux après 95 s, avertissement retiré à réception, âge progressant de
  19 à 24 secondes après un tick réel, panneau masqué normalement. Aucune
  exception de page ; Google Fonts bloqué volontairement. Navigateur et
  serveur statique éphémère arrêtés. Preuves :
  `/tmp/cb-fleet-freshness-browser-qa.json` et
  `/tmp/cb-fleet-freshness-{silent,received,aged}.png`.

La compilation TypeScript est désormais entièrement verte grâce au correctif
Codex `5cc171870` (`COWORK-TYPECHECK-2026-09-14.md`) ; les mentions des 20 erreurs
dans les livraisons Opus décrivent leur base isolée antérieure.
