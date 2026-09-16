#!/usr/bin/env node
/**
 * Run a command inside a throwaway Code Buddy profile with external network blocked.
 *
 *   node scripts/recette-comparatif/run-isolated.mjs <label> -- <command> [args...]
 *
 * - HOME, XDG_* and CODEBUDDY_* state dirs point under $RECETTE_QA_ROOT/<label>/home
 *   (default root /tmp/cb-comparatif-20260915/qa). The directory is created fresh
 *   unless RECETTE_KEEP_HOME=1.
 * - Provider credentials inherited from the caller are removed so nothing can use
 *   a real account; tests that need a model use local fixtures.
 * - NODE_OPTIONS preloads no-external-network.cjs (loopback only), inherited by children.
 * - stdout/stderr are streamed and also written to <label>/run.log.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [label, sep, command, ...args] = process.argv.slice(2);
if (!label || sep !== '--' || !command) {
  console.error('usage: run-isolated.mjs <label> -- <command> [args...]');
  process.exit(2);
}
if (!/^[a-zA-Z0-9._-]+$/.test(label)) {
  console.error('label must be [a-zA-Z0-9._-]+');
  process.exit(2);
}

const root = process.env.RECETTE_QA_ROOT || '/tmp/cb-comparatif-20260915/qa';
const base = path.join(root, label);
const home = path.join(base, 'home');
if (process.env.RECETTE_KEEP_HOME !== '1') fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(home, { recursive: true, mode: 0o700 });

const SECRET_ENV = /(API_KEY|TOKEN|SECRET|PASSWORD|OAUTH|_KEY$)/i;
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (SECRET_ENV.test(key)) continue;
  env[key] = value;
}
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_DATA_HOME: path.join(home, '.local', 'share'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  CODEBUDDY_SESSIONS_DIR: path.join(home, '.codebuddy', 'sessions'),
  CODEBUDDY_TELEMETRY: 'off',
  RECETTE_QA_BASE: base,
  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${path.join(here, 'no-external-network.cjs')}`.trim(),
});

const log = fs.createWriteStream(path.join(base, 'run.log'));
const child = spawn(command, args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
child.stdout.on('data', (chunk) => { process.stdout.write(chunk); log.write(chunk); });
child.stderr.on('data', (chunk) => { process.stderr.write(chunk); log.write(chunk); });
child.on('close', (code, signal) => {
  log.end(`\n[run-isolated] exit=${code} signal=${signal ?? ''}\n`);
  process.exit(code ?? 1);
});
