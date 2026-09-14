# Amélioration Cowork — écran Fleet et états de connexion (Opus, 2026-09-14)

- **Agent** : Claude Opus 5, piloté par Codex, demande explicite de Patrice.
- **Worktree** : `~/DEV/cb-cowork-improvements-opus-2026-09-14`
- **Branche** : `feat/cowork-improvements-opus-2026-09-14`, base `017ba1aa8`.
- **Périmètre** : `cowork/src`, tests Cowork, ce rapport, ma ligne de coordination.
- **Interdits** : commit/push, publication, compte, API LLM distante, commande robot,
  service/config utilisateur, Electron sur profil réel, `npm install`/rebuild, `src/` hors
  `cowork/`, `src/fleet/rooms` (intégrés séparément par le pilote).

## Statut

**Lot 6 livré au pilote, non commité** (2026-09-14). Les deux défauts de fermeture relevés au
lot 3 sont corrigés :
- la découverte périodique des pairs (premier passage à 5 s, puis toutes les 5 min) s'arrête à la
  sortie ;
- `FleetBridge.shutdown()` démarre toutes les fermetures de sockets dans le même tick,
  idempotent, sans perdre le nettoyage si une déconnexion rejette ou lève.

Toutes les protections des lots 2-3 (reprises, `pendingConnect`, `stopped`, identité des
listeners) sont conservées. Aucun nouveau timer ; renderer du lot 5 intact.

**Lot 5 livré au pilote, non commité** (2026-09-14). La fraîcheur apparaît là où l'on choisit un
pair :
- le Command Center affiche « N online · incl. M silent » ;
- la prévisualisation de route marque d'un badge le pair recommandé silencieux, avec une note
  neutre ;
- Mission Control affiche un badge « silencieux » dans la topologie et la matrice.

Rien d'autre ne change : statuts, `online`/`busy`/`offline`, pairs routables, route planifiée,
dispatch ; aucun appel réseau ni reconnexion supplémentaire. Aucun nouveau fichier source : un
hook ajouté au module de fraîcheur du lot 4, qui réutilise son horloge partagée (un seul
intervalle).

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

## Lot 6 — fermeture : découverte arrêtée et sockets fermées en parallèle

### Constat (reproduit par tests avant correction)

1. **Découverte jamais arrêtée.** `scheduleFleetDiscovery()` (`main/index.ts`) armait un
   `setTimeout` de 5 s non conservé et un `setInterval` de 5 min (`discoveryTimer`) que rien
   n'effaçait. Une passe lance `tailscale status --json` (`discovery.ts:181`), sonde
   `/api/health` des pairs (`discovery.ts:228`) et pousse `fleet.peer.discovered` vers le
   renderer. Elle pouvait donc démarrer ou publier pendant le long nettoyage de sortie, voire
   après la fermeture de la fenêtre.
2. **Sockets fermées une par une.** `FleetBridge.shutdown()` attendait chaque `disconnect()`
   dans la boucle :
   - le pair suivant n'était détaché qu'après la fermeture du précédent, et une requête
     (`peerRequest`) pouvait encore partir sur sa socket ;
   - avec le budget de 3 s de `shutdownFleetBridgeForQuit`, une socket lente empêchait les
     suivantes de démarrer leur fermeture ;
   - un second `shutdown()` concurrent refermait les pairs pas encore traités.

   Mesures rouges : compteurs de déconnexion `[1, 0, 0]` au lieu de `[1, 1, 1]` ; `peerRequest`
   résout au lieu d'échouer ; double appel qui ne se termine jamais (5 s de dépassement).

### Correctif

- `cowork/src/main/fleet/fleet-bridge.ts` :
  - `shutdown()` n'est plus `async` : il mémorise une promesse unique (`shutdownPromise ??=`),
    donc tout appel ultérieur partage le premier ;
  - `closeEverything()` passe `stopped` à vrai puis, **dans le même tick** pour chaque pair :
    désarme la reprise, collecte `pendingConnect`, détache le listener et démarre sa fermeture
    via `disconnectQuietly()`. Cette fonction ne rejette jamais, même si `disconnect()` lève de
    façon synchrone. `Promise.allSettled` attend fermetures et tentatives en vol ;
  - la durée totale est celle de la fermeture la plus lente, plus leur somme. La borne reste le
    budget existant de 3 s de `shutdownFleetBridgeForQuit` : aucun timer ajouté.
  - Garde-fous inchangés : `openListener` (garde `abandoned()`), `isCurrent()`, `stillAsked()`,
    `scheduleRecovery`, `pendingConnect`.
- `cowork/src/main/fleet/fleet-bridge-lifecycle.ts` : `createFleetDiscoverySchedule(pass,
  { firstDelayMs, intervalMs })` arme exactement les deux timers d'avant et renvoie :
  - `start()` : idempotent, sans effet après `stop()` ;
  - `stop()` : définitif et idempotent ; efface les deux timers ; une passe en cours reçoit
    `isActive() === false` ;
  - `isRunning()`.

  Une passe qui échoue est avalée, comme avant.
- `cowork/src/main/index.ts` :
  - `scheduleFleetDiscovery`/`discoveryTimer` remplacés par `runFleetDiscoveryPass(isActive)`
    (même corps ; ne lance pas Tailscale si la sortie a commencé et ne publie rien après) et
    `const fleetDiscovery = createFleetDiscoverySchedule(runFleetDiscoveryPass, { firstDelayMs:
    5_000, intervalMs: DISCOVERY_INTERVAL_MS })` ;
  - `fleetDiscovery.start()` au démarrage ;
  - `fleetDiscovery.stop()` en tête de `cleanupSandboxResources()`, avant tout `await` et avant
    la fermeture Fleet, ainsi que dans le chemin rapide dev de `before-quit` ;
  - aucun `getFleetBridge()` ni singleton ;
  - pas d'`await` de premier niveau dans `index.ts`, donc pas de zone morte temporelle sur
    `fleetDiscovery` : le démarrage s'exécute dans `app.whenReady().then`.

### Tests du lot 6

`cowork/tests/fleet-bridge.test.ts`, bloc « shutdown closes every socket at once » (5 tests,
vrai `FleetBridge`, sockets retenues par le faux listener) :

| Test | Avant correctif | Après |
| --- | --- | --- |
| toutes les fermetures démarrent avant la fin de l'une d'elles | **rouge** `[1, 0, 0]` | vert |
| tous les listeners détachés dès le début : `peerRequest` échoue « no active listener » | **rouge** (résout) | vert |
| second appel avant la fin : chaque socket fermée une seule fois | **rouge** (ne se termine jamais) | vert |
| une fermeture rejette, une autre lève de façon synchrone : les autres sont fermées, `shutdown` se résout, reconnexion refusée | vert (garde) | vert |
| un pair en panne au moment de l'arrêt : aucune reprise pendant 10 s de timers simulés | vert (garde) | vert |

`cowork/tests/fleet-bridge-quit-lifecycle.test.ts` :
- câblage statique de `index.ts` :
  - `fleetDiscovery.stop()` avant tout `await` de la sortie complète **(rouge → vert)** ;
  - `fleetDiscovery.stop()` dans le chemin dev **(rouge → vert)** ;
  - planification uniquement via le planificateur, même cadence, plus de `discoveryTimer` ni
    de `setTimeout/setInterval(() => void runOnce` **(rouge → vert)** ;
- `createFleetDiscoverySchedule` (5 tests, rouges tant que le helper était absent, puis verts) :
  - deux timers armés une seule fois, passes à 5 s puis 5 min ;
  - `stop()` avant la première passe → 0 timer, aucune passe en 30 min ;
  - passe en cours au moment de la sortie → rien publié ;
  - idempotent et définitif ;
  - une passe qui lève n'interrompt pas le planning ;
- helper de sortie sur vrai bridge : une socket bloquée n'empêche pas les deux autres de démarrer
  leur fermeture ; `timed-out` à 3 000 ms, reconnexion refusée, aucun nouveau listener (vert
  après le correctif du bridge).
- **Test du lot 3 adapté** : le motif d'import exact `import { shutdownFleetBridgeForQuit } from
  …` accepte désormais plusieurs noms importés depuis le même module ; ce qu'il vérifie (import
  du helper, jamais `getFleetBridge(`) est inchangé.

## Lot 5 — fraîcheur au moment du choix d'un pair

### Constat

- Command Center : la synthèse de disponibilité affichait `onlinePeers.length online`
  (`authenticated` ou `connected`), sans distinguer les pairs silencieux.
- `FleetRoutePreview` : le handler `fleet.routePreview` (`previewFleetRoute`, `main/ipc/fleet-ipc.ts`)
  construit ses lanes avec `peerId = FleetPeer.id` du bridge, donc directement rapprochables du
  store. Le routeur ne tient pas compte de la fraîcheur, et ce lot ne le change pas.
- Mission Control : `toOsPeer` convertit le store en `Peer` OS (`online`/`busy`/`offline`) ;
  `FleetTopologyView` et `PeerCapabilityMatrix` reçoivent ces pairs par props. Un champ optionnel
  suffit pour un badge : aucune refonte du modèle, le résumé (`summarizeFleet`) n'est pas touché.
- `MissionControlView` n'est monté que sur la vue `os` (`NewShell.tsx:785`), le Command Center
  seulement ouvert, les lanes seulement quand une route est affichée.

### Correctif

- `fleet-peer-freshness.tsx` (lot 4) : **un seul ajout**, `useSilentPeerIds(peers)`. C'est un
  `useSyncExternalStore` sur l'horloge partagée, dont l'instantané est l'ensemble des ids
  silencieux (chaîne) : l'appelant ne se rend que lorsqu'un pair devient silencieux ou se
  manifeste de nouveau, pas à chaque tick (règle React `rerender-derived-state`). Seule la règle
  `describePeerFreshness` du lot 4 est appliquée : `never`, `invalid`, un statut non authentifié
  ou un pair inconnu ne sont jamais comptés silencieux.
- `FleetCommandCenter.tsx` :
  - composant local `OnlinePeerCount` (`data-testid="fleet-online-count"`) : « `N online` » et, si
    M > 0, « ` · incl. M silent` » avec info-bulle « restent en ligne et routables ». Il est
    isolé pour que seule cette ligne se rende, pas tout le Command Center ;
  - `peersById={fleetPeers}` transmis à `FleetRoutePreview` ;
  - `onlinePeers`, `routablePeers`, `targetPeerIds`, disponibilité et dispatch inchangés.
- `FleetRoutePreview.tsx` :
  - prop optionnelle `peersById` (même nom que celle déjà passée ailleurs dans le Command Center) ;
  - la liste des lanes devient le sous-composant local `RouteLaneList`, monté seulement quand une
    route est affichée. Il ajoute un badge « silent » (`fleet-route-preview-silent`) sur les lanes
    dont le pair est silencieux, et une note neutre (`fleet-route-preview-silence`) : « Silent for
    over 90 s: … The router does not weigh freshness; the route is unchanged. » ;
  - ordre, contenu et appels réseau des lanes inchangés ; sans `peersById`, comportement
    identique à avant (`NO_PEERS`).
- Mission Control :
  - `os/util/fleet-model.ts` : `Peer.quiet?: boolean` documenté « présentation seulement »,
    et `QUIET_PEER_HINT` (français, comme le reste de ces vues) ;
  - `MissionControlView.tsx` : `useSilentPeerIds` sur les pairs du store, et
    `toOsPeer(peer, quiet)` n'ajoute que `quiet: true` ;
  - `FleetTopologyView.tsx` : badge « silencieux » (`os-peer-quiet`) à côté de la pastille de
    statut, et `data-testid` sur la carte du pair ;
  - `PeerCapabilityMatrix.tsx` : même badge sous le rôle ;
  - `summarizeFleet`, `deriveFleetLoad` et les tons de statut inchangés.
- Locales `en`/`fr`/`zh` : 3 clés ajoutées à la fin de `fleet.freshness` (`silentCount`,
  `silentCountHint`, `routeSilent`), à la même position en `en` et `fr`.
- Fichiers du lot 4 non touchés, hors `fleet-peer-freshness.tsx` : `fleet-freshness.ts`,
  `use-shared-now.ts`, `FleetPanel.tsx`, `fleet-peer-panel.tsx` et les tests du lot 4 gardent
  leurs empreintes.

### Tests du lot 5 — `cowork/tests/fleet-freshness-choice.test.tsx` (nouveau, 8 tests)

Rendus DOM réels (happy-dom), `setInterval`/`Date` simulés, i18n factice stable qui interpole.
Flotte mixte : `hub` récent, `spoke` silencieux, `fresh` sans événement, `broken` horodatage NaN,
`relay` `connected` ancien, `down` `disconnected`.
- **Command Center complet** :
  - « 5 online · incl. 1 silent » ; après 95 s « incl. 2 silent » ; deux réceptions ramènent à
    « 5 online » ; 95 s plus tard « incl. 2 silent » ;
  - le statut du pair reste `authenticated` ;
  - la prévisualisation de route n'appelle le routeur qu'une fois, avec les 6 pairs routables
    (silencieux compris).
- **`FleetRoutePreview`** :
  - 5 lanes dans l'ordre planifié ; badge seulement sur `spoke` (ni `hub`, ni `fresh`, ni
    `broken`, ni le pair inconnu `gpuNode/repo`) ; note avec `spoke`, « 90 s », « route is
    unchanged », sans `hub` ;
  - après 95 s, `hub` badgé à son tour ; nouvelles réceptions → plus aucun badge ni note ;
    routeur appelé une seule fois ; 1 timer affiché, 0 après fermeture ;
  - pairs inconnus du store → aucun badge.
- **Mission Control complet** :
  - badges `quiet` pour `spoke` (topologie + matrice), info-bulle « 90 s » ;
  - la carte de `spoke` affiche toujours `online`, `down` toujours `offline`, « En ligne » compte
    toujours 5 ;
  - après 95 s `hub` s'ajoute ; une réception de `spoke` retire son badge.
- **Traductions** : les 3 clés, avec interpolation, présentes en `en`/`fr`/`zh`.

| Exécution | Résultat |
| --- | --- |
| Avant correctif (sans hook, compteur, badges ni prop) | **4 rouges** (compteur absent, badge de lane absent, 0 timer au lieu de 1, badge OS absent), 1 vert (garde « pairs inconnus ») |
| Après correctif | 5/5, puis 8/8 avec le test des traductions |
| Deux corrections de test en cours de route, sans changement de comportement | sélecteur `getByRole('textbox')` ambigu dans le Command Center → `fleet-command-goal-input` ; chemin des locales via `process.cwd()` (happy-dom réécrit `import.meta.url`) |

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

### Lot 6

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-bridge.test.ts -t "shutdown closes every socket at once"` avant correctif | **3 rouges** / 2 verts. |
| `… run tests/fleet-bridge-quit-lifecycle.test.ts` avant helper et câblage | **8 rouges** (3 câblage, 5 planificateur) / 10 verts. |
| `… run tests/fleet-bridge.test.ts tests/fleet-bridge-quit-lifecycle.test.ts` après correctif | **44/44 verts** (26 + 18), idem avec `--sequence.shuffle`, idem après formatage. |
| 16 tests lisant `src/main/index.ts` + `fleet-ipc`, `saga-runner`, `fleet-discovery`, `fleet-team-panel-browser-bridge`, `companion-gateway-fleet-launch`, `aggregator-wiring`, `live-launcher-bridge`, `test-runner-bridge-catalog` | **25 fichiers, 249 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0 src/main/fleet/fleet-bridge.ts src/main/fleet/fleet-bridge-lifecycle.ts tests/fleet-bridge.test.ts tests/fleet-bridge-quit-lifecycle.test.ts` | Propre. |
| `node scripts/lint.cjs src/main/index.ts` | Propre. |
| `tsc --noEmit -p tsconfig.json`, filtré sur `src/` (Cowork) | Aucune erreur dans `cowork/src` (les erreurs historiques de `../src` ne sont pas répétées, consigne). |
| Prettier | Helper et test lifecycle conformes ; mes lignes conformes dans `fleet-bridge.ts`, `index.ts`, `fleet-bridge.test.ts` (écarts restants antérieurs). |
| `sha256sum` renderer du lot 5 + `discovery.ts` | Identiques à la base du lot 6. |

Empreintes à la livraison du lot 6 :

| Fichier | Delta lot 6 | SHA-256 |
| --- | --- | --- |
| `cowork/src/main/index.ts` | import groupé ; `runFleetDiscoveryPass(isActive)` + `fleetDiscovery` à la place de `scheduleFleetDiscovery`/`discoveryTimer` ; `fleetDiscovery.start()` au démarrage ; `fleetDiscovery.stop()` dans les deux chemins de sortie | `d56399712af4e7d2a7f81115da6e48d75997032069e954a60621e3b2f935bcbc` |
| `cowork/src/main/fleet/fleet-bridge.ts` | `shutdownPromise`, `shutdown()` mémorisé, `closeEverything()`, `disconnectQuietly()` (792 lignes au total) | `11760ffe9b8b82c57bd05272d310140edc4a2a50bf745855c5970a2022a4139e` |
| `cowork/src/main/fleet/fleet-bridge-lifecycle.ts` | + `createFleetDiscoverySchedule` (127 lignes au total) | `649ee14f09441c7dc5427e77e08c7c307e99f292b01c76b7698e24f36cbd60d6` |
| `cowork/tests/fleet-bridge.test.ts` | + bloc de 5 tests (860 lignes au total) | `2a46a23e38b86d5bc687917ace9b9dfb9cfec2d9ad7db0806b7e1b2ac0e6397e` |
| `cowork/tests/fleet-bridge-quit-lifecycle.test.ts` | + 3 câblage, 5 planificateur, 1 helper ; motif d'import assoupli (371 lignes au total) | `95cfee4c125e7f189d0ce4fd4e34eb1bd166d8bad4dfec2397228ed9fe7f8167` |

### Lot 5

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-freshness-choice.test.tsx` | 4 rouges → **8/8 verts** (voir ci-dessus). |
| Lot 5 + `fleet-route-preview`, `fleet-model`, `capability-matrix`, `council-model`, `fleet-freshness-display`, `i18n-french-support`, `--sequence.shuffle` | **7 fichiers, 36 tests verts**. |
| Suite Fleet voisine (les 26 du lot 4 + `fleet-route-preview`, `capability-matrix`, `council-model`, `fleet-model` et le nouveau fichier) | **29 fichiers, 245 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0` sur `fleet-peer-freshness.tsx`, `FleetRoutePreview.tsx`, `fleet-model.ts`, `FleetTopologyView.tsx`, `PeerCapabilityMatrix.tsx` et le test | Propre. |
| `node scripts/lint.cjs FleetCommandCenter.tsx MissionControlView.tsx` | Propre. |
| Prettier | Nouveau test formaté ; mes lignes conformes dans les autres fichiers (écarts restants antérieurs au lot : 3 dans `FleetRoutePreview.tsx`, 1 bloc dans `fleet-model.ts`). |
| `tsc --noEmit -p tsconfig.json` | 0 erreur dans `cowork/src` ; 20 erreurs baseline de ce worktree inchangées (corrigées en intégration par Codex, non touchées ici). |
| `sha256sum` de `main/index.ts`, `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts`, `fleet-freshness.ts`, `use-shared-now.ts`, `FleetPanel.tsx`, `fleet-peer-panel.tsx` | Identiques à la base du lot 5 (journal 01:50). |
| Build global | Non relancé (consigne). |

Empreintes à la livraison du lot 5 :

| Fichier | Delta lot 5 | SHA-256 |
| --- | --- | --- |
| `cowork/src/renderer/components/fleet-peer-freshness.tsx` | + `useSilentPeerIds` (134 lignes au total) | `cd8f73b56d0411b58bcde5c0733c3cc67e2ea4f687466fbaf28a1d5f95543f43` |
| `cowork/src/renderer/components/FleetCommandCenter.tsx` | 4 hunks : 2 imports, `OnlinePeerCount`, `peersById` | `6577f700f26c2eab5a6f7a74abca6139b307fb1c2caeeff3d056e679bd151cbb` |
| `cowork/src/renderer/components/FleetRoutePreview.tsx` | prop `peersById`, `RouteLaneList` (248 lignes au total) | `c558f7ffe59930822cb0db92a4cdee1c08beec78e06ef57243b01cdc4980f8db` |
| `cowork/src/renderer/components/os/MissionControlView.tsx` | 4 hunks : import, `toOsPeer(peer, quiet)`, `quiet`, calcul des pairs | `487aace0008fccbe7cb3db0f79173f6d6a400c1eaf708011e08f19b48de8784d` |
| `cowork/src/renderer/components/os/FleetTopologyView.tsx` | import, `data-testid` de carte, badge | `90ef23fb4cb29e0e4f39999bf25cb026232ef2f71c3e5ac6bcf7e77b8df268c5` |
| `cowork/src/renderer/components/os/PeerCapabilityMatrix.tsx` | import, badge | `72c9c703513360030ca12f2bfde525c4d0d1b289c0eafd4ba36f3d04e342c965` |
| `cowork/src/renderer/components/os/util/fleet-model.ts` | `quiet?`, `QUIET_PEER_HINT` | `a97902d32e26738f2924d3ba4ed4d1504422ec2e29ba38b43bc016f4e0220909` |
| `cowork/src/renderer/i18n/locales/en.json` | +3 clés | `61bb568c873149e99d5be126595dac53038c04143df030b88b3d3e837ec192f7` |
| `cowork/src/renderer/i18n/locales/fr.json` | +3 clés | `c33b933f6bef5e63cda4b88068b2599c0057dde1c7c6c4af2174439bc9aecf88` |
| `cowork/src/renderer/i18n/locales/zh.json` | +3 clés | `9d39d05c95533c1acfeec5f9fe4b69b4890584327804bf7139fc75f9b296a788` |
| `cowork/tests/fleet-freshness-choice.test.tsx` | nouveau, 289 lignes | `a2aeacfed4dfb0325dc7ea489967522e9c6669c23108a0ceca0aa109ae3f0c71` |

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

## Limites du lot 6

- Pas d'Electron réel : le câblage de sortie est prouvé par lecture statique de `index.ts` ; le
  comportement, par le helper et un vrai `FleetBridge` avec faux listener. Aucun serveur ni
  Tailscale réel.
- La fermeture parallèle est bornée par le budget de sortie existant (3 s), pas par un délai
  interne au bridge (consigne : aucun nouveau timer). Hors séquence de sortie, `shutdown()`
  attend la fermeture la plus lente, elle-même bornée à 1 s par le `FleetListener` du noyau.
- `stop()` de la découverte est définitif : un redémarrage de la découverte sans relancer
  l'application n'est pas prévu (aucun appelant ne le demande).
- Commande pour le pilote (lot 6 seul, après revue) :
  `git add cowork/src/main/index.ts cowork/src/main/fleet/fleet-bridge.ts
  cowork/src/main/fleet/fleet-bridge-lifecycle.ts cowork/tests/fleet-bridge.test.ts
  cowork/tests/fleet-bridge-quit-lifecycle.test.ts docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md
  docs/FABLE5-CODEX-COORDINATION.md` puis
  `git commit -m "fix(cowork): stop fleet discovery and close peer sockets in parallel on quit"`.
  Ces fichiers portent aussi les lots 1-3, déjà en intégration.

## Suite après le lot 6

Aucune autre amélioration Fleet n'est étayée par une preuve concrète à ce stade : les défauts
relevés pendant les lots 1 à 6 sont corrigés. Je ne propose pas de lot supplémentaire sans
nouveau constat.

## Limites du lot 5

- Pas d'Electron réel : preuves par rendus DOM complets (Command Center, Mission Control) sous
  faux temps.
- Le badge de lane et la note ne signalent que les pairs connus du store ; un id de lane inconnu
  ne reçoit rien (aucune supposition).
- Les chaînes de Mission Control restent en français codé en dur, comme le reste de ces vues
  (pas d'i18n dans `os/`).
- Aucun changement de routage : un pair silencieux peut toujours être recommandé ; la note le dit.
- Commande pour le pilote (lot 5 seul, après revue) :
  `git add cowork/src/renderer/components/fleet-peer-freshness.tsx cowork/src/renderer/components/FleetCommandCenter.tsx
  cowork/src/renderer/components/FleetRoutePreview.tsx cowork/src/renderer/components/os/MissionControlView.tsx
  cowork/src/renderer/components/os/FleetTopologyView.tsx cowork/src/renderer/components/os/PeerCapabilityMatrix.tsx
  cowork/src/renderer/components/os/util/fleet-model.ts cowork/src/renderer/i18n/locales/en.json
  cowork/src/renderer/i18n/locales/fr.json cowork/src/renderer/i18n/locales/zh.json
  cowork/tests/fleet-freshness-choice.test.tsx docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md
  docs/FABLE5-CODEX-COORDINATION.md` puis
  `git commit -m "feat(cowork): surface silent fleet peers where peers are chosen"`.
  `fleet-peer-freshness.tsx` et les locales portent aussi le lot 4, déjà en intégration.

## Suite possible après le lot 5

Côté fraîcheur Fleet, rien d'utile ne reste sans toucher au routage, ce qui est hors du
périmètre voulu. Seul point concret déjà identifié et encore ouvert : le micro-lot `main` noté au
lot 3 (arrêter `discoveryTimer` et son premier `setTimeout` au début de la sortie, et fermer les
sockets en parallèle dans `FleetBridge.shutdown()`). Il touche des fichiers livrés, donc à engager
seulement si le pilote le juge utile. — **Fait au lot 6.**

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

**Lot 5 — le silence visible là où l'on décide** (renderer seul, sans changer le routage) —
**fait au lot 5** (voir la section Lot 5) :
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

### 02:03 — Lot 6 : fermeture, découverte arrêtée et sockets fermées en parallèle (avant toute modification)

Coordination lue : « LOT 6 FERMETURE RÉSERVÉ ; Codex intègre le renderer lot 5 » (lots 1-4
intégrés jusqu'à `56e757447`), réservation actualisée « en cours ». Périmètre : `main/index.ts`,
`main/fleet/fleet-bridge.ts`, lifecycle si nécessaire, tests associés, rapport, ma ligne.
Contraintes :
- préserver reprises, `pendingConnect`, `stopped` et identité des listeners ;
- fermeture parallèle bornée, idempotente, sans perte de nettoyage si une déconnexion rejette ;
- aucun nouveau timer, aucun singleton créé pour fermer ;
- ni serveur réel, ni Electron, ni dépendance ;
- renderer du lot 5 gelé.

Base (SHA-256) :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/main/index.ts` (lot 3) | `40418d1f401cfb2b72c60f2a33ce54dd6ae19951b124511528b35e8ba3c0777c` |
| `cowork/src/main/fleet/fleet-bridge.ts` (lots 1-2) | `c7c001b9be300359570e5c985bb4a35e1dd864b6d7526757b5062da0e5cf7ebe` |
| `cowork/src/main/fleet/fleet-bridge-lifecycle.ts` (lot 3) | `2df2e5d0b63239db71dd7d1099f656a1c9970733544438f7c2140ef870bb3671` |
| `cowork/src/main/fleet/discovery.ts` (= HEAD) | `c3d6ac99752e2655fe6dc6814a8361077c1f7fecaacffc5c58e077a3aec24456` |
| `cowork/tests/fleet-bridge.test.ts` (lots 1-2) | `750198f37c4e75a3d71a27ed5224df2dfbfadce6a8256e67276144b03e82562d` |
| `cowork/tests/fleet-bridge-quit-lifecycle.test.ts` (lot 3) | `ccebdc2e2ee697ebbd6f42363a87609fdb73a46da664855fe2379af307a46791` |
| renderer lot 5 gelé : `fleet-peer-freshness.tsx`, `FleetCommandCenter.tsx`, `FleetRoutePreview.tsx`, `MissionControlView.tsx` | `cd8f73b5…3f43`, `6577f700…1cbb`, `c558f7ff…f8db`, `487aace0…784d` |

### 01:50 — Lot 5 : fraîcheur au moment du choix d'un pair (avant toute inspection)

Lot 4 copié en intégration (vérification root et revue indépendante en cours). Codex a réparé en
intégration le build Vite complet et le typecheck Cowork ; ce worktree peut encore montrer les 20
erreurs baseline, non corrigées ici, build global non relancé. Périmètre du lot 5 : renderer
seul. Au programme :
- compteur « en ligne dont N silencieux » du Command Center ;
- avertissement neutre dans `FleetRoutePreview` si le pair recommandé est silencieux ;
- badge `quiet` optionnel dans Mission Control / topologie / matrice, si c'est de la présentation
  pure.

Contraintes : réutiliser l'horloge et les utilitaires du lot 4, un seul intervalle ; ne jamais
modifier `online`/`busy`/`offline`, le routage ni le dispatch ; aucun appel réseau ni reconnexion.
Fichiers livrés `main`/`FleetBridge`/lifecycle/`vite.config.ts` inchangés.

Base (SHA-256) :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/renderer/components/FleetCommandCenter.tsx` (= HEAD) | `7e84d1220737e7785092a10426586abf25539aea4b203c56bb9a5e9c543be7a9` |
| `cowork/src/renderer/components/FleetRoutePreview.tsx` (= HEAD) | `cd9043c3707ab487a92de07a596407f2048a807b3720a676aa071045e482bbbb` |
| `cowork/src/renderer/components/os/MissionControlView.tsx` (= HEAD) | `b9e1b5249a248b64063ba6930f47703d2eb80ef0d4f1af379ba1c443e16e1976` |
| `cowork/src/renderer/components/os/FleetTopologyView.tsx` (= HEAD) | `4be6349b2fcf046ec1e91033942de2e3bc339a43250f6d5255edd1e0ad5a273e` |
| `cowork/src/renderer/components/os/PeerCapabilityMatrix.tsx` (= HEAD) | `264ca00d60ae4dd8d00d823cb13bac4379031e4c8f293fa954d9639cc091808c` |
| `cowork/src/renderer/components/os/util/fleet-model.ts` (= HEAD) | `7bc403e46fbdd8bb79412cb671afa3302afb7c06a8bf864723cc65d724216854` |
| `cowork/src/renderer/components/fleet-peer-freshness.tsx` (lot 4) | `349764b6a0609e4593edd17a7d9e4f9adbf035faeddc3a0a35149b759ba07739` |
| `cowork/src/renderer/utils/fleet-freshness.ts` (lot 4) | `290759780fc51a39c83610c1d1aa00e9de495e6a431bff5ee8573e2a09710f10` |
| `cowork/src/renderer/hooks/use-shared-now.ts` (lot 4) | `45593fa84feab2059aa66eceeabb3fdceded80cb99837fd16fded8b6c45e24f6` |
| `cowork/src/renderer/components/FleetPanel.tsx` (lots 1-2-4) | `87eea1cab5a1b9202a58151f780afe5a771708cf280ef7f4b0ad19e97a94f645` |
| `cowork/src/renderer/components/fleet-peer-panel.tsx` (lot 4) | `39509a46d25450c4dffa6bb8ec8ed4e28c8abc52a2990c6357afa113057ac0ad` |
| locales `en` / `fr` / `zh` (lot 4) | `8ab6c499…3fef` / `f55e893d…5f31` / `030084e5…0f1c` |
| `main/index.ts`, `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts` (interdits) | `40418d1f…777c`, `c7c001b9…7ebe`, `2df2e5d0…3671` |

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

### Contre-validation lot 5 : choix des pairs

Codex a porté le lot renderer et fait réaliser une revue indépendante :
les statuts, ensembles de pairs et requêtes de routage restent inchangés.
Le snapshot de pairs silencieux utilise désormais JSON au lieu d'un séparateur
newline : les IDs persistés ne sont pas forcément issus du normaliseur actuel.
Un test d'aperçu de route avec un tel ID échoue avant ce changement et passe après.
Les quatre suites fraîcheur/locales passent, soit 58 tests. TypeScript Cowork et
ESLint ciblé passent ; le build Vite complet du lot 5 passe également.

La QA Chromium réelle sur le renderer compilé confirme : compteur incluant un
pair silencieux, badge sur la recommandation, puis disparition après réception.
Le pair, le modèle et le score sont inchangés et le routeur n'est appelé qu'une fois.
IPC simulé, aucun Electron/backend ; Mission Control reste vérifié par tests DOM.
Preuve locale : `/tmp/cb-fleet-route-browser-qa.json`, captures
`/tmp/cb-fleet-route-silent.png` et `/tmp/cb-fleet-route-fresh.png`.
Validation avant commit : lint, typechecks, paquet (10 tests) et garde données
personnelles (40 tests après indexation) passent.

### Contre-validation lot 6 : fermeture

Après port sélectif, les 44 tests bridge/lifecycle passent dans la branche
d'intégration. Typecheck Cowork et ESLint ciblé passent également. La découverte
stoppe ses timers et ne publie plus après la sortie ; une sonde réseau déjà
lancée reste soumise à son propre délai. La fermeture des sockets est parallèle,
la promesse est partagée entre appels et le budget de sortie reste trois secondes.
Aucun lancement Electron, Tailscale ou fournisseur réel n'est revendiqué.
