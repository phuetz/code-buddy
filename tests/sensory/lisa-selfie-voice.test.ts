import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'node:url';

import { defaultReply } from '../../src/sensory/voice-loop.js';

const QA = fileURLToPath(new URL('../../_qa/selfie', import.meta.url));
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const roots: string[] = [];

afterEach(async () => {
  delete process.env.CODEBUDDY_LISA_SELFIE_CACHE_DIR;
  delete process.env.CODEBUDDY_LISA_SELFIE_RECENT_FILE;
  delete process.env.CODEBUDDY_COMPANION_PERSONA;
  delete process.env.CODEBUDDY_LISA_SELFIE;
  delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

beforeEach(() => {
  delete process.env.CODEBUDDY_SENSORY_ALERT_TOKEN;
  delete process.env.CODEBUDDY_SENSORY_ALERT_CHAT;
});

describe('voice companion selfie cache-first', () => {
  it('defaultReply returns a cache caption without calling a generator', async () => {
    await fs.mkdir(QA, { recursive: true });
    const root = await fs.mkdtemp(path.join(QA, 'voice-'));
    roots.push(root);
    const cacheDir = path.join(root, 'cache');
    const image = path.join(cacheDir, 'safe', 'portrait', 'portrait-001.png');
    await fs.mkdir(path.dirname(image), { recursive: true });
    await fs.writeFile(image, PNG_1X1);
    process.env.CODEBUDDY_LISA_SELFIE_CACHE_DIR = cacheDir;
    process.env.CODEBUDDY_LISA_SELFIE_RECENT_FILE = path.join(root, 'recent-selfies.json');
    const spoken = await defaultReply('envoie-moi une photo de toi');
    expect(spoken).toMatch(/photo|Voilà|Tiens|portrait/i);
    expect(spoken).not.toMatch(/backend|configur/i);
  });
});
