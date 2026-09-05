import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: execFileSyncMock };
});

import { resolveSourceDir, type SkillSource } from '../../src/skills/skill-sources.js';

let home: string;
let originalHome: string | undefined;

beforeEach(() => {
  execFileSyncMock.mockReset();
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-skill-sources-'));
  originalHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('skill sources', () => {
  it('propagates a git clone failure instead of returning a phantom directory', () => {
    const error = new Error('git clone failed: network unavailable');
    execFileSyncMock.mockImplementation(() => {
      throw error;
    });
    const source: SkillSource = { name: 'remote-skills', type: 'git', location: 'https://example.invalid/skills.git' };

    expect(() => resolveSourceDir(source)).toThrow(error);
    expect(fs.existsSync(path.join(home, '.codebuddy', 'skills', '.sources-cache', 'remote-skills'))).toBe(false);
  });
});
