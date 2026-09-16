# VERIF-PILOTE — Nuit 2026-09-06

Vérification croisée de deux correctifs écrits par le pilote lui-même, jamais relus par une autre lignée :
1. Reconnexion PWA (`src/server/mobile/assets/app.js`, commit `574aa0138`)
2. Budget de stall local (`src/utils/stream-stall-guard.ts`, `src/codebuddy/client.ts`, commits `57bca8330`, `e738178a5`)

Worktree : `~/DEV/cb-verif-nuit-2026-09-06`, branche `verif/nuit-2026-09-06`.

> Statut : CLOS — vérification complète réalisée avec succès.

## 0. Préconditions

- Worktree : `~/DEV/cb-verif-nuit-2026-09-06`, branche `verif/nuit-2026-09-06` (HEAD `631071f6f`).
- `~/code-buddy` et `~/.codebuddy` préservés et non touchés.
- Processus hôtes externes intacts (services d'inférence non impactés).
- Environnement d'exécution Vitest : `HOME=~/DEV/cb-verif-nuit-2026-09-06/_qa/vn/home`, `env -u FORCE_COLOR`, ports éphémères / ≥ 5300.

## 1. Reconnexion PWA

| # | Point vérifié | Verdict | Preuve |
|---|---|---|---|
| 1a | Deux reconnexions concurrentes (timer + `visibilitychange`) ⇒ deux sockets ? | TIENT | `ensureConnected()` (`app.js` L218-226) annule explicitement `state.reconnectTimer` et court-circuite si `state.ws.readyState === 0`. `connectWs()` (L1142-1147) ferme tout socket existant (`state.ws.close()`, `onclose = null`) et le listener `close` filtre les sockets obsolètes (`if (state.ws !== ws) return;`). Pas de double socket possible. |
| 1b | `send('chat')` pendant `readyState === 0` : file ou perdu ? | TIENT | Dans `send()` (L182-189), `if (type === 'chat' && !wsOpen())` est vérifié car `wsOpen()` exige `readyState === 1`. Le message est enfilé dans `state.outbox` (plafonné à 5), conservé et envoyé par `flushOutbox()` dès la réception de la trame `authenticated` (L1064). Rien n'est perdu. |
| 1c | File de 5 : ordre conservé ? doublon si l'utilisateur renvoie ? | TIENT | Ordre FIFO conservé (`push()` en queue, `shift()` en tête, puis `pending.forEach()` dans `flushOutbox()` L194-201). Aucun doublon sur double-clic involontaire car `sendText()` (L918-922) vide `input.value = ''` immédiatement. Si l'utilisateur retape et renvoie le même message, il est enfilé en tant que second message distinct (comportement chat standard). `flushOutbox` vide la file atomiquement avant émission. |
| 1d | `logout` puis `login` : `manualClose` remis à `false` ? | TIENT | `logout()` (L1190) positionne `state.manualClose = true;`. Lors de `login()` (L1184), `connectWs()` est appelé et réinitialise `state.manualClose = false;` à sa toute première ligne (L1143). La reconnexion automatique redevient active. |
| 1e | Après 6 échecs délai 30 s constant ; plafond de tentatives / fuite de timers ? | TIENT | Le délai est plafonné à 30 s via `Math.min(30000, 1000 * Math.pow(2, Math.min(state.reconnectAttempt, 5)))` (L204). Pas de plafond arbitraire d'essais : la PWA réessaye indéfiniment toutes les 30 s pour survivre aux coupures réseau prolongées. Aucune fuite de timers : un seul timer actif `state.reconnectTimer` à la fois, remis à 0 avant chaque nouvelle connexion ou nettoyé lors d'une déconnexion/succès. |
| 1f | Ping 25 s sur socket fermé ⇒ erreur console ? | TIENT | Dès la fermeture du WebSocket (L1160-1167), `state.connected = false;`. L'intervalle de ping (L1169-1171) vérifie `if (state.connected) send('ping');`, donc `send('ping')` n'est pas appelé. De plus, `send()` dispose d'un garde dur `if (!state.ws || state.ws.readyState !== 1) return;` empêchant tout appel à `ws.send()` sur un socket fermé. Aucune erreur console. |

## 2. Stall local

| # | Point vérifié | Verdict | Preuve |
|---|---|---|---|
| 2a | `isEffectiveTargetLocal()` chaîne de repli vide + origine indisponible | TIENT | Dans `isEffectiveTargetLocal()` (`src/codebuddy/client.ts` L686-693), `this.fallbackProviders[0] ?? this.credentialPoolProviders[0]` vaut `undefined` si la chaîne est vide. La condition `if (first)` est fausse et l'évaluation retombe sur `return isLocalLlmProvider();`, renvoyant le statut du runtime d'origine sans lever d'exception ni crash. |
| 2b | Budget paresseux ré-évalué à chaque attente de premier token ? | TIENT | `firstTokenTimeoutMs` est passé à `withStallGuard` comme closure paresseuse `() => resolveFirstTokenStallTimeoutMs(...)` (`agent-executor.ts` L1658-1660). `withStallGuard` (`stream-stall-guard.ts` L100-109) résout ce budget à l'attente du premier token. Lors d'une bascule de fournisseur sous `withLlmStreamRetry`, `streamFactory()` est invoqué à nouveau et réévalue dynamiquement la localité effective de la cible. |
| 2c | `CODEBUDDY_LLM_STALL_TIMEOUT_MS=0` ⇒ pas d'exception | TIENT | `resolveStallTimeoutMs` renvoie `0`. Dans `withStallGuard` (L94-97), `if (timeoutMs <= 0) { yield* stream; return; }` court-circuite immédiatement le garde ; aucun timer n'est initialisé et aucune exception `LlmStallError` n'est déclenchée. |
| 2d | Origine locale + bascule cloud ⇒ budget redevient 120 s ? | TIENT | Lors d'une bascule vers un fournisseur cloud (`authMode !== 'local'`), `isLocalFailoverCandidate(this.activeFallback)` renvoie `false`. L'option `{ targetIsLocal: false }` fournie à `resolveFirstTokenStallTimeoutMs` neutralise `isLocalLlmProvider(env)` (L66 : `if (!isLocal) return afterFirst;`). Le budget retombe immédiatement à `afterFirst` = 120 000 ms (120 s). |

## 3. Suites de vérification

Commandes exécutées sous `HOME=~/DEV/cb-verif-nuit-2026-09-06/_qa/vn/home` et `env -u FORCE_COLOR` :

1. **TypeScript compilation** :
   ```bash
   npx tsc --noEmit -p tsconfig.json
   ```
   Résultat : Code 0 (0 erreur).

2. **Linter ESLint** :
   ```bash
   npx eslint --quiet src/server/mobile/assets/app.js src/utils/stream-stall-guard.ts src/codebuddy/client.ts
   ```
   Résultat : Code 0 (0 avertissement, 0 erreur).

3. **Suites de tests Vitest** :
   ```bash
   npx vitest run tests/server/mobile-chat-ui.test.ts tests/server/mobile-pwa.test.ts tests/utils tests/codebuddy tests/agent/execution tests/security/donnees-personnelles.test.ts
   ```
   Détail par ensemble :
   - `tests/server/mobile-chat-ui.test.ts` & `tests/server/mobile-pwa.test.ts` : 2 fichiers, 62 tests passés.
   - `tests/utils` : 29 fichiers, 530 tests passés, 3 ignorés.
   - `tests/codebuddy` : 26 fichiers, 335 tests passés.
   - `tests/agent/execution` : 11 fichiers, 204 tests passés.
   - `tests/security/donnees-personnelles.test.ts` : 1 fichier, 40 tests passés.
   - **Total combiné** : 69 fichiers passés (69/69), 1171 tests passés, 3 ignorés, 0 échec en 14.84 s.

## 4. Bilan

Les vérifications croisées sur la reconnexion PWA et le budget de stall local confirment la solidité des implémentations.
Sur la PWA, la concurrence entre timer et visibilité est protégée, la file d'attente hors ligne préserve l'ordre FIFO sans doublon parasite, le cycle logout/login réactive la reconnexion, et aucun battement de ping n'est émis sur socket fermé.
Sur le stall guard, la résolution dynamique de la cible locale gère les chaînes vides sans erreur, le budget paresseux est réévalué lors du premier token et après bascule, la désactivation par timeout nul est respectée, et le repli local vers cloud rétablit le budget nominal de 120 s.
L'ensemble des suites de tests ciblées (69 fichiers, 1171 tests) est vert sans aucune régression.
Le typage statique TypeScript (`tsc --noEmit`) et le linting ESLint sont impeccables (0 erreur).
Aucune modification de code n'est requise : tous les invariants testés et analysés tiennent.

VERDICT: PUSHABLE
