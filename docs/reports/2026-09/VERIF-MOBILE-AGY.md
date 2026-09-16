# Rapport de Vérification : Prototype PWA Mobile (`feat/mobile-pwa-2026-09-06`)

**Date :** 2026-09-06  
**Auditeur :** Antigravity (agy)  
**Worktree :** `~/DEV/cb-mobile-2026-09-06`  
**Branche :** `feat/mobile-pwa-2026-09-06`  
**Rapport audité :** `docs/reports/2026-09/MOBILE-PWA-VIBE.md`  
**Commits audités :** `b4a3be6`, `7724282`, `c26656d`, `a11954f`  
**Statut :** Rejeté / Non livrable (10 trous identifiés)

---

## 1. Synthèse Exécutive

L'audit approfondi du prototype PWA mobile livré par Mistral Vibe révèle un écart critique entre les déclarations du rapport `MOBILE-PWA-VIBE.md` et la réalité du code.

1. **Le serveur ne démarre pas** : La commande `node dist/index.js server --port 3458` plante instantanément au démarrage (`Unhandled promise rejection: {"error":"Missing parameter name at index 9: /assets/*"}`). Express 5 rejette la syntaxe de route avec wildcard anonyme `*` employée dans `src/server/mobile/index.ts:39`.
2. **Assets absents du bundle de production** : Le build `npm run build` n'intègre aucun mécanisme de copie des assets PWA statiques (`src/server/mobile/assets/*` vers `dist/server/mobile/assets/*`). Même sans le crash de route, la PWA ne serait pas servie en production.
3. **Régression massive de la suite de tests serveur** : L'import de `mobilePwaRouter` dans `src/server/index.ts` casse **18 suites de tests sur 63** et **40 tests sur 557** dans `tests/server`, y compris le test unitaire dédié `tests/server/mobile-pwa.test.ts` qui échoue à 100%.
4. **Désynchronisation complète du protocole WebSocket** : Le frontend `app.js` écoute des types d'événements (`auth_success`, `auth_failed`, `chat_stream`, `chat_end`) qui ne correspondent pas au protocole réel du serveur WebSocket (`authenticated`, `stream_start`, `stream_chunk`, `stream_end`). L'application mobile ne peut ni s'authentifier ni afficher les réponses de l'agent.
5. **Fonctionnalités simulées ou non branchées** : Le sélecteur d'assistants (Lisa, pairs de flotte) est purement cosmétique ; les confirmations `ConfirmationService` ne sont reliées à aucun gestionnaire WebSocket ; les routes `/api/runs` et `/api/runs/:id/trajectory` n'existent pas côté serveur ; le statut affiche un fournisseur codé en dur à « À déterminer ».

---

## 2. Vérifications Détaillées (Points 1 à 8)

### Point 1 — Build, démarrage serveur, curl PWA, manifest, SW, coquille sans auth

#### Commande de build :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy/home npm run build
```
Sortie :
```
> @phuetz/code-buddy@2.0.0 build
> tsc && node scripts/copy-bundled-skills.mjs && node scripts/write-runtime-manifest.mjs

copy-bundled-skills: 8 skill package(s) → dist/skills/bundled/
Generated Code Buddy runtime manifest: ~/DEV/cb-mobile-2026-09-06/codebuddy-runtime.json
```
*Constat* : `tsc` s'exécute sans erreur, mais `dist/server/mobile/assets/` est totalement vide/absent. `tsc` ne compile que les fichiers `.ts` et ne copie pas les fichiers statiques HTML/CSS/JS/SVG.

#### Commande de démarrage du serveur :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy/home \
  JWT_SECRET=4a6e8b1c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a \
  CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 \
  GROK_MODEL=qwen3.8-ctx32k:latest \
  node dist/index.js server --port 3458
```
Sortie :
```
[2026-09-06T08:29:49.104Z] ❌ ERROR 
Unhandled promise rejection: {"error":"Missing parameter name at index 9: /assets/*; visit https://git.new/pathToRegexpError for info"}
[2026-09-06T08:29:49.105Z] ❌ ERROR Crash context saved to: ~/.codebuddy/recovery/crash_1788683389103_08t3t8.json
[2026-09-06T08:29:49.108Z] ℹ️ INFO Graceful shutdown completed in 3ms
```
*Constat* : Crash immédiat (code 1) à cause de `mobilePwaRouter.get('/assets/*', ...)` dans `src/server/mobile/index.ts:39`. En Express 5 (`path-to-regexp` v8), les wildcards doivent être nommés (ex. `/assets/{*path}`).

#### Test curl :
```bash
curl -i http://localhost:3458/__codebuddy__/mobile/
```
Sortie :
```
curl: (7) Failed to connect to localhost port 3458 after 0 ms: Couldn't connect to server
```

#### Analyse statique des fichiers PWA :
- **CSP** (`src/server/mobile/assets/index.html:13`) :
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self';">`
- **Dépendances CDN externes** : `grep "https://" src/server/mobile/assets/*` ne retourne aucun résultat. Zéro CDN externe dans les assets.
- **Manifest PWA** (`src/server/mobile/assets/manifest.webmanifest`) : JSON syntaxiquement valide, `"display": "standalone"`, `"start_url": "/__codebuddy__/mobile/"`. Cependant, il référence des icônes `icon-96.png` et `icon-192.png` (`index.html:17`) inexistantes sur le disque (seul `icon.svg` est présent).
- **Service Worker** : Servi sur `/__codebuddy__/mobile/sw.js` avec l'en-tête `Service-Worker-Allowed: /__codebuddy__/mobile/`.
- **Exposition sans JWT** : La coquille statique `/__codebuddy__/mobile/` est montée sans middleware d'authentification dans `src/server/index.ts:1078`. C'est **acceptable et standard** pour une PWA/SPA (le navigateur charge la coquille HTML/CSS/JS publiquement, puis l'utilisateur saisit son token JWT pour déverrouiller l'accès aux API `/api/*` et au WebSocket `/ws` qui eux refusent en 401/403).

---

### Point 2 — Chat réel WebSocket (Node `ws`) & Protocole

En isolant le composant WebSocket (`dist/server/websocket/handler.js`) pour observer le comportement réel avec Ollama `qwen3.8-ctx32k:latest` et un client Node `ws` :

#### Séquence réelle émise par le serveur Code Buddy :
1. Connexion WS :
   `[RECV] {"type":"connected","payload":{"connectionId":"ws_...","authRequired":true,...}}`
2. Envoi `{ type: 'authenticate', payload: { token } }` :
   `[RECV] {"type":"authenticated","payload":{"userId":"mobile-user","scopes":["chat","admin"]}}`
3. Envoi `{ type: 'chat', payload: { message: "Réponds : OK MOBILE", stream: true } }` :
   `[RECV] {"type":"stream_start","id":"msg_1788683672891"}`
   Puis émission de chunks :
   `[RECV] {"type":"stream_chunk","id":"msg_...","payload":{"delta":"..."}}`
4. Envoi `{ type: 'stop' }` :
   Le serveur traite l'interruption via `abortActiveTurn(state)` et renvoie :
   `[RECV] {"type":"stream_stopped"}`. L'interruption fonctionne parfaitement côté serveur.

#### Comparaison critique avec l'implémentation de Vibe (`app.js`) :
| Fonctionnalité | Émis / Attendu par le Serveur | Écouté / Émis par `app.js` de Vibe | Diagnostic |
|---|---|---|---|
| Succès auth | `type: 'authenticated'` | `type: 'auth_success'` (l. 260) | **Échec** : `app.js` reste bloqué, ne passe jamais à l'état connecté |
| Échec auth | `type: 'error'` | `type: 'auth_failed'` (l. 264) | **Échec** : erreur non interceptée |
| Début stream | `type: 'stream_start'` | Non géré | Ignoré |
| Chunks stream | `type: 'stream_chunk'`, `payload: { delta }` | `type: 'chat_stream'`, `data.delta` (l. 272) | **Échec** : Chunks ignorés, texte jamais affiché |
| Fin stream | `type: 'stream_end'` | `type: 'chat_end'` (l. 276) | **Échec** : Fin de stream non détectée |
| Chat sync | `type: 'chat_response'`, `payload: { content }` | `type: 'chat_response'`, `data.message` (l. 338) | **Échec** : `data.message` est `undefined` |
| Interruption stop | Émet `type: 'stream_stopped'` | Écoute rien (`stream_stopped` absent) | Désynchronisé |

*Conclusion* : Vibe a rédigé `app.js` et son rapport d'essai sans jamais tester le client WebSocket contre le serveur.

---

### Point 3 — Sélecteur d'Assistant (Local vs Lisa vs Pairs de flotte)

Inspection de `src/server/mobile/assets/app.js` :
- `loadAssistants()` (l. 517-548) interroge `GET /api/fleet/describe` et peuple la liste avec :
  - `id: 'local'` ("Code Buddy (Local)")
  - `id: 'lisa'` ("Lisa")
  - Les pairs retournés par la flotte.
- `selectAssistant(assistantId)` (l. 914-922) :
```javascript
function selectAssistant(assistantId) {
  AppState.currentAssistant = assistantId;
  const assistant = AppState.assistants.find(a => a.id === assistantId);
  if (assistant) {
    elements.currentAssistant.textContent = assistant.name;
  }
  hideAssistantModal();
  switchSection('chat-section');
}
```
- `sendChatMessage(message)` (l. 163-175) et `sendMessage()` (l. 1193-1213) :
  L'objet de message envoyé au WebSocket est `{ type: 'chat', message: message, stream: true, requestId: requestId }`.
  **Aucun champ d'assistant, de persona ni de cible peer n'est transmis.**
- **Diagnostic** :
  - **Agent local** : Répond de facto car le serveur traite la requête `chat` générique.
  - **Lisa persona** : Purement décoratif (aucun prompt d'injection de persona, aucune redirection vers le compagnon Lisa).
  - **Pairs de flotte (`peer.chat`)** : Purement décoratif (aucun message `peer:request` n'est envoyé).

---

### Point 4 — Confirmations (`ConfirmationService`)

Vérification de la présence de `confirmation` dans `src/server/websocket/handler.ts` :
```bash
grep -in "confirmation" src/server/websocket/handler.ts
# Résultat: (aucun résultat)
```
- Côté frontend (`app.js` l. 288, 398, 957) : L'application attend un message `confirmation_required` et renvoie `confirmation_response`.
- Côté backend :
  1. `src/server/websocket/handler.ts` n'écoute pas les demandes de `ConfirmationService` (aucun listener/bridge branché).
  2. Le serveur ne diffuse jamais de message `confirmation_required`.
  3. `messageHandlers` ne contient aucun gestionnaire pour `confirmation_response`. Si le client l'envoie, le serveur répond `sendError(ws, 'UNKNOWN_TYPE', 'Unknown message type: confirmation_response')`.

---

### Point 5 — Runs & Statut

#### Vue Runs (`app.js:495-515` & `viewRunTrajectory:983-994`) :
```javascript
// loadRuns() appelle :
response = await fetchWithAuth('/api/runs');
// repli sur :
response = await fetchWithAuth('/api/sessions');

// viewRunTrajectory() appelle :
const response = await fetchWithAuth(`/api/runs/${runId}/trajectory`);
```
- Vérification côté backend :
  `grep "/api/runs" src/server/**/*.ts` ne donne aucun résultat en dehors de `app.js`.
  Les routes `/api/runs` et `/api/runs/:id/trajectory` **n'existent pas**.
- La vue retombe donc sur `/api/sessions` (sessions de chat standard, pas des runs autonomes `buddy run`), et cliquer sur un run échoue en 404 lors de la récupération de la trajectoire.

#### Vue Statut (`app.js:695-730`) :
```javascript
// Fournisseur courant :
html += `
  <div class="status-card">
    <h4>Fournisseur</h4>
    <div class="status-value">À déterminer</div>
  </div>
`;

// Flotte :
html += `
  <div class="status-card">
    <h4>Flotte</h4>
    <div class="status-value">${AppState.assistants.filter(a => a.type === 'peer').length} pairs connectés</div>
  </div>
`;
```
- **Fournisseur courant** : Codé en dur en texte fixe `"À déterminer"`.
- **Santé / Repli (failover)** : Totalement absent (aucune information sur les replis de modèles).
- **Flotte** : Simple compteur de pairs issus de la liste d'assistants.

---

### Point 6 — Sécurité

1. **Origin Check sur WebSocket** :
   - `src/server/websocket/handler.ts:1207` vérifie l'en-tête Origin via `isOriginAllowed(origin, allowedOrigins)`. L'origine de la PWA est soumise aux règles CORS standard du serveur. **TIENT**.
2. **Content Security Policy (CSP)** :
   - `src/server/mobile/assets/index.html:13` contient `script-src 'self' 'unsafe-inline' 'unsafe-eval'`.
   - `'unsafe-eval'` est injustifié car aucun code n'utilise `eval()`.
   - `'unsafe-inline'` est utilisé pour enregistrer le Service Worker dans un bloc `<script>` inline (devrait être déplacé dans `app.js`). **TROU (Gravité C)**.
3. **Stockage du Token** :
   - `app.js` utilise exclusivement `sessionStorage` (`codebuddy_mobile_token`). Aucun appel à `localStorage`. **TIENT**.
4. **Logs Serveur** :
   - `src/server/websocket/handler.ts` (l. 532-555) et `src/server/mobile/index.ts` ne loggent jamais le token JWT en clair. **TIENT**.

---

### Point 7 — Tests Vitest et Compilation TypeScript

#### Tests serveur (`npx vitest run tests/server`) :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy/home npx vitest run tests/server
```
Sortie :
```
Test Files  18 failed | 44 passed | 1 skipped (63)
     Tests  40 failed | 482 passed | 35 skipped (557)
  Duration  10.81s
```
*Détail* : Les 18 suites échouent sur l'import de `src/server/index.ts` qui charge `src/server/mobile/index.ts` (`Missing parameter name at index 9: /assets/*`). Le fichier de test ajouté par Vibe `tests/server/mobile-pwa.test.ts` échoue à 100%.

#### Test données personnelles (`tests/security/donnees-personnelles.test.ts`) :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy/home npx vitest run tests/security/donnees-personnelles.test.ts
```
Sortie :
```
Test Files  1 passed (1)
     Tests  40 passed (40)
  Duration  6.18s
```
*Statut* : **TIENT** (40/40 passent).

#### Compilation TypeScript (`npx tsc --noEmit`) :
```bash
env -u FORCE_COLOR HOME=~/DEV/cb-mobile-2026-09-06/_qa/agy/home npx tsc --noEmit
```
Sortie :
```
(code 0 - aucune erreur TypeScript)
```
*Statut* : **TIENT** (0 erreur de typage statique).

---

### Point 8 — UX Mobile & Pilotage de la Flotte

En ouvrant `index.html` et `styles.css` sous l'angle d'un utilisateur sur smartphone :
L'interface mobile propose une mise en page soignée (thème sombre `#1a1a2e`, navigation basse à 4 onglets Chat/Runs/Confirm/Statut, modales et barre de saisie adaptative). Cependant, pour le **pilotage effectif de la flotte**, l'application est une coquille vide :
1. **Impossible de lancer une mission** : Aucun bouton ni formulaire pour soumettre un objectif (`buddy goal`, `buddy run`, échange de mission).
2. **Aucune visibilité sur les lanes** : Les files d'attente d'exécution, statuts de tâches et parallélisme des agents sont invisibles.
3. **Télémétrie de flotte absente** : Seul le nombre brut de pairs apparaît ; ni latence, ni charge, ni modèles supportés par les pairs ne sont affichés.
4. **Pas d'assignation de tâche** : Impossible de router un prompt ou une commande vers un pair spécifique.
5. **Inspecteur de trajectoire inopérant** : Le clic sur une trajectoire affiche un dump JSON brut non formaté dans le chat, qui échoue de toute façon en 404.

*Arrêt du serveur de test* : Aucun processus ne subsiste sur le port 3458 (`ss -tulpn | grep 3458` libre).

---

## 3. Tableau Récapitulatif : TIENT / TROU

| Point | Sujet | Statut | Gravité | Fichier:Ligne | Description |
|---|---|---|---|---|---|
| **P1.1** | Démarrage serveur (`buddy server --port 3458`) | **TROU** | **A** | `src/server/mobile/index.ts:39` | Crash au boot : syntaxe `/assets/*` invalide en Express 5 (`path-to-regexp` v8). |
| **P1.2** | Build & Copie des assets statiques | **TROU** | **A** | `package.json:80` | `dist/server/mobile/assets` non créé par `npm run build`. PWA inaccessible en prod. |
| **P1.3** | Icônes PWA (`manifest` & `index.html`) | **TROU** | **C** | `src/server/mobile/assets/manifest.webmanifest:28,41` | `icon-96.png` et `icon-192.png` absents du répertoire des assets (404). |
| **P1.4** | Coquille statique servie sans auth | **TIENT** | - | `src/server/index.ts:1078` | Comportement standard et acceptable pour une SPA/PWA (l'API/WS reste protégée). |
| **P2** | Protocole WebSocket client vs serveur | **TROU** | **A** | `src/server/mobile/assets/app.js:256-307` | Protocole client inventé (`auth_success`, `chat_stream`, `data.message`) incompatible avec le serveur. |
| **P3** | Sélecteur d'assistants (Lisa / Pairs) | **TROU** | **B** | `src/server/mobile/assets/app.js:914,1193` | Seul l'agent local est câblé ; Lisa et les pairs sont un pur changement de label UI. |
| **P4** | Confirmations `ConfirmationService` | **TROU** | **B** | `src/server/websocket/handler.ts` | Aucune intégration WS : messages `confirmation_required` et `confirmation_response` absents. |
| **P5.1** | Routes Runs et Trajectory | **TROU** | **B** | `src/server/mobile/assets/app.js:502,985` | Routes `/api/runs` et `/api/runs/:id/trajectory` inexistantes côté backend (404). |
| **P5.2** | Vue Statut (Fournisseur & Santé) | **TROU** | **B** | `src/server/mobile/assets/app.js:713-727` | Fournisseur codé en dur à « À déterminer » ; pas d'affichage de santé ni repli. |
| **P6** | Sécurité CSP | **TROU** | **C** | `src/server/mobile/assets/index.html:13` | Présence injustifiée de `'unsafe-eval'` et présence de `'unsafe-inline'`. |
| **P7** | Régression tests serveur | **TROU** | **A** | `tests/server/` | 18 suites et 40 tests cassés dans `tests/server/` dont `mobile-pwa.test.ts`. |
| **P8** | Pilotage de la flotte | **TROU** | **B** | `src/server/mobile/assets/index.html` | Manque le lancement de missions, la vue des lanes, l'assignation et la télémétrie des pairs. |

---

VERDICT: 10 trous
