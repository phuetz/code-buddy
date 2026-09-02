import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSkillsCommands } from '../../src/commands/skills-cli/index.js';
import { logger } from '../../src/utils/logger.js';

afterEach(() => {
  delete process.env.CODEBUDDY_SKILL_EXCHANGE;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('R17 skill exchange errors', () => {
  it('reports a disabled exchange as a clean CLI error', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const command = new Command();
    command.exitOverride();
    registerSkillsCommands(command);

    await expect(command.parseAsync(['node', 'buddy', 'skills', 'exchange', 'keys'])).resolves.toBeDefined();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Skill exchange is disabled'));
  });
});
