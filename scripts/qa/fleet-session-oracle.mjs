#!/usr/bin/env node
/**
 * F06/F07/F08 oracle: two real Buddy servers + deterministic fixture.
 * Label: real Buddy/RPC with deterministic provider fixture — NOT a live LLM.
 *
 * JWT files stay in --jwt-dir (private). Artifacts in --artifact must not
 * contain token strings.
 *
 *   node scripts/qa/fleet-session-oracle.mjs --entry dist/index.js --artifact DIR --jwt-dir DIR --work-root DIR
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    entry: { type: 'string' },
    node: { type: 'string', default: process.execPath },
    artifact: { type: 'string' },
    'jwt-dir': { type: 'string' },
    'work-root': { type: 'string' },
    'port-a': { type: 'string', default: '18781' },
    'port-b': { type: 'string', default: '18782' },
    'delay-ms': { type: 'string', default: '800' },
    'interrupt-delay-ms': { type: 'string', default: '2000' },
  },
});
if (!values.entry || !values.artifact || !values['jwt-dir']) {
  process.stderr.write('usage: fleet-session-oracle.mjs --entry dist/index.js --artifact DIR --jwt-dir DIR [--work-root DIR]\n');
  process.exit(2);
}

const entry = path.resolve(values.entry);
const artifact = path.resolve(values.artifact);
const jwtDir = path.resolve(values['jwt-dir']);
const workRoot = path.resolve(values['work-root'] || fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fleet-oracle-')));
const delayMs = Math.max(200, Number(values['delay-ms']) || 800);
const interruptDelayMs = Math.max(delayMs + 200, Number(values['interrupt-delay-ms']) || 2000);
fs.mkdirSync(artifact, { recursive: true });
fs.mkdirSync(jwtDir, { recursive: true, mode: 0o700 });
fs.chmodSync(jwtDir, 0o700);

const children = [];
function spawnLogged(command, args, env, logFile, extra = {}) {
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], ...extra });
  children.push(child);
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}
function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(child.pid, 'SIGTERM'); } catch { /* */ }
}

process.on('exit', () => {
  for (const child of children) stopChild(child);
});

function waitListen(child, logFile, needle, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
      if (text.includes(needle)) return resolve();
      if (child.exitCode !== null) return reject(new Error(`process exited ${child.exitCode} before ${needle}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for ${needle}`));
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function rpc(url, tokenFile, method, params, timeout = 20000) {
  const result = spawn(values.node, [
    path.join(here, 'peer-rpc.mjs'),
    '--url', url,
    '--token-file', tokenFile,
    '--method', method,
    '--params', JSON.stringify(params),
    '--timeout', String(timeout),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  result.stdout.on('data', (c) => { stdout += c; });
  result.stderr.on('data', (c) => { stderr += c; });
  const code = await new Promise((resolve) => result.on('close', resolve));
  let parsed;
  try { parsed = JSON.parse(stdout); } catch {
    parsed = [{ type: 'parse-error', stdout, stderr, code }];
  }
  return { code, parsed, stderr };
}

function responsePayload(frames) {
  const frame = (frames || []).find((item) => item.type === 'peer:response');
  return frame?.payload;
}

function assertNoJwt(dir) {
  const needle = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (needle.test(fs.readFileSync(full, 'utf8'))) {
        throw new Error(`JWT leaked into artifact ${full}`);
      }
    }
  };
  walk(dir);
}

const fixtureLog = path.join(workRoot, 'fixture.jsonl');
fs.writeFileSync(fixtureLog, '');
const fixture = spawn(values.node, [
  path.join(here, 'deterministic-llm-fixture.mjs'),
  '--port', '0',
  '--log', fixtureLog,
  '--delay-ms', String(delayMs),
], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(fixture);
const fixturePort = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('fixture port timeout')), 5000);
  fixture.stdout.on('data', (chunk) => {
    buf += chunk;
    const line = buf.trim();
    if (/^\d+$/.test(line)) {
      clearTimeout(timer);
      resolve(Number(line));
    }
  });
  fixture.stderr.on('data', (chunk) => {
    fs.appendFileSync(path.join(artifact, 'fixture.err'), chunk);
  });
});

const homeA = path.join(workRoot, 'home-a');
const homeB = path.join(workRoot, 'home-b');
const wsA = path.join(workRoot, 'ws-a');
const wsB = path.join(workRoot, 'ws-b');
for (const dir of [homeA, homeB, wsA, wsB]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(wsA, 'note.txt'), 'alpha-note-ok\n');
fs.writeFileSync(path.join(wsB, 'note.txt'), 'beta-note-ok\n');

const jwtA = crypto.randomBytes(32).toString('hex');
const jwtB = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(workRoot, 'jwt-a.secret'), jwtA, { mode: 0o600 });
fs.writeFileSync(path.join(workRoot, 'jwt-b.secret'), jwtB, { mode: 0o600 });

function serverEnv(home, secret, workspace) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    JWT_SECRET: secret,
    CODEBUDDY_DISABLE_MCP: 'true',
    CODEBUDDY_SENSORY: 'false',
    CODEBUDDY_TELEMETRY: 'false',
    CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT: workspace,
    CODEBUDDY_PEER_PROVIDER: 'grok',
    GROK_API_KEY: 'fixture',
    GROK_BASE_URL: `http://127.0.0.1:${fixturePort}/v1`,
    GROK_MODEL: 'fixture-model',
    LANG: 'C.UTF-8',
  };
}

function startServer(tag, home, secret, workspace, port) {
  const logFile = path.join(artifact, `server-${tag}.log`);
  const child = spawnLogged(values.node, [entry, 'server', '--host', '127.0.0.1', '--port', String(port)], serverEnv(home, secret, workspace), logFile, { cwd: workspace });
  return { child, logFile, pid: child.pid, port };
}

const portA = Number(values['port-a']);
const portB = Number(values['port-b']);
const serverA = startServer('a', homeA, jwtA, wsA, portA);
const serverB = startServer('b', homeB, jwtB, wsB, portB);
await waitListen(serverA.child, serverA.logFile, `API Server started on http://127.0.0.1:${portA}`);
await waitListen(serverB.child, serverB.logFile, `API Server started on http://127.0.0.1:${portB}`);

async function mint(home, secret, user, file) {
  const result = spawn(values.node, [entry, 'token', '--user', user, '--scopes', 'chat,sessions,tools,peer:invoke,peer:listen', '--json'], {
    env: { ...serverEnv(home, secret, home), JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  result.stdout.on('data', (c) => { stdout += c; });
  const code = await new Promise((resolve) => result.on('close', resolve));
  const start = stdout.indexOf('{');
  const json = JSON.parse(stdout.slice(start));
  if (code !== 0 || !json.token) throw new Error(`token mint failed for ${user}`);
  fs.writeFileSync(file, JSON.stringify(json), { mode: 0o600 });
}

const tokenA = path.join(jwtDir, 'token-a.json');
const tokenB = path.join(jwtDir, 'token-b.json');
await mint(homeA, jwtA, 'fleet-a', tokenA);
await mint(homeB, jwtB, 'fleet-b', tokenB);

const urlB = `ws://127.0.0.1:${portB}/ws`;
const report = {
  kind: 'real Buddy/RPC with deterministic provider fixture — NOT a live LLM',
  fixturePort,
  pids: { a: serverA.pid, b: serverB.pid },
  ports: { a: portA, b: portB },
};

const startA = await rpc(urlB, tokenB, 'peer.chat-session.start', { model: 'fixture-model', provider: 'grok' });
const startB = await rpc(urlB, tokenB, 'peer.chat-session.start', { model: 'fixture-model', provider: 'grok' });
const sessionA = responsePayload(startA.parsed)?.payload?.sessionId;
const sessionB = responsePayload(startB.parsed)?.payload?.sessionId;
if (!sessionA || !sessionB || sessionA === sessionB) throw new Error('expected two session ids');

// Distinct sessions: own markers only
const cA = await rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionA, prompt: 'MARKER_A_UNIQUE' });
const cB = await rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionB, prompt: 'MARKER_B_UNIQUE' });
const textA = responsePayload(cA.parsed)?.payload?.text || '';
const textB = responsePayload(cB.parsed)?.payload?.text || '';
report.isolation = {
  sessionA,
  sessionB,
  textA,
  textB,
  aHasOnlyA: textA.includes('MARKER_A_UNIQUE') && !textA.includes('MARKER_B_UNIQUE'),
  bHasOnlyB: textB.includes('MARKER_B_UNIQUE') && !textB.includes('MARKER_A_UNIQUE'),
};

// Same-session FIFO: first continue completes, second includes prior assistant in fixture history.
const startC = await rpc(urlB, tokenB, 'peer.chat-session.start', { model: 'fixture-model', provider: 'grok' });
const sessionC = responsePayload(startC.parsed)?.payload?.sessionId;
const first = await rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionC, prompt: 'FIFO_FIRST' });
const second = await rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionC, prompt: 'FIFO_SECOND' });
const firstText = responsePayload(first.parsed)?.payload?.text || '';
const secondText = responsePayload(second.parsed)?.payload?.text || '';
report.fifoSequential = {
  sessionC,
  firstText,
  secondText,
  secondSawFirstUser: secondText.includes('FIFO_FIRST'),
  secondSawFirstAssistant: /seq=/.test(secondText) && secondText.includes('FIFO_FIRST'),
  secondHasSecond: secondText.includes('FIFO_SECOND'),
};

// Concurrent continues on session D: fire both without awaiting the first.
const startD = await rpc(urlB, tokenB, 'peer.chat-session.start', { model: 'fixture-model', provider: 'grok' });
const sessionD = responsePayload(startD.parsed)?.payload?.sessionId;
const concurrent = await Promise.all([
  rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionD, prompt: 'CONCUR_ONE' }, 25000),
  rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionD, prompt: 'CONCUR_TWO' }, 25000),
]);
const concurrentTexts = concurrent.map((item) => responsePayload(item.parsed)?.payload?.text || '');
const later = concurrentTexts.find((text) => text.includes('CONCUR_TWO')) || '';
report.fifoConcurrent = {
  sessionD,
  texts: concurrentTexts,
  bothOk: concurrent.every((item) => responsePayload(item.parsed)?.ok === true),
  laterSawEarlierUser: later.includes('CONCUR_ONE'),
};

const listed = await rpc(urlB, tokenB, 'peer.chat-session.list', {});
const listPayload = responsePayload(listed.parsed)?.payload;
const listJson = JSON.stringify(listPayload || {});
report.list = {
  count: listPayload?.count,
  hasPromptLeak: /MARKER_|FIFO_|CONCUR_|alpha-unique|session-one/.test(listJson),
  sessions: listPayload?.sessions,
};

// F08: delayed in-flight, kill server B, client must not succeed, restart, retry
const delayFixture = spawn(values.node, [
  path.join(here, 'deterministic-llm-fixture.mjs'),
  '--port', '0',
  '--log', path.join(workRoot, 'fixture-delay.jsonl'),
  '--delay-ms', String(interruptDelayMs),
], { stdio: ['ignore', 'pipe', 'pipe'] });
children.push(delayFixture);
const delayPort = await new Promise((resolve, reject) => {
  let buf = '';
  const timer = setTimeout(() => reject(new Error('delay fixture port timeout')), 5000);
  delayFixture.stdout.on('data', (chunk) => {
    buf += chunk;
    const line = buf.trim();
    if (/^\d+$/.test(line)) {
      clearTimeout(timer);
      resolve(Number(line));
    }
  });
});
// Restart B against delayed fixture for interrupt test (same home/jwt/workspace)
stopChild(serverB.child);
await new Promise((r) => setTimeout(r, 400));
const envDelay = serverEnv(homeB, jwtB, wsB);
envDelay.GROK_BASE_URL = `http://127.0.0.1:${delayPort}/v1`;
const serverB2log = path.join(artifact, 'server-b-delay.log');
const serverB2 = spawnLogged(values.node, [entry, 'server', '--host', '127.0.0.1', '--port', String(portB)], envDelay, serverB2log, { cwd: wsB });
await waitListen(serverB2, serverB2log, `API Server started on http://127.0.0.1:${portB}`);
const startE = await rpc(urlB, tokenB, 'peer.chat-session.start', { model: 'fixture-model', provider: 'grok' });
const sessionE = responsePayload(startE.parsed)?.payload?.sessionId;
const inflight = rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionE, prompt: 'INTERRUPT_PENDING' }, interruptDelayMs + 8000);
await new Promise((r) => setTimeout(r, 300));
const killedPid = serverB2.pid;
stopChild(serverB2);
const inflightResult = await inflight;
const inflightOk = responsePayload(inflightResult.parsed)?.ok === true;
report.interrupt = {
  killedPid,
  clientClaimedSuccess: inflightOk,
  frames: inflightResult.parsed.map((f) => f.type),
  error: responsePayload(inflightResult.parsed)?.error || inflightResult.parsed.find((f) => f.type === 'ws-error' || f.type === 'timeout'),
};

const serverB3log = path.join(artifact, 'server-b-restart.log');
const serverB3 = spawnLogged(values.node, [entry, 'server', '--host', '127.0.0.1', '--port', String(portB)], envDelay, serverB3log, { cwd: wsB });
await waitListen(serverB3, serverB3log, `API Server started on http://127.0.0.1:${portB}`);
const retry = await rpc(urlB, tokenB, 'peer.chat-session.continue', { sessionId: sessionE, prompt: 'INTERRUPT_PENDING' }, interruptDelayMs + 8000);
report.retry = {
  ok: responsePayload(retry.parsed)?.ok === true,
  error: responsePayload(retry.parsed)?.error?.message,
  text: responsePayload(retry.parsed)?.payload?.text,
  note: 'Same prompt may be retried after restart; not exactly-once remote effects.',
};

const delayLog = fs.existsSync(path.join(workRoot, 'fixture-delay.jsonl'))
  ? fs.readFileSync(path.join(workRoot, 'fixture-delay.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : [];
report.fixtureDelayCalls = delayLog.map((row) => ({ event: row.event, seq: row.seq, users: row.userTexts }));
const starts = delayLog.filter((row) => row.event === 'start' && (row.userTexts || []).includes('INTERRUPT_PENDING'));
const finishes = delayLog.filter((row) => row.event === 'finish' && starts.some((s) => s.seq === row.seq));
report.duplicateDetection = {
  interruptPromptStarts: starts.length,
  interruptPromptFinishes: finishes.length,
};

report.pass = Boolean(
  report.isolation.aHasOnlyA
  && report.isolation.bHasOnlyB
  && report.fifoSequential.secondHasSecond
  && report.fifoSequential.secondSawFirstUser
  && report.fifoConcurrent.bothOk
  && report.fifoConcurrent.laterSawEarlierUser
  && !report.list.hasPromptLeak
  && !report.interrupt.clientClaimedSuccess,
);

fs.writeFileSync(path.join(artifact, 'oracle.json'), JSON.stringify(report, null, 2));
assertNoJwt(artifact);

stopChild(serverA.child);
stopChild(serverB3);
stopChild(fixture);
stopChild(delayFixture);
await new Promise((r) => setTimeout(r, 300));
process.stdout.write(`${JSON.stringify({ pass: report.pass, artifact: path.join(artifact, 'oracle.json') }, null, 2)}\n`);
process.exit(report.pass ? 0 : 1);
