import { Command } from 'commander';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProvisionCommands } from '../../src/commands/cli/provision-command.js';

// Use the real local planner: JSON must be consumable from stdout by a pipe.
describe('provision db-auth JSON output', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints the human-readable dry-run plan to stdout for terminal users and pipes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-provision-human-'));
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const program = new Command().exitOverride();
    registerProvisionCommands(program);
    try {
      await program.parseAsync(['node', 'buddy', 'provision', 'db-auth', '--target', 'local', '--dir', dir, '--name', 'qa-human']);
      const output = chunks.join('');
      expect(output).toContain('qa-human');
      expect(output).toContain('.env.local');
      expect(output).toContain('Simulation (no files written)');
      expect(output).not.toContain('INFO');
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes one parseable plan to stdout without writing planned files or secret contents', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-provision-json-'));
    const chunks: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const program = new Command().exitOverride();
    registerProvisionCommands(program);
    try {
      await program.parseAsync(['node', 'buddy', 'provision', 'db-auth', '--target', 'local', '--dir', dir, '--name', 'qa-json', '--json']);
      const output = chunks.join('');
      const plan = JSON.parse(output);
      expect(plan.mode).toBe('dry-run');
      expect(plan.target).toBe('local');
      expect(plan.written).toBe(false);
      expect(plan.files).toHaveLength(14);
      expect(plan.files).toContainEqual({ path: '.env.local', action: 'create', secret: true });
      expect(plan.files.every((file: Record<string, unknown>) => !('content' in file))).toBe(true);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
