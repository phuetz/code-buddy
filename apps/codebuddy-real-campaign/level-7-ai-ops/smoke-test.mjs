import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFile = path.join(__dirname, 'db.json');
const dbTmp = `${dbFile}.tmp`;

function cleanup() {
  try {
    fs.unlinkSync(dbFile);
  } catch {}
  try {
    fs.unlinkSync(dbTmp);
  } catch {}
}

function waitForPort(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Server startup timeout. Stderr: ${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (buf) => {
      const text = buf.toString();
      const match = text.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString();
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited too early (${code}). Stderr: ${stderr}`));
    });
  });
}

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.__events = [];
    ws.on('message', (raw) => {
      try {
        ws.__events.push(JSON.parse(raw.toString()));
      } catch {}
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitWs(ws, type, predicate = () => true, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const index = ws.__events.findIndex((evt) => evt.type === type && predicate(evt));
    if (index >= 0) {
      const [evt] = ws.__events.splice(index, 1);
      resolve(evt);
      return;
    }
    const timeout = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timeout waiting WS event ${type}`));
    }, timeoutMs);

    function onMessage(raw) {
      try {
        const evt = JSON.parse(raw.toString());
        if (evt.type === type && predicate(evt)) {
          clearTimeout(timeout);
          ws.off('message', onMessage);
          resolve(evt);
        }
      } catch {}
    }
    ws.on('message', onMessage);
  });
}

async function waitJobDone(baseUrl, id, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/jobs/${id}`);
    assert.equal(res.status, 200);
    const job = await res.json();
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Job timeout');
}

async function run() {
  cleanup();
  const child = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0' },
  });

  let ws1;
  let ws2;
  try {
    const port = await waitForPort(child);
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    assert.deepEqual(await healthRes.json(), { status: 'ok' });

    ws1 = await connectWs(wsUrl);
    ws2 = await connectWs(wsUrl);
    await waitWs(ws1, 'init');
    await waitWs(ws2, 'init');

    const created1 = waitWs(ws1, 'incidentCreated');
    const created2 = waitWs(ws2, 'incidentCreated');
    const createRes = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'DB outage', description: 'P95 latency exploded' }),
    });
    assert.equal(createRes.status, 201);
    const incident = await createRes.json();
    assert.equal((await created1).incident.id, incident.id);
    assert.equal((await created2).incident.id, incident.id);

    const updated1 = waitWs(ws1, 'incidentUpdated');
    const updated2 = waitWs(ws2, 'incidentUpdated');
    const updateRes = await fetch(`${baseUrl}/api/incidents/${incident.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    assert.equal(updateRes.status, 200);
    assert.equal((await updated1).incident.id, incident.id);
    assert.equal((await updated2).incident.id, incident.id);

    const jobCreated1 = waitWs(ws1, 'jobCreated');
    const jobCreated2 = waitWs(ws2, 'jobCreated');
    const jobPost = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'Collect trace bundle' }),
    });
    assert.equal(jobPost.status, 202);
    const job = await jobPost.json();
    assert.equal((await jobCreated1).job.id, job.id);
    assert.equal((await jobCreated2).job.id, job.id);

    await waitWs(ws1, 'jobUpdated', (evt) => evt.job.id === job.id && evt.job.status === 'running');
    await waitWs(ws2, 'jobUpdated', (evt) => evt.job.id === job.id && evt.job.status === 'running');
    await waitWs(ws1, 'jobUpdated', (evt) => evt.job.id === job.id && evt.job.status === 'completed');
    await waitWs(ws2, 'jobUpdated', (evt) => evt.job.id === job.id && evt.job.status === 'completed');
    const doneJob = await waitJobDone(baseUrl, job.id);
    assert.equal(doneJob.status, 'completed');

    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const sumRes = await fetch(`${baseUrl}/api/assist/summarize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `${incident.title}\n${incident.description}\nstatus=${incident.status}`,
      }),
    });
    if (key) {
      assert.equal(sumRes.status, 200);
      const sum = await sumRes.json();
      assert.equal(typeof sum.summary, 'string');
      assert.ok(sum.summary.length > 0);
    } else {
      assert.equal(sumRes.status, 503);
    }

    const deleted1 = waitWs(ws1, 'incidentDeleted');
    const deleted2 = waitWs(ws2, 'incidentDeleted');
    const delRes = await fetch(`${baseUrl}/api/incidents/${incident.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 204);
    assert.equal((await deleted1).id, incident.id);
    assert.equal((await deleted2).id, incident.id);
  } finally {
    ws1?.close();
    ws2?.close();
    child.kill();
    cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
