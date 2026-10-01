import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('prints complete candidate IDs when --resume cannot find a session', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'root-resume-ids-'));
  const sessions = path.join(home, '.codebuddy', 'sessions');
  const ids = ['session_1790000000000_aaaa', 'session_1790000000000_bbbb'];
  fs.mkdirSync(sessions, { recursive: true });
  for (const id of ids) {
    fs.writeFileSync(path.join(sessions, `${id}.json`), JSON.stringify({
      id, name: 'Saved task', messages: [], workingDirectory: home,
      createdAt: '2026-09-30T08:00:00.000Z', lastAccessedAt: '2026-09-30T08:00:00.000Z',
    }));
  }
  try {
    const child = spawnSync(process.execPath, [
      path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/index.ts'),
      '--resume', 'missing-session',
    ], {
      cwd: home,
      env: {
        PATH: process.env.PATH, HOME: home, USERPROFILE: home,
        CODEBUDDY_HOME: path.join(home, '.codebuddy'),
        GROK_HOME: path.join(home, '.codebuddy'),
        CODEBUDDY_SESSIONS_DIR: sessions,
        CODEBUDDY_REPO_PROFILE_READONLY: 'true', NO_COLOR: '1',
      },
      encoding: 'utf8', timeout: 30_000,
    });
    expect(child.status, child.stderr).toBe(1);
    const output = child.stdout + child.stderr;
    for (const id of ids) expect(output).toContain(`${id} - Saved task`);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}, 40_000);
