#!/usr/bin/env node
/**
 * cowork-pilot CLI — drive the Cowork Electron GUI from the command line.
 *
 * Architecture: a long-lived `daemon` process owns ONE CoworkPilot instance
 * (the Electron app must persist across separate CLI invocations). Thin-client
 * subcommands read ~/.cowork-pilot/daemon.json and POST to the daemon's
 * 127.0.0.1 HTTP server. A `once` mode runs a single action with a throwaway
 * pilot (no daemon required) for CI.
 *
 * Pure Node ESM, Node 24. No npm deps beyond the local ./pilot-core.mjs.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { CoworkPilot, CHATGPT_PROFILE } from './pilot-core.mjs';

const STATE_DIR = path.join(os.homedir(), '.cowork-pilot');
const DAEMON_FILE = path.join(STATE_DIR, 'daemon.json');
const DEFAULT_PORT = 7333;

// ---------------------------------------------------------------------------
// arg parsing (hand-rolled, no commander)
// ---------------------------------------------------------------------------

/**
 * Split argv into positionals and flags. Flags may take a value (`--port 7333`)
 * or be booleans (`--real`, `--no-full`). We treat `--flag value` as a value
 * flag unless `value` itself looks like another flag, in which case the flag is
 * boolean. The caller decides which flags are boolean via `boolFlags`.
 */
function parseArgs(argv, boolFlags = new Set()) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq !== -1) {
        flags[tok.slice(2, eq)] = tok.slice(eq + 1);
        continue;
      }
      const name = tok.slice(2);
      if (boolFlags.has(name)) {
        flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else if (tok.startsWith('-') && tok.length === 2) {
      // short flags: -h
      flags[tok.slice(1)] = true;
    } else {
      positionals.push(tok);
    }
  }
  return { positionals, flags };
}

function die(msg, code = 1) {
  process.stderr.write(String(msg).replace(/\n?$/, '\n'));
  process.exit(code);
}

function out(obj) {
  // Pretty-print JSON for human + machine readability.
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// daemon
// ---------------------------------------------------------------------------

async function cmdDaemon(rest) {
  const { flags } = parseArgs(rest, new Set(['real']));
  const port = flags.port ? Number(flags.port) : DEFAULT_PORT;
  const real = !!flags.real;
  const userDataDir = flags['user-data'] || undefined;
  const attachUrl = flags.attach || undefined;

  // Ensure DISPLAY is set before constructing the pilot (pilot-core defaults
  // too, but be explicit so the env is correct for the whole process).
  if (!process.env.DISPLAY) process.env.DISPLAY = ':10.0';

  const mode = real ? 'real' : 'mock';
  let server = null;
  let shuttingDown = false;

  const log = (line) => process.stderr.write(`${line}\n`);
  const pilot = new CoworkPilot({ userDataDir, log });

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[daemon] shutting down${signal ? ` (${signal})` : ''}`);
    try {
      if (server) await new Promise((r) => server.close(() => r()));
    } catch {
      /* ignore */
    }
    try {
      await pilot.close();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(DAEMON_FILE, { force: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  // Register signal handlers FIRST so `kill` works even if boot hangs.
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Bring up the Electron app (or attach). A failure here leaves no daemon.json.
  try {
    if (attachUrl) {
      log(`[daemon] attaching to ${attachUrl}`);
      await pilot.attach(attachUrl);
    } else {
      log('[daemon] launching Cowork…');
      await pilot.launch();
    }
    if (real) {
      log('[daemon] configuring real ChatGPT provider…');
      await pilot.configureProvider(CHATGPT_PROFILE);
    }
  } catch (err) {
    log(`[daemon] boot failed: ${err?.stack || err}`);
    try {
      await pilot.close();
    } catch {
      /* ignore */
    }
    process.exit(1);
  }

  // Only NOW bind HTTP + write daemon.json so "health up" == "pilot ready".
  const STARTED_AT = new Date().toISOString();
  server = http.createServer((req, res) => {
    const send = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(body);
    };

    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { ok: true, pid: process.pid, port, mode, startedAt: STARTED_AT });
    }

    if (req.method === 'POST' && (req.url === '/rpc' || req.url === '/shutdown')) {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 64 * 1024 * 1024) req.destroy(); // guard runaway bodies
      });
      req.on('end', async () => {
        if (req.url === '/shutdown') {
          send(200, { ok: true });
          // respond first, then close
          setImmediate(() => shutdown('shutdown-rpc'));
          return;
        }
        let parsed;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch (e) {
          return send(400, { ok: false, error: `invalid JSON body: ${e.message}` });
        }
        const { method, args } = parsed;
        const argList = Array.isArray(args) ? args : [];
        const fn = pilot[method];
        if (typeof fn !== 'function') {
          return send(400, { ok: false, error: `unknown pilot method: ${method}` });
        }
        try {
          const result = await fn.apply(pilot, argList); // preserve `this`
          send(200, { ok: true, result: result === undefined ? null : result });
        } catch (e) {
          send(200, { ok: false, error: e?.message || String(e) });
        }
      });
      return;
    }

    send(404, { ok: false, error: 'not found' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch((e) => {
    log(`[daemon] failed to bind 127.0.0.1:${port}: ${e.message}`);
    return shutdown('bind-failed');
  });

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    DAEMON_FILE,
    JSON.stringify({ pid: process.pid, port, startedAt: STARTED_AT, mode }, null, 2)
  );
  log(`[daemon] ready on http://127.0.0.1:${port} (mode=${mode}, pid=${process.pid})`);
  // Keep the process alive — the http server holds the event loop open.
}

// ---------------------------------------------------------------------------
// thin client
// ---------------------------------------------------------------------------

function readDaemonInfo() {
  if (!fs.existsSync(DAEMON_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(DAEMON_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function daemonFetch(pathname, init) {
  const info = readDaemonInfo();
  if (!info) {
    die(
      'No cowork-pilot daemon is running. Start one first:\n  cowork-pilot daemon [--port N] [--real]\nOr use one-shot mode:\n  cowork-pilot once <chat|shot|run-bundle> …'
    );
  }
  const url = `http://127.0.0.1:${info.port}${pathname}`;
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e?.cause?.code === 'ECONNREFUSED' || e?.code === 'ECONNREFUSED') {
      die(
        `Daemon record found (pid ${info.pid}, port ${info.port}) but it is not responding. It may have crashed.\nRun \`cowork-pilot stop\` to clear it, then \`cowork-pilot daemon\` to restart.`
      );
    }
    die(`Failed to reach daemon: ${e.message}`);
  }
}

/** POST an RPC to the daemon. Returns the parsed `result` or throws (exits). */
async function rpc(method, args = []) {
  const res = await daemonFetch('/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args }),
  });
  const data = await res.json();
  if (!data.ok) die(`RPC ${method} failed: ${data.error}`);
  return data.result;
}

// ---------------------------------------------------------------------------
// subcommands (client)
// ---------------------------------------------------------------------------

async function cmdChat(rest) {
  const { positionals, flags } = parseArgs(rest);
  const prompt = positionals[0];
  if (!prompt) die('usage: cowork-pilot chat "<prompt>" [--marker REGEX] [--timeout MS]');
  const opts = {};
  if (flags.marker) opts.marker = String(flags.marker); // string travels over JSON; chat() rebuilds RegExp
  if (flags.timeout) opts.timeoutMs = Number(flags.timeout);
  out(await rpc('chat', [prompt, opts]));
}

async function cmdShot(rest) {
  const { positionals, flags } = parseArgs(rest, new Set(['no-full', 'full']));
  const filePath = positionals[0];
  if (!filePath) die('usage: cowork-pilot shot <path> [--no-full]');
  const fullPage = !flags['no-full'];
  const result = await rpc('screenshot', [filePath, { fullPage }]);
  // strip base64 for display
  out({ path: result?.path, bytes: result?.bytes });
}

async function cmdEval(rest) {
  const { positionals } = parseArgs(rest);
  const js = positionals[0];
  if (!js) die('usage: cowork-pilot eval "<js>"');
  out(await rpc('evaluate', [js]));
}

async function cmdIpc(rest) {
  const { positionals } = parseArgs(rest);
  const type = positionals[0];
  if (!type) die("usage: cowork-pilot ipc <type> ['<json payload>']");
  let payload = {};
  if (positionals[1] !== undefined) {
    try {
      payload = JSON.parse(positionals[1]);
    } catch (e) {
      die(`invalid JSON payload: ${e.message}`);
    }
  }
  out(await rpc('ipc', [type, payload]));
}

async function cmdState() {
  out(await rpc('getState', []));
}

async function cmdClick(rest) {
  const { positionals } = parseArgs(rest);
  if (!positionals[0]) die('usage: cowork-pilot click <selector>');
  out({ ok: await rpc('click', [positionals[0]]) });
}

async function cmdFill(rest) {
  const { positionals } = parseArgs(rest);
  if (positionals.length < 2) die('usage: cowork-pilot fill <selector> <text>');
  out({ ok: await rpc('fill', [positionals[0], positionals[1]]) });
}

async function cmdPress(rest) {
  const { positionals } = parseArgs(rest);
  if (positionals.length < 2) die('usage: cowork-pilot press <selector> <key>');
  out({ ok: await rpc('press', [positionals[0], positionals[1]]) });
}

async function cmdConfig() {
  out(await rpc('getConfig', []));
}

async function cmdSetProvider(rest) {
  parseArgs(rest, new Set(['real'])); // --real accepted; the default profile is CHATGPT_PROFILE
  // Rely on configureProvider's default param so we never serialize a profile.
  out(await rpc('configureProvider', []));
}

async function cmdListBundles() {
  const bundles = await rpc('listTestBundles', []);
  out(bundles);
}

async function cmdRunBundle(rest) {
  const { positionals, flags } = parseArgs(rest);
  const id = positionals[0];
  if (!id) die('usage: cowork-pilot run-bundle <id> [--timeout MS]');
  const opts = {};
  if (flags.timeout) opts.timeoutMs = Number(flags.timeout);
  out(await rpc('runTestBundle', [id, opts]));
}

async function cmdStatus() {
  const info = readDaemonInfo();
  if (!info) {
    out({ running: false });
    return;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/health`);
    const health = await res.json();
    out({ running: true, daemon: info, health });
  } catch {
    out({ running: false, stale: true, daemon: info });
  }
}

async function cmdStop() {
  const info = readDaemonInfo();
  if (!info) {
    out({ ok: true, note: 'no daemon running' });
    return;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/shutdown`, { method: 'POST' });
    await res.json().catch(() => ({}));
  } catch {
    // daemon may already be dead; best-effort kill
    try {
      process.kill(info.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(DAEMON_FILE, { force: true });
  } catch {
    /* ignore */
  }
  out({ ok: true });
}

// ---------------------------------------------------------------------------
// one-shot mode (no daemon) — throwaway pilot for CI
// ---------------------------------------------------------------------------

async function cmdOnce(rest) {
  const action = rest[0];
  const args = rest.slice(1);
  if (!action) die('usage: cowork-pilot once <chat|shot|run-bundle> …');

  const { positionals, flags } = parseArgs(args, new Set(['real', 'no-full', 'full']));
  if (!process.env.DISPLAY) process.env.DISPLAY = ':10.0';

  const pilot = new CoworkPilot({ log: (l) => process.stderr.write(`${l}\n`) });
  try {
    await pilot.launch();
    if (flags.real) await pilot.configureProvider(CHATGPT_PROFILE);

    if (action === 'chat') {
      const prompt = positionals[0];
      if (!prompt) die('usage: cowork-pilot once chat "<prompt>" [--real] [--marker R] [--timeout MS]');
      const opts = {};
      if (flags.marker) opts.marker = String(flags.marker);
      if (flags.timeout) opts.timeoutMs = Number(flags.timeout);
      out(await pilot.chat(prompt, opts));
    } else if (action === 'shot') {
      const filePath = positionals[0];
      if (!filePath) die('usage: cowork-pilot once shot <path> [--no-full]');
      const r = await pilot.screenshot(filePath, { fullPage: !flags['no-full'] });
      out({ path: r.path, bytes: r.bytes });
    } else if (action === 'run-bundle') {
      const id = positionals[0];
      if (!id) die('usage: cowork-pilot once run-bundle <id> [--timeout MS]');
      const opts = {};
      if (flags.timeout) opts.timeoutMs = Number(flags.timeout);
      out(await pilot.runTestBundle(id, opts));
    } else {
      die(`unknown once action: ${action} (supported: chat, shot, run-bundle)`);
    }
  } catch (e) {
    process.stderr.write(`${e?.stack || e}\n`);
    process.exitCode = 1;
  } finally {
    await pilot.close();
  }
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

const HELP = `cowork-pilot — drive the Cowork Electron GUI from the CLI.

DAEMON (long-lived; owns one persistent Cowork instance):
  cowork-pilot daemon [--port N] [--real] [--user-data DIR] [--attach URL]
      Launch (or --attach to) Cowork and serve RPC on 127.0.0.1:<port> (default ${DEFAULT_PORT}).
      --real            configure the real ChatGPT (Codex) provider after launch
      --user-data DIR   persistent Electron profile dir
      --attach URL      attach over CDP (e.g. http://localhost:9222) instead of launching

CLIENT (require a running daemon):
  cowork-pilot chat "<prompt>" [--marker REGEX] [--timeout MS]   send a chat prompt
  cowork-pilot shot <path> [--no-full]                          screenshot to <path>
  cowork-pilot eval "<js>"                                      evaluate JS in renderer
  cowork-pilot ipc <type> ['<json payload>']                    one-shot IPC invoke
  cowork-pilot state                                            getState() snapshot
  cowork-pilot click <selector>                                 click an element
  cowork-pilot fill <selector> <text>                           fill an input
  cowork-pilot press <selector> <key>                           press a key on element
  cowork-pilot config                                           print getConfig()
  cowork-pilot set-provider [--real]                            configureProvider (ChatGPT)
  cowork-pilot list-bundles                                     list Test Runner bundles
  cowork-pilot run-bundle <id> [--timeout MS]                   run a Test Runner bundle
  cowork-pilot status                                           daemon health
  cowork-pilot stop                                             shut the daemon down

ONE-SHOT (no daemon; throwaway pilot — for CI):
  cowork-pilot once chat "<prompt>" [--real] [--marker R] [--timeout MS]
  cowork-pilot once shot <path> [--no-full]
  cowork-pilot once run-bundle <id> [--timeout MS]

Selectors accept prefixes: testid=  text=  role=Name  (or raw CSS).
Output is JSON for scriptability. Errors go to stderr with a non-zero exit.`;

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }

  switch (cmd) {
    case 'daemon':
      return cmdDaemon(rest);
    case 'chat':
      return cmdChat(rest);
    case 'shot':
      return cmdShot(rest);
    case 'eval':
      return cmdEval(rest);
    case 'ipc':
      return cmdIpc(rest);
    case 'state':
      return cmdState();
    case 'click':
      return cmdClick(rest);
    case 'fill':
      return cmdFill(rest);
    case 'press':
      return cmdPress(rest);
    case 'config':
      return cmdConfig();
    case 'set-provider':
      return cmdSetProvider(rest);
    case 'list-bundles':
      return cmdListBundles();
    case 'run-bundle':
      return cmdRunBundle(rest);
    case 'status':
      return cmdStatus();
    case 'stop':
      return cmdStop();
    case 'once':
      return cmdOnce(rest);
    default:
      die(`unknown command: ${cmd}\nRun \`cowork-pilot --help\` for usage.`);
  }
}

main().catch((e) => {
  process.stderr.write(`${e?.stack || e}\n`);
  process.exit(1);
});
