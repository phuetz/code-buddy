import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getGlobalEventBus } from '../../src/events/event-bus.js';
import { wireSemanticVisionReaction } from '../../src/sensory/semantic-vision-reaction.js';

let tmp: string;

async function waitForPercepts(): Promise<string> {
  const perceptPath = path.join(tmp, '.codebuddy', 'companion', 'percepts.jsonl');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 2000) {
    try {
      return await readFile(perceptPath, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error('identity percept was not written');
}

function identified(name: string, similarity?: number): void {
  getGlobalEventBus().emit('sensory:perception', {
    source: 'test',
    metadata: {
      modality: 'vision',
      kind: 'person_identified',
      payload: { name, similarity, camera: 'local-test-camera' },
    },
  });
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'identity-percept-'));
  process.env.CODEBUDDY_USER_NAME = 'Patrice';
});

afterEach(async () => {
  delete process.env.CODEBUDDY_USER_NAME;
  delete process.env.CODEBUDDY_SENSORY_GREET;
  await rm(tmp, { recursive: true, force: true });
});

describe('semantic identity reaction — event → local percept', () => {
  it('records a named percept and raises the configured-user hook case-insensitively', async () => {
    const onIdentityChange = vi.fn();
    const unwire = wireSemanticVisionReaction({ cwd: tmp, onIdentityChange });
    try {
      identified('pAtRiCe', 0.72);
      const raw = await waitForPercepts();
      const percept = JSON.parse(raw.trim()) as {
        summary: string;
        confidence: number;
        payload: Record<string, unknown>;
      };
      expect(percept.summary).toBe('pAtRiCe est là');
      expect(percept.confidence).toBe(0.72);
      expect(percept.payload).toMatchObject({
        event: 'person_identified',
        name: 'pAtRiCe',
        similarity: 0.72,
        recognizedUser: true,
      });
      expect(onIdentityChange).toHaveBeenLastCalledWith(true);
    } finally {
      unwire();
    }
  });

  it('records an unknown person without asserting the configured-user flag', async () => {
    const onIdentityChange = vi.fn();
    const unwire = wireSemanticVisionReaction({ cwd: tmp, onIdentityChange });
    try {
      identified('unknown');
      const raw = await waitForPercepts();
      const percept = JSON.parse(raw.trim()) as {
        summary: string;
        payload: Record<string, unknown>;
      };
      expect(percept.summary).toBe('personne inconnue');
      expect(percept.payload).toMatchObject({
        name: 'unknown',
        recognizedUser: false,
      });
      expect(onIdentityChange).toHaveBeenLastCalledWith(false);
    } finally {
      unwire();
    }
  });
});
