#!/usr/bin/env node
/** Harness check: fixture records synthetic history and strips Authorization. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));

test('fixture reply includes prior users/assistants and omits Authorization', async () => {
  const child = spawn(process.execPath, [path.join(here, 'deterministic-llm-fixture.mjs'), '--port', '0', '--delay-ms', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('port timeout')), 5000);
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const line = buf.trim();
      if (/^\d+$/.test(line)) {
        clearTimeout(timer);
        resolve(Number(line));
      }
    });
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-should-not-log' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: 'U1' },
          { role: 'assistant', content: 'A1' },
          { role: 'user', content: 'U2' },
        ],
      }),
    });
    const body = await res.json();
    const text = body.choices[0].message.content;
    assert.match(text, /users=U1\|\|U2/);
    assert.match(text, /assistants=A1/);
    const log = await fetch(`http://127.0.0.1:${port}/__qa/log`).then((r) => r.json());
    const dumped = JSON.stringify(log);
    assert.equal(dumped.includes('secret-should-not-log'), false);
    assert.equal(dumped.includes('Bearer'), false);
    assert.equal(log.records[0].userTexts.join(','), 'U1,U2');
  } finally {
    child.kill('SIGTERM');
  }
});
