# RAPPORT GK30 — Widgets génératifs et widget boursier en vrai

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-widgets-2026-09-02`
Branche : `fix/gk30-widgets-reel-2026-09-03`
HEAD au démarrage : `a41944cc2` (`Merge GK21 (outils navigateur en vrai : app_server, web_test, computer_control) into codex/audit-systeme-nerveux-2026-09-01`)
HEAD produit : lot documentaire (cette révision)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code widgets, `stock_quote`, canvas serveur, tests et documentation associée.

## Mission

Éprouver en vrai le parcours widgets génératifs + widget boursier :

- `buddy server` de test → agent headless Ollama « cours de AAPL » → `stock_quote` → payload `data:{type:'stock'}` → widget rendu sur le canvas (HTML récupéré via `/__codebuddy__/canvas/:id`, capture headless)
- source primaire coupée (faux serveur en erreur) → repli sur la suivante annoncé honnêtement, jamais un cours inventé
- widget génératif auto-proposé (`CODEBUDDY_WIDGETS=true` **et** `CODEBUDDY_WIDGETS_AUTO=true`) sur une réponse tabulaire → widget serveur, réutilisation d'un widget déjà autorisé
- sans les variables : byte-identique (test)

Loi : « se servir de ses applis EN VRAI ». Variable réelle : `CODEBUDDY_WIDGETS` + `CODEBUDDY_WIDGETS_AUTO` (G9/DOC1 ont retiré `CODEBUDDY_WIDGETS_AUTOGEN`).

## Garde-fous tenus

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local `qwen3:4b-instruct`. `stock_quote` : faux HTTP loopback Yahoo 500 → Nasdaq JSON, bases `CODEBUDDY_YAHOO_FINANCE_BASE` / `_NASDAQ_BASE`.
- Aucun service systemd. ComfyUI 8188/8189 non touché. Ports 3000/3001 occupés → `port: 0`.
- HOME temporaire `_qa/gk30/home`. Jamais le vrai `~/.codebuddy`.
- Un commit conventionnel par lot, fichiers nommés un par un.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 13:08 | Rapport créé **avant inspection**. Coordination réservée. `dca203615`. |
| 13:09–13:16 | Inspection CLAUDE.md, `src/widgets/`, `stock-quote.ts`, canvas, tests. |
| 13:16 | Tests E1–E3 collés **rouges** (canvas 404, repli silencieux, dates absentes). |
| 13:18 | E1 canvas monté. Vert. `5824dd385`. |
| 13:20 | E3 dates Yahoo/Nasdaq/Stooq. Vert. `8d95cf068`. |
| 13:21 | E2 repli annoncé. Vert. `fabce9073`. |
| 13:23 | E4 widget auto → canvas + payload tools. Vert. `248fe641f` `a8c22be34`. |
| 13:25 | HTTP réel + capture Playwright. Vert. `134b27383`. |
| 13:30 | Live `buddy server` + tools execute : Yahoo 500 → Nasdaq, HTML canvas. |
| 13:31 | `/api/chat` 4b sans filtre d'outils : refus, 0 tool call (prompt tronqué). |
| 13:34 | Agent headless Ollama `--allowed-tools stock_quote` : tool call réel, payload, widgetHtml. 15,7 s. |
| 13:35 | Union 15 fichiers / 109 tests verts. `tsc` racine+GPU 0. ESLint ciblé 0. |

## Fichiers lus

- `CLAUDE.md` (§ Generative UI `CODEBUDDY_WIDGETS_AUTO`, `stock_quote`, routes canvas)
- `docs/cb2/generative-ui.md`, `docs/cb2/README.md`, `docs/infrastructure.md`
- `src/widgets/` (`auto-widget.ts`, `widget-engine.ts`, `widget-matcher.ts`, `widget-registry.ts`, `curated/stock.ts`)
- `src/tools/stock-quote.ts`, `src/tools/registry/web-tools.ts`
- `src/server/routes/canvas.ts`, `src/server/index.ts`, `src/server/routes/chat.ts`, `src/server/routes/tools.ts`, `src/server/agent-adapter.ts`
- `src/index.ts` (headless JSON + autoWidget)
- Tests existants : `tests/widgets/*`, `tests/tools/stock-quote.test.ts`, `tests/canvas/canvas-server.test.ts`, `tests/cli/headless-exit-code.test.ts`, `tests/docs/revue-gemini-docs.test.ts`

## Écarts

### E1 — `/__codebuddy__/canvas/:id` documenté mais 404 — FERMÉ (`5824dd385`)

`createCanvasRoutes` existait, n'était jamais monté sur Express. GET live → 404. Un POST `{html:''}` aurait été accepté comme rendu.

- Rouge : `tests/server/gk30-canvas-routes.test.ts` — status 404.
- Correctif : `createCanvasRouter()` monté sur `/__codebuddy__`. HTML complet servi tel quel. Push sans HTML → 400.
- Vert : 1/1.

### E2 — Repli silencieux Yahoo → Nasdaq — FERMÉ (`fabce9073`)

Le résumé disait seulement le cours Nasdaq, sans dire que Yahoo avait échoué.

- Rouge : output `Apple Inc. (AAPL) : 315,39 USD…` sans « Yahoo » ni « indisponible ».
- Correctif : `announceFallback` préfixe `Yahoo Finance indisponible. Repli Nasdaq : …` + `metadata.fallbackFrom`.
- Vert : 4/4 honesty + 22 voisins stock-quote.

### E3 — Cours sans date calendaire — FERMÉ (`8d95cf068`)

Nasdaq ignorait `lastTradeTimestamp`, Stooq n'utilisait que l'heure, Yahoo `fmtTime` n'affichait que HH:mm. Le widget pouvait montrer un prix périmé sans jour.

- Rouge : `time` Nasdaq `undefined`, Stooq `22:00`, Yahoo `12:53`.
- Correctif : date Nasdaq, `YYYY-MM-DD HH:mm` Stooq, `fmtTime` jour+heure, `relevé …` si l'amont n'en donne pas.
- Vert : 3/3 dates + widget contient 2026.

### E4 — Payload `data` et widget canvas absents de l'API — FERMÉ (`248fe641f`, `a8c22be34`)

`POST /api/tools/:name/execute` droppait `data`. Aucune publication canvas même avec `CODEBUDDY_WIDGETS_AUTO=true`.

- Correctif : `publishAnswerWidget` / `publishToolResultWidget`. REST et `/api/chat` exposent `data` + `widgetHtml` + `canvasId` seulement si le HTML existe. Sans env : pas de publication.
- Vert : auto-canvas 3/3 + stock-widget-canvas 2/2.

## Parcours réel

1. Faux Yahoo HTTP 500 + Nasdaq JSON AAPL daté `Sep 03, 2026`.
2. `buddy server` (`port: 0`, `127.0.0.1`, HOME `_qa/gk30/home`).
3. `POST /api/tools/stock_quote/execute` `{symbol:AAPL}` : `data.type=stock`, output avec repli, `canvasPath` servi, HTML contient AAPL + 2026.
4. Capture Playwright : `_qa/gk30/proofs/stock-widget.png` (81 Ko) — Apple Inc. 226,34 USD, +1,40 %, date 03/09/2026.
5. Agent headless Ollama `qwen3:4b-instruct` `--allowed-tools stock_quote` : tool call `stock_quote({symbol:AAPL})`, payload, `widgetHtml`, réponse « Le cours de AAPL est de 226,34 USD. » (15,7 s, $0).

`/api/chat` sans filtre d'outils : le 4b, prompt tronqué 207 k→57 k, **n'appelle pas** l'outil (« I cannot access stock quotes… »). Ce n'est pas un mensonge de cours : 0 tool call. Le chemin headless filtré est le parcours agent prouvé.

## Tableau final « scénario → attendu → obtenu → correctif → commit »

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| GET `/__codebuddy__/canvas/` sur `buddy server` | HTML 200 | 404 | Monter `createCanvasRouter` | `5824dd385` |
| POST canvas `{html:""}` | 400, pas un rendu | 200 snapshot vide | Refus HTML vide | `5824dd385` |
| GET `/__codebuddy__/a2ui/` | page A2UI | 404 | Même montage | `5824dd385` |
| Yahoo 500, Nasdaq OK | Repli **annoncé**, cours Nasdaq daté | Cours Nasdaq **sans** mention du repli | `announceFallback` | `fabce9073` |
| Toutes sources en erreur | `success:false`, aucun prix | Conforme (déjà) | Test de non-régression | `fabce9073` |
| Payload Yahoo/Nasdaq/Stooq | Date calendaire sur `data.time` et le widget | Heure seule ou rien | Parsers + `fmtTime` | `8d95cf068` |
| `CODEBUDDY_WIDGETS` / `_AUTO` off | Texte byte-identique, 0 canvas | Conforme autoWidget ; REST droppait `data` | `data` REST toujours ; canvas seulement si AUTO | `248fe641f` |
| Tableau markdown ≥200 car. + AUTO | HTML `<table>` sur canvas | Pas de publication serveur | `publishAnswerWidget` | `248fe641f` |
| Widget authored `dataTypes` | Réutilisation, pas de LLM | Conforme matcher ; désormais poussé canvas | publish | `248fe641f` |
| `stock_quote` → canvas HTML + capture | HTML avec AAPL + date, PNG | Capture 81 Ko | Test Playwright | `134b27383` |
| Agent Ollama « cours de AAPL » | `stock_quote` + payload + widgetHtml | CLI `--allowed-tools` : OK 15,7 s. `/api/chat` 4b sans filtre : 0 tool | Constat, pas un cours inventé | — |

## Vérifications

- Union ciblée : 15 fichiers / **109 tests verts**.
- `npx tsc --noEmit -p .` exit 0 ; `tsconfig.gpuNode-identity.json` exit 0.
- ESLint ciblé `--max-warnings=0` exit 0.
- `git diff --check` propre.
- Aucun push. `package-lock.json` restauré après `npm install` (hors sujet).

## Reste ouvert

- `/api/chat` avec le catalogue d'outils complet + `qwen3:4b-instruct` : prompt tronqué, le modèle refuse d'appeler `stock_quote`. Le CLI `--allowed-tools stock_quote` fonctionne.
- Construire `CodeBuddyAgent` sans provider (pas de clé, pas d'Ollama) : REST tools 500 `API key is required` avant même `stock_quote`.
- Spec historique `docs/specs/cb2/INNOV-07-generative-ui.md` cite encore `CODEBUDDY_WIDGETS_AUTOGEN` ; le contrat courant (`docs/cb2/`) est juste.
