# Réparation PWA Bridge C & Chat v2 — Rapport de mission

**Date** : 2026-09-06  
**Branche** : `fix/pwa-bridge-c-2026-09-06`  
**Dépôt** : `~/DEV/cb-pwa-c-2026-09-06`  
**Auteur** : Antigravity (AGY)  
**Environnement de test isolé** : `HOME=~/DEV/cb-pwa-c-2026-09-06/_qa/pwac/home`, `env -u FORCE_COLOR`, ports dynamiques (≥ 4000)

---

## 1. Contexte et Objectifs

Fermer les 4 observations C de la contre-vérification Opus du pont d'approbation PWA (`docs/reports/2026-09/VERIF-PWA-SECU-OPUS.md`) et les 2 trous C du chat v2 (`docs/reports/2026-09/VERIF-PWA-CHAT-AGY.md`) :

1. **C-1 : `status` pose `approvalCapable` sans exiger l'auth** (`src/server/websocket/handler.ts`) : n'accepter le drapeau que d'un socket authentifié, non anonyme distant, portée `tools` ; sinon ignorer avec `warn`.
2. **C-2 : Le drapeau n'est jamais retiré** : `approvalCapable` retombe à `false` sur un `status` qui l'omet ou le met à `false`, et à la fermeture du socket ; test : après retrait, le socket ne reçoit plus `confirmation_required` et le repli Telegram reprend.
3. **C-3 / C-4 : Destinataires = éligibles et non servis** + **`stopServer` ne déwire pas le pont** (`src/server/index.ts`, `src/server/websocket/confirmation-bridge.ts`) : ne retenir comme destinataires que les sockets effectivement livrés par `broadcast` ; si aucun socket n'est servi (contre-pression / buffer overflow), replier immédiatement sur Telegram (`return null`) sans bloquer sur le délai ; `stopServer` appelle `unwireMobileConfirmationBridge()` qui remet `ConfirmationService` sans pont et vide `pending` (chaque attente résolue `confirmed:false`).
4. **Chat v2 (TROU C1 & C2)** : test `QuotaExceededError` sur `localStorage` (mock qui lance) ⇒ aucune exception non rattrachée, historique tronqué progressivement et images ≤ 5 ; bouton 🎤 : si `SpeechRecognition` absent (Firefox, PWA sans permission), le bouton est masqué (`hidden`) au lieu d'un clic mort.
5. **Preuves et non-régression**.

---

## 2. Tableau Récapitulatif des Corrections

| Point | Description | Fichiers modifiés | Statut TDD | Commit |
|---|---|---|---|---|
| **1 (C-1)** | Filtrage `approvalCapable` dans `status` | `src/server/websocket/handler.ts`<br>`tests/server/mobile-confirmation.test.ts` | Rouge → Vert | `080073a2e` |
| **2 (C-2)** | Retrait de `approvalCapable` (omission, `false`, disconnect) | `src/server/websocket/handler.ts`<br>`tests/server/mobile-confirmation.test.ts` | Rouge → Vert | `74cfcfc5c` |
| **3 (C-3/C-4)** | Destinataires servis + teardown `stopServer` | `src/server/index.ts`<br>`src/server/websocket/confirmation-bridge.ts`<br>`src/utils/confirmation-service.ts`<br>`tests/server/mobile-confirmation.test.ts`<br>`tests/server/mobile-pwa.test.ts` | Rouge → Vert | `03fbaf052` |
| **4 (C-Chat)** | Quota `localStorage` tronqué + bouton micro masqué | `src/server/mobile/assets/app.js`<br>`tests/server/mobile-chat-ui.test.ts` | Rouge → Vert | `4341bcfb5` |

---

## 3. Détail technique et preuves par point

### Point 1 — `status` n'accepte `approvalCapable` que si authentifié, non anonyme, avec portée `tools`
- **Correction** : Dans `src/server/websocket/handler.ts` (gestionnaire du message `status`), vérification que `state.authenticated && !state.anonymousRemote && state.scopes.includes('tools')`. À défaut, le drapeau est ignoré et un `logger.warn('[ws] status approvalCapable ignored …')` est émis.
- **TDD Rouge** : Test vérifiant le rejet avec warning sur socket non-authentifié, socket distant anonyme sous `--no-auth`, et socket authentifié sans portée `tools`. 2 échecs initiaux.
- **TDD Vert** : Succès après ajout de la garde et de l'avertissement.
- **Commit** : `080073a2e` `fix(security): exiger un socket authentifié et porté tools pour approvalCapable dans status`.

### Point 2 — Réinitialisation de `approvalCapable` sur omission, false ou déconnexion
- **Correction** : Dans `handler.ts`, la branche `else` du test `approvalCapable === true` repasse `state.approvalCapable = false`. De même dans `resetWebSocketExtensionsForIdentityChange`, `ws.on('close')`, `ws.on('error')`, `closeAllConnections()` et lors de la terminaison heartbeat idle.
- **TDD Rouge** : `AssertionError: expected [ 'ws_...' ] to have a length of +0 but got 1` lors de l'envoi d'un payload `{}` ou `approvalCapable: false`.
- **TDD Vert** : Succès, `collectApprovalSurfaceIds()` retombe à 0, le socket ne reçoit plus `confirmation_required` et le repli Telegram s'exécute immédiatement.
- **Commit** : `74cfcfc5c` `fix(security): retirer approvalCapable lors d'une omission/false ou fermeture socket`.

### Point 3 — Destinataires servis et déconnexion du pont à l'arrêt du serveur
- **Correction** :
  1. `src/server/websocket/confirmation-bridge.ts` : `deps.broadcast` est appelé avant l'enregistrement dans `pending`. Seuls les identifiants effectivement livrés (`servedIds`) constituent `recipientIds`. Si `servedIds.length === 0` (ex: contre-pression / `bufferedAmount` trop élevé), le pont retourne `null` immédiatement au lieu d'attendre l'expiration du délai (30s) pour un refus.
  2. `src/server/index.ts` : `unwireMobileConfirmationBridge()` est importé et appelé dans `stopServer()` au milieu des 6 autres ponts.
  3. `src/utils/confirmation-service.ts` : ajout de l'accesseur `getWsApprovalBridge()` pour inspecter l'état du pont.
- **TDD Rouge** :
  - `C-3 falls back to Telegram immediately if all approval sockets drop under backpressure` : échouait avec `{ confirmed: false, feedback: 'Confirmation timed out' }` après 2000ms.
  - `C-4 stopServer unwires the bridge` : échouait avec `expected [AsyncFunction] to be null`.
- **TDD Vert** : Repli Telegram instantané sans timeout et `service.getWsApprovalBridge() === null` avec `pendingMobileConfirmationCount() === 0` (résolu `confirmed: false`).
- **Commit** : `03fbaf052` `fix(security): restreindre les destinataires aux sockets servis et déconnecter le pont à l'arrêt du serveur`.

### Point 4 — Chat v2 : QuotaExceededError et masquage du bouton micro
- **Correction** :
  1. `src/server/mobile/assets/app.js` :
     - `persistHistory()` intercepte l'échec de `storeSet()`. Si le quota est dépassé, il tente d'abord de sauvegarder sans images, puis tronque progressivement l'historique par moitié (`candidate.slice(Math.ceil(candidate.length / 2))`) jusqu'à succès ou 1 message restant, sans jamais propager d'exception.
     - Bouton `#mic-btn` : détecte `Boolean(root.SpeechRecognition || root.webkitSpeechRecognition)`. Si absent (Firefox, PWA sans permission), applique `classList.add('hidden')` et `hidden = true`. Si présent, affiche et attache l'écouteur `startDictation`.
- **TDD Rouge** :
  - `handles QuotaExceededError without unhandled exception and truncates history` : `expected 20 to be less than or equal to 5`.
  - `hides the mic button when SpeechRecognition is absent` : `expected false to be true`.
- **TDD Vert** : 24/24 tests DOM passés.
- **Commit** : `4341bcfb5` `fix(mobile): tronquer l'historique sur QuotaExceededError et masquer le micro sans reconnaissance vocale`.

---

## 4. Preuves de Validation Complète

1. **Vitest ciblés** :
   ```bash
   HOME=~/DEV/cb-pwa-c-2026-09-06/_qa/pwac/home env -u FORCE_COLOR npx vitest run tests/server tests/utils/confirmation-service*.test.ts tests/security/donnees-personnelles.test.ts
   ```
   **Résultat** : 69 passed, 2 skipped (gardes Playwright sans navigateur headless Chromium), **705 tests passés, 0 échec** (en 19.48s).

2. **Typage TypeScript** :
   ```bash
   npx tsc --noEmit -p tsconfig.json
   ```
   **Résultat** : Code de sortie 0, **0 erreur**.

3. **Linter ESLint** :
   ```bash
   npm run lint
   ```
   **Résultat** : Code de sortie 0, **0 erreur** (2484 warnings préexistants inchangés).

4. **Diff git et formatage** :
   ```bash
   git diff --check
   ```
   **Résultat** : Aucun espace résiduel ni problème de fin de ligne (code 0).

5. **Inviolabilité sans drapeau** :
   Sans `CODEBUDDY_MOBILE_PWA=true`, la route renvoie 404 avant l'authentification et le pont WS n'est jamais installé (`tests/server/mobile-pwa.test.ts` : 29/29 verts).
