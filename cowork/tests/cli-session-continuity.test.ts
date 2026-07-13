import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getExternalSession, listExternalSessions } from '../src/main/session/cli-session-continuity';

describe('CLI session continuity catalog', () => {
  const directories: string[] = [];
  afterEach(() => {
    delete process.env.CODEBUDDY_SESSIONS_DIR;
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('lists valid transcripts and ignores aggregate/malformed files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'continuity-'));
    directories.push(directory);
    process.env.CODEBUDDY_SESSIONS_DIR = directory;
    writeFileSync(join(directory, 'good.json'), JSON.stringify({
      id: 'cli-1', name: 'CLI research', model: 'local-fast', createdAt: '2026-01-01T00:00:00.000Z', lastAccessedAt: '2026-01-02T00:00:00.000Z',
      messages: [{ type: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
    }));
    writeFileSync(join(directory, 'sessions.json'), JSON.stringify([]));
    writeFileSync(join(directory, 'broken.json'), '{');

    expect(listExternalSessions()).toEqual([expect.objectContaining({ id: 'cli-1', messageCount: 1 })]);
    expect(getExternalSession('cli-1')?.messages[0]?.content).toBe('hello');
  });
});
