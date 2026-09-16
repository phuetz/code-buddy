import { Command } from 'commander';
import { afterEach, expect, it, vi } from 'vitest';
import { registerFleetCollaborationCommands } from '../../src/commands/cli/fleet-collaboration-commands.js';
import { readFile } from 'node:fs/promises';
import { runCollaboration } from '../../src/fleet/collaboration.js';

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
vi.mock('../../src/fleet/collaboration.js', () => ({
  parseCollaborationConfig: vi.fn(value => value), runCollaboration: vi.fn(),
}));
const oldExitCode = process.exitCode;
afterEach(() => { process.exitCode = oldExitCode; vi.restoreAllMocks(); vi.clearAllMocks(); });

it('prints a structured partial result and exits unsuccessfully', async () => {
  vi.mocked(readFile).mockResolvedValue('{"version":1}');
  vi.mocked(runCollaboration).mockResolvedValue({ status: 'partial', peers: [{ id: 'offline', status: 'failed', error: 'REQUEST_TIMEOUT' }] });
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const program = new Command().exitOverride();
  registerFleetCollaborationCommands(program.command('fleet'));
  await program.parseAsync(['node', 'buddy', 'fleet', 'collaborate', 'shared goal', '--config', 'fleet.json', '--json', '--timeout', '4000']);
  expect(runCollaboration).toHaveBeenCalledWith({ version: 1 }, expect.objectContaining({ goal: 'shared goal', timeoutMs: 4000 }));
  expect(JSON.parse(String(stdout.mock.calls[0]?.[0])).status).toBe('partial');
  expect(stderr).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it('does not print raw malformed JSON, which could contain credentials', async () => {
  vi.mocked(readFile).mockResolvedValue('{"token":"private-value"');
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const program = new Command().exitOverride();
  registerFleetCollaborationCommands(program.command('fleet'));
  await program.parseAsync(['node', 'buddy', 'fleet', 'check', '--config', 'fleet.json', '--json']);
  expect(stdout.mock.calls.flat().join('')).not.toContain('private-value');
  expect(runCollaboration).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
