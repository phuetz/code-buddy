import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runTryDemo, type TryProvider } from '../../src/commands/try.js';
import { getTrustFolderManager } from '../../src/security/trust-folders.js';

const provider: TryProvider = {
  kind: 'ollama', label: 'local fixture', apiKey: 'local',
  baseURL: 'http://localhost:11434/v1', model: 'fixture-model',
};
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe('try sandbox lifecycle and independent verification', () => {
  it.each(['success', 'throw', 'construction'] as const)('trusts only its sandbox until %s completes, without persisting trust', async outcome => {
    const workspace = await mkdtemp(join(tmpdir(), 'try-workspace-'));
    folders.push(workspace);
    const manager = getTrustFolderManager();
    const enforcement = manager.isEnforcementEnabled();
    const persisted = manager.getTrustedFolders();
    let witnessedTrust = false;
    manager.setEnforcement(true);
    try {
      expect(manager.isTrusted(workspace)).toBe(false);
      const code = await runTryDemo({
        resolveProvider: async () => provider,
        createWorkspace: async () => workspace,
        createAgent: async () => {
          expect(manager.isTrusted(workspace)).toBe(true);
          expect(manager.isTrusted(join(workspace, 'fizzbuzz.js'))).toBe(true);
          expect(manager.isTrusted(`${workspace}-sibling`)).toBe(false);
          expect(manager.getTrustedFolders()).toEqual(persisted);
          witnessedTrust = true;
          if (outcome === 'construction') throw new Error('construction failure');
          return { processUserMessage: async () => {
            if (outcome === 'throw') throw new Error('turn failure');
            return [];
          } };
        },
        verify: async () => ({ success: true, output: '' }),
        stdout: () => {}, stderr: () => {},
      });
      expect(code).toBe(outcome === 'success' ? 0 : 1);
      expect(witnessedTrust).toBe(true);
      expect(manager.isTrusted(workspace)).toBe(false);
      expect(manager.getTrustedFolders()).toEqual(persisted);
    } finally {
      manager.setEnforcement(enforcement);
    }
  });

  it.each(['missing', 'wrong', 'correct'] as const)('verifies actual FizzBuzz even if the agent claims success: %s', async implementation => {
    const errors: string[] = [];
    const sandbox: string[] = [];
    const code = await runTryDemo({
      resolveProvider: async () => provider,
      createAgent: async (_provider, workspace) => {
        folders.push(workspace);
        sandbox.push(workspace);
        return { processUserMessage: async () => {
          await writeFile(join(workspace, 'fizzbuzz.test.js'),
            "require('node:test')('model test', () => {});\n");
          if (implementation !== 'missing') {
            await writeFile(join(workspace, 'fizzbuzz.js'), implementation === 'correct'
              ? "exports.fizzBuzz = n => n % 15 === 0 ? 'FizzBuzz' : n % 3 === 0 ? 'Fizz' : n % 5 === 0 ? 'Buzz' : String(n);\n"
              : "exports.fizzBuzz = () => 'FizzBuzz';\n");
          }
          return [{ type: 'assistant', content: 'All green!', timestamp: new Date() }];
        } };
      },
      stdout: () => {}, stderr: message => errors.push(message),
    });
    expect(code).toBe(implementation === 'correct' ? 0 : 1);
    expect(JSON.parse(await readFile(join(sandbox[0]!, 'package.json'), 'utf8')).type).toBe('commonjs');
    if (implementation !== 'correct') expect(errors.join('\n')).toContain('did not produce a green test');
  });
});
