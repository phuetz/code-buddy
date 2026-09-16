# PWA-CHAT-V2-GROK — vrai chat mobile avec émojis, inspiré de MySoulmate

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-pwa-chat-2026-09-06`
Branche : `feat/pwa-chat-v2-2026-09-06`
HEAD au départ : `d00d063ef` (`Merge branch 'codex/audit-systeme-nerveux-2026-09-01' into fix/pwa-confirmation-2026-09-06`)
Original `~/code-buddy` : interdit
`~/.codebuddy` : interdit
Inspiration : `~/DEV/MySoulmate` en **lecture seule** (Expo/React Native — idées, jamais de copie de code)
Rapport créé **avant toute inspection de code** (stub commité `f7820d392`).
HOME temporaire : `_qa/chat/home` (gitignoré). Aucune écriture dans le vrai `~/.codebuddy`.
Ports de preuve : 3801. ComfyUI 8188/8189 intacts.

## Demande (verbatim)

« améliore l'interface de chat. crée un vrai chat avec des emojis, inspire-toi de mysoulmate »

## Mission

Transformer la PWA vanilla `/__codebuddy__/mobile/` en un vrai chat mobile (composer, bulles, réactions, présence, suggestions, historique local), inspiré des idées MySoulmate, sans framework ni CDN.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-pwa-chat-2026-09-06/_qa/chat/home` et `env -u FORCE_COLOR`.
- Chemins `~/…` dans le rapport ; jamais de prénom ni de donnée personnelle dans les fichiers suivis.
- Vanilla JS/CSS, aucun framework, aucun CDN. Émojis = Unicode natif.
- Protocole WS inchangé (`chat`, `stop`, `confirmation_required/response`, frames `image`, `stream_chunk` / `stream_end`).
- Look Lisa sombre conservé.
- Réactions **locales uniquement** : aucun `type: 'reaction'` dans le handler WS (absent à l'inspection, non ajouté).

## Inspiration MySoulmate (lecture seule)

Lu : `components/EmojiPicker.tsx`, `components/chat/AnimatedMessageBubble.tsx`, `AnimatedTypingDots.tsx`, `MoodIndicator.tsx`, `StylePicker.tsx`, `ThoughtBubble.tsx`, `ImageGenerationBubble.tsx`, `StreamingMessageBubble.tsx`, `AnimatedAvatar.tsx`, `types/message.ts`, `app/(tabs)/chat.tsx` (suggestions ~l.904/1606, `getMoodStatus` ~l.196, cœurs ~l.160), `services/chatStyleService.ts`.

### 10 idées retenues

1. Grille d'émojis (idée `EmojiPicker.tsx`) — étendue à 8 catégories, ~423 Unicode, recherche FR/EN.
2. Trois points « écrit… » (idée `AnimatedTypingDots.tsx`) — CSS, dès le premier `stream_chunk`.
3. Puce d'humeur dans l'en-tête (idée `MoodIndicator.tsx` + `getMoodStatus`) — label `moodBand` si le statut l'expose.
4. Chips de réponses rapides (idée `getSuggestedReplies` / barre ~l.1606) — contextuelles, tap = envoi, masquables.
5. Réactions sous la bulle (idée `Message.reactions` / `MessageReaction`) — barre ❤️😂😮😢👍🔥, localStorage.
6. Bulle image + ouverture plein écran (idée `ImageGenerationBubble`) — lightbox, fermeture au toucher.
7. Avatar + pastille de présence (idée `AnimatedAvatar`) — `icon-192.png` puis selfie persisté ≤ 200 Ko.
8. Séparateurs de jour + horodatage discret (idée liste `chat.tsx` + timestamps).
9. Haptique à l'envoi (idée `Haptics.impactAsync`) — `navigator.vibrate(10)` si disponible.
10. Bulles groupées / coins adaptés (idée `AnimatedMessageBubble` + fil WhatsApp-like).

### 5 idées écartées (pourquoi)

1. **StylePicker / `chatStyleService`** — changerait le prompt / la température côté LLM ; la mission impose un client sans backend supplémentaire.
2. **ThoughtBubble** — le protocole WS n'a pas de champ « inner thoughts » ; l'inventer casserait le contrat.
3. **Cœurs Reanimated / ressorts** (`chat.tsx` ~l.160) — pas de React Native ; on garde un pulse CSS sur l'envoi, pas un système de particules.
4. **Reply-to / barre de citation** — `replyTo` n'existe pas dans les trames `chat` ; hors périmètre.
5. **Feedback training +/- et portes premium** — surface dating-app, pas un chat PWA Code Buddy.

Pas de copie de composants React Native : réécriture vanilla.

## Inspection (après réservation)

- PWA existante : `src/server/mobile/assets/{index.html,app.js,styles.css,sw.js}` — IIFE ~500 lignes, bulles plates, Entrée déjà câblée, pas d'émojis / réactions / historique.
- Handler WS (`src/server/websocket/handler.ts`) : **aucun** `type: 'reaction'` — confirmé par grep. Non ajouté.
- `GET /api/status` via `buildMobileStatus` : provider / fallback / flotte, **pas** de `companion.mood`.
- `GET /__codebuddy__/mobile/status` n'existait pas. Ajouté, même payload que `buildMobileStatus`.
- `relationship-state.ts` exporte déjà `loadRelationshipState`, `personalityOf`, `moodBand` (opt-in `CODEBUDDY_COMPANION_RELATIONAL`).
- `jsdom` n'est pas une dep directe ; `happy-dom` l'est (`package.json` devDependencies). Tests DOM : `// @vitest-environment happy-dom`.

## Décisions

- Un bundle vanilla (`emoji-data.js` + `app.js`) exposé en `window.CodeBuddyMobile` pour le harnais DOM. Le protocole WS n'est pas étendu.
- Réactions : **locales uniquement** (commentaire dans `app.js`, test d'absence de `send('reaction')`).
- Humeur : champ `companion: { mood, traits, label }` **omis** si `CODEBUDDY_COMPANION_RELATIONAL` ≠ `true` (opt-in, lecture seule).
- Historique : `localStorage` (200 messages, 5 images ≤ 100 Ko). IndexedDB non nécessaire à cette taille.
- Commits : le DOM unique empêche de scinder `app.js` en six livraisons autonomes. Points 1–3 / 5–6 = un commit client ; point 4 serveur = un commit ; CSS post-captures = un correctif.

## Commits

| Hash | Message |
|---|---|
| `f7820d392` | `docs(pwa): réserver GROK-PWA-CHAT-V2 (rapport avant inspection)` |
| `66233c714` | `feat(pwa): composer, émojis, bulles, réactions, suggestions et historique` |
| `494aac8f9` | `feat(server): humeur companion en lecture seule sur le statut PWA` |
| `5432569cf` | `fix(pwa): borner le sélecteur d'émojis et la lightbox` |
| *(ce commit)* | `docs(pwa): clôturer GROK-PWA-CHAT-V2` |

## Preuves

### Tests (HOME isolé)

```text
env -u FORCE_COLOR HOME=~/DEV/cb-pwa-chat-2026-09-06/_qa/chat/home \
  npx vitest run tests/server/mobile-pwa.test.ts \
    tests/server/mobile-chat-ui.test.ts \
    tests/server/mobile-status*.test.ts \
    tests/security/donnees-personnelles.test.ts
```

Résultat : **4 fichiers / 91 verts / 0 rouge** (dont `donnees-personnelles` 40/40). Durée ~9,3 s.

`mobile-status*.test.ts` matche `mobile-status-companion.test.ts` (nouveau) ; `mobile-runs-status.test.ts` n'est pas dans le glob `mobile-status*`.

### Outils

| Commande | Résultat |
|---|---|
| `node --check src/server/mobile/assets/app.js` | 0 |
| `npx eslint src/server/mobile/assets/app.js` | 0 erreur |
| `npx eslint . --ext .js,.jsx,.ts,.tsx --quiet` | 0 (exit 0) |
| `npx tsc --noEmit -p tsconfig.json` | 0 |
| `git diff --check` | 0 |

Catalogue émojis (node) : 8 catégories, **423** entrées ; recherche `cœur` / `rire` / `kiss` OK.

### Serveur réel + captures Playwright

Build dans le worktree (`tsc` + `copy-mobile-pwa-assets`). Serveur :

```text
CODEBUDDY_MOBILE_PWA=true JWT_SECRET=test-secret-only \
  HOME=~/DEV/cb-pwa-chat-2026-09-06/_qa/chat/home \
  node dist/index.js server --port 3801 --host 127.0.0.1 --no-auth
```

PID **242925**. `curl` : HTML 200 (8254 o), `app.js` 200, `emoji-data.js` 200, `/__codebuddy__/mobile/status` 200. Arrêt `kill 242925` (pas `pkill -f`) ; port 3801 refermé. ComfyUI 8188 intact.

Playwright Chromium, viewport **390×844**, script `_qa/chat/take-shots.mjs` (non suivi) :

| Fichier (non commité) | Contenu |
|---|---|
| `_qa/chat/shots/01-chat-bulles-reactions.png` | 38209 o — bulles user/assistant, photo, réaction ❤️, chips, humeur « joyeuse » |
| `_qa/chat/shots/02-selecteur-emojis.png` | 75078 o — recherche + 8 onglets + grille Unicode |
| `_qa/chat/shots/03-lightbox.png` | 26436 o — overlay plein écran |

## Bilan

Vrai chat PWA vanilla (émojis Unicode, bulles groupées, réactions locales, présence, chips, historique 200). WS inchangé ; pas de `type: 'reaction'`. Humeur serveur opt-in relationnel. Preuves : 91/91, tsc 0, eslint 0 erreur, captures 390×844. Original `~/code-buddy` et `~/.codebuddy` non touchés. Aucun push.
