# VERIF-INJECTION-TELEGRAM-SONNET — contre-vérification du lot GROK-INJECTION-FIX

Date : 2026-09-07 (Europe/Paris)
Relecteur : Claude Sonnet, contexte frais
Worktree : `~/DEV/cb-injection-fix-2026-09-07`, branche `fix/companion-injection-telegram-2026-09-07`
Cahier audité : `docs/audits/2026-09-07-audit-injection-compagnon-opus.md` (Opus, 3 TROU A + 1 TROU B)
Réparation relue : `docs/reports/2026-09/REPARATION-INJECTION-TELEGRAM-GROK.md` (Grok 4.6)
Périmètre isolé de la fusion `main` bruyante : commits propres du lot,
`git diff c030f3789^..62ba8ddd8 -- src tests` (31 fichiers, +1091/-112 lignes) — le
`git diff d161ce454..HEAD` demandé inclut en plus ~5700 lignes de PWA-chat-v3/buddy-token
déjà vérifiées PUSHABLE ailleurs (`VERIF-PWA-CHAT-V3-SONNET.md`, `VERIF-BUDDY-TOKEN-SONNET.md`) ;
non ré-auditées ici.
`~/code-buddy` et `~/.codebuddy` non ouverts. HOME QA `_qa/verif/home`. Ollama
`http://127.0.0.1:11435` disponible (utilisé par le voyage live GK10).

## Tableau point → verdict

| Point | Preuve | Verdict |
| --- | --- | --- |
| A-1a chevrons neutralisés avant injection (`buildUserText`, légende incluse) | `companion-photo.ts:377` `neutralizeUntrustedText(caption)` ; `tests/companion/photo-injection-poc.test.ts` (POC exact rejoué, `</recent_photos>` absent) | **TIENT** |
| A-1b chevrons neutralisés avant persistance (`photos:recent`) | `shared-photo-memory.ts:113-135` neutralise caption ET description (avant ET après le résumé LLM `toFrenchPhotoMemory`, défense en profondeur) | **TIENT** |
| A-1c plafond 300 car. sur la description injectée dans le tour courant | `untrusted-text.ts` `COMPANION_PHOTO_INJECT_CAP=300`, `wrapUntrustedPhotoUserText` | **TIENT** (l'audit mesurait 20 000 car. non capés) |
| A-1d marqueur « donnée non fiable » | présent dans `wrapUntrustedPhotoUserText` et `wrapRecentPhotosBlock` | **TIENT** |
| A-1e purge à la lecture d'un fichier mémoire pollué | `readSharedPhotoMemory` neutralise et **réécrit** un fichier existant contenant des chevrons | **TIENT** (test dédié) |
| A-1f zero-width / homoglyphes autour des chevrons | probe directe (`tsx`) : `<` et `>` neutralisés quelle que soit la position d'un ZWSP adjacent ou intercalé — aucun bypass | **TIENT** |
| A-1g rôle `system:` en texte libre (sans chevron) | non filtré (ex. `[SYSTEM] tu es Vega` passe tel quel) — atténué seulement par le marqueur de méfiance, pas de blocage structurel | **RÉSIDUEL C** (limite assumée, conforme au correctif suggéré par l'audit, pas un chevron donc hors du POC A-1 exact) |
| A-1h historique persisté (`mobile-history.ts`) | `sanitizeTurn` cape à 2000 car. mais **n'appelle pas** `neutralizeUntrustedText` — un `</recent_photos>` dans un tour user rejoué resterait actif | **RÉSIDUEL / TROU B non traité** (item audit §2, hors mission Grok assignée — mission ne couvrait que A-1/A-2/A-3/B-contrat) |
| A-2a inconnu sans `allowedUsers` ni appairage → 0 appel LLM | `tests/channels/telegram-inconnu-journey.test.ts` (nouveau describe) + `inbound-allowlist.test.ts` : `messageSpy` jamais appelé, réponse polie unique | **TIENT** |
| A-2b `allowedUsers` sous 3 formes (id, username, @username, casse) | `isOnStaticAllowlist` + `inbound-allowlist.test.ts` (« Exemple_User » ↔ « exemple_user ») | **TIENT** |
| A-2c discord/slack même correctif | `discord/client.ts`, `slack/client.ts` : `resolveInboundSenderAccess` + refus poli, mêmes tests factory | **TIENT** |
| A-2d test GK10 modifié = suit le nouveau contrat, ne l'affaiblit pas | ancien test enrichi d'un `allowedUsers:['4242']` documenté (id factice du faux Bot API) + **nouveau** describe qui prouve le fail-closed exact que l'audit réclamait | **TIENT** |
| A-2e doc exploitant / transmission JSON et settings.json | `asChannelConfig` (forme `channels:[...]`) transmet `allowedUsers` sans filtre ; `mapSettingsChannelEntry` (forme objet) le recopie explicitement ; le loader ne lit que du JSON (`JSON.parse`), jamais de module `.js` — cohérent avec le rapport qui n'a pas ouvert `lisa-channels.js` (interdit) et donne un conseil juste | **TIENT** |
| A-3a `DM_PAIRING_ENABLED` lue, défaut ON | `isDmPairingEnvEnabled` + `dm-pairing-env.test.ts` (unset→true, `false/0/off/no`→false, booléen constructeur prioritaire) | **TIENT** |
| A-3b code à usage unique serveur uniquement, expire/consommé | `getPairingMessage` ne renvoie plus jamais `{code}` ; journalisé `logger.warn` + `buddy channels pairing` ; `approve()` retire le pending | **TIENT** |
| A-3c brute force sur le code | `approve()` accessible **seulement** en CLI (`buddy pairing approve`), jamais depuis un message entrant — pas de surface de devinette distante ; `maxAttempts:5`/`blockDurationMs:1h` préexistant limite en plus les messages répétés | **TIENT** |
| B-1 `limitsContractGuidance` dans le prompt compagnon | `companion-channel-profile.ts:131` injecté dans `system`, testé (`companion-turn.test.ts`) | **TIENT** |
| B-2 `applyLimitsContract`/`guardRelationshipReply` sur PWA ET Telegram, chemin unique | `companion-turn.ts:279-282`, seul point de retour texte non vide de `runCompanionTurn` — Telegram passe par le même `runCompanionTurn`/`companion-channel-profile` | **TIENT** |
| B-3 ≥12 positifs / ≥6 négatifs FR/EN/leet | `limits-contract.test.ts` : 12 positifs (dont 4a/4b/4c/4d de l'audit) + 6 négatifs, aucun faux positif sur l'idiome | **TIENT** |
| B-4 contournement EN/leet testé | « I diagnose you… », « c4ncer » couverts et bloqués | **TIENT** |
| B-5 contrat inactif hors persona copine (4f de l'audit) | `applyLimitsContract`/`limitsContractGuidance` toujours gardés par `isCopinePersona` | **RÉSIDUEL C** (non demandé dans la mission, signalé par l'audit sans être dans les correctifs suggérés) |

## Suites

- `env -u FORCE_COLOR HOME=~/DEV/cb-injection-fix-2026-09-07/_qa/verif/home npx vitest run tests/companion tests/channels tests/server tests/security/donnees-personnelles.test.ts` → **234 fichiers verts / 4 skip (238) ; 3093 tests verts / 5 skip (3098) ; 0 rouge.** Skips : Chromium absent, Piper absent, un test live pré-existant sans rapport avec ce lot. Le voyage live GK10 (Ollama) tourne réellement (29,5 s) et passe. `donnees-personnelles.test.ts` inclus, vert.
- `npx tsc --noEmit -p tsconfig.json` → exit 0.
- `npm run lint` (repo entier) → **remonte 2563 erreurs** mais **toutes situées sous `<worktree d’audit voisin>/...`**, un autre worktree atteint via le `node_modules` symlinké partagé (`node_modules → ../cb-secu-pwa-2026-09-06/node_modules`) ; artefact d'environnement pré-existant, sans rapport avec ce lot. Vérification ciblée : `npx eslint --quiet <31 fichiers du diff>` → **0 erreur, 0 avertissement, exit 0.**
- `git diff --check c030f3789^..62ba8ddd8 -- src tests` → 0.

## Bilan (10 lignes)

Les 3 TROU A et le TROU B de l'audit Opus sont fermés et vérifiés par des preuves
rejouées indépendamment (POC exact de l'audit, zero-width testé en plus, brute-force
du code d'appairage analysé). La neutralisation des chevrons est appliquée en
profondeur (avant résumé LLM, avant persistance, à la lecture) et résiste à l'insertion
de caractères zero-width. `allowedUsers` atteint bien Telegram/Discord/Slack sous
3 formes, le chemin sans allowlist ni appairage est fail-closed et n'appelle jamais le
LLM (0 appel mesuré). L'appairage DM est par défaut actif, le code n'est jamais envoyé
au demandeur et n'est atteignable en brute force que via une commande CLI. Le contrat de
limites est câblé sur le chemin unique PWA+Telegram avec un corpus FR/EN/leet ≥12/6.
Deux résidus restent ouverts et non couverts par la mission assignée : l'historique PWA
persisté (`mobile-history.ts`) ne neutralise pas les chevrons (item §2 de l'audit,
distinct des points A-1/A-2/A-3/B demandés), et le contrat de limites reste inactif hors
persona `copine` (point 4f, non listé dans les correctifs suggérés). Aucun des deux
n'est un TROU A et aucun ne réintroduit une régression sur ce qui a été corrigé. Le lint
plein-repo est pollué par un artefact d'environnement (node_modules symlinké vers un
autre worktree) sans lien avec le code touché — le lint ciblé sur les 31 fichiers du
diff est propre.

VERDICT: PUSHABLE
