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
| *(lot 1)* | feat(pwa): citer, chercher, épingler, accusés et sélection |

## Preuves

- `node --check src/server/mobile/assets/app.js` : 0
- `npx eslint src/server/mobile/assets/app.js --quiet` : 0
- Vitest HOME `_qa/v3/home` : `mobile-chat-ui` + extras + forward + ws-protocol + pwa = 75 verts (chat-ui+pwa) ; lot 1 ciblé 59 verts
- `npx tsc --noEmit -p tsconfig.json` : 0
- Playwright 390×844 : `_qa/v3/shots/01-reply-search.png` (non commitée)

## Bilan 10 lignes par lot

### Lot 1 — messages de niveau messagerie
Réponse citée (balayage droite / menu), copie, transfert Telegram masqué hors canal, supprimer pour moi, modifier le dernier (marque « modifié »), sélection multiple, recherche + surlignage préc/suiv, bandeau épinglés, ✓ / ✓✓ / ✓✓ bleu via `ack`, horodatage complet au toucher, séparateurs de jour conservés, ligne « nouveaux messages ». WS rétro-compatible. SW v5. Capture `01-reply-search.png`.
