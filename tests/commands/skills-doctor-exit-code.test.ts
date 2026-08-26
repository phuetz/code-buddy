import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWithIntegrity: vi.fn(),
  removeMissingSkillRecord: vi.fn(),
}));

vi.mock('../../src/skills/hub.js', () => ({
  computeChecksum: vi.fn(() => 'checksum'),
  getSkillsHub: () => ({
    listWithIntegrity: mocks.listWithIntegrity,
    removeMissingSkillRecord: mocks.removeMissingSkillRecord,
  }),
}));

vi.mock('../../src/skills/registry.js', () => ({
  SkillRegistry: class {
    async load(): Promise<void> {}
    list(): never[] { return []; }
    shutdown(): void {}
  },
}));

import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';

const missingSkill = {
  checksum: 'expected',
  enabled: true,
  exists: false,
  installedAt: 0,
  integrityOk: false,
  name: 'missing-skill',
  path: '/workspace/.codebuddy/skills/missing-skill/SKILL.md',
  sizeBytes: 0,
  source: 'local' as const,
  version: '1.0.0',
};

async function runDoctor(...args: string[]): Promise<string> {
  const output: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
    output.push(String(value ?? ''));
  });
  const program = new Command();
  registerSkillsCommands(program);
  try {
    await program.parseAsync(['node', 'buddy', 'skills', 'doctor', '--json', ...args]);
  } finally {
    logSpy.mockRestore();
  }
  return output.join('\n');
}

describe('skills doctor exit status', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    mocks.listWithIntegrity.mockReset();
    mocks.removeMissingSkillRecord.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('sets a non-zero exit code when health issues remain', async () => {
    mocks.listWithIntegrity.mockReturnValue([missingSkill]);

    const output = JSON.parse(await runDoctor()) as { issueCount: number; ok: boolean };

    expect(output).toMatchObject({ issueCount: 1, ok: false });
    expect(process.exitCode).toBe(1);
  });

  it('keeps a successful exit when an approved repair clears every issue', async () => {
    mocks.listWithIntegrity
      .mockReturnValueOnce([missingSkill])
      .mockReturnValueOnce([]);
    mocks.removeMissingSkillRecord.mockReturnValue(true);

    const output = JSON.parse(await runDoctor('--repair-missing', '--approved-by', 'reviewer')) as {
      issueCount: number;
      ok: boolean;
    };

    expect(output).toMatchObject({ issueCount: 0, ok: true });
    expect(process.exitCode).toBeUndefined();
  });
});
