import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataFile = path.join(__dirname, 'items.json');
const tempDataFile = `${dataFile}.tmp`;

function cleanup() {
  try {
    fs.unlinkSync(dataFile);
  } catch {}
  try {
    fs.unlinkSync(tempDataFile);
  } catch {}
}

function waitForServerPort(child, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Server startup timeout. Stderr: ${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (buf) => {
      const text = buf.toString();
      const match = text.match(/Server listening on http:\/\/127\.0\.0\.1:(\d+)/);
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
      reject(new Error(`Server exited before startup with code ${code}. Stderr: ${stderr}`));
    });
  });
}

function connectWebSocket(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws._messageQueue = [];
    ws.on('message', (raw) => {
      try {
        ws._messageQueue.push(JSON.parse(raw.toString()));
      } catch {}
    });
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connect timeout for ${url}`));
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

function waitForMessageType(ws, expectedType, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const queued = ws._messageQueue.findIndex((msg) => msg.type === expectedType);
    if (queued >= 0) {
      const [msg] = ws._messageQueue.splice(queued, 1);
      resolve(msg.payload);
      return;
    }

    const timeout = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timeout waiting for WS message type ${expectedType}`));
    }, timeoutMs);

    function onMessage(raw) {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === expectedType) {
          clearTimeout(timeout);
          ws.off('message', onMessage);
          const idx = ws._messageQueue.findIndex(
            (queuedMsg) =>
              queuedMsg.type === expectedType && JSON.stringify(queuedMsg.payload) === JSON.stringify(msg.payload),
          );
          if (idx >= 0) ws._messageQueue.splice(idx, 1);
          resolve(msg.payload);
        }
      } catch {}
    }

    ws.on('message', onMessage);
  });
}

async function run() {
  cleanup();
  const child = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ws1;
  let ws2;
  try {
    const port = await waitForServerPort(child);
    const base = `http://127.0.0.1:${port}`;
    const wsUrl = `ws://127.0.0.1:${port}`;

    const healthRes = await fetch(`${base}/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.deepEqual(health, { status: 'ok' });

    ws1 = await connectWebSocket(wsUrl);
    ws2 = await connectWebSocket(wsUrl);
    await waitForMessageType(ws1, 'snapshot');
    await waitForMessageType(ws2, 'snapshot');

    const createP1 = waitForMessageType(ws1, 'item.created');
    const createP2 = waitForMessageType(ws2, 'item.created');
    const createRes = await fetch(`${base}/api/items`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'First item', done: false }),
    });
    assert.equal(createRes.status, 201);
    const created = await createRes.json();
    assert.equal(created.title, 'First item');
    assert.equal(created.done, false);
    assert.equal((await createP1).id, created.id);
    assert.equal((await createP2).id, created.id);

    const listRes = await fetch(`${base}/api/items`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);

    const updateP1 = waitForMessageType(ws1, 'item.updated');
    const updateP2 = waitForMessageType(ws2, 'item.updated');
    const updateRes = await fetch(`${base}/api/items/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated item', done: true }),
    });
    assert.equal(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.equal(updated.title, 'Updated item');
    assert.equal(updated.done, true);
    assert.equal((await updateP1).id, created.id);
    assert.equal((await updateP2).id, created.id);

    const deleteP1 = waitForMessageType(ws1, 'item.deleted');
    const deleteP2 = waitForMessageType(ws2, 'item.deleted');
    const deleteRes = await fetch(`${base}/api/items/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteRes.status, 204);
    assert.equal((await deleteP1).id, created.id);
    assert.equal((await deleteP2).id, created.id);

    const finalListRes = await fetch(`${base}/api/items`);
    assert.equal(finalListRes.status, 200);
    const finalList = await finalListRes.json();
    assert.equal(finalList.length, 0);
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
