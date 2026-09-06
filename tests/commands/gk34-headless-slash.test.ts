import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchSlashPrompt } from '../../src/commands/headless-slash.js';
import { getTeamManager, resetTeamManager } from '../../src/agent/multi-agent/team-manager.js';
import { _resetAgentsHandlerForTests } from '../../src/commands/handlers/agents-handler.js';

describe('GK34 headless slash dispatch', () => {
  const originalTeamFile = process.env.CODEBUDDY_TEAM_FILE;

  afterEach(() => {
    resetTeamManager();
    _resetAgentsHandlerForTests();
    if (originalTeamFile === undefined) delete process.env.CODEBUDDY_TEAM_FILE;
    else process.env.CODEBUDDY_TEAM_FILE = originalTeamFile;
  });

  it('returns null for a regular prompt (LLM path)', async () => {
    const res = await dispatchSlashPrompt('fix the failing test');
    expect(res).toBeNull();
  });

  it('does not pass an unknown slash to the LLM', async () => {
    const res = await dispatchSlashPrompt('/this-command-does-not-exist-gk34');
    expect(res?.handled).toBe(true);
    expect(res?.output).toMatch(/Unknown command/i);
    expect(res?.passToAI).toBeFalsy();
  });

  it('runs /team start|add|status in-process with visible coordination', async () => {
    const start = await dispatchSlashPrompt('/team start GK34 toy repo');
    expect(start?.handled).toBe(true);
    expect(start?.output).toMatch(/Team started/i);
    expect(start?.output).toContain('GK34 toy repo');

    const add = await dispatchSlashPrompt('/team add coder');
    expect(add?.output).toMatch(/Added coder/i);

    const status = await dispatchSlashPrompt('/team status');
    expect(status?.output).toContain('AGENT TEAM STATUS');
    expect(status?.output).toContain('GK34 toy repo');
    expect(status?.output).toMatch(/coder/i);
  });

  it('runs /batch without a spawn as plan-only (no false "started")', async () => {
    const res = await dispatchSlashPrompt('/batch 1. Fix src/add.js. Only touch src/add.js.\n2. Write README.md. Only touch README.md.');
    expect(res?.handled).toBe(true);
    expect(res?.output).not.toContain('Batch command initiated');
    expect(res?.output).toMatch(/Batch Plan|Units:/);
    expect(res?.output).toContain('plan only');
  });

  it('persists /team start+add so a new process can /team status', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gk34-team-'));
    const file = join(dir, 'team-session.json');
    process.env.CODEBUDDY_TEAM_FILE = file;
    resetTeamManager();

    await dispatchSlashPrompt('/team start persist-across-process');
    await dispatchSlashPrompt('/team add reviewer');
    resetTeamManager();

    const reloaded = getTeamManager();
    expect(reloaded.isActive()).toBe(true);
    expect(reloaded.getTeamGoal()).toBe('persist-across-process');
    expect(reloaded.getMembers().some((m) => m.role === 'reviewer')).toBe(true);

    const status = await dispatchSlashPrompt('/team status');
    expect(status?.output).toContain('persist-across-process');
    expect(status?.output).toMatch(/reviewer/i);
    rmSync(dir, { recursive: true, force: true });
  });
});
