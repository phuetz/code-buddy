import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listExternalSessions } from '../../cowork/src/main/session/cli-session-continuity.js';

describe('CLI catalog origin tags', () => {
  const dirs: string[] = [];
  afterEach(() => {
    delete process.env.CODEBUDDY_SESSIONS_DIR;
    for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('tags cowork handoff files as origin cowork', () => {
    const directory = mkdtempSync(join(tmpdir(), 'origin-'));
    dirs.push(directory);
    process.env.CODEBUDDY_SESSIONS_DIR = directory;
    writeFileSync(join(directory, 'cowork-gui.json'), JSON.stringify({
      id: 'cowork-gui',
      name: 'From GUI',
      model: 'local',
      createdAt: '2026-09-17T00:00:00.000Z',
      lastAccessedAt: '2026-09-17T00:00:00.000Z',
      messages: [{ type: 'user', content: 'hi', timestamp: '2026-09-17T00:00:00.000Z' }],
      metadata: { handoffSource: 'cowork' },
    }));
    expect(listExternalSessions()).toEqual([
      expect.objectContaining({ id: 'cowork-gui', origin: 'cowork', messageCount: 1 }),
    ]);
  });
});
