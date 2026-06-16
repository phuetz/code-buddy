# cowork-pilot

Programmatic control of the **Cowork** Electron GUI for testing & automation —
a **CLI** and an **MCP server** sharing one core (`pilot-core.mjs`) built on
Playwright's `_electron` (already a Cowork dependency). It can launch its own
isolated Cowork instance *or* attach to a running one
(`--remote-debugging-port`).

Born out of the 2026-06-15 real-conditions audit: instead of writing one-off
Playwright specs, drive Cowork live (real ChatGPT chat, screenshots, store
state, IPC, Test Runner bundles) from a shell or from any MCP client.

## Layout

| File | Role |
|---|---|
| `pilot-core.mjs` | `CoworkPilot` class — launch/attach, chat, screenshot, eval, IPC, state, Test Runner bundles. |
| `cli.mjs` | `cowork-pilot` CLI — long-lived **daemon** + thin client subcommands (+ `once` one-shot mode). |
| `mcp-server.mjs` | `cowork-pilot-mcp` — stdio **MCP server** exposing 12 tools. |

## Requirements

- Run from this directory (or anywhere under `cowork/`) so Node resolves
  `playwright`/`electron` from `cowork/node_modules`.
- A built Cowork bundle: `cd cowork && npx vite build` (produces
  `dist-electron/` + `dist/`).
- An X display. Defaults to `DISPLAY=:10.0` (xrdp); override via env.
- To use the **real ChatGPT subscription**, the OAuth token must exist at
  `~/.codebuddy/codex-auth.json` (created by `buddy login`). Pass `--real`.

## CLI

```bash
# Start the daemon (keeps ONE Cowork instance alive across commands)
node cli.mjs daemon            # add --real to wire the ChatGPT profile, --attach URL to attach
                               # add --port N (default 7333), --user-data DIR

# Then, from other shells:
node cli.mjs status                       # daemon health
node cli.mjs state                        # store + headings snapshot
node cli.mjs set-provider --real          # configure the real ChatGPT (Codex) profile
node cli.mjs chat "Hello" --marker '^OK'  # send a prompt, print the assistant reply
node cli.mjs shot /tmp/cowork.png         # full-page screenshot
node cli.mjs eval "document.title"        # run JS in the renderer
node cli.mjs ipc workdir.set '{"path":"/repo"}'   # generic electronAPI.invoke
node cli.mjs click "text=Outils"          # selectors: testid= / text= / role=Name / raw CSS
node cli.mjs fill  "testid=welcome-prompt-input" "hi"
node cli.mjs list-bundles                 # Test Runner catalog rows
node cli.mjs run-bundle code-buddy-cowork-functional-coverage-bundle
node cli.mjs stop                         # graceful shutdown

# One-shot (no daemon): launches a throwaway instance, runs once, exits
node cli.mjs once chat "2+2?" --real
node cli.mjs once shot /tmp/c.png
node cli.mjs once run-bundle <id>
```

## MCP server

stdio server (MCP `2024-11-05`). 12 tools:

`cowork_launch` (args: `real?`, `userDataDir?`, `attach?`) · `cowork_chat`
(`prompt`, `marker?`, `timeoutMs?`) · `cowork_screenshot` (`path?`,
`fullPage?` — returns an image) · `cowork_eval` (`js`) · `cowork_ipc`
(`type`, `payload?`) · `cowork_get_state` · `cowork_click` (`selector`) ·
`cowork_fill` (`selector`, `text`) · `cowork_list_bundles` · `cowork_run_bundle`
(`id`, `timeoutMs?`) · `cowork_get_config` · `cowork_close`.

Any tool lazily launches Cowork if not started. Logs go to **stderr** (stdout is
the MCP channel).

### Register in Code Buddy (`~/.codebuddy/mcp.json`)

```json
{
  "mcpServers": {
    "cowork-pilot": {
      "name": "cowork-pilot",
      "transport": {
        "type": "stdio",
        "command": "node",
        "args": ["/home/patrice/code-buddy/cowork/pilot/mcp-server.mjs"],
        "env": { "DISPLAY": ":10.0" }
      },
      "enabled": true,
      "description": "Drive the Cowork Electron GUI (chat, screenshots, state, Test Runner bundles)"
    }
  }
}
```

Then any MCP client (Code Buddy, Claude Desktop, …) can drive Cowork.

## Library use

```js
import { CoworkPilot, CHATGPT_PROFILE } from './pilot-core.mjs';
const pilot = new CoworkPilot();
await pilot.launch();
await pilot.configureProvider(CHATGPT_PROFILE);       // real ChatGPT subscription
const { reply } = await pilot.chat('17*23?', { marker: '^CB' });
await pilot.screenshot('/tmp/out.png');
await pilot.close();
```

## Notes

- `chat()` marker mode excludes the echoed prompt bubble, so a marker that also
  appears in the prompt still resolves to the assistant's reply. Without a
  marker it falls back to a "text settles" heuristic.
- The e2e launch path sets `COWORK_E2E=1` and an isolated `userData` dir (wiped
  on close unless `keepUserData`). It does **not** touch `~/.codebuddy` except
  to read the ChatGPT OAuth token, so real chats use the live subscription.
