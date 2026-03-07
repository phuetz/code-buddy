import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.join(__dirname, 'data', 'incidents.json');
const tempDataFile = `${dataFile}.tmp`;

function cleanup() {
  try {
    fs.unlinkSync(dataFile);
  } catch {}
  try {
    fs.unlinkSync(tempDataFile);
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
      reject(new Error(`Server exited early: ${code}. Stderr: ${stderr}`));
    });
  });
}

function connectWs(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.__queue = [];
    ws.on('message', (raw) => {
      try {
        ws.__queue.push(JSON.parse(raw.toString()));
      } catch {}
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WS connect timeout for ${url}`));
    }, timeoutMs);

    ws.once('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function waitForWsEvent(ws, type, predicate = () => true, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const idx = ws.__queue.findIndex((evt) => evt.type === type && predicate(evt));
    if (idx >= 0) {
      const [evt] = ws.__queue.splice(idx, 1);
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
          const queueIdx = ws.__queue.findIndex(
            (queued) => queued.type === evt.type && JSON.stringify(queued) === JSON.stringify(evt),
          );
          if (queueIdx >= 0) ws.__queue.splice(queueIdx, 1);
          resolve(evt);
        }
      } catch {}
    }

    ws.on('message', onMessage);
  });
}

async function waitForJobDone(baseUrl, jobId, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = await res.json();
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Job ${jobId} did not complete in time`);
}

async function run() {
  cleanup();
  const child = spawn('node', ['src/server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
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
    await waitForWsEvent(ws1, 'job_snapshot');
    await waitForWsEvent(ws2, 'job_snapshot');

    const createEvt1 = waitForWsEvent(ws1, 'incident_created');
    const createEvt2 = waitForWsEvent(ws2, 'incident_created');
    const createRes = await fetch(`${baseUrl}/api/incidents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Prod outage', description: 'API latency spike' }),
    });
    assert.equal(createRes.status, 201);
    const createdIncident = await createRes.json();
    assert.equal(createdIncident.status, 'new');
    assert.equal((await createEvt1).incident.id, createdIncident.id);
    assert.equal((await createEvt2).incident.id, createdIncident.id);

    const updateEvt1 = waitForWsEvent(ws1, 'incident_updated');
    const updateEvt2 = waitForWsEvent(ws2, 'incident_updated');
    const updateRes = await fetch(`${baseUrl}/api/incidents/${createdIncident.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    assert.equal(updateRes.status, 200);
    const updatedIncident = await updateRes.json();
    assert.equal(updatedIncident.status, 'in_progress');
    assert.equal((await updateEvt1).incident.id, createdIncident.id);
    assert.equal((await updateEvt2).incident.id, createdIncident.id);

    const listRes = await fetch(`${baseUrl}/api/incidents`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, createdIncident.id);

    const jobCreated1 = waitForWsEvent(ws1, 'job_created');
    const jobCreated2 = waitForWsEvent(ws2, 'job_created');
    const jobPostRes = await fetch(`${baseUrl}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: 'Collect diagnostics' }),
    });
    assert.equal(jobPostRes.status, 202);
    const queuedJob = await jobPostRes.json();
    assert.ok(['queued', 'running'].includes(queuedJob.status));
    assert.equal((await jobCreated1).job.id, queuedJob.id);
    assert.equal((await jobCreated2).job.id, queuedJob.id);

    await waitForWsEvent(ws1, 'job_updated', (evt) => evt.job.id === queuedJob.id && evt.job.status === 'running');
    await waitForWsEvent(ws2, 'job_updated', (evt) => evt.job.id === queuedJob.id && evt.job.status === 'running');
    await waitForWsEvent(ws1, 'job_updated', (evt) => evt.job.id === queuedJob.id && evt.job.status === 'done');
    await waitForWsEvent(ws2, 'job_updated', (evt) => evt.job.id === queuedJob.id && evt.job.status === 'done');

    const doneJob = await waitForJobDone(baseUrl, queuedJob.id);
    assert.equal(doneJob.status, 'done');

    const deleteEvt1 = waitForWsEvent(ws1, 'incident_deleted');
    const deleteEvt2 = waitForWsEvent(ws2, 'incident_deleted');
    const deleteRes = await fetch(`${baseUrl}/api/incidents/${createdIncident.id}`, { method: 'DELETE' });
    assert.equal(deleteRes.status, 204);
    assert.equal((await deleteEvt1).id, createdIncident.id);
    assert.equal((await deleteEvt2).id, createdIncident.id);
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
