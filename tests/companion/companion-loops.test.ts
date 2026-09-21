import { afterEach, describe, expect, it } from 'vitest';
import {
  isCompanionAlwaysOnLoopsRunning,
  startCompanionAlwaysOnLoops,
  stopCompanionAlwaysOnLoops,
} from '../../src/companion/companion-loops.js';
import { handleCompanionLoops } from '../../src/commands/handlers/companion-loops-handler.js';

afterEach(() => {
  stopCompanionAlwaysOnLoops();
});

describe('companion always-on loops', () => {
  it('starts and stops without throwing when delivery is off', () => {
    const stop = startCompanionAlwaysOnLoops({ NODE_ENV: 'test' });
    expect(isCompanionAlwaysOnLoopsRunning()).toBe(true);
    stop();
    expect(isCompanionAlwaysOnLoopsRunning()).toBe(false);
  });

  it('exposes a slash handler', async () => {
    const started = await handleCompanionLoops(['start']);
    expect(started.entry.content).toMatch(/armed/i);
    const status = await handleCompanionLoops(['status']);
    expect(status.entry.content).toMatch(/running/i);
  });
});
