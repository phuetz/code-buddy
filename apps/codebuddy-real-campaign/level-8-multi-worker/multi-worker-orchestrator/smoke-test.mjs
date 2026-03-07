import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jobsFile = path.join(__dirname, 'jobs.json');
const jobsTmp = `${jobsFile}.tmp`;

function cleanup() {
  try {
    fs.unlinkSync(jobsFile);
  } catch {}
  try {
    fs.unlinkSync(jobsTmp);
  } catch {}
}

function waitForPort(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), timeoutMs);
    child.stdout.on('data', (buf) => {
      const match = buf.toString().match(/Server listening on port (\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server exited early: ${code}`));
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

function waitEvent(ws, eventName, predicate = () => true, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const idx = ws.__events.findIndex((e) => e.event === eventName && predicate(e));
    if (idx >= 0) return resolve(ws.__events.splice(idx, 1)[0]);
    const timeout = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error(`timeout waiting event ${eventName}`));
    }, timeoutMs);
    function onMsg(raw) {
      try {
        const evt = JSON.parse(raw.toString());
        if (evt.event === eventName && predicate(evt)) {
          clearTimeout(timeout);
          ws.off('message', onMsg);
          resolve(evt);
        }
      } catch {}
    }
    ws.on('message', onMsg);
  });
}

async function waitFinal(baseUrl, id) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const res = await fetch(`${baseUrl}/api/jobs/${id}`);
    assert.equal(res.status, 200);
    const job = await res.json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`job ${id} timeout`);
}

async function run() {
  cleanup();
  const child = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0' },
  });
  let ws;
  try {
    const port = await waitForPort(child);
    const baseUrl = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    ws = await connectWs(wsUrl);
    await waitEvent(ws, 'initial_jobs');

    const createA = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'workerA', payload: { item: 'img' } }),
    });
    assert.equal(createA.status, 201);
    const jobA = await createA.json();

    const createB = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'workerB', payload: { item: 'data' } }),
    });
    assert.equal(createB.status, 201);
    const jobB = await createB.json();

    await waitEvent(ws, 'job_queued', (e) => e.job.id === jobA.id);
    await waitEvent(ws, 'job_queued', (e) => e.job.id === jobB.id);
    await waitEvent(ws, 'job_running', (e) => e.job.id === jobA.id || e.job.id === jobB.id);
    await waitEvent(ws, 'job_retry', (e) => e.job.id === jobA.id);
    await waitEvent(ws, 'job_done', (e) => e.job.id === jobA.id);
    await waitEvent(ws, 'job_done', (e) => e.job.id === jobB.id);

    const finalA = await waitFinal(baseUrl, jobA.id);
    const finalB = await waitFinal(baseUrl, jobB.id);
    assert.equal(finalA.status, 'done');
    assert.equal(finalB.status, 'done');
    assert.equal(finalA.retries, 1);
    assert.equal(finalB.retries, 0);
  } finally {
    ws?.close();
    child.kill();
    cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
