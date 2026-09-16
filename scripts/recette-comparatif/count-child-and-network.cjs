/**
 * Preload that counts child_process and network primitives called from Code Buddy
 * sources (a stack frame under /src/), and writes the counts to
 * $RECETTE_COUNT_FILE at exit. tsx's own loader processes are not attributed.
 * Load it through NODE_OPTIONS so the tsx child process inherits it.
 */
'use strict';

const fs = require('node:fs');
const counts = { childProcess: {}, network: {} };

function fromSources() {
  return (new Error().stack ?? '').split('\n').slice(3).some((line) => line.includes('/src/') && !line.includes('node_modules'));
}

function wrap(target, name, bucket) {
  const original = target[name];
  if (typeof original !== 'function') return;
  target[name] = function counted(...args) {
    if (fromSources()) bucket[name] = (bucket[name] ?? 0) + 1;
    return original.apply(this, args);
  };
}

const cp = require('node:child_process');
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) wrap(cp, name, counts.childProcess);
const net = require('node:net');
wrap(net, 'connect', counts.network);
wrap(net, 'createConnection', counts.network);
wrap(require('node:http'), 'request', counts.network);
wrap(require('node:https'), 'request', counts.network);
if (typeof globalThis.fetch === 'function') wrap(globalThis, 'fetch', counts.network);
require('node:module').syncBuiltinESMExports();

process.on('exit', () => {
  if (!process.env.RECETTE_COUNT_FILE) return;
  fs.appendFileSync(process.env.RECETTE_COUNT_FILE, `${JSON.stringify({ pid: process.pid, argv: process.argv.slice(1, 3), ...counts })}\n`);
});
