# MOBILE-PWA-V1-GROK — PWA mobile Code Buddy : prototype vibe → v1 réelle

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-mobile-2026-09-06`
Branche : `feat/mobile-pwa-2026-09-06`
HEAD au départ : `c74b8f22b` (`docs(audit): add verification report for mobile PWA prototype`)
Original `~/code-buddy` : interdit
Rapport créé **avant toute écriture de code** (ce fichier, commité).
HOME temporaire : `_qa/grok/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Cahier : `docs/reports/2026-09/VERIF-MOBILE-AGY.md` (10 trous) + `MOBILE-PWA-VIBE.md`.
Inspiration imposée : projet Lisa (`~/DEV/Lisa`, public `https://github.com/phuetz/Lisa`).

## Mission

Fermer les 10 trous d'agy. Le serveur doit démarrer. Preuves collées. Pas de verdict.

Ordre :

1. **P1.1 / P1.2 / P1.3 / P7** — Express 5, copie d'assets au `npm run build`, icônes PNG 96/192/512 générées par script, `tests/server` à 0 rouge.
2. **P2** — client WS sur le protocole réel de `src/server/websocket/handler.ts` + essai Ollama streamé.
3. **P4** — `confirmation_required` / `confirmation_response` branchés sur `ConfirmationService` (fail-closed, une réponse par id, JWT).
4. **P5** — `/api/runs` + `/api/runs/:id/trajectory` (`buildTrajectory` est dans cette base) + statut fournisseur / repli / flotte.
5. **P3** — sélecteur Agent / Lisa / Pairs réellement câblé, sinon retiré.
6. **P6** — CSP sans `unsafe-eval` ni `unsafe-inline`.
7. **P8** — hors v1 : lister ce qu'il faudrait (mission → lane → sentinelle) pour Astra.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-mobile-2026-09-06/_qa/grok/home` et `env -u FORCE_COLOR`.
- Ports de test ≥ 3460. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom ni secret dans les fichiers suivis.

## Journal

### 2026-09-06 — création du rapport (avant code)

HEAD `c74b8f22b`. Branche déjà extraite (prototype vibe 4 commits + rapport agy).
Rapports lus : `VERIF-MOBILE-AGY.md`, `MOBILE-PWA-VIBE.md`.
`buildTrajectory` est dans cette base (`2be0d27c2` sur `src/observability/run-trajectory.ts`).

### Décision Lisa (lecture avant d'écrire la v1)

Lu : `README.md`, `CLAUDE.md`, `package.json`, `apps/mobile/package.json`, `packages/ui-kit`, `packages/markdown-renderer`, `packages/audio-engine` (Web Speech), `src/hooks/useMcpClient.ts`, `src/theme/colors.ts`, `src/components/chat/ChatLayoutMobile.tsx`, `src/components/mobile/MessageBubble.tsx`.

**Choix : garder la PWA vanilla sous `/__codebuddy__/mobile/`, sans importer le client Lisa.**

Justification :

| Critère | Client Lisa (a) | Vanilla (b) |
|---|---|---|
| Pile | React 19 + Vite 6 + MUI 7 + Capacitor 8 + Tauri + TensorFlow + MediaPipe | HTML/CSS/JS, zéro bundler |
| `apps/mobile` | Wrapper Capacitor du web complet (`web-dir ../web/dist`) | — |
| `@lisa-sdk/ui` | peer MUI + lucide-react | — |
| `@lisa-sdk/markdown` | peer React + `react-markdown` + prismjs | — |
| `useMcpClient` | 25 lignes, list/read MCP, pas un chat | — |
| Bundle | largement > 10 Mo (vision/audio/3D) | quelques dizaines de Ko |
| Licence / auteur | même auteur, réutilisation légitime | — |

La mission impose l'architecture `route /__codebuddy__/mobile/` + PWA vanilla sans CDN + pas de bundle de 10 Mo pour un chat. Copier le client Lisa (ou une dépendance workspace vers `~/DEV/Lisa`) tirerait React/MUI/Capacitor et couplerait Code Buddy à la perception navigateur. Ce n'est pas un chat.

**Réutilisation ciblée, sans copie de paquets :**

- Jetons visuels Lisa (`src/theme/colors.ts`) : fond `#0a0a0f`, surface `#12121a`, accent ambre `#f5a623`, cyan `#06b6d4`, texte `#e8e8f0`.
- UX : bulles, double-tap copier, barre basse, saisie vocale Web Speech API (même idée que `packages/audio-engine/src/service.ts`).
- Markdown : rendu local assaini (pas `react-markdown`).

Pas de copie de fichiers Lisa dans `src/server/mobile/` (trop couplés à React). Pas de workspace vers le dépôt Lisa (cycle de build, monorepo pnpm, deps natives).

### Inspection des 10 trous (après réservation)

Constat agy relu sur le code :

- P1.1 : `mobilePwaRouter.get('/assets/*')` — Express 5 / `path-to-regexp` v8 refuse le joker anonyme.
- P1.2 : `npm run build` = `tsc` + `copy-bundled-skills` + `write-runtime-manifest`. Canvas/A2UI n'ont pas de copie : le HTML est inline. Les skills passent par `scripts/copy-bundled-skills.mjs`. Même patron pour la PWA.
- P1.3 : manifeste cite `icon-96.png` / `icon-192.png` ; seul `icon.svg` est présent.
- P2 : le handler émet `authenticated`, `stream_start`, `stream_chunk` (`payload.delta`), `stream_end`, `stream_stopped`, `chat_response` (`payload.content`), `pong`. Le prototype écoutait d'autres types.
- P3 : `selectAssistant` ne change qu'un libellé.
- P4 : aucun `confirmation` dans le handler WS. `ConfirmationService` a déjà `interactiveBridge` / `mcpApprovalBridge`.
- P5 : `RunStore.listRuns` + `loadTrajectory` / `buildTrajectory` existent ; pas de route HTTP. `provider-health.json` n'existe pas dans le dépôt — repli = chaîne `fallback-chain` + fichier optionnel `~/.codebuddy/provider-health.json` s'il est présent.
- P6 : CSP avec `unsafe-eval` + `unsafe-inline` (enregistrement SW inline).
- P7 : 18 suites / 40 tests rouges par crash d'import. Le test PWA utilise `http.get` comme s'il renvoyait une `IncomingMessage`.
- P8 : hors v1, documenté en fin de rapport.

## Preuves

*(rempli au fil des commits)*

## P8 — hors v1 (Astra)

*(rempli après P1–P7)*

## Bilan

*(dix lignes, pas de verdict)*
