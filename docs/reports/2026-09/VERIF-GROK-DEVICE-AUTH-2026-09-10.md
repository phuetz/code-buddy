# VERIF-GROK-DEVICE-AUTH — 2026-09-10

Vérificateur à contexte frais (Grok 4.6) du lot authentification d’appareil Android livré par Astra.

- Clone : `code-buddy-device-auth-2026-09-10`
- Branche vérifiée : `astra/device-auth-2026-09-10`
- HEAD vérifié : `24c4db130ab1ac56c8c58cae2aa85510a5fa4738`
- Base `origin/main` : `76e675a6923e67e48b2fb2cf68c7fdd7c5fba5f7`
- Commits Astra : `9a4d6b7db` (réservation), `b7de292c8` (core), `7ddf1a4a2` (CLI), `24c4db130` (doc)
- Rapport Astra : `docs/reports/2026-09/DEVICE-AUTH-ASTRA-2026-09-10.md`
- HOME QA : `_qa/verif-device/home` (gitignoré)
- Aucun fichier de code modifié. Aucun push. Aucune clé réelle, aucun jeton, aucun code d’appairage dans ce rapport.

Rapport créé **avant** inspection, puis complété par exécution (`timeout 900`, serveur spawn+kill dans le même harnais, pas de processus laissé).

Index Code Explorer : `status` INDEXED sur `24c4db130` à l’arrivée ; `analyze . --force` relancé (MCP disait « Repository not found »). Après force, le CLI liste ce clone ; le serveur MCP de la session continue de le refuser. Les `context` / `impact` / `query` utiles ont donc été faits en CLI. Homonymes écartés : `register` (ACP), `generateToken` / `refreshToken` (JWT générique).

## 1. Surface Astra (`git diff --stat origin/main..HEAD`)

21 fichiers, +1341 / −28. Fichiers de production :

| Fichier | Rôle |
| --- | --- |
| `src/server/auth/device-store.ts` | Pairing, register/challenge/verify, révocation |
| `src/server/routes/device-auth.ts` | 3 POST publics + 10 req/min |
| `src/server/auth/device-token.ts` | Garde de révocation HTTP |
| `src/server/auth/device-session-context.ts` | Identité signée du tour WS |
| `src/server/auth/jwt.ts` | Claims + refus de refresh device |
| `src/server/websocket/handler.ts` | Profil agent, pont de confirmation |
| `src/utils/device-store-file.ts` | Enveloppe 0600 + verrou |
| `src/commands/device-auth.ts` | `buddy pair` / `buddy devices` |
| `src/index.ts` | Enregistrement paresseux des commandes |
| `docs/mobile-pwa.md`, `CLAUDE.md` | Contrat et commandes |

`git diff --check origin/main..HEAD` : exit 0. Aucun chemin `/home/…` ni secret dans le diff fonctionnel.

## 2. Sécurité — lecture + exécution live

Preuves live : harnais `_qa/verif-device/live.mjs` (gitignoré), `buddy` via `tsx src/index.ts`, HOME isolé, `JWT_SECRET` factice non repris ici, clés LLM retirées de l’environnement du serveur (aucun appel payant). Port éphémère `127.0.0.1`. Serveur arrêté (SIGTERM, exit 0).

| Propriété | Verdict | Preuve |
| --- | --- | --- |
| Code d’appairage unique et expirant (8 car. 10 min, hash SHA-256, pas d’HTTP d’émission) | TIENT | `createPairing` + live `buddy pair --json` (codeLen=8) ; second `register` du même code → 400 `Invalid pairing request` ; disque sans le code en clair |
| Nonce unique ; rejeu → 401 | TIENT | Live : verify 200 puis rejeu 401 `Authentication failed` ; mauvaise signature consomme le nonce (verify original ensuite 401) |
| Signature liée à `deviceId` (`deviceId + "." + nonce` UTF-8, ES256) | TIENT | Live : autre clé P-256 → 401 ; octets signés avec un autre UUID → 401 ; WebCrypto `sign`/`verify` SHA-256 |
| Appareil révoqué → 401 | TIENT | Live : `buddy devices revoke` puis `challenge` 401 ; nouvel `authenticate` WS `AUTH_FAILED` ; socket déjà ouvert → `AUTH_FAILED` au chat suivant |
| Limite de débit 10/min, IP de transport, pas `X-Forwarded-For` | TIENT | Code : `keyGenerator: req => req.socket.remoteAddress` ; live : 429 `Too many requests` sur `/challenge` |
| Aucune clé privée côté serveur | TIENT | Schéma JWK public only ; `d` refusé ; live `devices.json` sans `"d"` ; `importKey` `['verify']` seulement |
| Erreurs sans détail exploitable | TIENT | 400 `Invalid pairing request` / 401 `Authentication failed` / 429 `Too many requests` ; live : pas d’id, nonce ou signature dans le corps d’erreur |
| `devices.json` 0600 + écriture atomique + verrou | TIENT | `writeJsonAtomicSync(..., { mode: 0o600 })` ; live `mode=600` ; lock `mkdir` fail-closed ; pas de restauration `.bak` |
| Journal d’audit sans preuve | TIENT | Actions `device_register` / `device_verify` / `device_revoke` ; live : événements présents, code/jeton/signature absents |
| Refresh JWT device interdit | TIENT | `refreshToken` retourne `null` si `amr` contient `device` (tests WS) |

Harnais live : **29/30 PASS**. Le seul FAIL est `confirmation_required` sur `buddy server` sans fournisseur LLM (voir §3).

## 3. Scénario réel pair → JWT → `/ws`

Exécuté, pas lu.

1. `buddy server --host 127.0.0.1` + `GET /api/health` 200.
2. `buddy pair --json --url http://127.0.0.1:<port>` → `{ url, pairingCode }` 8 caractères.
3. Node WebCrypto P-256 : `POST /api/auth/device/register` `{ pairingCode, deviceName, publicKeyJwk }` (JWK Android-like avec `use: "sig"`) → `{ deviceId }` 200, `Cache-Control: no-store`.
4. `POST .../challenge` `{ deviceId }` → nonce 32 octets base64url, `expiresAt` **chaîne ISO 8601**.
5. Signature ES256 des octets UTF-8 `deviceId + "." + nonce`, `POST .../verify` `{ deviceId, nonce, signature }` → `{ token }` uniquement.
6. JWT décodé : `identity: "owner"`, `amr: ["biometric","device"]`, `profile: "agent"`, `sub: deviceId`, `exp - iat = 3600`.
7. WS `/ws` `authenticate` avec ce jeton → `authenticated.payload` = `userId, scopes, profile, identity, amr`.
8. `chat` `{ message: "hello", assistant: "companion" }` **n’emprunte pas** le routeur companion : types `connected,authenticated,ack,error` (agent sans fournisseur ; clés LLM volontairement absentes). Le journal serveur ne montre pas `[companion-turn]` sur ce tour.
9. Jeton **sans** ces champs (`buddy token --user demo --days 1`) : claims sans `amr`/`profile`/`identity`. `authenticate` avec `profile`/`identity`/`amr` **forgés côté client** → payload **exact** `{"userId":"demo","scopes":["chat","chat:stream","sessions","tools"]}` (byte-identique, aucun champ device). `chat` `assistant: companion` → `chat_response` + log `[companion-turn] no provider resolved for the companion surface`.
10. Serveur arrêté.

`confirmation_required` **n’est pas arrivé** sur le `buddy server` live : pas de tour d’outil (pas de fournisseur). Ce n’est pas un démenti du câblage. Les tests `tests/server/device-auth.test.ts` exécutent un vrai `setupWebSocket` + `ConfirmationService.requestConfirmation` et reçoivent `confirmation_required { tool: write_file, summary: write: test.txt }`, y compris avec `assistant: companion` et `CODEBUDDY_MOBILE_PWA=false`. Un jeton historique `approvalCapable: true` ne reçoit pas le prompt quand seul Android a armé le pont.

Session agent : `handler.ts` force `assistant = 'agent'` si `state.profile === 'agent'`, mode permission `default` par tour, `approvalCapable = true`, pont existant. Les jetons device ont les portées `chat, chat:stream, sessions, tools` (pas `tools:execute`) : `execute_tool` WS reste interdit ; les confirmations passent par le tour agent, comme documenté.

## 4. Typecheck, lint, tests

| Commande | Résultat |
| --- | --- |
| `timeout 900 npm run typecheck` | exit 0 (`tsc --noEmit` + gpuNode-identity + companion-core) |
| `npx eslint --max-warnings=0` sur les 16 fichiers touchés | exit 0, 0 avertissement |
| `timeout 900 npm test -- tests/server` (HOME QA) | **79 fichiers verts, 2 fichiers ignorés ; 752 tests verts, 2 ignorés, 0 rouge** ; 11,48 s |
| `timeout 900 npm test -- tests/commands` (HOME QA, **tout** le répertoire) | **138 fichiers verts ; 1345 tests verts, 4 ignorés, 0 rouge** ; exit 0 |

Astra annonçait 776/778 sur `tests/server` **plus** `tests/commands/token` (pas tout `tests/commands`). Les **2 ignorés d’Astra** sont bien dans `tests/server` :

1. `tests/server/mobile-ws-live.test.ts` — `describe.skipIf(process.env.RUN_MOBILE_LIVE !== '1')` : fumée Ollama live, opt-in. `RUN_MOBILE_LIVE` unset.
2. `tests/server/chat-route-real-gpt55.test.ts` — `describe.skipIf(process.env.CODEBUDDY_REAL_GPT55_SERVER !== '1')` : ChatGPT réel payant, opt-in. Un test chacun → 2 tests ignorés.

`tests/commands` complet (plus large qu’Astra) ignore 4 cas **préexistants, hors lot** : `backup-profile.test.ts` `it.skip('should handle both scope backup')` (commentaire : mock multi-source) ; 3 fumées navigateur Hermes (`it.skipIf(process.env.CI \|\| !chromiumExecutableExists())`) — `CI=true` dans cet environnement.

`gk30-widget-capture.test.ts` n’est **pas** dans les 2 ignorés (Chromium présent, fichier exécuté).

## 5. Hygiène et contrat Android

- Aucun `/home/…` dans le diff Astra ni dans ce rapport.
- Aucun secret, code d’appairage, nonce, signature ou JWT dans les fichiers suivis.
- `docs/mobile-pwa.md` § Application Android et `CLAUDE.md` (commandes `buddy pair` / `buddy devices`, routes `/api/auth/device/*`, JWT agent/owner, WS default, `getDeviceSessionIdentity`) correspondent au code.

Contrat **requête** vs app Android (`DeviceAuthClient.kt`, `KeystoreManager.signData`) :

| Élément | Serveur | App | Match |
| --- | --- | --- | --- |
| `register { pairingCode, deviceName, publicKeyJwk }` | oui | oui | oui |
| `challenge { deviceId }` | oui | oui | oui |
| `verify { deviceId, nonce, signature }` | oui | oui | oui |
| ES256 sur UTF-8 `deviceId + "." + nonce` | oui | oui (`SHA256withECDSA`) | oui |
| JWK `kty=EC crv=P-256 x y` base64url | oui | oui ; `use: "sig"` en plus | oui (Zod strippe `use`) |
| Signature DER native base64url | acceptée | `Base64.getUrlEncoder().withoutPadding()` sur DER | oui |

Écart **réponse**, hors liste exigée par la mission mais réel pour un téléphone actuel :

- Challenge : serveur `expiresAt` ISO 8601 (doc + live `typeof string`) ; Kotlin `json.get("expiresAt")?.asLong` (nombre). Un ISO fait lever Gson avant le repli.
- Verify : serveur `{ token }` ; Kotlin `token` + `expiresAt` Long avec **repli** si absent → verify OK.

Le mock Android (`scripts/mock-auth-ws-server.js`) émet `expiresAt` numérique. Ce n’est pas le contrat documenté de Code Buddy. Suivi : lane Android doit parser l’ISO (ou le serveur pourrait *ajouter* un epoch sans retirer l’ISO). Ça n’invalide pas les champs de requête listés.

## 6. Limites (honnêtes)

- Pas de téléphone / Keystore / biométrie réelle (lane Android).
- `confirmation_required` non vu sur `buddy server` sans LLM ; vu dans les tests WS réels.
- `npm run validate` global non rejoué (Astra : timeout 900 s, 28 rouges hors lot, antériorité non prouvée).
- MCP Code Explorer n’a pas inscrit ce clone malgré `analyze --force` ; CLI oui.

## Outillage

Outillage : 14 appels Code Explorer CLI (context/impact/query, dont 2 homonymes écartés) + 1 `analyze --force` ; 7 appels MCP échoués (registre) ; 5 commandes via lm-resizer, 74 485 octets économisés nets (77 154 bruts → 2 802 transmis). Volumes de sortie, pas des jetons facturés.

Index : à jour sur `24c4db130` avant inspection ; réindexé `--force` (même commit). Réindexation incrémentale après le commit de ce rapport.

## Bilan

Vérifié par exécution le lot Astra `24c4db130` sans toucher au code. Pairing unique/hashé, nonce anti-rejeu, signature liée à `deviceId`, révocation 401 HTTP+WS, 429, 0600, audit sans preuve : tous tenus sur un vrai `buddy server`. JWT 1 h `owner` / `agent` / `amr` biometric+device. `/ws` device = session agent (companion forcé ignoré) ; jeton historique = payload byte-identique et route companion. Typecheck 0, eslint ciblé 0, `tests/server` 752/2 skip/0 rouge, `tests/commands` 1345/4 skip hors lot/0 rouge. Les 2 ignorés Astra sont les fumées opt-in Ollama et GPT-5.5. `confirmation_required` live sans fournisseur non exercé ; tests WS réels oui. Écart Android `expiresAt` (ISO vs Long) à traiter dans la lane app.

VERDICT: PUSHABLE
===LANE_GROK_VERIF_DEVICE_AUTH_TERMINE===
