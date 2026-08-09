# Portage Fleet saturation/rétention depuis l'audit de juillet

**Date :** 9 août 2026
**Branche :** `codex/portage-fleet-saturation-july-2026`
**Source examinée :** `AUDIT-FINDINGS.md` de l'audit Fleet du 2 août 2026
**Base avant portage :** `origin/main` à `f9a31a7e`
**Méthode :** réécriture ciblée, aucun cherry-pick, merge, changement de branche ou push

## Résultat

Sur les onze constats, huit défauts actifs et encore absents de la base ont été
portés. Trois constats de cycle de vie n'ont volontairement pas été dupliqués :
ils appartiennent au lot Fleet lifecycle déjà livré sur
`codex/portage-fleet-lifecycle-july-2026` par `5d0e1589`, corrigé par
`49c67a1b`, puis complété à son tip `1ee2ca96`.

| Nº | Constat | Décision | Commit / preuve |
|---:|---|---|---|
| 1 | Sweep d'inactivité ignorant les pong | **ÉCARTÉ** | Déjà traité dans le lot lifecycle par `5d0e1589`, avec garde des connexions authentifiées dans `49c67a1b`. |
| 2 | `peer:request` sans rate-limit ni saturation | **PORTÉ** | `99f4e9ee` |
| 3 | Requêtes `FleetListener` en vol non rejetées au drop | **ÉCARTÉ** | Déjà traité par `5d0e1589`. |
| 4 | `dispatchedTasks` sans borne | **PORTÉ** | `8aad0e1b` |
| 5 | Réponses Council Fleet non sanitizées | **PORTÉ** | `2dc1c068` |
| 6 | Sérialisation de toutes les RPC d'une connexion | **PORTÉ** | `afd825be`, puis lanes bornées par `1358107a` |
| 7 | `ModelScoreboard` O(N) et `statSync` par lookup | **PORTÉ** | `ba2d1efc` |
| 8 | `selectFastestModel()` recalcule les rankings par candidat | **PORTÉ** | `ba2d1efc` |
| 9 | Scopes loopback no-auth incohérents | **PORTÉ** | `35f94632` |
| 10 | Probes de capacités concurrentes non dédupliquées | **PORTÉ** | `d1ff7e74` |
| 11 | Trou de test du cycle de vie transport | **ÉCARTÉ** | Couverture déjà livrée par `5d0e1589`; le chunk tardif était déjà ignoré dans la base. |

Les chemins portés sont bien branchés en production : `buddy server` monte
`setupWebSocket()` dans `src/server/index.ts:1171-1177`, puis câble
`peer.chat`, `peer.chat-stream` et les sessions dans
`src/server/index.ts:1218-1263`. `peer.describe` appelle réellement
`getLocalCapabilities()` dans `src/server/websocket/peer-rpc.ts:155-190`.
Le Council appelle `gatherPeerAnswers()` dans
`src/council/council-engine.ts:235-250`, et le sélecteur de modèle est consommé
par le triage Council (`src/council/triage.ts:106-115`) comme par le chemin voix
(`src/sensory/agent-reply.ts:252-262`). Aucun code mort n'a été durci.

## Constats écartés sans double portage

### 1 — sweep d'inactivité et pong : ÉCARTÉ

La base `f9a31a7e` n'intègre pas encore le lot lifecycle : même après ce lot
isolé, `src/server/websocket/handler.ts:1242-1280` ne contient pas de handler
`pong`, et le sweep s'appuie encore sur `lastActivity`. Le correctif ne doit
cependant pas être recréé ici :

- `5d0e1589:src/server/websocket/handler.ts:1133-1153` ajoute le pong et le test
  d'écouteur passif ;
- `49c67a1b:src/server/websocket/handler.ts:1140-1176` ajoute la garde
  `if (!state.authenticated) return` et la deadline d'authentification, évitant
  la réserve majeure découverte lors de la revue du premier lot ;
- `5d0e1589:tests/server/websocket-lifecycle.test.ts:74-98` couvre à la fois la
  survie avec pong et la fermeture sans pong.

Décision : dépendre explicitement du lot lifecycle précédent, au lieu de créer
un second patch conflictuel sur le même handler.

### 3 — rejet des requêtes en vol au drop : ÉCARTÉ

La base expose encore l'écart : le callback `close` de
`src/fleet/fleet-listener.ts:301-330` n'appelle pas
`rejectPendingRequests()`, bien que la méthode existe à
`src/fleet/fleet-listener.ts:843-857`. Le portage antérieur `5d0e1589` ajoute
exactement cet appel à `src/fleet/fleet-listener.ts:301-312` et son test de
drop réel à `tests/server/websocket-lifecycle.test.ts:100-153`.

Décision : ne pas dupliquer un correctif déjà livré et destiné à être intégré
avec le lot lifecycle.

### 11 — couverture du cycle de vie transport : ÉCARTÉ

Le fichier `tests/server/websocket-lifecycle.test.ts` n'est pas encore dans
`origin/main`, mais il est déjà créé par `5d0e1589` et couvre les deux invariants
ci-dessus. Le troisième invariant est cohérent avec le code courant : un
`peer:chunk` sans pending est ignoré sans throw dans
`src/fleet/fleet-listener.ts:406-423`; le test dédié est déjà présent dans le
lot précédent à
`5d0e1589:tests/fleet/fleet-listener.test.ts:1062-1075`.

Décision : le trou de test appartient au même commit lifecycle que les
correctifs qu'il verrouille. Le recopier dans ce lot recréerait les mêmes
fichiers et les mêmes conflits d'intégration.

## Constats portés et preuves rouge → vert

### 2 — rate-limit et backpressure de saturation : PORTÉ (`99f4e9ee`)

Le handler maintient maintenant un compteur de 30 RPC/minute par connexion
(`src/server/websocket/handler.ts:34-40`, `67-68`, `992-1012`) et répond avec
un `peer:response` corrélé `RATE_LIMITED`, afin de vider le pending côté
appelant. Les trois entrées LLM vérifient la capacité déclarée avant de lancer
du travail : `peer.chat`/`peer.chat-stream` dans
`src/fleet/peer-chat-bridge.ts:68-72`, `202-219` et `peer.dispatch` dans
`src/server/websocket/peer-rpc.ts:209-231`. Le dispatcher préserve le code
`SATURATED` à `src/server/websocket/peer-rpc.ts:385-398`.

Tests :

```text
npx vitest run tests/server/websocket-peer-security.test.ts
ROUGE : 1 test exécuté, 1 échec — la 31e requête a résolu avec { pong: true }
        au lieu de rejeter RATE_LIMITED.
VERT  : 1 fichier réussi, 1/1 test réussi.

npx vitest run tests/server/peer-chat-bridge.test.ts \
  -t "rejects chat, stream, and dispatch with SATURATED"
ROUGE : 1 test exécuté, 1 échec — peer.dispatch a répondu ok:true alors que
        CODEBUDDY_FLEET_MAX_CONCURRENCY=1 et qu'un chat occupait la capacité.
VERT  : 1 test réussi, 22 ignorés par le filtre.
```

Deux assertions déjà périmées du même fichier de test ont été alignées sur le
code présent dans la base : `executeCostCappedFleetCall()` injectait déjà
`maxTokens: 4096`, alors que les assertions attendaient encore `undefined`.
Aucun comportement de coût n'a été modifié par ce lot.

### 4 — rétention bornée de `peer.dispatch` : PORTÉ (`8aad0e1b`)

`src/fleet/peer-chat-bridge.ts:406-455` fixe une TTL par défaut de 30 minutes,
configurable par `CODEBUDDY_PEER_DISPATCH_TTL_MS`, et un plafond dur de 500
entrées. À chaque nouveau dispatch, les terminés expirés sont purgés puis les
terminés les plus anciens sont évincés en priorité
(`src/fleet/peer-chat-bridge.ts:463-493`). `peer.dispatchStatus` conserve son
contrat `{ found: false }` pour une entrée purgée.

```text
npx vitest run tests/fleet/peer-dispatch-retention.test.ts
ROUGE : 2/2 échecs — longueur reçue 600 au lieu de 500 ; l'entrée âgée de
        101 ms survivait à une TTL de 100 ms.
VERT  : 1 fichier réussi, 2/2 tests réussis.
```

### 5 — sanitation des réponses Council Fleet : PORTÉ (`2dc1c068`)

La sanitation est faite au point d'entrée partagé
`src/council/peers.ts:7-34`, avant que la réponse ne rejoigne le juge, le
consensus ou la synthèse dans `src/council/council-engine.ts:235-297`. Une
réponse vidée par le sanitizer devient une erreur `réponse vide`, comme sur la
voie locale.

```text
npx vitest run tests/fleet/fleet-council-peers.test.ts -t "sanitiz|emptied"
ROUGE : 2/2 échecs — <think> arrivait intact ; une réponse reasoning-only
        restait comptée comme réponse.
VERT  : tests/fleet/fleet-council-peers.test.ts et
        tests/council/council-engine.test.ts : 19/19 tests réussis.
```

### 6 — multiplexage RPC par connexion : PORTÉ (`afd825be`, `1358107a`)

Les messages ordinaires restent sériels. Seuls les `peer:request` passent par
un ordonnanceur borné à trois exécutions et 200 pending par connexion
(`src/server/websocket/handler.ts:69-91`, `426-473`). Le dispatch utilise trois
lanes stables réutilisées par connexion, plutôt qu'une lane unique par request
id, pour ne pas transformer le multiplexage en nouvelle fuite de rétention.
Le chemin se trouve à `src/server/websocket/handler.ts:1109-1138`; tout refus
ou timeout produit un `peer:response` corrélé `HANDLER_ERROR`. Les tâches
encore en file sont rejetées à la fermeture (`src/server/websocket/handler.ts:1246-1258`).

```text
npx vitest run tests/server/websocket-peer-multiplex.test.ts
ROUGE : 1 échec — une seule RPC avait démarré (reçu 1, attendu 2) avant la
        libération du premier handler.
VERT  : 1 fichier réussi, 1/1 test réussi.
```

### 7 — index et reload du `ModelScoreboard` : PORTÉ (`ba2d1efc`)

Le chargement construit trois index en mémoire à
`src/fleet/model-scoreboard.ts:101-173`; `runsFor()`, `roleScore()` et
`consecutiveRecentFailures()` les consomment à
`src/fleet/model-scoreboard.ts:252-254`, `303-313` et `322-331`. Le contrôle
de mtime est limité à une fois toutes les 250 ms
(`src/fleet/model-scoreboard.ts:97-140`), tandis qu'une écriture force d'abord
un reload pour ne jamais masquer l'append d'un autre processus
(`src/fleet/model-scoreboard.ts:233-244`). Enfin, le conducteur précompute les
scores rôle × candidat avant les permutations
(`src/council/conductor.ts:53-60`).

```text
npx vitest run tests/council/conductor-performance.test.ts
ROUGE : roleScore appelé 4 326 fois au lieu de 36.
VERT  : 1/1 test réussi.

npx vitest run tests/fleet/model-scoreboard.test.ts \
  -t "throttled reload-check window|reloads before writes"
ROUGE : le lecteur voyait l'append immédiatement (reçu 1, attendu 0), preuve
        que chaque lookup refaisait encore statSync/reload.
VERT  : 2 tests réussis, 20 ignorés par le filtre.
```

### 8 — rankings de latence calculés une seule fois : PORTÉ (`ba2d1efc`)

`selectFastestModel()` construit une seule map task-scoped et une seule map
globale avant de parcourir les candidats (`src/fleet/model-selector.ts:192-228`).
Le résultat et les règles de repli restent inchangés.

```text
npx vitest run tests/fleet/model-selector.test.ts \
  -t "builds scoped and global latency rankings only once"
ROUGE : ranking() appelé 6 fois pour 3 candidats, attendu 2.
VERT  : 1 test réussi, 9 ignorés par le filtre.
```

### 9 — scopes no-auth loopback : PORTÉ (`35f94632`)

La décision loopback continue d'utiliser `isDirectLoopbackRequest()` et refuse
donc de faire confiance aux en-têtes de proxy. Seule une connexion directe
reçoit désormais `tools:execute`, `fleet:listen` et `peer:invoke`
(`src/server/websocket/handler.ts:1181-1210`). Le greeting documente les scopes
accordés (`src/server/websocket/handler.ts:300-328`, `1231-1240`). Une connexion
simulée distante/proxy conserve le jeu restreint.

```text
npx vitest run tests/server/connected-greeting.test.ts -t "documents scopes"
ROUGE : payload.scopes était undefined.
VERT  : test réussi.

npx vitest run tests/server/websocket-no-auth-scopes.test.ts
ROUGE : le greeting loopback ne contenait aucun scope et aucun broadcast Fleet
        ne pouvait lui être livré.
VERT  : 1/1 test réussi ; le client direct reçoit l'événement, le client avec
        x-forwarded-for ne le reçoit pas.
```

### 10 — déduplication des probes de capacités : PORTÉ (`d1ff7e74`)

La promesse de construction en vol est partagée à
`src/fleet/capability-registry.ts:41-84`. Le cache n'est publié qu'à la fin de
la construction, `lastRefreshAt` reflète cette fin, et `finally` libère la
promesse même en cas d'erreur. Le chemin est actif depuis `peer.describe`
(`src/server/websocket/peer-rpc.ts:155-176`).

```text
npx vitest run tests/fleet/capability-registry.test.ts \
  -t "deduplicates concurrent snapshot builds"
ROUGE : 15 fetches pour 5 appels concurrents, attendu 3 (Ollama, LM Studio,
        Lemonade une seule fois chacun).
VERT  : test ciblé réussi ; suite élargie capability/peer-rpc/selector,
        3 fichiers et 65/65 tests réussis.
```

## Vérifications finales

```text
npm run typecheck

> @phuetz/code-buddy@1.8.0 typecheck
> tsc --noEmit

Résultat : code 0, aucune erreur.
```

```text
npx vitest run tests/council/conductor-performance.test.ts \
  tests/council/council-engine.test.ts \
  tests/council/council-triage.test.ts \
  tests/fleet/capability-registry.test.ts \
  tests/fleet/fleet-council-peers.test.ts \
  tests/fleet/fleet-listener.test.ts \
  tests/fleet/fleet-load.test.ts \
  tests/fleet/fleet-loopback-smoke.test.ts \
  tests/fleet/model-scoreboard.test.ts \
  tests/fleet/model-selector.test.ts \
  tests/fleet/peer-chat-stream.test.ts \
  tests/fleet/peer-dispatch-retention.test.ts \
  tests/server/anonymous-tools-local-only.test.ts \
  tests/server/broadcast-backpressure.test.ts \
  tests/server/connected-greeting.test.ts \
  tests/server/desktop-endpoint.test.ts \
  tests/server/fleet-bridge.test.ts \
  tests/server/lane-queue-server.test.ts \
  tests/server/peer-chat-bridge.test.ts \
  tests/server/peer-rpc.test.ts \
  tests/server/websocket.test.ts \
  tests/server/websocket-abort.test.ts \
  tests/server/websocket-no-auth-scopes.test.ts \
  tests/server/websocket-peer-multiplex.test.ts \
  tests/server/websocket-peer-security.test.ts

Test Files  25 passed (25)
Tests       301 passed (301)
Duration    2.70s
```

```text
git diff --check origin/main..HEAD
Résultat : code 0, aucune sortie.
```

La suite complète d'environ 27 000 tests n'a pas été lancée, conformément à la
consigne de préférer les filtres de chemins. Les 25 suites exécutées couvrent
tous les fichiers de test touchés et les suites Fleet/Server/Council directement
adjacentes.

## Réserves connues et intégration

1. **Dépendance explicite au lot lifecycle.** `origin/main` à `f9a31a7e` ne
   contient pas `5d0e1589`/`49c67a1b`. Intégrer cette branche seule laisserait
   donc les constats 1, 3 et 11 ouverts. Il faut intégrer aussi le lot
   `codex/portage-fleet-lifecycle-july-2026`, de préférence à son tip
   `1ee2ca96` qui préserve l'attente d'approbation device-pairing.
2. **Saturation configurée.** `SATURATED` dépend volontairement de
   `CODEBUDDY_FLEET_MAX_CONCURRENCY`; sans capacité déclarée,
   `isFleetSaturated()` conserve son contrat existant et retourne `false`. Le
   rate-limit de 30 RPC/minute reste actif indépendamment.
3. **Plafond de dispatch.** Sous une rafale de plus de 500 tâches toutes encore
   actives, le plafond dur peut évincer l'entrée la plus ancienne avant sa fin.
   Le travail n'est pas annulé, mais son polling retourne alors `{found:false}`;
   c'est le compromis explicite qui garantit la borne mémoire.
4. **Visibilité scoreboard.** Un append externe peut être visible avec au plus
   250 ms de retard. Les écritures locales forcent un reload préalable et ne
   perdent pas les appends concurrents.
5. Les éléments sales préexistants sont restés hors diff et hors index :
   `.codebuddy/TOOLS.md` et `docs/audits/vitrine-commerciale-2026-07-27/`.
   `docs/FABLE5-CODEX-COORDINATION.md` n'a pas été modifié.
