import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { CustomAgentLoader } from '../../src/agent/custom/custom-agent-loader.js';

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebuddy-hermes-agent-'));
  return tempDir;
}

describe('CustomAgentLoader built-in Hermes Agent', () => {
  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      tempDir = null;
    }
  });

  it('loads Hermes as a built-in custom agent without a user file', () => {
    const loader = new CustomAgentLoader(makeTempDir());

    const agent = loader.getAgent('hermes');

    expect(agent).toMatchObject({
      id: 'hermes',
      name: 'Hermes Agent',
      author: 'Code Buddy',
      version: '1.0.0',
    });
    expect(agent?.tags).toEqual(
      expect.arrayContaining(['builtin', 'hermes', 'fleet', 'toolsets']),
    );
    expect(agent?.disabledTools).toEqual(['git_push', 'delete_file']);
    expect(agent?.fleetDispatchProfile).toBe('balanced');
    expect(agent?.requireExplicitDispatchProfile).toBe(true);
    expect(agent?.systemPrompt).toContain('Default Fleet toolset: fleet.hermes.balanced');
  });

  it('allows a user file to override the built-in Hermes profile', () => {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, 'hermes.toml'),
      [
        'name = "Local Hermes"',
        'description = "Override"',
        'systemPrompt = """',
        'Project-specific Hermes instructions.',
        '"""',
        '',
      ].join('\n'),
    );
    const loader = new CustomAgentLoader(dir);

    const agent = loader.getAgent('hermes');

    expect(agent?.name).toBe('Local Hermes');
    expect(agent?.systemPrompt.trim()).toBe('Project-specific Hermes instructions.');
    expect(loader.listAgents().filter((entry) => entry.id === 'hermes')).toHaveLength(1);
  });
});
