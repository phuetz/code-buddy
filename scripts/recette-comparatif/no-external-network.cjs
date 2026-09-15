/**
 * Preload that refuses every outbound TCP/TLS connection except loopback.
 *
 * Used by the comparatif recette (P1–P8) so that tests and real CLI runs in a
 * throwaway profile can never reach a cloud provider by accident. Loaded via
 * `node --require`, it also propagates to child processes through NODE_OPTIONS.
 */
'use strict';

const net = require('node:net');
const tls = require('node:tls');

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

function hostOf(args) {
  const first = args[0];
  if (first && typeof first === 'object') {
    if (first.path) return 'unix';
    return first.host ?? first.hostname ?? 'localhost';
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) return 'unix';
  return typeof args[1] === 'string' ? args[1] : 'localhost';
}

function guard(original, label) {
  return function guarded(...args) {
    const host = hostOf(args);
    if (host !== 'unix' && !LOOPBACK.has(String(host).replace(/^\[|\]$/g, ''))) {
      const error = new Error(`[recette-comparatif] external network blocked (${label} → ${host})`);
      error.code = 'ERECETTE_NETWORK_BLOCKED';
      process.emitWarning(error.message);
      throw error;
    }
    return original.apply(this, args);
  };
}

net.connect = guard(net.connect, 'net.connect');
net.createConnection = guard(net.createConnection, 'net.createConnection');
tls.connect = guard(tls.connect, 'tls.connect');

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function guardedFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : input?.url ?? String(input));
    if (!LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ''))) {
      const message = `[recette-comparatif] external fetch blocked (${url.hostname})`;
      process.emitWarning(message);
      throw new Error(message);
    }
    return originalFetch(input, init);
  };
}
