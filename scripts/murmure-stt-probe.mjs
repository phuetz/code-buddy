#!/usr/bin/env node
/**
 * murmure-stt-probe.mjs — test de l'option 1 : consommer le flux STT temps réel
 * de l'app Murmure (al1x-ai, Tauri/Rust) via son API locale (api_enabled, port 4800).
 *
 * Ce que fait le script :
 *   1. vérifie que l'API écoute (sinon : dis-toi de lancer Murmure / d'activer l'API) ;
 *   2. DÉCOUVRE le contrat : GET sur des routes HTTP probables (/, /health, /api, ...)
 *      pour voir ce que Murmure publie ;
 *   3. tente une connexion WebSocket sur plusieurs chemins candidats et imprime les
 *      messages reçus (partiels vs final mis en évidence) ;
 *   4. à défaut de WS, tente un flux SSE (text/event-stream).
 *
 * Lance-le depuis la racine du repo pour que `ws` se résolve :
 *     node scripts/murmure-stt-probe.mjs
 *     MURMURE_PORT=4800 node scripts/murmure-stt-probe.mjs   # override port
 *
 * But : apprendre la forme exacte de l'API. Demain on écrit le vrai pont
 * (Murmure → getGlobalEventBus() comme percept `hearing`) une fois le contrat connu.
 * Best-effort, ne plante jamais.
 */

import process from 'node:process';

const HOST = process.env.MURMURE_HOST || '127.0.0.1';
const PORT = Number(process.env.MURMURE_PORT || 4800);
const BASE = `http://${HOST}:${PORT}`;
const WS_BASE = `ws://${HOST}:${PORT}`;

// Routes HTTP qu'une app de dictation expose typiquement (auto-doc / health / status).
const HTTP_ROUTES = ['/', '/health', '/healthz', '/status', '/api', '/api/status', '/info', '/version', '/docs'];
// Chemins WebSocket candidats pour le flux de transcripts en continu.
const WS_PATHS = ['/', '/ws', '/api/ws', '/stream', '/api/stream', '/transcripts', '/transcribe', '/events', '/live'];
// Chemins SSE candidats (fallback si pas de WS).
const SSE_PATHS = ['/stream', '/events', '/api/stream', '/sse', '/transcripts'];
// Route(s) découverte(s) via `strings` du binaire → testées EN PREMIER.
//   ex:  MURMURE_PATHS=/api/v1/ws,/listen node scripts/murmure-stt-probe.mjs
const EXTRA = (process.env.MURMURE_PATHS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (EXTRA.length) { WS_PATHS.unshift(...EXTRA); SSE_PATHS.unshift(...EXTRA); HTTP_ROUTES.unshift(...EXTRA); }

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function log(...a) {
  console.log(...a);
}

/** TCP/HTTP reachability check — true UNIQUEMENT si on obtient une vraie réponse HTTP. */
async function apiReachable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(BASE + '/', { signal: ctrl.signal });
    clearTimeout(t);
    return !!res; // réponse HTTP (même 404) → quelque chose écoute vraiment
  } catch (e) {
    const code = e?.cause?.code || e?.code || '';
    if (code === 'ECONNREFUSED') return false; // personne n'écoute
    return false; // timeout/abort/autre → non confirmé, on traite comme "pas joignable"
  }
}

/** Probe HTTP routes to discover the API surface. */
async function discoverHttp() {
  log(c.bold(`\n[1] Découverte HTTP sur ${BASE}`));
  let anything = false;
  for (const route of HTTP_ROUTES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(BASE + route, { signal: ctrl.signal, headers: { accept: 'application/json,text/plain,*/*' } });
      clearTimeout(t);
      const ct = res.headers.get('content-type') || '';
      let body = '';
      try { body = (await res.text()).slice(0, 240).replace(/\s+/g, ' ').trim(); } catch {}
      const tag = res.ok ? c.green(`${res.status}`) : c.yellow(`${res.status}`);
      log(`  ${tag}  GET ${route}  ${c.dim(ct)}  ${body ? c.dim('› ' + body) : ''}`);
      if (res.status !== 404) anything = true;
    } catch (e) {
      // connection refused on a route is unusual once the server is up; ignore per-route errors
    }
  }
  if (!anything) log(c.dim('  (toutes 404 — l\'API tourne mais aucune route connue ne répond ; le flux est sûrement en WS/SSE)'));
}

/** Try to load the `ws` package (present in the repo deps). */
async function loadWs() {
  try {
    const mod = await import('ws');
    return mod.default || mod.WebSocket || mod;
  } catch (e) {
    log(c.yellow(`\n[ws] paquet "ws" introuvable (${e.message}). Lance le script depuis la racine du repo code-buddy.`));
    return null;
  }
}

/** Pretty-print a transcript-ish payload, highlighting partial vs final. */
function printTranscript(src, raw) {
  let obj = null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (s.startsWith('{') || s.startsWith('[')) { try { obj = JSON.parse(s); } catch {} }
    if (!obj) { log(`  ${c.cyan(src)} ${c.dim('text')} ${s.slice(0, 300)}`); return; }
  } else {
    obj = raw;
  }
  // Heuristique : repère un champ texte + un flag partial/final.
  const text = obj.text ?? obj.transcript ?? obj.partial ?? obj.result ?? obj.content ?? '';
  const isFinal = obj.final === true || obj.is_final === true || obj.type === 'final' || obj.event === 'final';
  const isPartial = obj.partial != null || obj.type === 'partial' || obj.event === 'partial' || obj.is_final === false;
  const kind = isFinal ? c.green('FINAL  ') : isPartial ? c.yellow('partial') : c.dim('msg    ');
  if (text) log(`  ${c.cyan(src)} ${kind} ${c.bold(String(text))}`);
  else log(`  ${c.cyan(src)} ${c.dim(JSON.stringify(obj).slice(0, 300))}`);
}

/** Try each WS path; resolve with the first that connects and stay listening. */
async function tryWebSocket(WebSocketCtor) {
  log(c.bold(`\n[2] WebSocket sur ${WS_BASE}  (chemins: ${WS_PATHS.join(' ')})`));
  let connected = false;
  for (const path of WS_PATHS) {
    const url = WS_BASE + (path === '/' ? '/' : path);
    const ok = await new Promise((resolve) => {
      let settled = false;
      let ws;
      try { ws = new WebSocketCtor(url); } catch { resolve(false); return; }
      const giveUp = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(false); } }, 1500);
      ws.on('open', () => {
        clearTimeout(giveUp);
        settled = true; connected = true;
        log(c.green(`  ✓ connecté → ${url}`));
        log(c.dim('  → parle dans Murmure (push-to-talk: ctrl+space). Ctrl-C pour quitter.\n'));
        // certaines API attendent un message d'abonnement — on en envoie quelques-uns inoffensifs
        for (const sub of ['{"type":"subscribe"}', '{"action":"start"}', 'start']) {
          try { ws.send(sub); } catch {}
        }
        resolve(true); // garde la socket ouverte
      });
      ws.on('message', (data) => printTranscript(`ws${path}`, data.toString()));
      ws.on('error', () => { if (!settled) { settled = true; clearTimeout(giveUp); resolve(false); } });
      ws.on('close', () => { if (!settled) { settled = true; clearTimeout(giveUp); resolve(false); } });
    });
    if (ok) return true; // on reste sur la première qui marche
  }
  if (!connected) log(c.dim('  aucun chemin WS n\'a accepté la connexion.'));
  return connected;
}

/** SSE fallback: stream text/event-stream from candidate paths. */
async function trySse() {
  log(c.bold(`\n[3] SSE (fallback) sur ${BASE}`));
  for (const path of SSE_PATHS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(BASE + path, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('event-stream') || !res.body) { clearTimeout(t); continue; }
      clearTimeout(t);
      log(c.green(`  ✓ flux SSE → ${BASE + path}  (${ct})`));
      log(c.dim('  → parle dans Murmure. Ctrl-C pour quitter.\n'));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      // boucle de lecture indéfinie
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line.startsWith('data:')) printTranscript(`sse${path}`, line.slice(5).trim());
        }
      }
      return true;
    } catch {
      // try next path
    }
  }
  log(c.dim('  aucun flux SSE trouvé.'));
  return false;
}

async function main() {
  log(c.bold(`Murmure STT probe → ${BASE}`));

  if (!(await apiReachable())) {
    log(c.red(`\n✗ Rien n'écoute sur ${HOST}:${PORT}.`));
    log(`  → Lance Murmure (l'API a été activée: api_enabled=true, port ${PORT}).`);
    log(`  → Vérifie:  ${c.dim(`ss -ltnp | grep :${PORT}`)}`);
    log(`  → Logs:     ${c.dim('tail -f ~/.local/share/com.al1x-ai.murmure/logs/murmure.log')}`);
    process.exit(1);
  }
  log(c.green(`✓ quelque chose écoute sur ${HOST}:${PORT}`));

  await discoverHttp();

  const WebSocketCtor = await loadWs();
  if (WebSocketCtor) {
    const wsOk = await tryWebSocket(WebSocketCtor);
    if (wsOk) return; // on reste connecté à écouter les transcripts
  }

  const sseOk = await trySse();
  if (sseOk) return;

  log(c.yellow('\nNi WS ni SSE détecté automatiquement.'));
  log('Regarde la sortie HTTP ci-dessus pour la route réelle, ou les logs Murmure :');
  log(c.dim('  grep -iE "api|listen|route|ws|http|stream|4800" ~/.local/share/com.al1x-ai.murmure/logs/murmure.log | tail -30'));
  log('Donne-moi cette route demain et j\'écris le pont Code Buddy direct.');
}

process.on('SIGINT', () => { log(c.dim('\n— arrêt —')); process.exit(0); });
main().catch((e) => { log(c.red(`erreur: ${e?.message || e}`)); process.exit(1); });
