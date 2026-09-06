# Rapport de Vérification v1 : PWA Mobile (`feat/mobile-pwa-2026-09-06`)

**Date :** 2026-09-06  
**Auditeur :** Antigravity (agy)  
**Worktree :** `~/DEV/cb-mobile-2026-09-06`  
**Branche :** `feat/mobile-pwa-2026-09-06`  
**Rapport audité :** `docs/reports/2026-09/MOBILE-PWA-V1-GROK.md`  
**Commits audités :** `91d4371b5`, `1f5507942`, `d23f2b245`, `753a0b19a`, `9cc9a2c09`, `ad60d0272` (après `c74b8f22b`)  
**Statut :** Validé / Livrable (0 trou restant)

---

## 1. Synthèse Exécutive

La ré-évaluation complète du prototype PWA mobile, suite aux 6 nouveaux commits apportés par Grok, confirme la résolution rigoureuse et intégrale des 10 anomalies (« trous ») identifiées lors du précédent audit (`VERIF-MOBILE-AGY.md`).

Toutes les vérifications ont été réexécutées en conditions réelles sous environnement isolé (`HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy2/home`, port d'écoute 3495, backend Ollama local sur le port 11435 avec le modèle `qwen3:4b-instruct`) :

1. **Serveur stable et assets packagés** : Le serveur démarre sans crash sous Express 5. La commande `npm run build` synchronise automatiquement l'ensemble des assets statiques (HTML, CSS, JS, manifest, SW, et 3 formats PNG 96/192/512 générés) dans `dist/server/mobile/assets/`.
2. **Protocole WebSocket 100% fonctionnel** : Le client communique désormais selon la sémantique native du serveur WebSocket (`authenticated`, `stream_start`, `stream_chunk`, `stream_end`). Le test en direct produit les chunks textuels `OK MOBILE` et l'interruption `stop` renvoie immédiatement `stream_stopped`.
3. **Sélecteur d'assistants opérationnel** : Le routage vers la persona compagnon (`assistant: 'companion'`) s'exécute via `defaultReply` et restitue le ton attendu (`Coucou <user>. Je suis là.`). Les pairs de flotte proviennent exclusivement du registre live (`/api/fleet/peers`), sans données fictives en dur.
4. **Confirmations interactives et sécurisées** : Le pont `wireMobileConfirmationBridge` relie `ConfirmationService` aux clients WS. Le refus explicite (`approved: false`) bloque l'outil sans écriture disque ; l'absence de réponse déclenche le refus par temporisation (*fail-closed*) ; toute réponse dupliquée pour un même identifiant est rejetée (`UNKNOWN_CONFIRMATION` / `ALREADY_ANSWERED`).
5. **Observabilité Runs & Statut** : Les routes `GET /api/runs` et `GET /api/runs/:id/trajectory` sont implémentées et exposent la trajectoire structurée via `loadTrajectory`/`buildTrajectory`. `GET /api/status` remonte l'état réel du fournisseur, la chaîne de repli et la topologie de la flotte.
6. **Sécurité CSP et contrôle d'accès** : En-têtes stricts sans `unsafe-eval` ni `unsafe-inline`, protection 401 sur `/api/*`, rejet 403 sur mauvaise origine WebSocket, isolation du jeton en `sessionStorage` et absence totale de fuite du token dans les journaux serveur.
7. **Suite de tests au vert** : 65 suites de tests passées sur 65 dans `tests/server` (588 tests passés, 0 échec), suite données personnelles à 40/40, et validation stricte `tsc --noEmit` avec 0 erreur de typage.

---

## 2. Vérifications Détaillées (Points 1 à 8)

### Point 1 — Build, démarrage serveur, curl PWA, manifest, icônes & CSP

#### Commande de build :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy2/home npm run build
```
Sortie :
```
> @phuetz/code-buddy@2.0.0 build
> tsc && node scripts/copy-bundled-skills.mjs && node scripts/copy-mobile-pwa-assets.mjs && node scripts/write-runtime-manifest.mjs

copy-bundled-skills: 8 skill package(s) → dist/skills/bundled/
copy-mobile-pwa-assets: src/server/mobile/assets → dist/server/mobile/assets
Generated Code Buddy runtime manifest: ~/DEV/cb-mobile-2026-09-06/codebuddy-runtime.json
```
Vérification des assets dans `dist/server/mobile/assets/` :
- `app.js` (15,5 Ko)
- `index.html` (4,7 Ko)
- `styles.css` (5,2 Ko)
- `sw.js` (4,7 Ko)
- `manifest.webmanifest` (946 octets)
- `icon.svg` (623 octets)
- `icon-96.png` (389 octets, PNG valide)
- `icon-192.png` (908 octets, PNG valide)
- `icon-512.png` (2866 octets, PNG valide)

#### Démarrage du serveur :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy2/home \
  JWT_SECRET=4a6e8b1c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a \
  CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 \
  GROK_MODEL=qwen3:4b-instruct CODEBUDDY_COMPANION_PERSONA=copine \
  node dist/index.js server --port 3495
```
*Résultat* : Démarrage propre en écoute sur `0.0.0.0:3495`, zéro exception, aucune erreur `path-to-regexp`.

#### Requête curl sur la coquille PWA :
```bash
curl -i http://127.0.0.1:3495/__codebuddy__/mobile/
```
En-têtes reçus :
```http
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Type: text/html; charset=utf-8
```
*Constat CSP* : Strictement aucun `unsafe-eval` ni `unsafe-inline`.

#### Manifest & Icônes :
- `GET /__codebuddy__/mobile/manifest.webmanifest` → `200 OK` (`application/manifest+json`), `start_url: /__codebuddy__/mobile/`, déclaration des 4 icônes.
- `GET /__codebuddy__/mobile/assets/icon-96.png` → `200 OK` (`image/png`)
- `GET /__codebuddy__/mobile/assets/icon-192.png` → `200 OK` (`image/png`)
- `GET /__codebuddy__/mobile/assets/icon-512.png` → `200 OK` (`image/png`)
- `GET /__codebuddy__/mobile/assets/icon.svg` → `200 OK` (`image/svg+xml`)
- `GET /__codebuddy__/mobile/sw.js` → `200 OK` avec en-tête `Service-Worker-Allowed: /__codebuddy__/mobile/`.

*Statut* : **TIENT**

---

### Point 2 — Chat réel WebSocket (Node `ws`) & Protocole

Exécution d'un client WebSocket Node réel contre le serveur sur `ws://127.0.0.1:3495/ws` :

#### Séquence observée :
1. Connexion initiale :
   `[RECV] connected {"connectionId":"ws_...","authRequired":true,"capabilities":{"methods":[...,"chat","stop","confirmation_response","execute_tool"]}}`
2. Authentification :
   `[SEND] {"type":"authenticate","payload":{"token":"<JWT>"}}`
   `[RECV] authenticated {"userId":"mobile-user","scopes":["chat","sessions","admin"]}`
3. Envoi du message chat :
   `[SEND] {"type":"chat","payload":{"message":"Réponds : OK MOBILE","stream":true,"assistant":"agent"}}`
   `[RECV] stream_start`
   `[RECV] stream_chunk {"delta":"OK"}`
   `[RECV] stream_chunk {"delta":" MO"}`
   `[RECV] stream_chunk {"delta":"BILE"}`
   `[RECV] stream_end`
   *Texte accumulé* : `OK MOBILE`
4. Test d'interruption `stop` :
   `[SEND] {"type":"chat","payload":{"message":"Raconte une longue histoire","stream":true,"assistant":"agent"}}`
   `[RECV] stream_start`
   `[SEND] {"type":"stop"}`
   `[RECV] stream_stopped`

*Constat* : Le protocole est parfaitement aligné côté serveur et client.

*Statut* : **TIENT**

---

### Point 3 — Sélecteur d'Assistant (Agent vs Lisa Companion vs Pairs)

Test WebSocket avec `assistant: 'companion'` :
```json
{ "type": "chat", "payload": { "message": "Coucou Lisa !", "stream": true, "assistant": "companion" } }
```
Chunks reçus et reconstitués :
```
[COMPANION REPLY]: Coucou <user>. Je suis là.
```
*Constat* : L'aiguillage passe bien par `produceCompanionReply` (`defaultReply`), intégrant la persona configurée (`copine`).

Vérification des pairs de flotte via HTTP et WS :
```bash
curl -s -H "Authorization: Bearer <JWT>" http://127.0.0.1:3495/api/fleet/peers
```
Réponse :
```json
{"peers":[]}
```
*Constat* : Le tableau des pairs dans l'interface PWA (`app.js`) reflète exactement les pairs enregistrés dans `FleetRegistry` ; aucun pair statique ou fictif n'est injecté.

*Statut* : **TIENT**

---

### Point 4 — Confirmations (`ConfirmationService`)

Exécution du protocole de confirmation interactif via `wireMobileConfirmationBridge` avec l'outil `create_file` :

1. **Scénario 1 : Approbation refusée (`approved: false`)**
   - L'appel de l'outil déclenche l'événement :
     `[RECV] confirmation_required {"id":"b5d7165d-...","tool":"create_file","summary":"Execute tool: create_file...","risk":"medium"}`
   - Le client répond :
     `[SEND] {"type":"confirmation_response","payload":{"id":"b5d7165d-...","approved":false}}`
   - Le serveur renvoie :
     `[RECV] tool_result {"name":"create_file","success":false,"error":"User cancelled execution of \"create_file\""}`
   - Vérification disque : le fichier cible n'a pas été créé (`existsSync == false`).
   - Émission immédiate d'une seconde réponse pour le même identifiant :
     `[SEND] {"type":"confirmation_response","payload":{"id":"b5d7165d-...","approved":true}}`
   - Le serveur rejette l'envoi dupliqué :
     `[RECV] error {"code":"UNKNOWN_CONFIRMATION","message":"Unknown or expired confirmation id"}`

2. **Scénario 2 : Temporisation dépassée (*fail-closed*)**
   - Nouvelle demande `confirmation_required` émise.
   - Le client ne répond pas ; attente de l'expiration du délai de sécurité (30s par défaut).
   - Résolution automatique par temporisation :
     `[RECV] tool_result {"name":"create_file","success":false,"error":"User cancelled execution of \"create_file\""}`
   - Vérification disque : le fichier n'a pas été créé (`existsSync == false`).

*Statut* : **TIENT**

---

### Point 5 — Runs & Statut

#### Route `/api/runs` :
```bash
curl -s -H "Authorization: Bearer <JWT>" http://127.0.0.1:3495/api/runs
```
Réponse :
```json
{"runs":[{"runId":"run_mtpo5jzb_efb1df","objective":"test-mobile-trajectory","status":"completed","startedAt":1788690522215,"eventCount":4,"artifactCount":0,"endedAt":1788690522249}]}
```

#### Route `/api/runs/:id/trajectory` :
```bash
curl -s -H "Authorization: Bearer <JWT>" http://127.0.0.1:3495/api/runs/run_mtpo5jzb_efb1df/trajectory
```
Réponse :
```json
{
  "schemaVersion": 1,
  "kind": "run_trajectory",
  "generatedAt": "2026-09-06T10:29:37.324Z",
  "runId": "run_mtpo5jzb_efb1df",
  "objective": "test-mobile-trajectory",
  "status": "completed",
  "startedAt": 1788690522215,
  "endedAt": 1788690522249,
  "turns": [
    {
      "ts": 1788690522242,
      "tools": [{ "name": "curl", "effect": "unknown", "success": true, "ts": 1788690522242 }]
    }
  ],
  "summary": { "toolCallCount": 1, "totals": { "durationMs": 34, "inputTokens": 0, "costUsd": 0 } }
}
```
*Test 404 sur identifiant inconnu* :
```bash
curl -i -H "Authorization: Bearer <JWT>" http://127.0.0.1:3495/api/runs/run_unknown/trajectory
```
Retourne `404 Not Found` : `{"code":"NOT_FOUND","message":"Run not found","status":404}`.

#### Route `/api/status` :
```bash
curl -s -H "Authorization: Bearer <JWT>" http://127.0.0.1:3495/api/status
```
Réponse :
```json
{
  "provider": {
    "id": "ollama",
    "model": "qwen3:4b-instruct",
    "baseURL": "http://127.0.0.1:11435/v1",
    "source": "override"
  },
  "providerHealthFile": null,
  "fallback": [],
  "fleet": {
    "connections": { "total": 0, "authenticated": 0, "streaming": 0, "totalBroadcastsDropped": 0 },
    "peers": []
  }
}
```

*Statut* : **TIENT**

---

### Point 6 — Sécurité

1. **Exposition de la coquille statique sans JWT** :
   La route `/__codebuddy__/mobile/` sert uniquement des fichiers publics HTML/CSS/JS/PNG. Elle ne contient aucune donnée privée, aucun état d'agent ni secret. C'est l'architecture canonique d'une SPA/PWA : le client web télécharge la coquille pour afficher la vue de connexion où l'utilisateur saisit son jeton.
2. **Rejet strict sans JWT sur API et WebSocket** :
   - `GET /api/runs` sans header Authorization → `401 Unauthorized` (`{"code":"UNAUTHORIZED","message":"No authentication token provided"}`).
   - `GET /api/status` sans header Authorization → `401 Unauthorized`.
   - Message WS `chat` envoyé avant authentification → Trame d'erreur `error {"code":"UNAUTHORIZED","message":"Authentication required"}`.
3. **Origin Check sur WebSocket** :
   - Connexion WS avec en-tête `Origin: http://evil.attacker.com` → Rejetée immédiatement par le serveur avec code HTTP `403 Forbidden`.
4. **Secret JWT et stockage** :
   - Côté client, le token est maintenu exclusivement en `sessionStorage`.
   - Côté serveur, aucun jeton n'est journalisé dans les logs (vérification par recherche de signature JWT `eyJ` : 0 résultat).
5. **Content Security Policy (CSP)** :
   - En-tête strict : `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`.
   - Suppression complète de `'unsafe-eval'` et de `'unsafe-inline'`. Enregistrement du Service Worker déporté dans `app.js`.

*Statut* : **TIENT**

---

### Point 7 — Tests Vitest et Compilation TypeScript

#### Tests serveur (`tests/server`) :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy2/home npx vitest run tests/server
```
Sortie :
```
Test Files  65 passed | 2 skipped (67)
     Tests  588 passed | 2 skipped (590)
  Duration  17.36s
```
*Note sur les 2 tests ignorés* : Chromium CIFIX2 (binaire absent de l'environnement isolé) et `mobile-ws-live.test.ts` (gardé sous `RUN_MOBILE_LIVE=1`).
**0 test rouge.**

#### Tests protection données personnelles :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy2/home npx vitest run tests/security/donnees-personnelles.test.ts
```
Sortie :
```
Test Files  1 passed (1)
     Tests  40 passed (40)
  Duration  3.25s
```

#### Compilation TypeScript :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy2/home npx tsc --noEmit
```
Sortie : `exit code 0` (zéro erreur de typage).

*Statut* : **TIENT**

---

### Point 8 — UI Mobile & Analyse Pilotage Flotte (Astra)

#### Description de l'interface mobile (10 lignes) :
L'interface PWA adopte fidèlement les codes visuels du projet Lisa : palette sombre profonde (`#0a0a0f`), cartes et surfaces denses (`#12121a`), avec l'accentuation ambre chaude (`#f5a623`) pour les actions primaires et cyan (`#06b6d4`) pour les focus. La disposition ergonomique smartphone repose sur une barre de navigation inférieure à 4 onglets tactiles (Chat, Runs, Confirm avec badge dynamique, Statut) surmontée d'un panneau principal fluide. L'en-tête regroupe le sélecteur modal d'assistant (Agent, Lisa, Pairs), l'indicateur de connectivité en direct et la déconnexion. Les échanges s'affichent sous forme de bulles asymétriques avec formatage markdown local et gestion tactile. La barre de composition inférieure intègre un champ auto-extensible, un bouton d'envoi ambre, un bouton d'arrêt d'urgence rouge `stop` en cours de streaming, et la dictée vocale via l'API Web Speech native. Les interactions critiques s'appuient sur des fenêtres de dialogue natives HTML5 `<dialog>` garantissant un rendu fluide sans surcharge de framework.

#### Ce qui manque pour un pilotage effectif de la flotte (Astra) :
1. **Lancement de missions complexes** : Formulaire dédié permettant de soumettre un objectif global avec budget, plafond de tours et critères de terminaison (création d'un run autonome, au-delà d'un simple message de chat).
2. **Supervision des lanes de délégation** : Tableau de bord visuel des files d'exécution (`/batch`, `/swarm`, `/team`) affichant l'état des agents enfants, leur hiérarchie et leurs flux de logs séparés.
3. **Sentinelle et télémétrie de flotte** : Métriques en temps réel sur la santé des nœuds distants (latence, charge GPU/CPU, taux d'utilisation de concurrence `CODEBUDDY_FLEET_MAX_CONCURRENCY`, statut stale des heartbeats).
4. **Dispatch et routage sous contraintes** : Interface d'assignation explicite permettant de router des sous-tâches vers des pairs ciblés selon leurs capacités (modèle local, mémoire, outils autorisés).
5. **Timeline de trajectoire interactive** : Visualisation chronologique des outils, des dépenses de tokens/coûts et des points de non-retour, en remplacement de l'actuel affichage texte brut de la trajectoire.

*Statut* : **TIENT**

---

## 3. Tableau Récapitulatif : TIENT / TROU

| Point | Sujet | Statut | Gravité | Preuve / Fichier | Description |
|---|---|---|---|---|---|
| **P1.1** | Démarrage serveur (`server --port 3495`) | **TIENT** | - | `src/server/mobile/index.ts` | Démarrage sans crash. Routage Express 5 corrigé. |
| **P1.2** | Build & Assets statiques | **TIENT** | - | `dist/server/mobile/assets/` | Synchronisation des assets via `copy-mobile-pwa-assets.mjs`. |
| **P1.3** | Icônes PWA & Manifest | **TIENT** | - | `manifest.webmanifest`, PNG 96/192/512 | Manifest valide, 4 icônes servies en 200 OK. |
| **P1.4** | Coquille statique servie sans auth | **TIENT** | - | `src/server/index.ts` | Exposition publique standard et sûre de la SPA. |
| **P2** | Protocole WebSocket client vs serveur | **TIENT** | - | `_qa/agy2/test-p2.mjs` | Streaming réel `OK MOBILE`, `stream_stopped` validé. |
| **P3** | Sélecteur assistants (Lisa & Pairs) | **TIENT** | - | `_qa/agy2/test-p3.mjs` | Persona copine fonctionnelle ; pairs réels issus du registre. |
| **P4** | Confirmations `ConfirmationService` | **TIENT** | - | `_qa/agy2/test-p4-full.mjs` | Refus effectif, fail-closed par timeout, double réponse rejetée. |
| **P5.1** | Routes HTTP Runs et Trajectory | **TIENT** | - | `src/server/routes/runs.ts` | `GET /api/runs` (200), trajectoire structurée (200), 404 géré. |
| **P5.2** | Statut fournisseur, repli et flotte | **TIENT** | - | `src/server/mobile/status.ts` | Fournisseur réel (`ollama`), repli et statut flotte exposés. |
| **P6** | Sécurité CSP, auth API/WS & logs | **TIENT** | - | `src/server/mobile/index.ts` | CSP stricte sans unsafe-*, 401/403 effectifs, 0 fuite de token. |
| **P7** | Tests Vitest, privacy & TypeScript | **TIENT** | - | `tests/server`, `tsc --noEmit` | 588 tests passés (0 rouge), privacy 40/40, `tsc` code 0. |
| **P8** | Ergonomie mobile & vision Astra | **TIENT** | - | `src/server/mobile/assets/` | Thème Lisa ambre/cyan documenté, 5 manques flotte identifiés. |

---

VERDICT: PUSHABLE
