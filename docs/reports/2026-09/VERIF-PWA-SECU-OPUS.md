# VERIF-PWA-SECU-OPUS — vérification adversariale du correctif PWA / confirmations

- Date : 2026-09-06
- Vérificateur : Claude Opus, contexte frais, posture adversariale
- Worktree : `~/DEV/cb-secu-pwa-2026-09-06`, branche `fix/pwa-confirmation-2026-09-06`
- Objet : contre-vérifier les trois commits de Grok (`b007f7ec6` A-1, `8e928943a` B-2,
  `53b85a376` B-1) répondant à `docs/audits/2026-09-06-audit-release-opus.md` §A-1, §B-1, §B-2.
- HOME de test isolé : `~/DEV/cb-secu-pwa-2026-09-06/_qa/verifsecu/home`
- HEAD au départ de l'inspection : `d00d063ef` (fusion de `codex/audit-systeme-nerveux-2026-09-01`)
- Rapport créé AVANT inspection, puis complété.

## Tableau des points

| Point | Verdict | Preuve |
| --- | --- | --- |
| A-1 `anonymousRemote` exposé sur le principal | TIENT | `src/server/websocket/handler.ts:169` (champ de `WebSocketExtensionPrincipal`), figé en lecture seule par `extensionPrincipal` `handler.ts:212` |
| A-1 le pont refuse le socket anonyme distant (`UNAUTHORIZED`) | TIENT | `src/server/websocket/confirmation-bridge.ts:69-76` ; test `tests/server/mobile-confirmation.test.ts` « refuses confirmation_response from a --no-auth remote socket and still accepts loopback » |
| A-1 socket loopback sous `--no-auth` accepté | TIENT | même test (le socket loopback résout la confirmation à `{confirmed:true}`) ; scopes `--no-auth` `handler.ts:1385-1396` |
| A-1 JWT sans portée `tools` refusé (`FORBIDDEN`) | TIENT | `confirmation-bridge.ts:85-92` ; test « requires the tools scope to answer confirmation_response » |
| A-1 détection loopback partagée, pas une copie | TIENT | `state.anonymousRemote` est calculé UNE fois à la connexion (`handler.ts:1378` + `:1402`) par `isDirectLoopbackRequest` (`src/server/middleware/auth.ts:161`), la même fonction que `chat` (`handler.ts:708`), `avatar.renderer.*` (`:1070`, `:1100`), `desktop-handler.ts:315`, `routes/cognition.ts:25`. Le pont lit ce champ, il n'en refait pas le calcul. `execute_tool` (`handler.ts:918`) ne lit pas ce champ mais exige `tools:execute`/`admin`, absents des scopes `--no-auth` |
| A-1 contournements (IPv4-mapped, XFF, `trustedProxies`, Origin absent) | TIENT | Test jetable exécuté (3/3 verts, supprimé après coup) : les deux formes IPv4 privées mappées en IPv6 (préfixe `::ffff:` suivi d'une adresse RFC 1918 en /16 et en /12), la forme décimale entière `2130706433` et la forme octale `0177.0.0.1` → non-loopback ; `[::1]`, `::1%lo` → loopback ; `127.0.0.1` + `x-forwarded-for` / `x-real-ip` / `forwarded` → non-loopback. `hasProxyForwardingHeaders` (`auth.ts:148`) ne consulte JAMAIS `trustedProxies` : tout en-tête de transfert dégrade le socket en distant, donc plus strict, jamais plus laxiste. Origin absent : la vérification d'origine est au handshake seulement, un client LAN sans `Origin` sous `--no-auth` reste `anonymousRemote` et est refusé (prouvé par le même test, socket porteur de `X-Forwarded-For`) |
| B-2 `confirmation_required` seulement aux sockets `tools` ET surface déclarée | TIENT | `collectApprovalSurfaceIds` `handler.ts:1526-1536` (authentifié + non anonyme distant + `approvalCapable` + portée `tools`) ; `targetFilter` transmis au broadcast `confirmation-bridge.ts:176-186`, appliqué `handler.ts:1563` |
| B-2 réponse d'un non-destinataire ignorée + journal | TIENT | `confirmation-bridge.ts:131-137` (`logger.warn` « not a recipient », aucune résolution) ; test « sends confirmation_required only to the PWA and ignores a fleet listen reply » |
| B-2 anti-rejeu conservé | TIENT | `confirmation-bridge.ts:126-129` + `:139-145` ; test « rejects a second response for the same id » |
| B-2 délai fail-closed conservé | TIENT | `confirmation-bridge.ts:165-172` (`{confirmed:false, feedback:'Confirmation timed out'}`) ; test « denies when the timeout elapses with no response » |
| B-2 régression : sans PWA, repli `remoteApproval` (Telegram) | TIENT | Le test demandé EXISTE déjà, deux fois : `tests/utils/confirmation-service.test.ts:418-437` (pont → `null` → `requestApproval` appelé une fois) et `tests/server/mobile-confirmation.test.ts` « does not capture when only a fleet listen socket is present — Telegram fallback runs ». Confirmé par mon test jetable avec un socket loopback `--no-auth` non déclaré |
| B-2 le résumé ne fuit plus vers les autres sockets | TIENT | Test jetable : `expect(JSON.stringify(remote.events)).not.toContain('secret-lan.md')` et aucun `confirmation_required` reçu par le socket distant — assertion que le test livré ne faisait pas (il tolérait la réception) |
| B-2 déclaration `approvalCapable` et clients non-PWA | TIENT, acceptable | Deux voies : payload `authenticate` (`handler.ts:528`, posé `:540`, `:566`, `:595`) — la PWA l'envoie (`src/server/mobile/assets/app.js:190`) — et payload `status` (`handler.ts:977-985`). Un client non-PWA PEUT donc se déclarer : acceptable, il doit être authentifié, non anonyme distant et porter `tools`, exactement la barre demandée |
| B-1 route 404 AVANT l'authentification sans le drapeau | TIENT | `src/server/index.ts:279-287`, monté avant `createAuthMiddleware(config)` (`:289`) ; test `tests/server/mobile-pwa.test.ts` « keeps the PWA route and WS approval bridge off without the flag » sous `authEnabled:true` sans jeton : 404 (un 401 aurait signalé l'ordre inverse) |
| B-1 `setWsApprovalBridge` jamais appelé sans le drapeau | TIENT | `handler.ts:1334-1346` ; test par espion, dans les deux sens (« off » : aucune fonction posée ; « on » : posée) |
| B-1 état module `pending` vide sans le drapeau | TIENT | La seule écriture `pending.set` est `confirmation-bridge.ts:174`, à l'intérieur du rappel installé par `wireMobileConfirmationBridge` — sans câblage, aucune entrée n'est créable |
| B-1 test byte-identique présent | TIENT | Les deux tests d'opt-in ci-dessus (`tests/server/mobile-pwa.test.ts`), plus tous les tests existants qui posent désormais le drapeau explicitement |
| B-1 `CLAUDE.md` documente le drapeau | TIENT | `CLAUDE.md:261` ; complément `docs/mobile-pwa.md:7` et `:20` |
| B-1 ligne CHANGELOG « sans opt-in » | CORRIGÉ (par moi) | Commit séparé `f48a3d86d` : l'entrée du 6 septembre disait encore « sans opt-in » et « Aucun drapeau — PWA toujours active sous `buddy server` ». Réécrite, numéros de ligne cités réalignés |
| Régressions | TIENT | Voir la section dédiée |

## Trous et observations

Aucun trou A ni B. Quatre observations C (hygiène / défense en profondeur), aucune n'ouvre un chemin
d'approbation non autorisé, toutes vérifiées par lecture de code et par test.

- **C-1 — `status` accepte `approvalCapable` sans exiger l'authentification.** `handler.ts:977-985`
  pose le drapeau avant toute vérification ; un socket anonyme distant sous `--no-auth` peut donc
  marquer son propre état. C'est neutralisé en aval : `collectApprovalSurfaceIds` (`handler.ts:1528-1531`)
  écarte `!authenticated`, `anonymousRemote` et l'absence de `tools`, et le pont refuse la réponse.
  Prouvé par mon test jetable (le distant se déclare, ne reçoit rien, est refusé). Resserrement
  souhaitable : n'accepter le drapeau que sur un socket authentifié non anonyme distant.
- **C-2 — `approvalCapable` n'est jamais retiré.** Aucune remise à `false` : une ré-authentification
  sans le drapeau conserve la qualité de surface d'approbation acquise plus tôt. Sans conséquence
  tant que la portée `tools` reste exigée à chaque envoi, mais l'état est monotone.
- **C-3 — les destinataires sont les sockets *éligibles*, pas les sockets *servis*.** `broadcast`
  retourne désormais la liste réellement livrée (`handler.ts:1572`) mais `confirmation-bridge.ts:174`
  enregistre l'ensemble calculé avant l'envoi. Sous contre-pression (`bufferedAmount` au-delà de la
  limite, `handler.ts:1565`) un socket resterait autorisé à répondre sans avoir reçu le prompt, et si
  aucun n'est servi on attend le délai (refus) au lieu de replier sur Telegram. Comportement
  fail-closed, donc sûr, mais moins gracieux que le repli.
- **C-4 — `stopServer` ne déwire pas ce pont.** Zéro occurrence de `unwireMobileConfirmationBridge`
  dans `src/server/index.ts`, alors que les six autres ponts le font (`index.ts:2295-2303`). Sans
  danger — `closeAllConnections()` vide les surfaces, donc le pont rend `null` et le repli reprend —
  mais l'état module survit à l'arrêt du serveur dans le même processus.
- **Hors périmètre, noté pour mémoire :** le drapeau ne couvre pas `/api/mobile` (`index.ts:276`),
  toujours monté avant l'authentification. Cette surface a ses gardes propres (loopback pour
  l'appairage `src/server/routes/mobile.ts:147`, jeton d'appairage `:185`) et n'était pas visée par
  §B-1.

## Régressions et outillage

- `npx vitest run tests/server tests/utils tests/security tests/fleet` (HOME isolé, `env -u FORCE_COLOR`,
  après `npm rebuild better-sqlite3 @vscode/ripgrep`) : **187 fichiers, 2749 tests verts, 5 ignorés,
  0 rouge**. Rejoué après mes deux commits, avec `tests/commands/changelog.test.ts` et
  `tests/self-model/evolution-notes.test.ts` : **189 fichiers, 2758 verts, 0 rouge**.
- `tests/security/donnees-personnelles.test.ts` : 40 verts.
- `npx tsc --noEmit -p tsconfig.json` : **0 erreur** après construction du paquet d'espace de travail.
  Première passe : deux `TS2307 Cannot find module '@phuetz/companion-core'`
  (`src/companion/core-adapter.ts:20` et `:53`) — **préexistantes et étrangères au correctif** : le
  fichier vient de la base (`b08179617`, présent sur `codex/audit-systeme-nerveux-2026-09-01`) et le
  worktree n'avait pas de `node_modules/@phuetz/`. Reproduit puis levé en construisant
  `packages/companion-core` (`tsc -p tsconfig.build.json`, son `prepare` le fait à l'installation) et
  en liant le paquet. **À retenir : lancer `npm install` complet dans un worktree avant de conclure
  sur `npm run validate`.**
- `npm run lint` : **0 erreur** (2484 avertissements préexistants). Première passe : deux erreurs
  `no-redeclare` (`src/server/mobile/assets/app.js:166` et `:168`) — également préexistantes, venues
  de la base (rendu des selfies : `var html` / `var mime` doublés dans `handleFrame`) ; le fichier est
  identique à celui de la base à la ligne 190 près, seule modification de Grok. Corrigées ici en
  commit séparé `952a94f0b` (quatre lignes, `var` → `let`/`const` de bloc), preuve
  `npx eslint src/server/mobile/assets/app.js` : 2 erreurs → 0.
- `git diff --check` : propre.
- Faux rouge d'environnement, sans lien : `tests/docs/revue-gemini-docs.test.ts` sort 16 rouges, tous
  « dist/index.js est absent — construire d'abord : npm run build » (worktree jamais construit).

## Commits ajoutés par cette vérification

- `952a94f0b` `fix(mobile): déclarations de bloc dans le client PWA (no-redeclare)` — correctif évident
  de 4 lignes, lint rouge → vert.
- `f48a3d86d` `docs(changelog): la PWA mobile est derrière CODEBUDDY_MOBILE_PWA` — correction de la
  ligne du 6 septembre qui annonçait encore « sans opt-in ».
- Le présent rapport.

Aucun `push`. `~/code-buddy` et `~/.codebuddy` non modifiés.

## Bilan

Les trois trous de l'audit sont réellement fermés, et fermés au bon endroit : le pont ne réinvente pas
la détection de boucle locale, il consomme le champ que le reste du serveur utilise déjà, ce qui évite
la divergence que je cherchais. Les contournements classiques — IPv6 mappé sur une adresse privée,
en-têtes de transfert forgés, formes octale et décimale de l'adresse de boucle, absence d'`Origin` —
tombent tous, et j'ai vérifié en exécutant, pas en lisant. La liaison des confirmations est le vrai
gain : le prompt ne part qu'aux surfaces déclarées, une réponse d'un socket non destinataire est
journalisée et jetée, et le résumé de l'opération ne fuit plus vers la flotte — cette dernière
assertion manquait au test livré, je l'ai posée et elle passe. Le repli Telegram, la crainte
principale d'une capture silencieuse, est couvert par deux tests distincts déjà présents. L'opt-in
rend le service mobile absent par défaut, 404 avant l'authentification et sans pont installé. Restent
quatre finitions sans gravité, toutes fail-closed, dont la plus utile serait d'exiger un socket
authentifié avant d'accepter la déclaration `approvalCapable` dans `status`. Les deux rouges d'outillage
que j'ai rencontrés venaient de la base et de l'installation du worktree, pas du correctif ; l'un est
corrigé ici, l'autre se lève par une installation complète.

VERDICT: PUSHABLE
