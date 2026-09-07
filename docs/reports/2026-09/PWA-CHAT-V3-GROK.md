# PWA-CHAT-V3-GROK — vrai chat mobile (niveau WhatsApp / Telegram / iMessage)

Date : 2026-09-07 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-chat-v3-2026-09-07`
Branche : `feat/pwa-chat-v3-2026-09-07`
HEAD au départ : `c94033686` (`test(channels): le tour compagnon live sur Ollama devient opt-in`)
Original `~/code-buddy` : interdit
`~/.codebuddy` : interdit (HOME QA `_qa/v3/home`)
Inspiration : WhatsApp / Telegram / iMessage + `~/DEV/MySoulmate/app/(tabs)/chat.tsx` en **lecture seule**
Rapport créé **avant toute inspection du code PWA** (cette section 25 fonctions d’abord).
HOME temporaire : `_qa/v3/home` (gitignoré). Captures Playwright : `_qa/v3/shots/` (non commitée).
Ports de preuve : ≥ 5700. ComfyUI 8188/8189 intacts. Ollama `http://127.0.0.1:11435` (`qwen3:4b-instruct`).
Vitest : `HOME=~/DEV/cb-chat-v3-2026-09-07/_qa/v3/home`, `env -u FORCE_COLOR`.

## 25 fonctions d’une vraie app de chat que la PWA n’a pas

Comparaison WhatsApp / Telegram / iMessage + MySoulmate (`chat.tsx` : `replyTo`, `searchQuery`, `pinnedMessages`, `Audio.Recording`, `CheckCheck`, menu long-appui Pin/Trash/Reply, bandeau épinglés, barre de recherche). Base PWA connue par le lot v2 (émojis, réactions locales, bulles groupées, lightbox, quick replies, historique local 200, reconnexion, photos + album, dictée Web Speech) — **pas encore d’inspection v3**.

| # | Fonction | Référents | Lot |
|---|---|---|---|
| 1 | Répondre / citer un message (balayage droite ou long-appui → citation au-dessus du composer et dans la bulle ; tap = défilement vers l’original) | WA / TG / iMsg ; MySoulmate `replyTo` | 1 |
| 2 | Copier (menu contextuel, pas seulement la barre de réactions) | WA / TG / iMsg | 1 |
| 3 | Transférer vers Telegram (masqué si canal absent) | WA / TG Forward | 1 |
| 4 | Supprimer pour moi | WA / TG / iMsg ; MySoulmate `Trash2` | 1 |
| 5 | Modifier mon dernier message (renvoi + marque « modifié ») | WA / TG / iMsg | 1 |
| 6 | Sélection multiple + suppression | WA / TG | 1 |
| 7 | Recherche dans la conversation (barre, surlignage, précédent/suivant) | WA / TG / iMsg ; MySoulmate `searchQuery` | 1 |
| 8 | Messages épinglés (bandeau) | WA / TG ; MySoulmate `pinnedBar` | 1 |
| 9 | Accusés ✓ envoyé / ✓✓ reçu / ✓✓ bleu lu (`ack:'read'` dès que Lisa commence à répondre) | WA / iMsg ; MySoulmate `CheckCheck` | 1 |
| 10 | Horodatage complet au toucher | WA / iMsg | 1 |
| 11 | Ligne « nouveaux messages » au retour | TG / WA | 1 |
| 12 | Message vocal maintenu (MediaRecorder, forme d’onde, glisser pour annuler) | WA / TG / iMsg ; MySoulmate `Audio.Recording` | 2 |
| 13 | Lecteur vocal in-bulle (play/pause, durée, ×1,5) + transcription dépliable | WA / TG | 2 |
| 14 | Réponse vocale de Lisa (TTS, auto-lecture si l’utilisateur a envoyé un vocal) | iMsg / WA notes vocales | 2 |
| 15 | Présence « en ligne / écrit… / vu à HH:MM » (dernier `stream_end`) | WA last seen | 3 |
| 16 | Badge de non-lus sur l’icône d’onglet | WA / TG | 3 |
| 17 | Son discret + vibration à la réception en arrière-plan | WA / TG / iMsg | 3 |
| 18 | Notifications push (`PushManager` + `sw.js` `push`/`notificationclick`, VAPID, opt-in) | WA / TG Web / iMsg | 3 |
| 19 | Historique serveur paginé (`GET …/history?before=&limit=50`) + journal JSONL | WA cloud / TG | 4 |
| 20 | Liste virtualisée (fenêtre 150 nœuds) + « aller en bas » + restauration de position | TG / WA | 4 |
| 21 | Taille de police (3 crans) + thème sombre/clair/auto | WA / TG / iMsg | 5 |
| 22 | Fond de discussion (4 motifs CSS, pas d’images) | WA / TG | 5 |
| 23 | Aperçu de lien (titre/description, garde SSRF, cache 24 h) | WA / TG / iMsg | 5 |
| 24 | Grands émojis seuls (3× sans bulle) + sélecteur avec tons de peau | iMsg / WA | 5 |
| 25 | Collage d’image, glisser-déposer bureau, raccourcis (Entrée, ↑ modifie, Échap) | WA Web / TG Desktop / iMsg | 5 |

Hors périmètre volontaire : GIF/autocollants (pas de CDN), appels voix/vidéo, groupes, stories, messages éphémères, sauvegardés MySoulmate (`bookmarkedMessages`), StylePicker / ThoughtBubble (déjà écartés en v2).

Séparateurs de jour : déjà livrés en v2 (à conserver, pas à réinventer).

## Mission

Porter la PWA vanilla `/__codebuddy__/mobile/` au niveau d’une app de chat complète, **par lots indépendamment fusionnables** (un commit par lot). Vanilla JS/CSS, aucun CDN, hors-ligne via `sw.js` (cache incrémenté à chaque lot), protocole WS étendu rétro-compatible, `aria-label` partout, cibles ≥ 44 px, `env(safe-area-inset-*)`, `visualViewport`, thème sombre Lisa + thème clair.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- `git add` fichier par fichier.
- Jamais de prénom / `/home/<user>` / donnée personnelle dans les fichiers suivis.
- `~/code-buddy` et `~/.codebuddy` interdits en écriture.
- Lint 0 erreur sur `app.js` ; `node --check app.js`.
- Si une vérification échoue, le dire.

## Lots

1. Messages de niveau messagerie
2. Messages vocaux
3. Présence et notifications
4. Historique serveur et défilement
5. Personnalisation et confort
6. Preuves globales

## Inspection

PWA v2 : `src/server/mobile/assets/{index.html,app.js,styles.css,sw.js}` — IIFE ~1910 lignes, historique local 200, réactions locales, dictée Web Speech, photos, cache `codebuddy-mobile-v4`. Aucune citation, recherche, pin, sélection, vocal MediaRecorder, push, historique serveur.
Handler WS (`src/server/websocket/handler.ts`) : trame `chat` = `message` + `attachments` images ; pas d’`ack`, pas de `replyTo`. Les types inconnus sont ignorés (clients anciens inchangés).
`validateChatAttachments` refuse tout non-image (lot 2 devra l’étendre).
MySoulmate lu en lecture seule : `replyTo`, `searchQuery`, `pinnedMessages`, `Audio.Recording`, `CheckCheck`.

## Décisions

- Lot 1 : extras optionnels `replyTo` / `clientMsgId` sur `chat` ; nouvelle trame `{ type:'ack', payload:{ ack:'received'|'read', clientMsgId? } }` ignorée par les anciens clients.
- Transfert Telegram = `POST /__codebuddy__/mobile/forward` (JWT/loopback), masqué si canal absent (`telegramForward` dans `/status`).
- Édition = renvoi local + `editOf` (le serveur traite comme un nouveau tour).
- Cache SW `v5`.

## Commits

| Hash | Message |
|---|---|
| `ad7de3d88` | docs(pwa): stub PWA-CHAT-V3-GROK avant inspection |
| `db9651eed` | feat(pwa): citer, chercher, épingler, accusés et sélection |
| `c2b1623c5` | feat(pwa): notes vocales MediaRecorder + STT/TTS |
| `8b659452d` | feat(pwa): présence, badge, son et push VAPID |
| `3175c09a4` | feat(pwa): historique serveur paginé et liste virtualisée |
| `013f20429` | feat(pwa): thème, police, fond, aperçu de lien |
| *(lot 6)* | docs(pwa): preuves globales PWA-CHAT-V3 |

## Preuves

- `node --check src/server/mobile/assets/app.js` : 0
- `npx eslint src/server/mobile/assets/app.js --quiet` : 0
- `npx tsc --noEmit -p tsconfig.json` : 0
- `git diff --check` : 0
- Vitest HOME `_qa/v3/home` `tests/server tests/companion tests/channels tests/security/donnees-personnelles.test.ts` : **229 fichiers / 3055 verts / 11 skip / 0 rouge**
- Playwright 390×844 (non commitée) : `_qa/v3/shots/01-reply-search.png`, `02-voice-recording.png`, `03-voice-bubble.png`, `04-settings-light.png`, `05-notification-badge.png`, `06-quoted-reply.png`

## Bilan 10 lignes par lot

### Lot 1 — messages de niveau messagerie
Réponse citée (balayage droite / menu), copie, transfert Telegram masqué hors canal, supprimer pour moi, modifier le dernier (marque « modifié »), sélection multiple, recherche + surlignage préc/suiv, bandeau épinglés, ✓ / ✓✓ / ✓✓ bleu via `ack`, horodatage complet au toucher, séparateurs de jour conservés, ligne « nouveaux messages ». WS rétro-compatible. SW v5. Capture `01-reply-search.png`.

### Lot 2 — messages vocaux
Micro maintenu = MediaRecorder (WebM/Ogg), forme d’onde, glisser pour annuler, plafond 2 Mo / 120 s. STT injectable (`speech-reaction`) ; le texte devient le tour utilisateur. Bulle ▶ / durée / ×1,5 + transcription. Option « Lisa me répond à voix haute » → trame `audio` (TTS injectable). Auto-lecture si l’utilisateur a envoyé un vocal. Images inchangées pour les anciens clients. SW v6. Captures `02-voice-recording.png`, `03-voice-bubble.png`.

### Lot 3 — présence et notifications
En-tête « vu à HH:MM » après `stream_end`. Badge d’onglet `(n) Lisa`. Son + vibration si l’app est en arrière-plan. Push opt-in `CODEBUDDY_MOBILE_PUSH=true` : clés VAPID `~/.codebuddy/push/` (0600), `GET /push/vapid`, `POST /push/subscribe`, envoi via transport injectable (web-push si présent). Câblé sur les initiatives away. SW v7.

### Lot 4 — historique serveur et défilement
Journal JSONL `~/.codebuddy/companion/mobile-conversations/<hash>.jsonl` (0600, O_APPEND). `GET /history?before=&limit=50` (JWT). Fenêtre DOM 150, chargement en remontant, restauration de scroll, « aller en bas » déjà là. Plafond local 2000. SW v8.

### Lot 5 — personnalisation et confort
Police 3 crans, thème sombre/clair/auto, 4 fonds CSS, sons on/off, aperçu de lien (SSRF `safeFetchFollow`, cache 24 h), émojis seuls 3×, tons de peau, collage/glisser-déposer, raccourcis déjà en lot 1. SW v9. Capture `04-settings-light.png`.

### Lot 6 — preuves globales
Suite exigée 229 fichiers / 3055 verts / 11 skip / 0 rouge. `tsc --noEmit` 0. ESLint `app.js` 0. `node --check app.js` 0. `git diff --check` 0. Six captures 390×844 sous `_qa/v3/shots/` (non suivies). SW v10. Aucun push. `~/code-buddy` et `~/.codebuddy` intacts. ComfyUI 8188/8189 intacts. Ouvert : envoi Web Push réel sans paquet `web-push` (transport injectable + import optionnel).

## Correctifs après vérification Sonnet

Date : 2026-09-07 (Europe/Paris)
Agent : Grok 4.6
Source : `docs/reports/2026-09/VERIF-PWA-CHAT-V3-SONNET.md` (verdict NON PUSHABLE, HEAD audité `5179c8595`, rapport `d3dc76d22`)
Branche : `feat/pwa-chat-v3-2026-09-07`
HEAD au départ des correctifs : `d3dc76d22`
HOME QA : `_qa/fix/home` (gitignoré). Vitest : `HOME=…/_qa/fix/home` et `env -u FORCE_COLOR`.
Ports : ≥ 6100. Original `~/code-buddy` et `~/.codebuddy` : interdits.
Section créée **avant toute modification de code**.

### Trous à lever (Sonnet)

| Id | Gravité | Fait | Correctif prévu |
|---|---|---|---|
| 1 | A | `savePushSubscription` n'exige que `https://` : loopback, RFC1918, 169.254, IPv6 ULA/loopback, `.local` acceptés | Passer l'`endpoint` par `isSafeUrl` (`src/security/ssrf-guard.ts`) : https seulement **et** hôte public ; 6 endpoints forgés → 400 sans écriture |
| 2 | A/B | Liste globale de 20, pas d'identité, pas de désabonnement ; un flot évince autrui | Fichiers par hash sha256 de l'`userId`, plafond 5 (plus ancien évincé), `DELETE /push/subscribe` (JWT, même identité), envoi uniquement à l'identité visée, mode 0600 |
| 3 | B/C | `res.text()` bufferise tout le corps ; cache `Map` sans plafond | Lecture bornée 256 Ko (arrêt du flux), timeout 5 s, LRU ≤ 200 ; serveur local 5 Mo → 256 Ko lus max |
| 4 | C | `WS_MAX_VOICE_MS` déclaré, jamais appliqué | Durée ≤ 120 s côté serveur : parse OGG/WebM ; si indéterminable, plafond 2 Mo **et** refus si le client déclare > 120 s, vérifié par `ffprobe` s'il est là, sinon estimation par débit |
| 5 | C | JSONL append-only sans rotation ni purge | Rotation à 5 Mo (renommé `.1`, une génération), purge des fichiers > 90 jours à l'ouverture |
| 6 | — | Isolation A/B prouvée à la main, absente de la suite | Test HTTP : jeton A ne lit pas l'historique de B |

Chaque point : test rouge avant, vert après. Un commit par point. Aucun push.

### Journal des correctifs

HEAD de départ `d3dc76d22`. Commits : `092e99c61` (réservation) → `428a2a102` (1) → `303dccb9f` (2) → `861ce6da3` (3) → `58cc717b3` (4) → `49f57e534` (5) → `d4f1e08cf` (6).

| Id | Correctif | Test rouge → vert | Commit |
|---|---|---|---|
| 1 | `isPublicHttpsPushEndpoint` : https + `.local`/loopback + `getSSRFGuard().isSafeUrl` ; 6 endpoints forgés → 400 sans écriture | 200 → 400, aucune trace dans le répertoire push | `428a2a102` |
| 2 | Fichiers `subscriptions/<sha256-32>.json` (0600), plafond 5 (plus ancien évincé), `DELETE /push/subscribe` JWT, `sendMobilePush` exige `userId` | 6e abo A évince le 1er ; B isolé ; DELETE A n'efface pas B | `303dccb9f` |
| 3 | `readCappedText` arrête le flux à 256 Ko ; LRU 200 ; timeout 5 s | serveur local 5 Mo → ≤ 256 Ko ; 201e URL évince la 1re | `861ce6da3` |
| 4 | Parse OGG/WebM ; déclaré > 120 s refusé ; `ffprobe` sinon estimation 64 kbps ; câblé dans `validateChatAttachments` + handler | OGG 200 s refusé ; déclaré 121 s refusé ; 1,2 Mo sans durée refusé | `58cc717b3` |
| 5 | Rotation à 5 Mo → `.1` (une génération) ; purge mtime > 90 j à l'ouverture | `.1` unique après 2 rotations ; fichier 91 j disparu au `read` | `49f57e534` |
| 6 | Test HTTP GET `/history` : jeton B ne voit pas `SECRET A` | couverture absente → 1 test vert | `d4f1e08cf` |

### Preuves

Commande :

```
HOME=~/DEV/cb-chat-v3-2026-09-07/_qa/fix/home env -u FORCE_COLOR \
  npx vitest run tests/server tests/companion tests/security/donnees-personnelles.test.ts
```

Résultat : **167 fichiers verts / 3 skip / 0 rouge** ; **1562 verts / 3 skip / 0 rouge**. Privacy **40/40**. `npx tsc --noEmit -p tsconfig.json` **0**. `npx eslint . --ext .js,.jsx,.ts,.tsx --quiet` **0 erreur**. `node --check src/server/mobile/assets/app.js` **0**. `git diff --check` **0**. Aucun push. ComfyUI 8188/8189 intacts.

### Bilan

Les six trous Sonnet sont fermés, fail-closed, un commit chacun. L'endpoint push traverse le garde SSRF existant (https public seulement). Les abonnements sont par identité, plafonnés à 5, désabonnables, et l'envoi ne vise que cette identité. L'aperçu de lien ne bufferise plus le corps. La durée vocale 120 s est appliquée côté serveur. Le journal tourne et se purge. L'isolation A/B est dans la suite. Ouvert : envoi Web Push réel toujours conditionné au paquet optionnel `web-push`.
