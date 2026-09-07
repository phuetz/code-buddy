# VERIF-PWA-CHAT-V3-SONNET — vérification à contexte frais du lot « chat mobile v3 »

Date : 2026-09-07 (Europe/Paris)
Agent : Claude Sonnet 5.1, vérificateur à contexte frais
Worktree : `~/DEV/cb-chat-v3-2026-09-07`
Branche : `feat/pwa-chat-v3-2026-09-07`
HEAD : `5179c8595`
`~/code-buddy` et `~/.codebuddy` : interdits (non touchés)
HOME QA : `~/DEV/cb-chat-v3-2026-09-07/_qa/verif/home` (gitignoré)
Ollama : `http://127.0.0.1:11435` (`qwen3:4b-instruct`, non nécessaire à cette vérification)
Rapport créé avant inspection du code.

## Méthode

Lecture de `docs/reports/2026-09/PWA-CHAT-V3-GROK.md`, puis `git diff c94033686..HEAD -- src tests`
restreint aux surfaces serveur nouvelles (`src/server/mobile/{push,link-preview,voice-note,index,
chat-extras,telegram-forward}.ts`, `src/server/websocket/handler.ts`,
`src/companion/mobile-conversation-log.ts`, `src/companion/mobile-history.ts`). Chaque point a été
vérifié par lecture de code puis, pour les points de sécurité, par une preuve exécutable jetable
sous `_qa/verif/proof/` (non commitée) : SSRF push, SSRF aperçu de lien (loopback/lien-local/
RFC1918/redirection), isolation d'historique entre deux jetons, drapeau désactivé.

## Tableau point → verdict

| # | Point | Verdict | Preuve |
|---|---|---|---|
| 1a | VAPID : clés dans `~/.codebuddy/push/`, mode 0600, jamais journalisées | TIENT | `push.ts:74-80` `writeJsonAtomicSync(file, keys, {mode:0o600})` ; `logger.warn` ne loggue que le message d'erreur, jamais les clés |
| 1b | `POST /push/subscribe` exige JWT (ou loopback direct) et refuse 404 hors drapeau | TIENT (B mineur) | `requireAlbumAccess` avant le handler ; preuve : flag off + loopback sans jeton → `404 {"error":"Push disabled"}`. Pas de vérification de **portée** (`scopes`) — juste une signature JWT valide, comme le reste des routes mobile existantes (pattern réutilisé, pas une régression de ce lot) |
| 1c | Plafond d'abonnements **par identité** | **TROU (A)** | `savePushSubscription(sub, env)` n'a **aucun paramètre d'identité** (arité 1 confirmée) : une seule liste globale plafonnée à 20 au total (`subsPath`), pas par utilisateur. Un flot de `subscribe` peut évincer les abonnements d'autrui |
| 1d | `endpoint` validé (https, pas de loopback/RFC1918 = SSRF) | **TROU (A)** | `savePushSubscription` ne vérifie que `endpoint.startsWith('https://')`. Preuve : `https://127.0.0.1:6001/evil`, `https://169.254.169.254/...`, `https://10.0.0.5/...`, `https://[::1]/evil` tous **acceptés**. Si `web-push` est un jour installé, `defaultWebPushSend` POSTera vers ces cibles avec les clés VAPID serveur — SSRF réseau interne par abonnement forgé |
| 1e | Envoi = transport injectable, `web-push` absent ⇒ pas d'exception | TIENT | `defaultWebPushSend` : `import('web-push')` dans un `try/catch`, retourne `false`, log `warn` seul |
| 1f | Désabonnement | **TROU (B)** | Aucune route ni fonction d'unsubscribe dans `push.ts`/`index.ts`/`app.js` — grep vide. Une fois abonné, l'abonnement vit jusqu'à éviction par le plafond de 20 |
| 1g | Byte-identique sans le drapeau | TIENT | `isMobilePushEnabled` gate chaque fonction ; `/push/vapid` et `/push/subscribe` → 404 vérifiés |
| 2a | `/history` exige JWT, identité = `sub` du jeton | TIENT | `mobilePwaRouter.get('/history', requireAlbumAccess, ...)` extrait `sub` via `verifyToken` |
| 2b | Jeton A ne lit pas l'historique de B | TIENT (non couvert par la suite) | Preuve : jeton B sur un journal contenant `user-a`+`user-b` → renvoie **uniquement** `SECRET B`. **Aucun test HTTP** de ce parcours dans `tests/` (seuls des tests unitaires sur `readConversationLog` existent) — lacune de couverture à combler |
| 2c | `limit` borné | TIENT | `Math.min(50, Math.max(1, opts.limit ?? 50))` dans `mobile-conversation-log.ts:67` |
| 2d | Journal `<hash-sha256>.jsonl`, 0600, aucun octet d'image/audio | TIENT | `appendConversationLog` n'écrit que `text` (les tours vocaux sont déjà transcrits en texte avant d'atteindre l'historique, `mobile-history.ts:132-141`) ; fichier créé avec `mode:0o600` |
| 2e | Taille du journal bornée / rotation | **TROU (C)** | `appendConversationLog` ajoute indéfiniment (aucune purge) ; `readConversationLog` relit `fs.readFileSync` **tout le fichier** à chaque requête — croissance et coût mémoire non bornés dans le temps |
| 3a | Aperçu de lien passe par le garde SSRF existant | TIENT | `link-preview.ts` importe `safeFetchFollow`. Preuve directe (hors mocks du test livré) : `127.0.0.1:6001`, `169.254.169.254`, `10.0.0.1` → bloqués (`URL blocked by SSRF guard`) ; redirection 302 vers `127.0.0.1` → bloquée aussi (re-validation par saut) ; `file://` → 400 |
| 3b | Taille de réponse bornée | **TROU (B)** | `await res.text()` lit **tout le corps** avant le `.slice(0, 80_000)` ; `safeFetchFollow` n'impose aucun plafond d'octets. Un site distant renvoyant un corps énorme épuise la mémoire serveur par requête |
| 3c | Timeout, cache 24 h | TIENT / **TROU (C)** | `AbortSignal.timeout(5000)` présent. Cache = `Map` en mémoire, TTL 24 h vérifié **à la lecture** mais **sans plafond du nombre d'entrées** — croissance illimitée si beaucoup d'URLs différentes sont prévisualisées |
| 3d | Titre/description échappés côté client (XSS) | TIENT | `app.js:750` : `escapeHtml(data.title)` / `escapeHtml(data.description)` avant `innerHTML` |
| 4a | Limites 2 Mo / 120 s appliquées côté serveur | TIENT (2 Mo) / **TROU (C)** (120 s) | Taille : `validateChatAttachments` rejette `bytes.length > WS_MAX_VOICE_BYTES` **avant** transcription (`handler.ts`). Durée : `WS_MAX_VOICE_MS` est **déclarée mais jamais utilisée** (grep vide ailleurs que sa définition) — aucune vérification de durée réelle côté serveur |
| 4b | MIME par magic bytes (OGG/WebM) | TIENT | `sniffAudioMime` vérifie les en-têtes EBML/`OggS`/`RIFF…WAVE`, appelé avant acceptation dans `validateChatAttachments` |
| 4c | STT/TTS injectables | TIENT | `setMobileVoiceHooksForTests` ; production passe par `speech-reaction.js` / `local-tts.js` en lazy-import |
| 4d | Audio sans STT ⇒ message honnête | TIENT | `handler.ts` : transcript vide ⇒ `userText = '(message vocal)'` si pas de texte |
| 4e | Blobs audio absents de l'historique JSON | TIENT | Seul `turn.content` (texte, transcrit) est journalisé ; jamais `attachment.data` |
| 5a | Frames rétro-compatibles (citer/éditer/supprimer) | TIENT | `currentChatPayload` n'ajoute que des clés optionnelles (`replyTo`, `clientMsgId`, `editOf`, `voiceReply`) sur la trame `chat` déjà connue ; un ancien serveur les ignore silencieusement (déstructuration par nom) |
| 5b | `sw.js` cache v11 liste tous les assets | TIENT / **TROU (C)** cosmétique | `CACHE_NAME='codebuddy-mobile-v11'` couvre HTML/CSS/JS/emoji-data/icônes 96/192/512, mais référence `icon-72.png` dans le handler `push` sans jamais le mettre en cache ni le livrer (fichier absent du dossier assets) — badge de notification silencieusement manquant, sans impact sécurité |
| 5c | `node --check`, ESLint 0, test DOM | TIENT | `node --check app.js` → 0 ; `eslint app.js --quiet` → 0 ; `tests/server/mobile-chat-ui.test.ts` (happy-dom) étoffé à 421 lignes |
| 6 | Suites | TIENT | Détail ci-dessous |

## Suites

- `npx vitest run tests/server tests/companion tests/channels tests/security/donnees-personnelles.test.ts`
  (`HOME=~/DEV/cb-chat-v3-2026-09-07/_qa/verif/home`, `env -u FORCE_COLOR`) :
  **230 fichiers / 3062 tests verts / 5 skip / 0 rouge**, exit 0. Écart mineur avec les 229/3055/11
  du rapport Grok, expliqué par l'environnement (Chromium/Piper absents ici ⇒ tests gardés
  `[CIFIX2]` exécutent leur repli au lieu d'être marqués `skip`) — aucune régression, 0 rouge dans
  les deux cas.
- `npx tsc --noEmit -p tsconfig.json` : 0 erreur.
- `npm run lint` : 0 erreur (2487 avertissements préexistants `no-explicit-any`/`no-unused-vars`,
  hors du périmètre de ce lot).
- `git diff --check c94033686..HEAD -- src tests` : 0 (aucun conflit résiduel, pas d'espace en fin
  de ligne signalé).

## Bilan (10 lignes)

Le lot est solide sur ce qui était déjà balisé par des modules partagés : l'aperçu de lien traverse
réellement le garde SSRF (`safeFetchFollow`), vérifié en direct contre loopback/lien-local/RFC1918
et une redirection vers loopback, tous bloqués ; l'échappement XSS côté client est présent ; les
notes vocales sont bornées en octets et sniffées par magic bytes avant tout traitement, jamais
journalisées en clair ; l'historique serveur isole correctement deux identités (vérifié en direct,
bien que non testé par la suite). En revanche, le sous-système Push VAPID — entièrement neuf, sans
module partagé à réutiliser — cumule deux trous réels : aucune validation SSRF de l'`endpoint`
(seul `https://` est vérifié, un `127.0.0.1`/`169.254.169.254`/RFC1918 est accepté) et aucun
plafond d'abonnements par identité (la fonction n'a même pas de paramètre d'identité) ; il manque
aussi tout chemin de désabonnement. L'aperçu de lien n'a pas de plafond de taille de réponse avant
troncature (le corps entier est bufferisé). Le plafond de durée vocale (120 s) est déclaré mais
jamais appliqué. Le journal de conversation ne tourne ni ne se purge jamais. Aucun de ces points
n'est couvert par un test rouge→vert dans la suite livrée ; toutes les preuves ci-dessus viennent
d'une exécution directe hors suite. Rien de tout cela n'a nécessité de correctif de ma part (aucun
n'est un one-liner sûr), donc aucun commit de code n'a été fait — seul ce rapport est livré.

VERDICT: NON PUSHABLE (SSRF réseau interne via l'endpoint push forgé + absence de plafond d'abonnements par identité, sous-système Push VAPID neuf)
