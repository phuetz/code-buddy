# gitnexus-chat — Audit V1.2 (bugs cachés, perf, sécu)

> Audit en mode plan post-V1.1 nuit 03→04 mai 2026. Complémentaire à
> [`CHAT-V1-ROADMAP-2026-05-04.md`](CHAT-V1-ROADMAP-2026-05-04.md) qui
> couvrait les évolutions UX/features. Cet audit creuse les angles non
> explorés : bugs subtils, sécurité, performance, edge cases.

## TL;DR

**2 bugs P0 fixés ce soir** (commit `cd75531` dans gitnexus-chat) :
- `@tailwindcss/typography` n'avait jamais été installé → classes `prose` mortes depuis V0
- `parseIndexedAt` helper pour gérer les 2 formats hétérogènes du serveur (Unix epoch + ISO)

**11 items P1/P2/P3 documentés ci-dessous** pour fix progressif.

---

## 🔴 P0 — Fixés ce soir

| # | Bug | Fix |
|---|---|---|
| 1 | `prose` classes mortes (typography plugin pas installé) | `npm i -D @tailwindcss/typography` + `@plugin` dans `index.css` |
| 2 | `indexedAt` rendu "Invalid Date" pour formats Unix epoch | helper `parseIndexedAt()` détecte ISO ou Unix |

---

## 🟠 P1 — Bugs latents / fragilités

### 3. localStorage sans cap

`chat-store.ts` persist tout `sessions[]` (limite browser ~5-10 MB). Long terme = explosion silencieuse (Zustand persist échoue sans erreur visible).

**Fix proposé** : helper `pruneOldSessions(max=50)` qui retire les sessions les plus anciennes au save. Optionnel : alert si `localStorage.length > 4MB` au boot.

### 4. Auto-scroll forcé même quand l'utilisateur scroll up

`ChatMessages.tsx:25` force `scrollTo(scrollHeight)` à chaque update. Pendant un long stream, si user scroll vers le haut pour relire, on le ramène brutalement au bas.

**Fix** : tracker la position de scroll, n'auto-scroll que si user est <50px du bottom. Pattern "stick to bottom unless user scrolled away".

### 5. Race condition : changement de session pendant un stream

Le `sessionId` est capturé en closure (les deltas s'écrivent sur la session originelle, OK), mais `isStreaming` est global → l'UI affiche "GitNexus réfléchit…" sur la nouvelle session si elle re-stream.

**Fix** : track `streamingSessionId` au lieu de `isStreaming` boolean. Spinner conditionné sur `streamingSessionId === currentSessionId`.

### 6. `deleteSession` pendant streaming = orphan delta

`updateMessage(sessionId, ...)` ignore silencieusement si la session n'existe plus → `acc` accumule rien → utilisateur confus.

**Fix** : `deleteSession` cancel le stream s'il vise la session supprimée, ou `useChat` cancel si le sessionId disparaît.

### 7. `setInputDraft` à chaque keystroke = re-render global

`ChatMessages` lit `setInputDraft` (pour les suggestions) → re-render à chaque touche dans `ChatInput`. Pas catastrophique mais inutile.

**Fix** : utiliser un selector d'action stable (Zustand garde la stabilité des fonctions par défaut, à vérifier en pratique). Si problème : `useShallow` ou separate stores.

---

## 🟡 P2 — Sécurité

### 8. `react-markdown` autorise `<a href>` arbitraire

Une réponse LLM peut contenir `[click](javascript:alert(1))` qui s'exécutera. Risque : prompt injection malveillante (le LLM ne devrait pas le faire mais on ne contrôle pas les outputs).

**Fix** : prop `urlTransform` de `react-markdown` avec whitelist (`http`, `https`, `mailto`, `#`, paths relatifs).

```tsx
urlTransform={(url) => {
  if (/^(javascript|data|vbscript):/i.test(url)) return '';
  return url;
}}
```

### 9. Markdown HTML inline (`<script>`)

À vérifier : par défaut `react-markdown` v10 désactive le HTML inline (pas de `rehype-raw`). Donc OK, mais à confirmer en lisant le source. Si quelqu'un ajoute `rehype-raw` plus tard, faut absolument `rehype-sanitize` après.

### 10. CORS server `Any`

`crates/gitnexus-cli/src/commands/serve.rs:68` permet toutes les origines. Acceptable en dev local, mais pour déploiement client agile-up : restreindre via env var (`GITNEXUS_HTTP_ORIGINS=http://chat.client.local`).

---

## 🟢 P3 — Bonus DX / hardening

### 11. `crypto.randomUUID()` indispo en non-HTTPS legacy

Pas dispo sur HTTP non-localhost en navigateurs anciens. Pour V1 dev local OK, mais déploiement HTTP intra-LAN = besoin fallback (`Math.random().toString(36)` ou polyfill).

### 12. Pas de validation client repo sélectionné

Bug serveur connu (`serve.rs:110`) : si user choisit "X" et "X" n'existe plus, le serveur fallback silencieusement au 1er repo. Côté chat : valider `selectedRepo` contre la liste fraîche au moment du send, alerter si introuvable.

### 13. Linter TypeScript-eslint non strict

Actuellement `tseslint.configs.recommended`. Pour un projet en `"strict": true` on peut monter à `recommendedTypeChecked` qui chope `no-floating-promises`, `no-misused-promises`, etc. Plus exigeant, plus de bugs détectés.

---

## 🔵 Backend-coupled (rappel — déjà dans la roadmap V1)

- `event: tool_call` typé pour afficher les tools en cours
- `event: source` pour citations cliquables
- Repo strict 404 (`serve.rs:110-119`)
- `event: usage` token tracking
- Endpoint `/api/chat/cancel/<id>` pour vrai cancel côté serveur

---

## Recommandation séquencement

**Sprint 1 (½ jour)** — quick wins UX cachés :
- P1 #4 (auto-scroll smart)
- P1 #5 (streamingSessionId)
- P2 #8 (urlTransform sanitize)

**Sprint 2 (½ jour)** — fragilités stockage :
- P1 #3 (cap localStorage)
- P1 #6 (deleteSession cancel)
- P3 #12 (validation repo client)

**Sprint 3 (1 jour)** — hardening :
- P2 #9 (vérifier rehype-raw + sanitize si besoin)
- P2 #10 (CORS env var serveur)
- P3 #11 (crypto.randomUUID fallback)
- P3 #13 (eslint strict-type-checked)

Total estimé : ~2 jours pour avoir un chat **vraiment robuste** prêt pour démo client agile-up.

---

*Rédigé par Claude Opus 4.7 (1M context), nuit 03→04 mai 2026, MINISTAR.*
*Audit profond complémentaire à `CHAT-V1-ROADMAP-2026-05-04.md` (UX/features).*
