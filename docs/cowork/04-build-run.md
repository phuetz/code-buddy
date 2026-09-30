# Build, dev, run

Cowork est un projet Electron à part (`cowork/`) avec son propre
`package.json`, Node ≥ 22, Vite + React + `better-sqlite3`. Deux chemins
coexistent : le **build de production** (multi-plateforme, lourd) et la
**boucle de dev Linux** (légère, ~30 s). Cette page décrit les deux,
honnêtement — le build prod n'est validé en CI que par tranches, la boucle
Linux est celle réellement utilisée au quotidien sur la machine de dev.

> Honnêteté : la boucle de dev Linux est **solide** (testée chaque jour).
> Le build prod complet (`npm run build`) est **partiellement validé** sur
> Linux — certaines étapes (Python standalone, agents WSL/Lima,
> `electron-builder`) sont pensées pour le ship macOS/Windows et soit
> échouent, soit sont inutiles en dev Linux (voir
> [`cowork/DEV-LINUX.md`](../../cowork/DEV-LINUX.md)).

## Build de production

```bash
cd cowork
npm run build
```

Le script `build` (dans `cowork/package.json`) enchaîne, dans l'ordre :

| Étape | Script | Rôle |
|-------|--------|------|
| Node standalone | `download:node` | télécharge un runtime Node embarqué dans l'app |
| Outils GUI | `prepare:gui-tools` | prépare les binaires d'outils desktop |
| Python standalone | `prepare:python:all` | runtime Python complet (skills Office, etc.) |
| Deps skills | `prepare:python:skills` | installe les dépendances Python des skills |
| Agent WSL | `build:wsl-agent` | compile l'agent sandbox Windows/WSL |
| Agent Lima | `build:lima-agent` | compile l'agent sandbox macOS/Lima |
| Bundle MCP | `build:mcp` | `node scripts/bundle-mcp.js` |
| Icône tray | `build:tray-icon` | génère l'icône de la barre des tâches |
| TypeScript | `tsc` | compile le code main/preload |
| Renderer | `vite build` | bundle le front React |
| Pre-build check | `node scripts/pre-build-check.js` | vérifications avant packaging |
| Packaging | `electron-builder` | produit l'installateur |

Sur Linux, `prepare:python:all` peut renvoyer un `HTTP 504` (rate-limit de
l'API GitHub releases) et les agents WSL/Lima n'ont aucun intérêt. **Pour
itérer sur Linux, n'utilise pas `npm run build`** — passe par la boucle
ci-dessous.

Note : le script `dev` (`npm run dev`) lance lui aussi `download:node`,
`build:wsl-agent`, `build:lima-agent`, `build:mcp` avant `vite` — d'où sa
lenteur. La boucle manuelle ci-dessous saute ces préalables.

## Boucle de dev Linux (recommandée)

Référence complète : [`cowork/DEV-LINUX.md`](../../cowork/DEV-LINUX.md). Résumé :

### 1. Préparation (une fois)

```bash
# Depuis la racine du repo code-buddy :
npm install                                    # deps racine (CLI / moteur)
npx tsc -p .                                   # compile le moteur core -> ./dist/

cd cowork
npm install                                    # deps cowork
npm run rebuild                                # electron-rebuild de better-sqlite3
```

`npm run rebuild` recompile `better-sqlite3` contre l'ABI Node d'Electron
(`--runtime=electron --target=<version> --disturl=https://electronjs.org/headers`).
Il est lancé automatiquement en `postinstall`, mais doit être rejoué après
tout `npm install` qui touche les modules natifs.

> Pourquoi compiler le core (`npx tsc -p .`) à la racine **et** builder
> cowork : Cowork embarque le moteur Code Buddy depuis
> `<repo>/dist/desktop/codebuddy-engine-adapter.js`. Si `./dist/` n'existe
> pas, Cowork retombe sur le runner `pi-coding-agent` (chat fonctionnel,
> mais sans MCP runtime sync, hot-swap modèle, hot-reload skills, etc.).

### 2. Build + lancement (à chaque itération)

```bash
cd cowork
npx vite build            # ~30 s : produit dist-electron/main, dist-electron/preload, dist/

xvfb-run -a env NODE_ENV=production \
  ./node_modules/electron/dist/electron \
  --no-sandbox --disable-gpu \
  ./dist-electron/main/index.js
```

Les flags ne sont pas cosmétiques :

| Flag | Raison |
|------|--------|
| `--no-sandbox` | évite le setup suid de `chrome-sandbox` (aborterait sinon sur un `node_modules/electron/` frais) |
| `--disable-gpu` | évite le probing GL en session xrdp / VNC (sinon Electron gèle au boot) |
| `xvfb-run -a` | écran virtuel privé pour les essais sans bureau |

### 3. Smoke test headless

```bash
cd cowork
xvfb-run -a npx playwright test e2e/cowork-smoke.spec.ts --workers=1
```

Le fixture Electron lance et ferme son propre processus. N’utilisez pas un
écran appartenant à une autre session et n’arrêtez pas les services existants.

## Tests

```bash
cd cowork
npm test              # Vitest (unitaire / intégration)
npm run test:e2e      # Playwright (build:e2e puis playwright test)
npm run test:coverage # Vitest + couverture v8
```

- **Vitest** (`vitest.config.ts`) tourne en `environment: 'node'`. Electron
  est **mocké** via un alias vers `tests/mocks/electron.ts` — la CI ne dépend
  donc pas du `path.txt` généré au postinstall. `mockReset` et
  `restoreMocks` sont activés.
- **Playwright** (`playwright.config.ts`) : e2e sur l'app réelle.
  `test:e2e` lance d'abord `build:e2e` (= `vite build`) puis
  `playwright test`. Config sérialisée (`fullyParallel: false`,
  `workers: 1`, timeout 60 s), traces/screenshots/vidéo conservés
  uniquement en cas d'échec (`retain-on-failure`).

### Seuils de couverture

Définis dans `vitest.config.ts` (`coverage.thresholds`) — volontairement
**modestes** (~30 %), honnêtes sur la maturité de la suite :

| Métrique | Seuil |
|----------|-------|
| lines | 30 % |
| statements | 30 % |
| functions | 35 % |
| branches | 28 % |

Le renderer (`src/renderer/`) et les fichiers de test sont exclus de la
couverture (logique testée côté main/IPC).

## Aller plus loin

- Lancement « one-liner » côté CLI : `buddy install-gui` puis `buddy gui`
  (alias `buddy desktop`) — installe Electron et build le bundle desktop.
- Détails Linux, résolution du moteur embarqué (4 couches), vérification du
  serveur embarqué : [`cowork/DEV-LINUX.md`](../../cowork/DEV-LINUX.md).
- Gotchas (dual-`mainWindow`, ABI sqlite, GPU) :
  [06 — Dépannage](06-troubleshooting.md).
