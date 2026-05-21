import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFleetCommands } from '../../src/commands/cli/fleet-commands.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

function getLogOutput(): string {
  return consoleLogSpy.mock.calls.map((call) => call.join(' ')).join('\n');
}

describe('Fleet CLI commands', () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints JSON policy decisions for a dispatch profile', async () => {
    const program = createProgram();
    registerFleetCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'fleet',
      'policy',
      '--json',
      'review',
      'view_file',
      'create_file',
      'bash',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      profile: string;
      policyProfile: string;
      decisions: Array<{ tool: string; action: string; matchedGroup?: string }>;
    };

    expect(output.profile).toBe('review');
    expect(output.policyProfile).toBe('minimal');
    expect(output.decisions).toEqual([
      expect.objectContaining({ tool: 'view_file', action: 'allow', matchedGroup: 'group:fs:read' }),
      expect.objectContaining({ tool: 'create_file', action: 'deny', matchedGroup: 'group:fs:write' }),
      expect.objectContaining({ tool: 'bash', action: 'deny', matchedGroup: 'group:runtime' }),
    ]);
  });

  it('lists dispatch profiles as JSON', async () => {
    const program = createProgram();
    registerFleetCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'fleet',
      'profiles',
      '--json',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      profiles: Array<{ profile: string; policyProfile: string; summary: string; useWhen: string }>;
    };
    expect(output.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profile: 'balanced', policyProfile: 'coding' }),
        expect.objectContaining({ profile: 'review', policyProfile: 'minimal' }),
        expect.objectContaining({ profile: 'safe', policyProfile: 'minimal' }),
      ]),
    );
    expect(output.profiles.find((profile) => profile.profile === 'review')?.summary)
      .toContain('read-first');
    expect(output.profiles.find((profile) => profile.profile === 'safe')?.useWhen)
      .toContain('high-risk');
  });

  it('lists dispatch profiles in human-readable form', async () => {
    const program = createProgram();
    registerFleetCommands(program);

    await program.parseAsync(['node', 'test', 'fleet', 'profiles']);

    const output = getLogOutput();
    expect(output).toContain('Fleet dispatch profiles:');
    expect(output).toContain('balanced');
    expect(output).toContain('review');
    expect(output).toContain('Use when: read-first code review');
    expect(output).toContain('Policy: minimal / confirm');
  });

  it('prints a human-readable policy preview', async () => {
    const program = createProgram();
    registerFleetCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'fleet',
      'policy',
      'code',
      'create_file',
      'git_push',
    ]);

    const output = getLogOutput();
    expect(output).toContain('Fleet dispatch profile: code');
    expect(output).toContain('Policy profile: coding');
    expect(output).toContain('create_file: allow');
    expect(output).toContain('git_push: confirm');
  });

  it('prints JSON Hermes-style toolset descriptors for a dispatch profile', async () => {
    const program = createProgram();
    registerFleetCommands(program);

    await program.parseAsync([
      'node',
      'test',
      'fleet',
      'toolsets',
      '--json',
      'review',
      'view_file',
      'create_file',
      'web_fetch',
    ]);

    const output = JSON.parse(getLogOutput()) as {
      toolset: {
        toolsetId: string;
        allowedTools: string[];
        confirmTools: string[];
        deniedTools: string[];
      };
    };

    expect(output.toolset.toolsetId).toBe('fleet.hermes.review');
    expect(output.toolset.allowedTools).toEqual(['view_file']);
    expect(output.toolset.confirmTools).toEqual(['web_fetch']);
    expect(output.toolset.deniedTools).toEqual(['create_file']);
  });

  it('lists Hermes-style toolsets in human-readable form', async () => {
    const program = createProgram();
    registerFleetCommands(program);

    await program.parseAsync(['node', 'test', 'fleet', 'toolsets']);

    const output = getLogOutput();
    expect(output).toContain('Hermes-style Fleet toolsets:');
    expect(output).toContain('fleet.hermes.balanced');
    expect(output).toContain('fleet.hermes.review');
    expect(output).toContain('Policy: minimal / confirm');
  });
});
