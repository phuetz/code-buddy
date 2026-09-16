> **STATUT : SOLDÉ.** Re-vérifié ligne à ligne le 2026-09-01 contre le code de `main` :
> **les 8 constats CRITIQUE + ÉLEVÉ (#1-#8) sont tous corrigés.** Preuves :
>
> | # | Constat | Preuve de la correction (état au 2026-09-01) |
> |---|---|---|
> | 1 | Gateway WS auto-auth + pas d'Origin | `gateway.ts` : `handleWSConnection` rejette une Origin non fiable (`isTrustedWebSocketOrigin`) ; `tokensMatch` utilise `crypto.timingSafeEqual` ; `handleWSClientMessage` passe `checkAuthorization()` pour tout mode non-`token` |
> | 2 | `revertHunks` path traversal | `diff-ipc.ts` : double `fs.realpath` + `relative()` fail-closed hors racine du workspace |
> | 3 | `second-instance` mainWindow périmé | `index.ts:786` appelle `setMainWindow(existingWindow)` |
> | 4 | `remoteSessionIds` jamais purgé | `remote-manager.ts:1050` : `this.remoteSessionIds.delete(sessionId)` dans `clearSessionBuffer` |
> | 5 | Import de session hors transaction | `session-manager.ts` : la boucle d'INSERT est enveloppée dans `this.db.raw.transaction(...)` |
> | 6 | `global-search` parcours synchrone | `global-search-service.ts:436` : `await fs.promises.readdir(...)` |
> | 7 | `traceSteps` non plafonné | `store/index.ts:1506` : `.slice(-TRACE_STEP_CAP)` |
> | 8 | `JSON.stringify` sur le chemin chaud | plus aucune occurrence dans `useIPC.ts` |
>
> Le document est conservé pour la trace de l'audit et **pour éviter de re-chasser ces défauts**.
> Les constats MOYEN / FAIBLE ci-dessous n'ont PAS été re-vérifiés : les traiter comme des pistes
> à confirmer, pas comme des faits.

# Audit Cowork — 2026-08-30

Audit multi-angles de `cowork/src/` (5 passes parallèles : sécurité/IPC, sessions/permissions, IPC main→renderer/fenêtres, gestion d'erreurs, performance/fuites). Les trois trouvailles les plus graves ont été **vérifiées à la main** (✓ CONFIRMÉ) ; les autres sont issues de l'audit et plausibles — **à confirmer avant correctif**.

> Bilan global : le main est **bien défendu** (backstops `unhandledRejection`/`uncaughtException`, path-containment fail-closed, `webPreferences` durcis, webhooks à signature vérifiée). Les défauts ci-dessous sont réels mais ciblés.

---

## 🔴 CRITIQUE

**1. Gateway WebSocket : auto-authentification sans jeton + aucun contrôle d'Origin** — ✓ CONFIRMÉ
`cowork/src/main/remote/gateway.ts:771` (+ `:665`, `message-router.ts:116`)
En mode d'auth **non-`token`** (allowlist / pairing), la branche `else` fait `client.authenticated = true` **sans jeton**. Le handshake WS (`handleWSConnection`, l.665) **ignore l'Origin** (`_req` non lu). `routeMessage` ne fait aucune vérif d'autorisation sur le chemin WS.
- **Scénario :** gateway activée en mode allowlist/pairing → un site web visité ouvre une WS cross-origin vers `ws://127.0.0.1:<port>/ws`, s'auto-authentifie et pilote l'agent (accès outils). Aggravé si `tunnelManager` expose l'endpoint publiquement.
- **Correctif :** exiger un jeton dans **tous** les modes ; **rejeter le handshake si l'`Origin` n'est pas de confiance** ; vérifier `sender.id` contre l'allowlist sur le chemin WS.
- **Portée :** conditionné à la gateway activée + mode non-token — mais défense faillie dès que c'est le cas.

---

## 🟠 ÉLEVÉ

**2. `diff.revertHunks` — écriture d'un chemin absolu arbitraire (path traversal)** — ✓ CONFIRMÉ
`cowork/src/main/ipc/diff-ipc.ts:29` → `diff/hunk-diff-service.ts:157`
Le handler IPC accepte un `filePath` du renderer (vérifie seulement « truthy »), puis `fs.writeFileSync(filePath, …)` **sans realpath, sans confinement au workspace, sans confirmation**.
- **Scénario :** renderer compromis (XSS via sortie modèle rendue / contenu web) → écrase `~/.bashrc`, `~/.ssh/authorized_keys`, etc.
- **Correctif :** realpath + refuser (fail-closed) tout chemin hors de la racine du workspace actif.

**3. `second-instance` réassigne `mainWindow` sans `setMainWindow()`** — ✓ CONFIRMÉ
`cowork/src/main/index.ts:783`
Même classe que la régression rc.8 « dual-mainWindow » : la copie de `window-management.ts` (lue par `getMainWindow()` dans `sendToRenderer`) reste périmée → les push main→renderer (`stream.message`, `session.status`, `trace.step`…) sont **silencieusement perdus**.
- **Scénario :** fenêtre fermée puis 2ᵉ instance lancée avec une autre BrowserWindow vivante → l'utilisateur voit une fenêtre mais le chat cesse de streamer.
- **Correctif :** appeler `setMainWindow(existingWindow)` juste après la réassignation.

**4. Sessions distantes cassées après le 1er tour**
`cowork/src/main/remote/remote-manager.ts:1226` (+ `1046-1057`)
`clearSessionBuffer` (appelé à chaque `idle`) efface les mappings mais **jamais** `remoteSessionIds` → au 2ᵉ tour `isNewSession=false` mais mapping absent → `throw "No actual session ID found"`. L'utilisateur distant ne peut plus enchaîner ; le Set fuit.
- **Correctif :** `remoteSessionIds.delete(sessionId)` dans `clearSessionBuffer`, ou ne pas vider les buffers sur `idle` (réserver à la fin réelle de session).

**5. `importExternalSession` : boucle d'INSERT hors transaction → gel UI**
`cowork/src/main/session/session-manager.ts:1171`
N messages = N INSERT autonomes (chacun avec fsync) sur le thread main → gel de plusieurs secondes à l'import d'un gros transcript.
- **Correctif :** envelopper dans `this.db.raw.transaction(() => …)()` (comme `duplicateSession`/`replaceMessages`).

**6. `global-search` : parcours `readdirSync`/`statSync` synchrone sur le thread main**
`cowork/src/main/search/global-search-service.ts:427`
Chaque Cmd+P (débouncé) traverse tout l'arbre du workspace en synchrone avant d'atteindre `limit` → gel du main sur un gros repo. *(Ne suit pas les symlinks — pas d'ELOOP ici, mais blocage réel.)*
- **Correctif :** `fs.promises.readdir` async avec yield, ou index/cache de l'arbre.

**7. `addTraceStep` : tableau non plafonné**
`cowork/src/renderer/store/index.ts:1505`
`traceSteps: [...ss.traceSteps, step]` sans trim (contrairement aux buffers frères) → croissance illimitée sur une longue session autonome + re-render de tous les consommateurs.
- **Correctif :** plafonner en queue (`slice(-TRACE_STEP_CAP)`).

**8. Chemin chaud : `console.log(JSON.stringify(payload))` par message stream**
`cowork/src/renderer/hooks/useIPC.ts:244` (+ `:189`)
Sérialise tout le contenu (multi-blocs) à chaque `stream.message` → pression GC, rendu qui saccade sur les tours bavards.
- **Correctif :** supprimer / gater derrière un flag debug ; jamais `JSON.stringify` sur le chemin chaud.

---

## 🟡 MOYEN (issus de l'audit — à confirmer)

- `nav-server.ts:67` — serveur HTTP loopback non authentifié → `executeJavaScript` par CSRF (impact borné à la navigation whitelistée). Exiger jeton/Origin.
- `gateway.ts:756` — comparaison de jeton non constant-time (`===`) ; utiliser `crypto.timingSafeEqual`.
- `window-management.ts:157-278` — **duplicat MORT** de `createWindow`/thème qui réassigne `mainWindow` sans `setMainWindow` : « loaded gun » de la classe dual-mainWindow. À supprimer (garder un pur ref-holder).
- `index.ts:1131` — raccourci global panic-stop (re)enregistré à chaque `focus`, fuite si fenêtre détruite en focus. Enregistrer une fois à la création.
- `preload/index.ts:465` — chaque panel ajoute son `ipcRenderer.on('server-event')` non filtré → `MaxListenersExceededWarning` + fan-out. Dispatcher unique par type.
- `media-library.ts:168` (+ `creative-asset-registry.ts:115`) — scan média `statSync` + `readFileSync`+`JSON.parse` du sidecar par fichier, synchrone, à chaque `media.list`. Async/lots.
- `memory-manager.ts:96` (+ `project-evolution.ts:529`) — `searchMessages` charge TOUT l'historique sans LIMIT puis filtre en JS. Router vers FTS + LIMIT.
- `presence-bridge.ts:186` — tête « unknown » émet un event + cycle disque (mkdir+write+rename) toutes les ~3 s sans dédup. Throttle/dédup.
- `activity-feed.ts:112` — `record()` re-prepare l'INSERT + exécute un DELETE de rognage à chaque appel sur des chemins fréquents. Préparer une fois, rogner périodiquement.
- `session-manager.ts:2531` — `JSON.parse(row.token_usage/metadata)` non protégé par ligne : une ligne corrompue casse tout le chargement d'historique. `safeParse` par ligne.
- `sandbox-adapter.ts:447` — repli **silencieux** vers exécution native (non-sandboxée) si pas de fenêtre, sans consentement. N'autoriser que derrière un flag explicite. *(Blocklist native conservée = isolation dégradée, pas contournement total.)*
- `session-manager.ts:2165` — `stopSession` ne congédie pas les modales d'autorisation d'outil en cours → modale fantôme sur un tour annulé. Émettre `permission.dismiss`.
- `session-manager.ts:865` + `index.ts:2230` — sessions **arrière-plan / voix / planifiées** sans `permissionMode` (toujours `default`) : **même classe que le bug studio corrigé** → une mission autonome qui écrit bloque sur une confirmation que personne ne voit. Threader `permissionMode` (ou documenter le choix).
- `ipc-main-bridge.ts:74` — confirmation **perdue** si aucune fenêtre vivante (session arrière-plan, fenêtre en tray). Mettre en file + rejouer, ou refuser explicitement.
- `remote-manager.ts:1202` — double création de session distante (TOCTOU : lecture avant l'`await startSession`, `add` après). Marquer `remoteSessionIds.add` avant l'await.

## ⚪ FAIBLE

- `session-manager.ts:1345` — `steerSession` ne propage pas `permissionModeOverride` (latent : les studios persistent le mode).
- `session-manager.ts:2892` — chemin d'autorisation MORT (`requestPermission`/`pendingPermissions`, timeout 60 s) sans appelant ; commentaire « 90 s » incohérent avec le vrai chemin (330 s). Supprimer ou rebrancher.
- `index.ts:3012` — `memoryProvider.setActive` renvoie `success:true` même si le registre live échoue (succès mensonger jusqu'au redémarrage).
- `ipc/channels-ipc.ts:420` — `removeChannel` avale l'échec de suppression du secret → token orphelin, non signalé.
- `updater.ts` / `codebuddy/session-bridge.ts` — capturent une `mainWindow` fixe (latent, non câblés) ; résoudre `getMainWindow()` par event.

---

## Déjà bien défendu (vérifié — pour calibrer)
`webPreferences` durcis (`nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `will-attach-webview` forcé) · permission handlers vérifiant `webContents.id` · `shell.openExternal` validant le protocole · `git-bridge`/`spec-next` sans shell (`execFile`/`spawn`) · path-containment fail-closed (lexical + symlink) · webhooks Slack/Feishu à signature constant-time vérifiée AVANT parse · `workspace.readDir` bloque `..`/null-byte · `sendToRenderer` garde `isDestroyed()` · `workflow-bridge` (prependListener + removeListener + queueMicrotask) correct · propagation start→continue du nouveau `permissionMode` **correcte de bout en bout**.

## Ordre de correctif recommandé
1. **#1 gateway** (jeton obligatoire + contrôle d'Origin) — surface d'attaque réseau.
2. **#2 revertHunks** (confinement workspace) — écriture arbitraire.
3. **#3 second-instance + duplicat mort window-management** — fiabilité du streaming.
4. **#4 sessions distantes** + **#5/#6 gels synchrones** (transaction + async walk).
5. Le reste par lots (MOYEN perf/permissions), en réutilisant le patron `permissionMode` déjà en place.

*Audit exécuté par 5 sous-agents en parallèle ; trouvailles CRITIQUE/ÉLEVÉ #1-#3 confirmées à la lecture du code par l'orchestrateur.*
