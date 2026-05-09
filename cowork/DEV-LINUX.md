# Cowork dev on Linux

The default `npm run build` script in `cowork/` was built around the
macOS/Windows ship path: it downloads a standalone Node, then a
standalone Python runtime, then runs WSL/Lima sandbox agents through
their build chain, then `electron-builder` to package an installer.
On Linux these steps either fail or are useless for iterative
development. This guide is the lighter loop.

## One-time setup

```bash
cd /path/to/code-buddy
git clone https://github.com/phuetz/ai-providers.git ../ai-providers   # only if missing
(cd ../ai-providers && npm install && npm run build)
npm install                                                            # root deps
(cd cowork && npm install)                                             # cowork deps
npx tsc -p .                                                           # compile core into ./dist/

# Rebuild native modules for Electron's Node ABI (better-sqlite3, etc.).
# Required after any `npm install` at the root that touches native deps.
./cowork/node_modules/.bin/electron-rebuild --module-dir . --only better-sqlite3
```

If Cowork can't find `dist-electron/` after these steps, ensure the
`vite-plugin-electron` postinstall ran by re-running
`(cd cowork && npx vite build)`.

## Iterative dev loop

Skip the heavy `npm run build` and use `vite build` directly. It
produces `dist-electron/main`, `dist-electron/preload`, and `dist/`
in ~30 s without touching Python or sandbox agents.

```bash
cd cowork
npx vite build

DISPLAY=:0 NODE_ENV=production \
  ./node_modules/electron/dist/electron \
  --no-sandbox --disable-gpu \
  ./dist-electron/main/index.js
```

Flags:
- `--no-sandbox` — skip the chrome-sandbox suid setup (would otherwise
  abort on a fresh `node_modules/electron/`).
- `--disable-gpu` — avoid GL context probing in xrdp / VNC sessions.
- `DISPLAY=:0` — local X server. xrdp users typically run on
  `:10.0` instead.

For headless smoke tests via CDP:

```bash
DISPLAY=:0 NODE_ENV=production \
  ./node_modules/electron/dist/electron \
  --no-sandbox --disable-gpu \
  --remote-debugging-port=9222 \
  ./dist-electron/main/index.js &

curl -s http://localhost:9222/json | jq -r '.[] | select(.type=="page") | .webSocketDebuggerUrl'
# → ws://localhost:9222/devtools/page/<id>
# Use a small ws client (e.g. `ws` package + a 30-line CDP eval helper) to
# Runtime.evaluate JS into the renderer.
```

## Verifying the embedded server

Click the power button (⏻) in the titlebar, then:

```bash
curl -s http://127.0.0.1:3000/api/health | jq
```

Expected: `status: 'ok'`, `database: 'ok'` (after the
`registerBuiltinTools` and DatabaseManager init), `api: 'ok'` if a
provider env var is set or `OPENAI_BASE_URL` points at loopback,
`apiHeartbeat.status: 'ok'` after ~5 s (live monitor pings the
provider).

If you see `database: 'error'`, the most common causes are:
- `better-sqlite3` ABI mismatch (run electron-rebuild as above).
- `JWT_SECRET` not set in production (the bridge mints one
  automatically since commit `cc2d2260`).
- A previous `buddy serve` lingering on port 3000 (`ss -tlnp | grep
  ':3000'`).

## Debugging the renderer

In Cowork, hit `Ctrl+Shift+I` to open DevTools. The store is exposed
on `window.useAppStore` (see `cowork/src/renderer/store/index.ts`),
so:

```js
useAppStore.getState().sessions.length
useAppStore.getState().sessionStates[useAppStore.getState().activeSessionId]
useAppStore.getState().pendingApprovals
```

Many Zustand actions are also accessible — handy for forcing state
when chasing a UI bug.

## Common gotchas on Linux

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Cannot find package '@phuetz/ai-providers'` | sibling repo not cloned | clone + build it (commit `5757b197` inlined the package, so newer code-buddy doesn't need it) |
| `chrome-sandbox` SUID error | first `npm install` | use `--no-sandbox` flag |
| Electron freezes on boot | xrdp without `--disable-gpu` | always set the flag in dev |
| `prepare:python:all HTTP 504` | GitHub releases API rate limit | skip — use `npx vite build` instead of `npm run build` |
| `port 3000 already in use` | leftover `buddy serve` | `pkill -f "buddy serve"` or kill the PID from `ss -tlnp` |
| `mainWindow=false` log on every event | regression of the dual-mainWindow bug | run electron with `--enable-logging`; if the log shows up, `setMainWindow()` is missing somewhere — see `architecture.md` |
