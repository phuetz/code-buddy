# SPEC — `web_scrape` : scraping local ultra-rapide via Scrapling

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `feat/web-scrape-scrapling`.

## Contexte produit
Code Buddy a déjà `web_fetch`/`web_extract` (fetch + extraction readability légère en TS) et
`firecrawl_scrape` (SaaS externe **payant**, clé API). Il manque le créneau **scrape lourd mais
LOCAL et GRATUIT** : anti-bot (Cloudflare), rendu JS, et sélecteurs adaptatifs qui survivent aux
changements de structure. On l'apporte en déléguant à **Scrapling** (https://github.com/D4Vinci/Scrapling,
`pip install "scrapling[fetchers]"`, Python 3.10+, BSD-3), via un **sidecar Python** exactement
comme `buddy-vision/` + le tool `object_detect`. Le « 1600× plus rapide » vient de son parser.

Philosophie Code Buddy : local-first, $0, jamais de dépendance cloud imposée. Le tool doit
**dégrader gracieusement** (fail-open) vers le `web_fetch` existant quand Scrapling n'est pas installé.

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Never-throws / fail-open : une panne de Scrapling ne casse jamais un tour d'agent.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, `.venv`, état `.codebuddy/`.
- Documente dans `docs/cb2/web-scrape.md`. NE MODIFIE PAS CLAUDE.md.

## Fichiers de référence à cloner (LIS-LES D'ABORD — ne devine pas les patterns)
- **Sidecar TS** : `src/tools/vision/object-detection.ts` — LE modèle. Copie sa structure :
  `resolvePythonPath()` (arg → env var → venv connu → `python3`), `spawnWithTimeout()`
  (`spawn` + capture stdout + timeout + rejet si code≠0), `parsePythonJson(stdout)` (**parse la
  DERNIÈRE ligne JSON** de stdout, robuste au bruit Python), et le point d'injection
  `runtime.runYolo ?? runYoloViaPython` (le tien = `runtime.runScrapling`).
- **Test sidecar** : `tests/tools/vision/blender-render.test.ts` — le helper `fakeSpawn(code)` qui
  émet une ligne sur `stdout` puis `'close', 0` ; c'est ton modèle de test (aucun vrai process).
- **Def d'un tool web** : `src/codebuddy/tool-definitions/web-tools.ts` (ex. `WEB_FETCH_TOOL:35`,
  `STOCK_QUOTE_TOOL:165`) + le tableau `WEB_TOOLS` (~`:189`).
- **Registry web** : `src/tools/registry/web-tools.ts` — `createWebTools()` (~`:368`) retourne le
  tableau des `ITool` ; ajoute le tien (ex. modèles `WebFetchTool:135`, `StockQuoteExecuteTool`).
- **Dispatch legacy** : `src/agent/tool-executor.ts` — ajoute un `case 'web_scrape'` (voir
  `web_fetch:478`, `stock_quote:483`).
- **Metadata** : `src/tools/metadata.ts` (voir `web_fetch:316`) — `keywords` + `priority` +
  `fleetSafe: true` (read-only).
- **SSRF** : `src/security/ssrf-guard.ts` `assertSafeUrl` — appelle-le sur l'URL AVANT tout spawn.
- **Sidecar Python de référence** : `buddy-vision/setup.sh` (venv + requirements + deps lourdes
  derrière un flag env).

## Périmètre P0

### 1. Sidecar Python `buddy-scrapling/`
- `buddy-scrapling/requirements.txt` : `scrapling[fetchers]` (épingle une version majeure connue,
  ex. `scrapling>=0.2,<1.0` — vérifie une version plausible ; ne bloque pas si résolution impossible).
- `buddy-scrapling/scrape.py` : lit UNE requête JSON sur **stdin**, écrit UNE ligne JSON sur
  **stdout**. Requête :
  `{"url": str, "mode": "http"|"stealth"|"dynamic", "format": "markdown"|"text"|"html",
    "css": {champ: sélecteur, ...}?, "timeout": int?, "impersonate": str?, "solveCloudflare": bool?}`.
  - `http` → `Fetcher.get(url, impersonate=…, stealthy_headers=True)` (léger, pas de navigateur).
  - `stealth` → `StealthyFetcher.fetch(url, headless=True, solve_cloudflare=solveCloudflare)`.
  - `dynamic` → `DynamicFetcher.fetch(url, headless=True, network_idle=True)`.
  - Sortie : `{"ok": true, "status": int, "engine": "http"|"stealth"|"dynamic",
    "markdown"?: str, "text"?: str, "html"?: str, "extracted"?: {champ: [valeurs]}, "title"?: str}`.
    Le champ principal suit `format` (`page.markdown` / `page.get_all_text()` / `page.html`) ;
    `extracted` = pour chaque `css`, `page.css(sel + '::text').getall()` (ou l'élément si pas `::text`).
    Erreur → `{"ok": false, "error": str}` sur stdout + exit 0 (pour que le TS parse proprement).
  - `import scrapling` protégé : ImportError → `{"ok": false, "error": "scrapling-not-installed"}`.
- `buddy-scrapling/setup.sh` : crée `~/.codebuddy/scrapling/.venv`, installe `requirements.txt`.
  Les **navigateurs Playwright** (lourds, requis seulement pour stealth/dynamic) sont installés
  seulement si `BUDDY_SCRAPLING_INSTALL_BROWSERS=1` (`scrapling install`). Le mode `http` marche sans.
- `buddy-scrapling/README.md` : install + modes + notes AMD (idem buddy-vision).

### 2. Tool TS `src/tools/web-scrape-tool.ts`
- `class WebScrapeTool` renvoyant `Promise<ToolResult>` (`{success, output?, error?}`).
- Params : `{url, mode?='http', format?='markdown', css?, timeout?, impersonate?, solveCloudflare?}`.
- Étapes : `assertSafeUrl(url)` (SSRF, fail-closed sur URL privée/loopback selon la politique du
  guard) → résout le python Scrapling → `runtime.runScrapling ?? runScraplingViaPython` (INJECTABLE)
  → spawn `python scrape.py`, envoie la requête JSON sur stdin, timeout
  (`CODEBUDDY_SCRAPLING_TIMEOUT_MS`, défaut 60000) → parse la dernière ligne JSON.
- `resolveScraplingPython()` : `CODEBUDDY_SCRAPLING_PYTHON` / `BUDDY_SCRAPLING_PYTHON` →
  `~/.codebuddy/scrapling/.venv/bin/python` → `python3` (`python` sous Windows).
  `resolveScriptPath()` : `buddy-scrapling/scrape.py` résolu par rapport à la racine du repo/dist.
- **Fail-open gracieux** : si le python est introuvable OU la sortie = `scrapling-not-installed`,
  le tool **retombe automatiquement sur le fetch existant** `getWebSearch().fetchPage(url)`
  (annoter `engine: 'fallback (web_fetch)'` dans l'output) au lieu d'échouer — SAUF si
  `CODEBUDDY_SCRAPLING_NO_FALLBACK=true` (alors erreur claire suggérant `buddy scrape --setup`).
  Un vrai échec réseau (Scrapling installé mais site injoignable) remonte l'erreur normalement.
- Output formaté lisible : le contenu (markdown/text/html tronqué raisonnablement), le titre, le
  moteur utilisé, et `extracted` s'il y a des sélecteurs.

### 3. Câblage (les 5 points, cf. fichiers de référence)
Def `WEB_SCRAPE_TOOL` dans `tool-definitions/web-tools.ts` + ajout à `WEB_TOOLS` ; factory dans
`createWebTools()` ; dispatch `case 'web_scrape'` dans `tool-executor.ts` ; metadata `web_scrape`
(`fleetSafe: true`, keywords : scrape, crawl, extract, cloudflare, anti-bot, stealth, html, markdown,
adaptive, selector). Alias Codex optionnel `web_scrape`→ dans `tool-aliases.ts` si le motif s'y prête.

### 4. CLI `buddy scrape` — `src/commands/scrape.ts` (lazy-loadé depuis `src/index.ts`)
- `buddy scrape <url> [--mode http|stealth|dynamic] [--format md|text|html] [--css "k=sel" ...]
   [--out FILE]` — scrape et imprime (ou écrit le fichier).
- `buddy scrape --setup [--browsers]` — exécute `buddy-scrapling/setup.sh`
  (`BUDDY_SCRAPLING_INSTALL_BROWSERS=1` si `--browsers`) et rapporte le résultat.
- `buddy scrape --check` — indique si Scrapling est détecté (venv/python) et sa version.

## Tests exigés
- `tests/tools/web-scrape-tool.test.ts` (modèle `blender-render.test.ts` avec `runtime.runScrapling`
  ou `deps.spawn` injecté) :
  - succès mode http : stdout = ligne JSON `{ok:true, engine:'http', markdown:'…'}` → output contient
    le markdown + le moteur.
  - sélecteurs : `extracted` remonté dans l'output.
  - `scrapling-not-installed` → **fallback** vers un `fetchPage` mocké (injecté) + annotation
    `fallback` ; avec `CODEBUDDY_SCRAPLING_NO_FALLBACK=true` → erreur guidant vers `--setup`.
  - timeout (spawn qui n'émet jamais) → échec propre (never-throws).
  - SSRF : URL loopback/privée → refus sans spawn (spy).
  - parse robuste : lignes de bruit Python avant la ligne JSON finale → OK.
- `tests/commands/scrape.test.ts` : Commander `parseAsync()` + `exitOverride()` + mocks
  `console.log`/`process.exit` (motif CLI existant) — `--check`, un scrape avec runner mocké.

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Le tool ne casse jamais quand Scrapling est absent (fallback prouvé par test).
- `docs/cb2/web-scrape.md` écrit (modes, env vars, setup, fallback, limites AMD). Commits
  Conventional (`feat(tools): …`, `feat(cli): …`).

## Interdits
- Pas de `pip install` ni de spawn Python réel dans les tests (tout injecté/mocké).
- Ne modifie PAS `web_fetch`/`firecrawl`/`browser` existants (tu ajoutes, tu ne remplaces pas).
- Le worker Python n'exécute jamais de code arbitraire venant de la page ; il extrait, point.
- Respecte le SSRF guard existant — ne réimplémente pas ta propre allowlist.
