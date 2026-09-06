# PWA-CHAT-V2-GROK — vrai chat mobile avec émojis, inspiré de MySoulmate

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-pwa-chat-2026-09-06`
Branche : `feat/pwa-chat-v2-2026-09-06`
HEAD au départ : `d00d063ef` (`Merge branch 'codex/audit-systeme-nerveux-2026-09-01' into fix/pwa-confirmation-2026-09-06`)
Original `~/code-buddy` : interdit
`~/.codebuddy` : interdit
Inspiration : `~/DEV/MySoulmate` en **lecture seule** (Expo/React Native — idées, jamais de copie de code)
Rapport créé **avant toute inspection de code** (ce fichier).
HOME temporaire : `_qa/chat/home` (gitignoré). Aucune écriture dans le vrai `~/.codebuddy`.
Ports de preuve ≥ 3800. ComfyUI 8188/8189 intacts.

## Demande (verbatim)

« améliore l'interface de chat. crée un vrai chat avec des emojis, inspire-toi de mysoulmate »

## Mission

Transformer la PWA vanilla `/__codebuddy__/mobile/` en un vrai chat mobile (composer, bulles, réactions, présence, suggestions, historique local), inspiré des idées MySoulmate, sans framework ni CDN.

Points (un commit chacun) :

1. Composer auto-redimensionnable + sélecteur d'émojis Unicode (8 catégories, ~300, recherche FR/EN, récents localStorage).
2. Bulles : avatar Lisa, regroupement, horodatage, séparateurs de jour, accusés, markdown conservé, lightbox, liens.
3. Réactions locales (appui long ≥ 400 ms / double-toucher) — pas de `type: 'reaction'` WS si absent.
4. Présence « Lisa écrit… » + bandeau + humeur si `GET /__codebuddy__/mobile/status` l'expose (sinon ajout lecture seule opt-in `CODEBUDDY_COMPANION_RELATIONAL=true`).
5. Suggestions / quick replies contextuelles.
6. Historique local 200 messages + flèche bas non-lus + effacer (confirmation).
7. Preuves (tests, lint, tsc, captures Playwright viewport 390×844).

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-pwa-chat-2026-09-06/_qa/chat/home` et `env -u FORCE_COLOR`.
- Chemins `~/…` dans le rapport ; jamais de prénom ni de donnée personnelle dans les fichiers suivis.
- Vanilla JS/CSS, aucun framework, aucun CDN. Émojis = Unicode natif.
- Protocole WS inchangé (`chat`, `stop`, `confirmation_required/response`, frames `image`, streaming `chunk`/`done`).
- Look Lisa sombre conservé.
- `npm run lint` 0 erreur sur `app.js` (pas de `catch (e)` inutilisé).
- Accessibilité : `aria-label`, contraste, cibles tactiles ≥ 44 px.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `d00d063ef`. Branche déjà extraite de la lane sécu PWA (`CODEBUDDY_MOBILE_PWA`, `approvalCapable`).
Ce fichier est créé avant lecture de `app.js`, `styles.css`, MySoulmate, `status.ts`, le handler WS.

---

## Inspiration MySoulmate (à remplir après lecture)

### 10 idées retenues

_(après lecture)_

### 5 idées écartées (pourquoi)

_(après lecture)_

---

## Inspection (après réservation)

_(à remplir)_

---

## Décisions

_(à remplir)_

---

## Commits

_(à remplir)_

---

## Preuves

_(à remplir)_

---

## Bilan

_(à remplir)_
