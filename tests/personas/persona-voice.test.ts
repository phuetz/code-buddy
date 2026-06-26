import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { getPersonaManager, resetPersonaManager, getActivePersonaVoice } from '../../src/personas/persona-manager.js';

let dir: string;
let n = 0;
const flush = () => new Promise((r) => setTimeout(r, 60));

async function waitInit(pm: ReturnType<typeof getPersonaManager>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (pm.getActivePersona()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(async () => {
  dir = path.join(os.tmpdir(), `cb-persona-${process.pid}-${n++}`, 'personas');
  await mkdir(dir, { recursive: true });
  resetPersonaManager();
});
afterEach(async () => {
  resetPersonaManager();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe('persona voice layer + persistence', () => {
  it('the selected persona STICKS across a restart (persisted to disk)', async () => {
    const pm = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm);
    expect(pm.setActivePersona('minimalist')).toBe(true);
    await flush(); // the async persist write

    resetPersonaManager(); // simulate a fresh process
    const pm2 = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm2);
    expect(pm2.getActivePersona()?.id).toBe('minimalist'); // survived the "restart"
  });

  it('getActivePersonaVoice exposes the built-in companion character (name + spoken prompt)', async () => {
    const pm = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm);
    pm.setActivePersona('companion');
    const v = getActivePersonaVoice();
    expect(v.robotName).toBe('Buddy');
    expect(v.spokenPrompt).toContain('Buddy');
  });

  it('a custom persona supplies its own voice .onnx + name (the per-personality voice)', async () => {
    await writeFile(
      path.join(dir, 'tom.json'),
      JSON.stringify({
        id: 'tom',
        name: 'Tom',
        description: 'd',
        systemPrompt: 's',
        traits: [],
        expertise: [],
        style: { verbosity: 'concise', formality: 'professional', tone: 'neutral', codeStyle: 'minimal', explanationDepth: 'surface' },
        isDefault: false,
        voice: '/voices/fr_FR-tom-medium.onnx',
        robotName: 'Tom',
        spokenPrompt: 'Tu es Tom.',
      }),
    );
    const pm = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm);
    expect(pm.setActivePersona('tom')).toBe(true);
    const v = getActivePersonaVoice();
    expect(v.voice).toBe('/voices/fr_FR-tom-medium.onnx');
    expect(v.robotName).toBe('Tom');
  });

  it('a persona without voice fields → {} (consumers fall back to env defaults)', async () => {
    const pm = getPersonaManager({ customPersonasDir: dir });
    await waitInit(pm);
    pm.setActivePersona('default');
    const v = getActivePersonaVoice();
    expect(v.voice).toBeUndefined();
    expect(v.robotName).toBeUndefined();
  });
});
