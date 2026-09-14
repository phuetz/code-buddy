# Amélioration Cowork — écran Fleet et états de connexion (Opus, 2026-09-14)

- **Agent** : Claude Opus 5, piloté par Codex, demande explicite de Patrice.
- **Worktree** : `~/DEV/cb-cowork-improvements-opus-2026-09-14`
- **Branche** : `feat/cowork-improvements-opus-2026-09-14`, base `017ba1aa8`.
- **Périmètre** : `cowork/src`, tests Cowork, ce rapport, ma ligne de coordination.
- **Interdits** : commit/push, publication, compte, API LLM distante, commande robot,
  service/config utilisateur, Electron sur profil réel, `npm install`/rebuild, `src/` hors
  `cowork/`, `src/fleet/rooms` (intégrés séparément par le pilote).

## Statut

**Lot 8 livré au pilote, non commité** (2026-09-14). Défaut réel confirmé et corrigé :
`FleetPeerSessionPanel` mélangeait pairs et sessions. Liste, erreur, session démarrée, réponse
d'un tour ou fin arrivant après un changement de pair ou de session s'appliquaient à la vue
affichée, et une requête partait encore après démontage. Chaque réponse est désormais liée au
pair (et à la session) pour lesquels elle a été demandée. Aucune fermeture distante automatique,
aucune requête nouvelle ; protocole et IPC inchangés. Un seul fichier source modifié.

**Lot 7 livré au pilote, non commité** (2026-09-14). Régression réelle confirmée et corrigée :
`FleetRoutePreview` présentait comme route actuelle un résultat calculé pour d'autres
paramètres. Une route n'est désormais affichée que pour la requête exacte qu'elle a obtenue ;
une réponse tardive ou antérieure à une fermeture est ignorée ; une nouvelle prévisualisation
reste possible pendant qu'une ancienne attend. Aucune requête automatique, payload inchangé,
route conservée sur changement de fraîcheur ou de `peersById`. Un seul fichier source modifié.

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

## Mission 12 — arrêt du pont workflows câblé dans la sortie de `main`

**Livrée au pilote, non commitée** (2026-09-14, 03:15).

### Constats et reproduction

Deux nouveaux fichiers de tests, **6 rouges sur 7** sur la livraison de la mission 11 bis.

`cowork/tests/workflow-bridge-shutdown.test.ts` (4 tests à ce stade, 4 rouges). Composants
réels : `WorkflowBridge`, Orchestrator du noyau (gelé) et `CoworkToolAgent`. Factices : imports
du noyau (qu'on peut retenir pour simuler un boot en cours), registre d'outils, service de
confirmation et `userData`. Horloge du noyau simulée (`setTimeout`), jamais avancée pendant les
assertions de refus : un run qui attendrait l'expiration du noyau reste « non réglé ».

| Test | Mission 11 bis | Après |
| --- | --- | --- |
| run après `shutdown()`, pont jamais démarré → réglé tout de suite, erreur « shut down », aucun import du noyau, 0 timer, aucun enregistrement de run | **rouge** : run non réglé (le noyau démarre et attend 5 min) | vert |
| orchestrateur déjà démarré : run puis replay après `shutdown()` → refus immédiats, aucun nouveau `startWorkflow`, aucun timer ajouté, historique inchangé | **rouge** : run non réglé | vert |
| arrêt pendant l'import `orchestration/` retenu, puis import libéré → refus, `start()` jamais appelé, aucun `startWorkflow`, 0 timer ; un run ultérieur ne relance aucun boot | **rouge** : run non réglé | vert |
| idem, import `tools/` retenu | **rouge** | vert |

Pendant ces rouges, Vitest a aussi capturé **3 exceptions non gérées** du noyau : « Task
'task_write' is not assigned » (`processQueue` → `startTask`). C'est la preuve que le dispatch
reprenait après l'arrêt. L'Orchestrator démarrait tout de même, et le refus synchrone du pont à
`task_assigned` (mission 11 bis) passait la tâche en échec avant le `startTask` du noyau. Dans
Electron, ce serait une exception non capturée dans `main`. Ce chemin disparaît avec le correctif :
aucun Orchestrator ne tourne après l'arrêt.

`cowork/tests/workflow-bridge-quit-wiring.test.ts` (3 tests, 2 rouges). `main/index.ts` n'est pas
importable en test : lecture de la source, lignes de commentaire ignorées.

| Test | Avant | Après |
| --- | --- | --- |
| `cleanupSandboxResources` appelle `workflowBridge?.shutdown()` une fois, après `isCleaningUp = true` et `shutdownFleetBridgeForQuit(fleetBridge)`, avant le premier `await` | **rouge** (absent) | vert |
| chemin dev de `before-quit` : appel après la fermeture Fleet, avant `closeDatabase()` | **rouge** (absent) | vert |
| un seul `new WorkflowBridge(`, placé au boot avant la sortie ; `let workflowBridge: WorkflowBridge \| null = null;` ; aucun `getWorkflowBridge(` ; aucune affectation ni appel non optionnel dans les deux sorties | vert (garde) | vert |

### Correctif

`workflow-bridge.ts` :
- `runTracked` refuse d'emblée après l'arrêt (même forme que le refus « Another visual workflow
  is already running »), avant tout enregistrement de run, compilation ou boot. Message :
  « Workflow bridge is shut down (Cowork is quitting): no workflow run can start ». `run()` et
  `replay()` passent par là.
- Boot différé : juste avant `orchestrator.start()`, si le pont a été arrêté pendant les
  imports, retour sans démarrer ni conserver cet Orchestrator.
- Après `await ensureOrchestrator()`, le même refus s'applique si le pont a été arrêté entre-temps.
  C'est le cas d'un `run()` suivi d'un `shutdown()` dans le même tick, orchestrateur déjà démarré :
  `run()` s'exécute de façon synchrone jusqu'à cet `await`.
- `shutdown()` : suppression du second `orchestrator.stop()` (doublon laissé à la mission 11 bis,
  sans effet) ; commentaire complété (refus immédiat, boot en cours, final et idempotent).

`main/index.ts` (+11 lignes, 2 hunks, rien retiré) :
- `cleanupSandboxResources()` (ligne 2457) : `workflowBridge?.shutdown()` dans un `try/catch`
  journalisé, juste après `const fleetBridgeClosing = shutdownFleetBridgeForQuit(fleetBridge)`
  et avant le premier `await`. Même idiome que `voiceBridge?.shutdown()` : une exception ne peut
  pas empêcher `app.quit()` ni la fermeture de la base.
- chemin dev de `before-quit` (ligne 2611) : même appel, `try/catch` best-effort comme
  `closeDatabase()`, après `void shutdownFleetBridgeForQuit(fleetBridge)` et avant
  `sessionManager?.dispose()`.
- Aucun singleton : la variable de module créée au boot est utilisée par chaînage optionnel. Ordre
  du lot 6 inchangé : `fleetDiscovery.stop()`, fermeture Fleet démarrée avant tout `await`,
  attente bornée à 3 s avant `closeLogFile()`. `fleet-bridge-lifecycle.ts` et son test sont
  inchangés (empreintes identiques).
- `index.ts` ne contient aucun autre chemin de sortie (`app.exit`, `will-quit`, `app.relaunch`,
  `process.exit` absents). SIGTERM/SIGINT passent par `app.quit()`, puis `before-quit`.

### Test de la mission 11 bis mis à jour

`workflow-bridge-late-confirmation.test.ts`, test « does not run a tool confirmed after the
bridge shut down ». Le run lancé après l'arrêt attendait l'expiration du noyau (5 min simulées)
avant d'échouer ; c'était l'ancien comportement. Il est désormais refusé tout de suite (erreur
« shut down »), toujours sans confirmation ni outil. La partie sur le run en vol au moment de
l'arrêt est inchangée.

### Mutations (retrait temporaire d'une garde, puis restauration)

| Garde retirée | Résultat |
| --- | --- |
| retour avant `orchestrator.start()` | 2 rouges (boot retenu `orchestration/` et `tools/`) |
| refus en tête de `runTracked` | 4 rouges |
| `this.stopped` dans la condition après `ensureOrchestrator` | **0 rouge** d'abord : le cas « même tick » n'était pas couvert. Test ajouté (« never starts a run requested in the same tick as shutdown on a running orchestrator ») → 1 rouge, vert après restauration |

### Vérifications

| Commande (dans `cowork/`) | Résultat |
| --- | --- |
| 7 nouveaux tests avant correctif | **6 rouges**, 1 vert (garde), 3 exceptions non gérées du noyau |
| `workflow-bridge-shutdown` (5) + `quit-wiring` (3) + `late-confirmation` + `late-task` + `fleet-bridge-quit-lifecycle` | **5 fichiers, 32 tests verts** (avant ajout du test « même tick »), 0 erreur non gérée |
| 17 fichiers qui lisent `main/index.ts` + 10 fichiers workflow (dont `late-*`, `persistence`, `integration`, `compilation`, `supervision-bridge`, `supervisor`, `force-confirmation`, `service`) | **27 fichiers, 218 tests verts** |
| `shutdown` + `late-confirmation` + `late-task` + `quit-wiring`, `--sequence.shuffle` | **15/15 verts** |
| `node scripts/lint.cjs --max-warnings 0` sur les 5 fichiers | Propre |
| `tsc --noEmit -p tsconfig.json` | 20 erreurs, toutes dans le noyau `../src/` (baseline connue) ; **0 dans `cowork/src`** |
| Prettier | 3 fichiers de test conformes ; toutes mes lignes du pont et de `index.ts` identiques à la sortie Prettier (les deux fichiers ne l'étaient déjà pas avant) |

Electron non lancé : aucune sortie réelle n'est revendiquée. Le câblage est prouvé sur la
source de `main`, et le comportement de `shutdown()` sur le vrai pont avec le vrai Orchestrator.

Empreintes :

| Fichier | Base → Après |
| --- | --- |
| `cowork/src/main/index.ts` | `d5639971…bcbc` → `f1acd716bb6eadd7af619f4d624194a5d8112f2bf6d1ac69712ea1c9f859c633` |
| `cowork/src/main/workflows/workflow-bridge.ts` | `65fe8155…6571` → `f466590b994fa6fa02b1e12a62bb4d9da76922d2f1d8426b69b1ddfca99942fe` |
| `cowork/tests/workflow-bridge-late-confirmation.test.ts` | `0eb16eb0…9745` → `9c87a9b2ee9c2f08c14c02870805e548f3093d3392291ba6638e93865570c2cb` |
| `cowork/tests/workflow-bridge-shutdown.test.ts` | nouveau → `2261d481aae63c84914e1c851df49f7b1473b8dc2ac65607f26849e0357b0815` |
| `cowork/tests/workflow-bridge-quit-wiring.test.ts` | nouveau → `795a7e1cf1c7989ba10d0096fe422de519f08b49db0ee2c4ecf784d4c3b457cd` |
| inchangés : `fleet-bridge-lifecycle.ts`, `fleet-bridge-quit-lifecycle.test.ts`, `cowork-tool-agent.ts`, `workflow-bridge-late-task.test.ts`, `src/orchestration/orchestrator.ts` | `649ee14f…60d6`, `95cfee4c…8167`, `6837b123…a8cf`, `b19818cc…f924`, `3bc79850…f23d` |

### Correction d'une affirmation de la mission 11 bis

J'avais écrit que `shutdown()` « n'annulait que les approbations » et que « la file de
l'Orchestrator restait active ». C'est faux : le `shutdown()` de HEAD (`017ba1aa8`) appelait déjà
`this.orchestrator?.stop()` après `cancelPending`, comme le montre `git diff` contre HEAD. Seul
point prouvé par le rouge de la mission 11 bis : un outil confirmé après l'arrêt s'exécutait,
faute de drapeau `stopped` consulté par le pont. La mission 11 bis a ajouté ce drapeau et un
second `stop()`, qui faisait doublon avec celui de HEAD ; ce doublon est retiré ici.

### Limites

- Un run **en vol** au moment de l'arrêt (workflow déjà démarré dans le noyau) n'est pas
  interrompu : aucune action nouvelle ne démarre, mais sa promesse ne se règle qu'à l'expiration
  du noyau (5 min). La sortie de `main` ne l'attend pas.
- Un outil déjà lancé n'est pas interrompu. Les boîtes de confirmation ou d'approbation déjà
  affichées ne sont pas retirées (renderer gelé).
- Un `replay()` dont l'instantané contient des valeurs masquées répond toujours par son erreur
  « Secret input required » et enregistre ce refus, même après l'arrêt. Réponse immédiate,
  rien n'est exécuté ; branche non modifiée.
- `shutdown()` est définitif. Aucun redémarrage du pont n'est prévu sans relancer Cowork, comme
  pour la découverte Fleet du lot 6.
- Garantie du câblage : lecture statique de la source, pas une sortie Electron réelle.

## Mission 11 bis — contre-relecture avant port : activité prouvée et arrêt du pont

### Constats et reproduction (vrai Orchestrator, vrai `CoworkToolAgent`)

2 tests ajoutés à `cowork/tests/workflow-bridge-late-confirmation.test.ts`, **2 rouges** sur la
livraison de la mission 11 :
1. **Activité non prouvée.** `isTaskActive` considérait « actif » tout ce qui n'était pas
   `completed`/`failed`/`cancelled`, y compris une tâche absente ou un statut `undefined`.
   Reproduit en faisant renvoyer `undefined` au `getTask` du vrai noyau pendant qu'une
   confirmation attend : l'outil était exécuté (`registry.execute` appelé 1 fois).
2. **Arrêt du pont.** ~~`WorkflowBridge.shutdown()` n'annulait que les approbations.~~ Un outil
   confirmé après `shutdown()` était exécuté (`registry.execute` appelé 1 fois)~~, et la file de
   l'Orchestrator restait active~~. *(Corrigé à la mission 12 : HEAD appelait déjà
   `orchestrator.stop()` ; seul le drapeau `stopped` manquait.)* Un premier jet de ce test (éventail de 5 outils) ne produisait
   pas de branches parallèles avec ce compilateur ; il a été remplacé, avant toute conclusion, par
   un outil unique suivi d'un run lancé après l'arrêt.

Constat annexe, non modifié (main gelé) : `WorkflowBridge.shutdown()` n'est appelé nulle part dans
`cowork/src/main`. La garantie n'existe donc que si un appelant l'invoque.

### Correctif (`workflow-bridge.ts` seul ; `cowork-tool-agent.ts` inchangé depuis la mission 11)

- `isTaskActive` n'accepte plus qu'une activité prouvée : pont non arrêté **et** statut du noyau
  `assigned` ou `in_progress`. Une tâche absente ou sans statut est inactive.
- Même preuve exigée dès `task_assigned`. Sans elle, le pont rapporte `failTask` (« not started:
  the bridge is stopped or the task is not running ») et ne démarre rien : ni confirmation, ni
  approbation, ni `set_variable`, ni événement.
- `shutdown()` passe `stopped` à vrai, appelle `orchestrator.stop()` (API existante du noyau, plus
  aucun dispatch de la file) et annule les approbations en attente comme avant. *(Mission 12 :
  `stop()` était déjà appelé à HEAD ; l'appel ajouté ici faisait doublon, retiré.)*
- Commentaire de `emitWorkflowEvent` corrigé : les événements de nœud tardifs ne sont plus publiés
  du tout ; la garde n'y protège plus que l'historique persistant du run actif.
- Test de la mission 9 : son Orchestrator factice déclare désormais la tâche `in_progress` à
  l'assignation, comme le vrai noyau. C'est un mock honnête : sans ce statut, le pont ne démarre
  plus la tâche.

### Vérifications

| Commande | Résultat |
| --- | --- |
| `tests/workflow-bridge-late-confirmation.test.ts` avant correctif | **2 rouges** / 4 verts. |
| 8 fichiers workflow (`late-confirmation`, `late-task`, `persistence`, `integration`, `compilation`, `supervision-bridge`, `supervisor`, `force-confirmation`) | **8 fichiers, 52 tests verts**. |
| `late-confirmation` + `late-task`, après formatage, `--sequence.shuffle` | **7/7 verts**. |
| `node scripts/lint.cjs --max-warnings 0` sur les 4 fichiers | Propre. |
| `tsc --noEmit` Cowork, lignes d'erreur dans `src/` | **0**. |
| Prettier | Tests formatés ; aucun écart sur les lignes modifiées du pont. |

Empreintes : `workflow-bridge.ts` `ffc565ed…2744` →
`65fe8155a9d2181f5fc455d3be64fb5d2414031a92be5e04a48d8c9416646571` ;
`cowork-tool-agent.ts` inchangé `6837b1238f3da9a8e9f98e97d1887a9caeb5c12ec5c0ec1d6ecfdd92a15aa8cf` ;
`workflow-bridge-late-confirmation.test.ts` `fc1c4ae0…f026` →
`0eb16eb0aaadea4c2b2d2547ed5d00d566df34fde115148ff19d90b4cd3d9745` ;
`workflow-bridge-late-task.test.ts` `27c41207…82e2` →
`b19818cc8c29bb0d09ee479917a15a7c44a591f1323061d1345e59fde1f9f924`. Noyau non modifié.

Limites :
- un outil déjà démarré avant l'arrêt n'est pas interrompu ;
- les boîtes de confirmation et d'approbation déjà affichées ne sont pas retirées (renderer gelé) ;
- ~~après `shutdown()`, un run lancé reste en file jusqu'à l'expiration du noyau (5 min) ; aucune
  action ne démarre~~ (résolu mission 12 : refus immédiat) ;
- ~~câbler `shutdown()` dans la séquence de sortie de `main` reste à décider par le pilote~~
  (fait à la mission 12).

## Mission 11 — confirmation/approbation après la fin du run : pas d'exécution, pas de publication

### Reproduction (vrai Orchestrator, vrai `CoworkToolAgent`)

`cowork/tests/workflow-bridge-late-confirmation.test.ts` (nouveau, 4 tests). Composants
réels : `WorkflowBridge`, Orchestrator du noyau (mission 10, gelé) et `CoworkToolAgent`.
Factices : registre d'outils (`execute` espionné), service de confirmation à réponse différée
et `userData` temporaire. Horloge simulée : le noyau expire la tâche après son
`defaultTimeout` (300 000 ms), fait échouer le workflow et abandonne la tâche.

| Test | Base (mission 10) | Après |
| --- | --- | --- |
| outil `write_file` confirmé **après** l'expiration → `registry.execute` jamais appelé, aucun `node_completed`/`node_failed` publié, aucun worker `busy` | **rouge** : `execute` appelé 1 fois | vert |
| approbation (`timeoutMs` 600 000) répondue après l'expiration → aucun événement de nœud publié, aucun `execute`, aucun worker `busy` | **rouge** : `node_completed` publié pour l'instance terminée | vert |
| outil confirmé à temps → `execute` 1 fois, run `completed`, `node_completed` publié | vert (garde) | vert |
| approbation donnée à temps → run `completed`, `node_completed` publié | vert (garde) | vert |

### Correctif

- `cowork-tool-agent.ts` : interface interne minimale `ToolTaskLifecycle { isActive(): boolean }`,
  passée en second argument optionnel de `runToolInvoke`. Sans elle, comportement identique.
  Vérifiée avant de demander la confirmation, puis juste avant `registry.execute`. Si la tâche
  n'est plus active, l'appel échoue avec « Workflow tool '…' was not run: its workflow task is
  no longer active ». Ce n'est ni un mode général ni un contournement de sécurité : la
  confirmation reste exigée. Un outil déjà démarré n'est pas interrompu.
- `workflow-bridge.ts` (`task_assigned`) :
  - `isTaskActive()` lit le statut réel de la tâche du noyau (`completed`/`failed`/`cancelled`
    = inactive) et est transmis à `runToolInvoke` ;
  - la décision de publier est prise **avant** de rapporter au noyau : `completeTask`/`failTask`
    sont toujours appelés (le noyau gelé libère ainsi le worker de façon sûre), mais
    `node_completed`/`node_failed` ne sont émis que si la tâche était encore active ;
  - le type interne `CoreOrchestrator.getTask` expose `status?`.
- Inchangés : approbations et confirmations normales, `set_variable`, parallélisme, retries,
  `cancelPending` (annulation manuelle) et noyau d'orchestration.

### Évolution du test de la mission 9

`workflow-bridge-late-task.test.ts` utilise un Orchestrator factice. Son script marque
désormais la tâche `cancelled` à l'échec du run, comme le fait le vrai noyau (prouvé par
`orchestrator-abandoned-tasks.test.ts` et le test ci-dessus). Il affirme en plus qu'aucun
`workflow.event` de `inst-1` n'est publié après la réponse tardive ; l'assertion de persistance
(`['inst-2', 'inst-2']`) est conservée. **Nouveau contrat** : un événement de nœud tardif d'un
run terminé n'est plus livré au renderer. L'assertion ajoutée côté intégration par Codex (« le
tardif `inst-1` est livré ») doit être inversée en conséquence. Non mesuré : je n'ai pas rejoué
cette nouvelle assertion contre l'ancien pont. La preuve rouge du changement de contrat est le
2ᵉ test ci-dessus, sur le vrai noyau.

### Limites

- Aucune annulation d'effet déjà parti : un outil lancé avant l'expiration va au bout, et seul
  son rapport est ignoré par le noyau.
- La confirmation elle-même (`ConfirmationService`) n'est pas retirée de l'écran : l'utilisateur
  peut encore répondre, mais l'outil ne s'exécute pas.
- L'approbation en attente reste affichée côté renderer (gelé) jusqu'à sa propre expiration ; y
  répondre ne publie plus rien.

### Vérifications

| Commande | Résultat |
| --- | --- |
| `tests/workflow-bridge-late-confirmation.test.ts` avant correctif | **2 rouges** / 2 verts. |
| `workflow-bridge-late-confirmation`, `-late-task`, `-persistence`, `-integration`, `-compilation`, `workflow-supervision-bridge`, `workflow-supervisor`, `workflow-force-confirmation` après correctif | **8 fichiers, 50 tests verts** ; rejoué après formatage (5/5 sur les deux fichiers de fin de run). |
| `node scripts/lint.cjs --max-warnings 0` sur les 4 fichiers | Propre. |
| `tsc --noEmit` Cowork, lignes d'erreur dans `src/` | **0**. |
| Prettier | Tests formatés ; aucun écart sur les lignes modifiées du tool-agent. |

Empreintes : `workflow-bridge.ts` `78048050…474c` → `ffc565edcc3828ffcce066f22783fd45df6c39e43c0c6a0a45a25a213c9e2744` ;
`cowork-tool-agent.ts` `a4ba848b…751c` → `6837b1238f3da9a8e9f98e97d1887a9caeb5c12ec5c0ec1d6ecfdd92a15aa8cf` ;
`workflow-bridge-late-confirmation.test.ts` `fc1c4ae0a0e41b4d58c108adc5999eebabd2e5003c5232c9f373ddabc4fdf026` ;
`workflow-bridge-late-task.test.ts` `dd2db712…6c35` → `27c412077bf7b8e2658bd88e70e0dfe22c5d858de7622d8ae17346ded7ae82e2`.
`src/orchestration/orchestrator.ts` inchangé (`3bc79850…f23d`).

## Mission 10 — vrai Orchestrator : tâches abandonnées qui rouvrent, redispatchent ou libèrent le mauvais worker

### Correction de la mission 9

Le passage « Non traité : … Le noyau refuse ce cas (`task.status !== 'assigned'`, ligne 278) »
de la mission 9 est **faux**. La ligne 278 est `startTask` ; `completeTask` et `failTask`
n'avaient aucune garde. La conclusion reposait sur une lecture partielle, pas sur une
exécution. Corrigée ici par des tests sur le vrai noyau.

### État réel observé (vrai Orchestrator, avant correctif)

- À l'expiration (`waitForTask`), la tâche garde son statut : `queued` (toujours en file) ou
  `in_progress` (agent `busy`, `currentTask` = cette tâche). Le workflow passe en `failed`.
- Un worker reste réservé par la tâche expirée tant que son exécuteur ne rend pas la main.
- Consommateurs UI : le pont Cowork émet `workflow.event` ; le renderer
  (`useIPC.ts:585` → `store.applyWorkflowEvent`) range `workflowExecutions` par `instanceId` et
  crée une entrée `running` par défaut si elle manque.

### Reproduction — `tests/orchestration/orchestrator-abandoned-tasks.test.ts` (nouveau, 5 tests)

Vrai `Orchestrator` (`defaultTimeout: 300`, horloge simulée sur `setTimeout`) et un worker.
L'exécuteur factice ne fait qu'enregistrer les `task_assigned` et rendre la main quand le test
le décide ; toutes les conclusions sont lues sur l'état réel (`getTask`, `getAgent`,
`getStats`, événements).

| Test | Base réelle | Après |
| --- | --- | --- |
| run 1 (2 tâches parallèles) expire ; run 2 démarre ; résultat tardif de `run1-a` → `run1-b` (encore en file) n'est pas dispatchée, `run2-c` l'est | **rouge** : `assigned = ['run1-a', 'run1-b']`, le worker part à `run1-b` | vert |
| résultat tardif : pas de `completed`, pas d'`output`, stats et événement `task_completed` inchangés ; le worker encore réservé est libéré | **rouge** : statut `completed` | vert |
| erreur tardive d'une tâche à retries : pas de remise en file ni de second dispatch | **rouge** : `run1-a` assignée 2 fois | vert |
| worker réattribué (`cancelTask` puis `run2-c`) ; approbation de `run1-a` répondue ensuite → worker toujours `busy` sur `run2-c` | **rouge** : worker passé `idle` | vert |
| garde : succès, parallélisme sur 2 workers, retry réel puis succès, 3 tâches comptées | vert | vert |

### Correctif (un invariant, `src/orchestration/orchestrator.ts`)

« Les tâches d'un workflow terminé ne rouvrent rien, ne se redispatchent pas, et un rapport ne
libère jamais un worker occupé par une autre tâche. »
- `startWorkflow` (branche d'échec) : `abandonUnfinishedTasks(instance)`. Chaque tâche non
  terminale de l'instance passe en `cancelled` et quitte la file. Une tâche encore exécutée
  garde son worker jusqu'au rapport de son exécuteur.
- `completeTask` / `failTask` : sur une tâche déjà terminale, `releaseWorkerAfterLateReport` ne
  touche ni statut, ni sortie, ni retry, ni stats, ni événement. Elle libère le worker
  uniquement si `agent.currentTask` est encore cette tâche, puis relance `processQueue`.
- `completeTask` / `failTask` (échec définitif et retry) / `cancelTask` : l'agent n'est libéré
  que si `agent.currentTask === taskId`.
- Inchangés : API publique, signatures, délais (aucune protection timeout retirée), parcours de
  succès, parallélisme, retries d'une tâche vivante. Pont et tool-agent Cowork non modifiés.

### Limites (effets déjà partis)

- Rien n'annule un effet externe déjà lancé : un outil en cours au moment de l'expiration va au
  bout ; seul son rapport est ignoré.
- `CoworkToolAgent.runToolInvoke` attend la confirmation (ligne 125) puis appelle
  `registry.execute` (ligne 134). Une confirmation donnée **après** la fin du run exécute donc
  encore l'outil. Non traité (au plus un défaut) ; proposition : vérifier dans le pont, entre
  confirmation et exécution, que la tâche n'est pas terminale.
- Le pont émet encore vers le renderer un `node_*` tardif de l'ancien `instanceId` (non persisté
  depuis la mission 9). Le store renderer peut alors recréer une entrée `running` pour cette
  instance. Proposition : ne pas émettre si `orchestrator.getTask(taskId)` est terminale.
- Un exécuteur qui ne répond jamais laisse son worker réservé (comportement antérieur,
  inchangé).

### Vérifications

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/orchestration/orchestrator-abandoned-tasks.test.ts` sur le noyau réel non modifié | **4 rouges** / 1 vert (garde). |
| `… run tests/orchestration` après correctif (et après formatage) | **2 fichiers, 41 tests verts**. |
| `cowork` : `workflow-bridge-late-task`, `-persistence`, `-integration` (vrai Orchestrator), `-compilation`, `workflow-supervision-bridge`, `workflow-supervisor`, `workflow-force-confirmation` | **7 fichiers, 46 tests verts**. |
| `node node_modules/eslint/bin/eslint.js --max-warnings 0` (racine) sur le noyau et le test | Propre. |
| `tsc --noEmit -p tsconfig.json` (racine, `--listFiles` inclut `src/orchestration/orchestrator.ts`) | Aucune ligne `error TS`. |
| Prettier | Nouveau test formaté ; aucun écart sur les lignes modifiées de `orchestrator.ts`. |

Empreintes : `orchestrator.ts` avant `9b521c64…d265`, après
`3bc798506647b4297d9fa4a1a16cdb7dfa808e25a86f861e5ab2396b8f75f23d` ; test
`fe4a041041d551b40e00635c8016bb4eb3f4767232c688b7ea0bbd2627cc32fc`. Suites Vitest racine
complètes non relancées (validation large prise en charge par le pilote).

## Mission 9 — pont workflows : événement tardif persisté dans le run suivant

### Audit

- **Pas de concurrence possible.** `runTracked` refuse un second run (`trackedRunActive`) ;
  `executeDefinition` n'est appelé que par lui. Le pont n'expose aucune annulation de
  workflow : le cas « workflow annulé qui continue à dispatcher » est sans objet.
- **Listeners.** `captureHandler` est retiré dans `finally`. Les listeners globaux
  (`task_assigned`, `workflow_started`, `loop_iteration_started`, `task_created`) sont posés une
  seule fois au démarrage de l'orchestrateur. Les correctifs `queueTask` (`queueMicrotask` sur
  `task_created`) et ordre des listeners (`prependListener`) sont intacts.
- **Défaut trouvé.** Le noyau abandonne une tâche après `defaultTimeout` (`waitForTask` →
  « Task timeout », `src/orchestration/orchestrator.ts:768`, lu sans modification) : le run se
  termine alors que le gestionnaire `task_assigned` du pont attend encore l'outil (ou une
  approbation). Au retour, `emitWorkflowEvent` poussait le `node_completed`/`node_failed`
  (`instanceId` de l'ancien run) dans `activeRunEvents`, qui appartient alors au **run
  suivant**. L'événement était ensuite persisté par `runStore.finish` dans l'historique de ce
  run : mélange `instanceId` et historique faussé.

### Reproduction et correctif

- `cowork/tests/workflow-bridge-late-task.test.ts` (nouveau, 1 test) : vrai `WorkflowBridge`,
  Orchestrator factice (EventEmitter, via `loadCoreModule` simulé), `CoworkToolAgent` factice
  à réponse différée, `userData` temporaire. Aucun outil, LLM ni workflow réel.
  - Run 1 : la tâche est assignée, puis le run se termine en « Task timeout » pendant que l'outil
    attend.
  - Run 2 démarré, puis l'outil du run 1 répond.
  - Avant correctif : historique du run 2 = `['inst-2', 'inst-1', 'inst-2']` (**rouge**).
- `cowork/src/main/workflows/workflow-bridge.ts`, `emitWorkflowEvent` : l'événement est
  toujours envoyé au renderer, mais n'est ajouté à `activeRunEvents` que si son `instanceId`
  est celui du run actif (`currentRun`). Les événements du run lui-même (`workflow_started` après
  `captureHandler`, nœuds, boucles, `completed`/`failed` final émis avant `currentRun = null`)
  restent enregistrés.
- Non traité (au plus un défaut) : `orchestrator.completeTask` est encore appelé sur une tâche
  que le noyau a déjà abandonnée. ~~Le noyau refuse ce cas (`task.status !== 'assigned'`, ligne
  278)~~ — **affirmation fausse, corrigée à la mission 10** : la ligne 278 est `startTask`, et
  `completeTask` n'avait aucune garde.

### Vérifications

| Commande | Résultat |
| --- | --- |
| `tests/workflow-bridge-late-task.test.ts` avant correctif | **1 rouge** (`inst-1` dans l'historique du run 2). |
| même test + `workflow-bridge-persistence`, `workflow-bridge-integration`, `workflow-bridge-compilation`, `workflow-supervision-bridge`, `workflow-supervisor`, `workflow-force-confirmation` après correctif | **7 fichiers, 46 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0` sur les 2 fichiers | Propre. |

Empreintes : `workflow-bridge.ts` avant `960d4123…c540`, après
`78048050591bbcd82856c628f1421df4a4fdc70bc8e80d05f93ddb26fbf8474c` ;
test `dd2db7123bbd85cce0c871f03da02126faf2319f830fe15862c3478e1dc76c35`.

Limites : typecheck complet et suites Cowork larges non relancés (quota). Aucun Electron ni
`userData` réel.

## Lot 8 bis — résidus de la revue pilote (remplace la première version du lot 8)

### Reproduction (avant correction)

4 nouveaux tests dans `fleet-peer-session-panel-isolation.test.tsx`, **4 rouges** sur la
première version du lot 8 :
1. lignes du pair A encore affichées et cliquables pendant `list(B)` en attente ;
2. A→B→A : un `start` de la première visite ouvrait la session et libérait `busy` d'un
   rafraîchissement plus récent ;
3. A→B→A puis re-sélection de la même session : la réponse d'un tour de la première visite
   s'ajoutait et effaçait le nouveau brouillon ;
4. même pair, re-sélection de la même session (s1→s2→s1) : l'ancienne réponse s'ajoutait et
   effaçait le nouveau brouillon.

S'y ajoute une garde StrictMode (double effet : liste affichée, `busy` libéré), verte avant
comme après.

### Correctif (`FleetPeerSessionPanel.tsx`)

- `viewRef = { visit, selection, shown }` remplace la comparaison `peerId`/`sessionId`, qui ne
  distinguait pas deux visites du même pair :
  - `visit` s'incrémente à chaque effet de pair et à son nettoyage (changement de pair,
    démontage, cycle StrictMode) ;
  - `selection` s'incrémente à chaque `selectSession`, même pour la même session ;
  - `shown` passe à faux au nettoyage.
- Chaque opération capture `{ visit, selection }` :
  - liste, démarrage et libération de `busy` exigent la même visite ;
  - transcription, brouillon, erreur de tour/fin et fermeture de la boîte exigent la même
    sélection ;
  - le démarrage n'ouvre la nouvelle session que si la sélection n'a pas changé.
- L'effet de pair vide `sessions` : aucune ligne de l'ancien pair n'est cliquable pendant la
  liste du nouveau.
- Toujours aucune fermeture distante automatique ni requête nouvelle ; protocole et IPC
  inchangés.

### Vérifications

| Commande | Résultat |
| --- | --- |
| `tests/fleet-peer-session-panel-isolation.test.tsx` avant correctif | **4 rouges** / 8 verts. |
| isolation (12) + `fleet-peer-session-panel` (5) + `fleet-freshness-display` + `fleet-freshness-choice`, `--sequence.shuffle` | **4 fichiers, 35 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0` sur les 2 fichiers | Propre. |
| `tsc --noEmit`, lignes d'erreur dans `src/` (Cowork) | **0**. |
| `fleet-peer-panel.tsx`, `fleet-peer-session-panel.test.tsx` | SHA-256 inchangés (`39509a46…`, `91b63eab…`). |

Empreintes livrées : `FleetPeerSessionPanel.tsx`
`b0b0c20d7893c26ec4713f84370ceedd2b6a77af56a2a69370e03dd59ac6533c` ;
`fleet-peer-session-panel-isolation.test.tsx`
`ef8e60a2fe6e5be445e7a988c8f4f46ab057d1d6fc139d0e1b9c348e8dc0d800` (12 tests).

Limites : pas d'Electron ni de pair réel. Deux listes concurrentes d'une **même** visite
peuvent encore arriver dans le désordre (dernière arrivée gagnante, sans mélange entre pairs,
visites ou sélections). Les suites Fleet plus larges du lot 8 initial (90 tests) n'ont pas été
relancées, par économie de quota : seuls les 4 fichiers ci-dessus l'ont été.

## Lot 8 — sessions multi-tours : réponses mélangées entre pairs et sessions

### Périmètre audité

- `cowork/src/renderer/components/FleetPeerSessionPanel.tsx` : seul consommateur renderer de
  `fleet.peerSessionStart|Say|End|List`. Aucun hook dédié. Le flux `continue-stream` n'est pas
  utilisé côté renderer, et `labs-catalog.ts` ne fait que citer la capacité.
- Montage : `PeerDetail` (`fleet-peer-panel.tsx:189`, gelé) rend
  `<FleetPeerSessionPanel peerId={peer.id} />` **sans `key`**. Choisir un autre pair dans le
  Command Center réutilise la même instance ; seul l'effet sur `peerId` remet la vue à zéro.
- Contrat IPC lu dans `preload/index.ts` (4261-4297) : non modifié.

### Constat (reproduit)

Aucune opération asynchrone ne vérifiait, à l'arrivée de la réponse, que le pair et la session
étaient encore ceux affichés :
- `refreshList` (liste ou erreur) d'un ancien pair remplaçait la liste du nouveau ;
- `startSession` ouvrait la session de l'ancien pair sous le nouveau. Un envoi aurait alors
  appelé `peerSessionSay(nouveauPair, sessionDeLAncien)` ; le rafraîchissement suivant listait
  aussi l'ancien pair ;
- `sendTurn` ajoutait la réponse de l'ancien pair, ou d'une autre session du même pair, à la
  transcription affichée, et effaçait le brouillon en cours ;
- `endSession` fermait la boîte de dialogue de la session choisie entre-temps ;
- `busy` n'était pas remis à zéro au changement de pair ; le `finally` d'une ancienne opération
  pouvait libérer les boutons pendant une opération plus récente ;
- après démontage, un tour réussi déclenchait encore `peerSessionList` (requête réseau inutile).

### Correctif (`FleetPeerSessionPanel.tsx` seulement)

- `viewRef` (ref) : pair et session affichés. Posé par l'effet de changement de pair, mis à jour
  par `selectSession()` (démarrage, rattachement, fin), remis à `null` au nettoyage de l'effet
  (changement de pair ou démontage).
- Chaque opération capture `askedPeer` (et la session concernée) avant l'`await` :
  - liste et démarrage : appliqués seulement si `isShownPeer(askedPeer)` ;
  - tour et fin : transcription, brouillon, erreur et fermeture de la boîte seulement si
    `isShownSession(askedPeer, sessionId)` ; le rafraîchissement de liste qui suivait déjà un
    succès est conservé pour le même pair ;
  - démarrage : la nouvelle session ne remplace pas une session rattachée entre-temps ; elle
    reste visible dans la liste ;
  - `busy` libéré seulement pour le pair affiché, et remis à `null` au changement de pair.
- Inchangés : aucun `peerSessionEnd` automatique, aucune nouvelle requête, protocole, textes et
  structure DOM (tests existants intacts).

### Tests du lot 8 — `cowork/tests/fleet-peer-session-panel-isolation.test.tsx` (nouveau, 7 tests)

Même montage que le test existant (`createRoot`, `act`) ; changement de pair par re-rendu de la
même instance ; réponses différées.

| Test | Base | Après |
| --- | --- | --- |
| liste tardive de l'ancien pair jamais affichée sous le nouveau ; bouton de rafraîchissement libre | rouge | vert |
| erreur tardive de liste de l'ancien pair jamais affichée | rouge | vert |
| session démarrée sur l'ancien pair non ouverte sous le nouveau ; aucune liste supplémentaire de l'ancien pair ; aucun `peerSessionEnd` ; bouton « New session » libre | rouge | vert |
| réponse de l'ancien pair non affichée ; brouillon du nouveau pair conservé ; aucun `peerSessionEnd` | rouge | vert |
| réponse d'une session non ajoutée à l'autre session du même pair | rouge | vert |
| fin d'une session après passage à une autre : la session choisie reste ouverte | rouge | vert |
| démontage pendant un tour : aucune requête de liste ensuite | rouge | vert |

Premier jet : un test mal construit (liste initiale de `spoke` en attente, donc bouton de
rafraîchissement désactivé) ; scindé en deux tests (liste / erreur) avant de conclure.
Rouge final : 7/7 sur la base, sur les assertions visées.

## Lot 7 — aperçu de route périmé dans `FleetRoutePreview`

### Audit

- `FleetCommandCenter` laisse modifier, pendant et après une prévisualisation, l'objectif
  (zone de saisie), le profil, la confidentialité, le parallélisme, le mode council et, par
  rafraîchissement des capacités, les pairs routables (`targetPeerIds`).
- `FleetRoutePreview` (base lot 5) :
  - `setPreview(result)` enregistrait le résultat sans les paramètres de la requête : il restait
    affiché sous « Planned route » quels que soient les changements ;
  - `loading` était un booléen global : bouton désactivé tant que l'ancienne requête attendait,
    même pour de nouveaux paramètres ;
  - la réponse d'une requête lancée avant un changement, ou avant la fermeture (✕), était affichée
    en arrivant et rouvrait une route fermée.
- `targetPeerIds` est un **nouveau tableau à chaque rendu** du Command Center
  (`routablePeers.map((peer) => peer.id)`) : les heartbeats le recréent avec les mêmes ids. Il
  faut donc comparer les valeurs, jamais l'identité, pour ne pas perdre la route sur un simple
  événement de fraîcheur.

### Reproduction

`cowork/tests/fleet-route-preview-stale.test.tsx` (nouveau, 11 tests, promesses différées),
exécuté sur la base lot 5 : **10 rouges**, 1 vert (garde « même requête »).
- route toujours affichée après changement d'objectif, de profil, de confidentialité, de
  parallélisme, de council, de pairs routables, et erreur toujours affichée ;
- bouton encore désactivé après changement de paramètres pendant l'attente ;
- impossible de relancer (routeur appelé 1 fois au lieu de 2) ;
- réponse tardive rouvrant la route fermée.

### Correctif (`cowork/src/renderer/components/FleetRoutePreview.tsx` seulement)

- La requête est construite une fois par rendu, **à l'identique** de l'ancien payload (mêmes
  champs et même ordre : `goal` normalisé, `privacyTag`, `dispatchProfile`, `parallelism`
  effectif si > 1, `council` si vrai, `targetPeerIds` si non vide). Sa clé est
  `JSON.stringify(request)`, donc une comparaison par valeur.
- Le résultat est mémorisé avec la clé de sa requête (`shown = { requestKey, result }`). Si la
  clé courante diffère, l'état est vidé **pendant le rendu**, sans effet : motif React « ajuster
  l'état quand une prop change », gardé contre les boucles. Rien n'est affiché ni relancé.
- `loading` est dérivé : `pendingRequestKey === requestKey`. Une attente pour d'anciens
  paramètres ne bloque plus le bouton.
- `latestAttempt` (ref, modifiée seulement dans les gestionnaires) : chaque prévisualisation et
  chaque fermeture l'incrémentent ; une réponse dont l'essai n'est plus le dernier est ignorée.
  La fermeture (`closePreview`) vide aussi l'attente.
- Inchangés :
  - algorithme et payload de routage, IPC, pas de requête automatique ;
  - `RouteLaneList` et badges de fraîcheur du lot 5 ;
  - locales et `fleet-peer-freshness.tsx` (gelé) ;
  - `FleetCommandCenter.tsx`.

### Tests du lot 7

| Test | Base lot 5 | Après |
| --- | --- | --- |
| objectif modifié : route retirée, aucune requête automatique, bouton actif | rouge | vert |
| profil / confidentialité / parallélisme / council / pairs routables modifiés (5 cas) | 5 rouges | 5 verts |
| erreur précédente retirée quand les pairs routables changent | rouge | vert |
| même requête (espaces autour de l'objectif, parallélisme équivalent en council, nouveau tableau aux mêmes ids, heartbeat dans `peersById`) : route conservée, routeur appelé 1 fois | vert (garde) | vert |
| réponse tardive pour d'anciens paramètres : jamais affichée, bouton libéré | rouge | vert |
| nouvelle prévisualisation pendant l'attente : 2ᵉ appel avec le nouveau payload exact ; la 2ᵉ réponse s'affiche, la 1ʳᵉ arrivée après ne la remplace pas | rouge | vert |
| rafraîchissement en attente puis fermeture : la réponse ne rouvre pas la route | rouge | vert |

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

### Lot 8

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-peer-session-panel-isolation.test.tsx` sur la base | **7 rouges** / 0 vert. |
| `… run tests/fleet-peer-session-panel-isolation.test.tsx tests/fleet-peer-session-panel.test.tsx` après correctif | **12/12 verts** (5 tests existants inchangés). |
| 11 suites renderer Fleet voisines (sessions, fraîcheur lots 4-5, route lots 5-7, `advanced-command-center`, `fleet-command-center-board`, `fleet-panel-connection`, `fleet-saga-detail-actions`, `i18n-french-support`) avec `--sequence.shuffle` | **11 fichiers, 90 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0 src/renderer/components/FleetPeerSessionPanel.tsx tests/fleet-peer-session-panel-isolation.test.tsx` | Propre. |
| `tsc --noEmit -p tsconfig.json`, filtré sur `src/` | Aucune erreur dans `cowork/src`. |
| Prettier | Nouveau test conforme ; écarts restants du panneau tous sur des lignes JSX non modifiées. |
| `sha256sum` de `fleet-peer-panel.tsx`, `FleetRoutePreview.tsx`, `fleet-peer-freshness.tsx`, `main/index.ts`, `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts`, `fleet-peer-session-panel.test.tsx` | Identiques à la base du lot 8. |
| Build global | Non relancé. |

Empreintes à la livraison du lot 8 :

| Fichier | Delta lot 8 | SHA-256 |
| --- | --- | --- |
| `cowork/src/renderer/components/FleetPeerSessionPanel.tsx` | `useRef` ; `viewRef`, `isShownPeer`, `isShownSession`, `selectSession` ; gardes dans `refreshList`, `startSession`, `sendTurn`, `endSession` ; `setBusy(null)` et nettoyage dans l'effet de pair (329 lignes au total) | `83c6053d056a0eee77eac430d4cb220b4762cf43e7a204cb4a065dc6ef7bf987` |
| `cowork/tests/fleet-peer-session-panel-isolation.test.tsx` | nouveau, 230 lignes, 7 tests | `ab07affb4247f9d5c19cd1a630aa9526717a9adc30f5eaabe138597377ff9229` |

### Lot 7

| Commande | Résultat |
| --- | --- |
| `node node_modules/vitest/vitest.mjs run tests/fleet-route-preview-stale.test.tsx` sur la base lot 5 | **10 rouges** / 1 vert. |
| `… run tests/fleet-route-preview-stale.test.tsx tests/fleet-route-preview.test.tsx tests/fleet-freshness-choice.test.tsx` après correctif | **23/23 verts** (payload existant et Command Center complet du lot 5 compris). |
| 17 suites renderer Fleet voisines (dont `advanced-command-center`, `fleet-command-center-board`, `fleet-panel-connection`, `fleet-freshness*`, `i18n-french-support`) avec `--sequence.shuffle` | **17 fichiers, 131 tests verts**. |
| `node scripts/lint.cjs --max-warnings 0 src/renderer/components/FleetRoutePreview.tsx tests/fleet-route-preview-stale.test.tsx` | Propre. |
| `tsc --noEmit -p tsconfig.json`, filtré sur `src/` | Aucune erreur dans `cowork/src`. |
| Prettier | Nouveau test conforme ; `FleetRoutePreview.tsx` : seuls les 3 écarts antérieurs subsistent. |
| `sha256sum` de `FleetCommandCenter.tsx`, `fleet-peer-freshness.tsx` (gelé), `fleet-route-preview.test.tsx`, `fleet-freshness-choice.test.tsx`, locale `en`, `main/index.ts`, `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts` | Identiques à la base du lot 7. |
| Build global | Non relancé. |

Empreintes à la livraison du lot 7 :

| Fichier | Delta lot 7 | SHA-256 |
| --- | --- | --- |
| `cowork/src/renderer/components/FleetRoutePreview.tsx` | `useRef` ; `shown`/`pendingRequestKey`/`latestAttempt` ; `request`/`requestKey` ; vidage au rendu ; `runPreview` gardé ; `closePreview` (273 lignes au total) | `55d07d26177afc4b7be6f869c70ac9d99cb72f1921160f4413e6b6eb27a9f2a4` |
| `cowork/tests/fleet-route-preview-stale.test.tsx` | nouveau, 221 lignes, 11 tests | `ad190a2a448ead80eb1323c08ab917e0f21e4c907517db3a9f5811913075c8fe` |

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

## Limites du lot 8

- Pas d'Electron réel ni de pair réel : preuve par rendu DOM avec réponses différées, sans
  contenu réel.
- Deux rafraîchissements de liste concurrents pour le **même** pair (par exemple au démarrage
  puis au clic manuel) peuvent encore arriver dans le désordre ; la dernière réponse arrivée
  l'emporte. Aucun mélange entre pairs ni sessions ; non corrigé, faute de preuve d'impact.
- Une session démarrée pendant qu'une autre était rattachée n'est pas ouverte automatiquement :
  elle apparaît dans la liste et reste ouverte côté pair (aucune fermeture distante).
- Commande pour le pilote (lot 8 seul, après revue) :
  `git add cowork/src/renderer/components/FleetPeerSessionPanel.tsx
  cowork/tests/fleet-peer-session-panel-isolation.test.tsx docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md
  docs/FABLE5-CODEX-COORDINATION.md` puis
  `git commit -m "fix(cowork): keep peer session answers with their peer and session"`.

## Limites du lot 7

- Pas d'Electron réel : preuve par rendu DOM (happy-dom) avec promesses différées.
- Revenir exactement aux paramètres d'une route déjà retirée ne la fait pas réapparaître : l'état
  est vidé dès le premier écart (il faut relancer la prévisualisation).
- Ordre des pairs : la clé suit l'ordre du payload. Un même ensemble de pairs livré dans un autre
  ordre retirerait la route ; le Command Center conserve l'ordre d'insertion du store, ce n'est
  pas observé en pratique.
- Commande pour le pilote (lot 7 seul, après revue) :
  `git add cowork/src/renderer/components/FleetRoutePreview.tsx cowork/tests/fleet-route-preview-stale.test.tsx
  docs/reports/2026-09/AMELIORATION-COWORK-OPUS-2026-09-14.md docs/FABLE5-CODEX-COORDINATION.md`
  puis `git commit -m "fix(cowork): never show a route preview computed for other parameters"`.
  `FleetRoutePreview.tsx` porte aussi le lot 5, déjà en intégration.

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

### 03:01 — Mission 12 : fermer le circuit réel de l'arrêt du pont workflows (avant toute modification)

`main/index.ts` dégelé pour moi seul (fichier identique au primaire, vérifié par le pilote) ;
helpers lifecycle permis. Noyau d'orchestration et renderer gelés. Demandé :
- appeler `WorkflowBridge.shutdown()` dans la sortie normale et dans le chemin dev, sans créer
  de singleton, en préservant la fermeture Fleet, la découverte et le délai de 3 s du lot 6 ;
- un run demandé après l'arrêt est refusé tout de suite avec une erreur claire, au lieu
  d'attendre 5 min en file ;
- un arrêt pendant un `ensureOrchestrator` en cours ne réactive pas le dispatch ensuite.

Tests déterministes : vrai pont, imports du noyau factices et différés, câblage de `main`
vérifié par lecture de la source (Electron non lancé, aucune sortie réelle revendiquée).

Constats avant modification :
- `main` crée un seul `workflowBridge` au boot (`let workflowBridge: WorkflowBridge | null`,
  `new WorkflowBridge()` ligne 1906) ; aucune des deux sorties ne l'arrête ;
- `runTracked` ne teste pas `stopped` ;
- le boot différé appelle `orchestrator.start()` sans retester `stopped` ;
- `shutdown()` appelle `orchestrator.stop()` deux fois, doublon sans effet.

Base (SHA-256) :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/main/index.ts` (lot 6) | `d56399712af4e7d2a7f81115da6e48d75997032069e954a60621e3b2f935bcbc` |
| `cowork/src/main/workflows/workflow-bridge.ts` (mission 11 bis) | `65fe8155a9d2181f5fc455d3be64fb5d2414031a92be5e04a48d8c9416646571` |
| `cowork/src/main/fleet/fleet-bridge-lifecycle.ts` (lot 6) | `649ee14f09441c7dc5427e77e08c7c307e99f292b01c76b7698e24f36cbd60d6` |
| `cowork/tests/fleet-bridge-quit-lifecycle.test.ts` (lot 6) | `95cfee4c125e7f189d0ce4fd4e34eb1bd166d8bad4dfec2397228ed9fe7f8167` |
| `cowork/tests/workflow-bridge-late-confirmation.test.ts` (mission 11 bis) | `0eb16eb0aaadea4c2b2d2547ed5d00d566df34fde115148ff19d90b4cd3d9745` |
| `cowork/tests/workflow-bridge-late-task.test.ts` (mission 11 bis) | `b19818cc8c29bb0d09ee479917a15a7c44a591f1323061d1345e59fde1f9f924` |
| `cowork/src/main/workflows/cowork-tool-agent.ts` (mission 11) | `6837b1238f3da9a8e9f98e97d1887a9caeb5c12ec5c0ec1d6ecfdd92a15aa8cf` |
| `src/orchestration/orchestrator.ts` (gelé, lecture seule) | `3bc798506647b4297d9fa4a1a16cdb7dfa808e25a86f861e5ab2396b8f75f23d` |

### 02:56 — Mission 11, contre-relecture avant port (avant toute modification)

Points demandés :
- `isTaskActive` acceptait une tâche absente ou un statut `undefined` → exiger une activité
  prouvée ;
- le commentaire de `emitWorkflowEvent` est périmé ;
- auditer l'arrêt du pont pendant une confirmation en attente.

Noyau gelé (Codex y corrige les IDs partagés entre runs et la continuation des branches
parallèles), renderer gelé. Base : `workflow-bridge.ts` `ffc565ed…2744`,
`cowork-tool-agent.ts` `6837b123…a8cf`, `workflow-bridge-late-confirmation.test.ts`
`fc1c4ae0…f026`, `workflow-bridge-late-task.test.ts` `27c41207…82e2`. Constat préalable :
`WorkflowBridge.shutdown()` n'est appelé nulle part dans `cowork/src/main`.

### 02:36 — Mission 10 : tâches abandonnées du vrai Orchestrator (avant toute modification)

**Correction d'une affirmation de la mission 9.** J'avais écrit « le noyau refuse ce cas
(`task.status !== 'assigned'`, ligne 278) ». C'est faux : la ligne 278 appartient à
`startTask`. Lu sur le vrai `src/orchestration/orchestrator.ts` (SHA-256
`9b521c648533afbae51b65f64843b76421dcdb859bb18e5e59d4f7c11621d265`) :
- `completeTask` (288-318) passe la tâche en `completed` sans condition, incrémente les stats,
  libère l'agent sans vérifier `agent.currentTask` et relance `processQueue` ;
- `failTask` (323-370) fait de même, avec en plus une remise en file selon les retries ;
- `waitForTask`, à l'expiration (765-770), rejette sans toucher la tâche, qui reste `queued`
  ou `in_progress` avec son agent `busy`.

Mission autorisée : core + pont/tool-agent Cowork, avec reproduction sur le **vrai**
Orchestrator et un exécuteur factice. Au plus un défaut cohérent. Base :
`workflow-bridge.ts` `78048050…474c`, `cowork-tool-agent.ts` `a4ba848b…751c`.

### 02:30 — Mission 9 : audit du pont workflows (avant toute modification)

Lot 8 bis copié et gelé, revue indépendante en cours ; quota hebdomadaire presque épuisé
(98 % selon le pilote). Cible : `cowork/src/main/workflows/workflow-bridge.ts`
(821 lignes, SHA-256 `960d4123860f4ba90a2de3f0b8e8c724a5fec16623b4f237e7c488629cd8c540`).
Défauts à chercher :
- workflow annulé qui continue à dispatcher ;
- callback tardif qui repeuple un run terminé ;
- listeners non nettoyés ;
- mélange `instanceId`/`workflowId`.

Anciens correctifs `queueTask` et ordre des listeners à ne pas réintroduire. Au plus un défaut
corrigé, dans le pont et ses tests, sans rien lancer de réel.

### 02:30 env. — Lot 8, reprise après revue pilote (avant toute modification)

Deux résidus signalés par la revue, à reproduire avant correction :
1. L'effet de changement de pair ne vide pas `sessions` : les lignes du pair A restent cliquables
   pendant `list(B)`, et l'envoi suivant part vers B avec la session de A.
2. `viewRef` ne compare que `peerId`/`sessionId` : un aller-retour A→B→A accepte la réponse
   de l'ancienne vue A et libère `busy` d'une opération plus récente.

Garder à l'esprit StrictMode (cleanup puis remontage) et la re-sélection de la même session.
Même périmètre : 2 fichiers et le rapport. Quota annoncé par le pilote : 2 % restants. La
première version du lot 8, copiée en primaire sans commit, sera remplacée.

### 02:18 — Lot 8 : audit des sessions multi-tours de pair (avant toute modification)

Lot 7 copié et gelé en revue pilote. En intégration, la revue du lot 6 a ajouté des gardes
`stopped` à `init`/`addPeer` et trois tests (47 verts sous Node 20/24) : non recopiés ici.
Objectif : chercher et reproduire un vrai mélange entre pairs ou sessions dans
`FleetPeerSessionPanel` et ses hooks (changement de pair pendant list/start/continue/end,
réponse retardée, démontage, session terminée) ; corriger seulement sur preuve, sans fermer
automatiquement une session distante ni créer d'action réseau non demandée. Si rien n'est
trouvé : rapporter périmètre et lacunes.

Base (SHA-256) :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/renderer/components/FleetPeerSessionPanel.tsx` (= HEAD) | `fced1e4071ea99a32f6176d488131c9da0a0be022a05764c59ab0527f9987937` |
| `cowork/tests/fleet-peer-session-panel.test.tsx` (= HEAD) | `91b63eabe37fef0442b621ac70b266a83d381368f49dddf5e7f3b0386593902a` |
| `cowork/src/renderer/components/fleet-peer-panel.tsx` (lot 4, gelé) | `39509a46d25450c4dffa6bb8ec8ed4e28c8abc52a2990c6357afa113057ac0ad` |
| `FleetRoutePreview.tsx` (lot 7), `fleet-peer-freshness.tsx` (lot 5), `main/index.ts`, `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts` (lot 6), tous gelés | `55d07d26…f2a4`, `cd8f73b5…3f43`, `d5639971…bcbc`, `11760ffe…139e`, `649ee14f…60d6` |

### 02:13 — Lot 7 : aperçu de route périmé dans `FleetRoutePreview` (avant toute modification)

Lot 6 copié et gelé pour revue Codex. En intégration, Codex a remplacé la jointure par saut de
ligne de `useSilentPeerIds` par `JSON.stringify`/`parse` (preuve rouge → vert, id persisté
contenant un saut de ligne). Ce fichier reste gelé ici, non recopié. Le renderer du lot 5 est
passé sur Chromium réel ; build et typecheck primaires verts. Question : un résultat
`routePreview` reste-t-il affiché comme route actuelle quand le parent change les paramètres
pendant l'`await` ou après ? Si oui, corriger l'invalidation. Contraintes :
- aucune requête automatique, aucun changement de l'algorithme ni du payload de routage ;
- conserver la route sur un simple changement de fraîcheur ou de `peersById`.

Base (SHA-256) :

| Fichier | SHA-256 |
| --- | --- |
| `cowork/src/renderer/components/FleetRoutePreview.tsx` (lot 5) | `c558f7ffe59930822cb0db92a4cdee1c08beec78e06ef57243b01cdc4980f8db` |
| `cowork/src/renderer/components/FleetCommandCenter.tsx` (lot 5, lecture seule ici) | `6577f700f26c2eab5a6f7a74abca6139b307fb1c2caeeff3d056e679bd151cbb` |
| `cowork/src/renderer/components/fleet-peer-freshness.tsx` (gelé) | `cd8f73b56d0411b58bcde5c0733c3cc67e2ea4f687466fbaf28a1d5f95543f43` |
| `cowork/tests/fleet-route-preview.test.tsx` (= HEAD) | `f81bdf3c2cb26186bd66d7df502ecd88b48e388bc36e6384392f3d87a6f6c3bf` |
| `cowork/tests/fleet-freshness-choice.test.tsx` (lot 5) | `a2aeacfed4dfb0325dc7ea489967522e9c6669c23108a0ceca0aa109ae3f0c71` |
| `main/index.ts`, `fleet-bridge.ts`, `fleet-bridge-lifecycle.ts` (lot 6, interdits) | `d5639971…bcbc`, `11760ffe…139e`, `649ee14f…60d6` |

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

### Complément pilote fermeture et route périmée

La revue fermeture a reproduit puis corrigé trois courses supplémentaires :
ajout après arrêt, arrêt pendant sauvegarde et lecture du registre après arrêt.
Les 47 tests bridge/lifecycle passent sous Node 20 et 24 ; l'écriture déjà lancée
peut rester durable pour le prochain démarrage, sans événement ni connexion tardive.
Cette correction est dans `bd1c23721`.

Lot 7 porté sélectivement : 24 tests route/fraîcheur passent, TypeScript et build
Vite complet passent. Revue indépendante sans défaut bloqueur : les paramètres
sont comparés par valeur et une réponse ancienne ne remplace pas la nouvelle.
Les appels IPC obsolètes ne sont pas annulés côté main ; leurs résultats ne sont
pas affichés pour d'autres paramètres.

### Contre-validation finale sessions et historique workflows

Sessions : après les deux livraisons Opus, la revue a reproduit trois cas encore
ouvert : état ancien au commit du nouveau pair, brouillon conservé lors d'un
changement de session et nouveau brouillon effacé par la réponse précédente.
La vue est désormais remontée avec une clé de pair ; sélectionner une session
réinitialise le brouillon ; une réponse préserve un brouillon modifié entre-temps.
Les 20 tests du panneau passent sous Node 20 et 24, lint et TypeScript sont verts.
Le build Vite complet passe. La QA Chromium réelle confirme les parcours A/B,
les réponses/listes tardives, le brouillon pendant envoi et son effacement au
changement de session : `/tmp/cb-fleet-sessions-browser-qa.json`. IPC de fixture,
aucun Electron ou pair réel. Les brouillons ne sont pas persistés par session.

Workflows : 44 tests de six suites passent. Le test de la course vérifie aussi
explicitement que le renderer reçoit le `node_completed` tardif de l'ancienne
instance, tandis que l'historique du nouveau run ne contient que sa propre
instance. La revue confirme la capture du démarrage avant l'émetteur et le
stockage du résultat final avant remise à zéro de `currentRun`.
Cette preuve de persistance utilise un ordonnanceur simulé et ne vaut pas
validation du traitement d'un timeout par le noyau réel.

### Contre-validation noyau : reprise du même workflow

La contre-relecture a reproduit deux lacunes du lot 10 : un résultat de l'ancienne exécution modifiait la tâche homonyme du nouveau run ; une branche parallèle créait une étape après l'échec du run. Codex les corrige par des identités runtime propres à chaque exécution et occurrence, et par des gardes avant les étapes, créations, itérations et publications de boucle. Les alias `task_<nom logique>`, `aliasAs` et les dépendances logiques sont conservés. Les consommateurs de `task_assigned` doivent transmettre l'identifiant runtime reçu à `getTask`, `completeTask` et `failTask`.

`cancelTask` est idempotent pour une tâche terminale. Le registre global garde sa borne `maxTasks` : sous pression, seuls les terminaux qui ne sont plus attendus par une exécution ou une dépendance active peuvent être retirés. Le worker d'une tâche abandonnée reste réservé jusqu'à son rapport tardif.

Vérifications : 48 tests orchestration et 45 tests Cowork passent sous Node 20 et 24 ; lint ciblé, typecheck noyau et Cowork passent. Les nouveaux tests couvrent notamment replay, continuation parallèle, dépendance en avant, sorties, boucle et capacité après résultat tardif. La validation complète est lancée séparément.

Limites conservées : aucune annulation d'un effet externe déjà parti ; pas d'identité distincte entre les tentatives retry d'une même tâche ; dans un batch concurrent, une dépendance logique répétée vise la dernière occurrence créée dans l'instance. Les historiques d'instances restent conservés comme avant.

Validation complète du noyau après intégration : `npm run validate` avec HOME/XDG temporaires et sans configuration fournisseur héritée termine avec **38 550 tests verts, 37 ignorés et 1 todo** (2 151 fichiers verts, 9 ignorés), lint sans erreur, typechecks et paquet verts. Le passage précédent dans l'environnement utilisateur avait 11 échecs sur trois fichiers lisant l'état local ; ils disparaissent dans le profil isolé. Revue indépendante finale favorable. Les tests ciblés workflows sous Node 20 ont aussi vérifié les confirmations tardives avec le noyau corrigé.

### Contre-validation du raccordement de fermeture

Le lot 12 est porté avec le noyau `2120d48d8` : neuf suites fermeture/workflows passent sous Node 20 (70 tests). Une revue supplémentaire a corrigé le replay expurgé qui écrivait encore dans l'historique après arrêt : le garde de `replay()` précède maintenant toute lecture/écriture. Le test reproduit le rouge avant correction, puis six suites (27 tests) passent sous Node 20 et 24. Le typecheck Cowork, le lint ciblé et `npm run validate -- tests/security/donnees-personnelles.test.ts` passent. Aucun arrêt Electron réel n'est revendiqué : le câblage est vérifié sur la source et le cycle de vie sur le pont.
