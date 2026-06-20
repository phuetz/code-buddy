import { describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import { startSensoryBridge } from '../../src/sensory/sensory-bridge.js';
import { wireSensoryReactions, type Perception } from '../../src/sensory/reactions.js';

async function open(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  return ws;
}

describe('sensory bridge → event bus → reaction', () => {
  it('a daemon frame reaches the bus and fires the reaction', async () => {
    const bridge = startSensoryBridge({ port: 18231 });
    const received: Perception[] = [];
    const unwire = wireSensoryReactions((p) => received.push(p));
    try {
      const ws = await open(18231);
      ws.send(JSON.stringify({ modality: 'audio', kind: 'speech_start', ts_ms: 42, salience: 200, payload: { rms: 0.4 } }));
      await new Promise<void>((resolve) => {
        const t = setInterval(() => {
          if (received.length) {
            clearInterval(t);
            resolve();
          }
        }, 10);
      });
      ws.close();
      expect(received).toHaveLength(1);
      expect(received[0]!.modality).toBe('audio');
      expect(received[0]!.kind).toBe('speech_start');
      expect(received[0]!.salience).toBe(200);
    } finally {
      unwire();
      await bridge.close();
    }
  });

  it('ignores malformed, token-mismatched, and modality-less frames', async () => {
    const bridge = startSensoryBridge({ port: 18232, token: 'secret' });
    const received: Perception[] = [];
    const unwire = wireSensoryReactions((p) => received.push(p));
    try {
      const ws = await open(18232);
      ws.send('not json');
      ws.send(JSON.stringify({ modality: 'audio', kind: 'x', token: 'wrong' }));
      ws.send(JSON.stringify({ kind: 'no-modality' }));
      await new Promise((r) => setTimeout(r, 120));
      ws.close();
      expect(received).toHaveLength(0);
    } finally {
      unwire();
      await bridge.close();
    }
  });

  it('rejects cross-origin connections (CSWSH defence)', async () => {
    const bridge = startSensoryBridge({ port: 18233 });
    const received: Perception[] = [];
    const unwire = wireSensoryReactions((p) => received.push(p));
    try {
      const ws = new WebSocket('ws://127.0.0.1:18233', { headers: { Origin: 'http://evil.example' } });
      await new Promise<void>((resolve) => {
        ws.on('open', () => resolve());
        ws.on('close', () => resolve());
        ws.on('error', () => resolve());
      });
      try {
        ws.send(JSON.stringify({ modality: 'audio', kind: 'speech_start', salience: 200 }));
      } catch {
        /* socket already closed by the server */
      }
      await new Promise((r) => setTimeout(r, 150));
      ws.close();
      expect(received).toHaveLength(0); // an Origin-bearing client is refused
    } finally {
      unwire();
      await bridge.close();
    }
  });
});
