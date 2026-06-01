/**
 * Tests for `buddy user-model ...` CLI.
 *
 * Exercises the real LocalUserModel against a temp workDir (process.cwd is
 * spied) so the propose→accept review flow and the no-silent-write guarantee
 * are verified through the command wiring.
 */

import { Command } from 'commander';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { createUserModelCommand } from '../../src/commands/user-model.js';
import { resetUserModels } from '../../src/memory/user-model.js';

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(createUserModelCommand());
  return program;
}

function getLogOutput(spy: jest.SpyInstance): string {
  return (spy.mock.calls as unknown[][]).map((c) => c.join(' ')).join('\n');
}

describe('buddy user-model', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpyInstance;
  let consoleSpy: jest.SpyInstance;
  let consoleErrSpy: jest.SpyInstance;
  let processExitSpy: jest.SpyInstance;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-model-cli-'));
    resetUserModels();
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(
      (() => {}) as unknown as (code?: number | string | null) => never,
    );
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrSpy.mockRestore();
    processExitSpy.mockRestore();
    resetUserModels();
    await fs.remove(tmpDir);
  });

  it('observe → show: proposing does not put it in the active model', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'buddy', 'user-model', 'observe', 'Prefers French explanations.', '--kind', 'preference',
    ]);
    expect(getLogOutput(consoleSpy)).toContain('Proposed observation');

    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'user-model', 'show']);
    expect(getLogOutput(consoleSpy)).toMatch(/no accepted observations/i);
  });

  it('observe --json returns the pending observation and review command', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'buddy', 'user-model', 'observe', 'Prefers compact JSON review queues.', '--kind', 'working-style', '--json',
    ]);

    const output = JSON.parse(getLogOutput(consoleSpy)) as {
      deduped: boolean;
      observation: { content: string; id: string; kind: string; status: string };
      reviewCommand: string;
    };
    expect(output).toMatchObject({
      deduped: false,
      observation: {
        content: 'Prefers compact JSON review queues.',
        kind: 'working-style',
        status: 'pending',
      },
    });
    expect(output.reviewCommand).toBe(`buddy user-model accept ${output.observation.id} --by <name>`);
  });

  it('observe --json omits review command when it dedupes an accepted observation', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'buddy', 'user-model', 'observe', 'Already reviewed preference.', '--kind', 'preference', '--json',
    ]);
    const first = JSON.parse(getLogOutput(consoleSpy)) as {
      observation: { id: string };
    };
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'user-model', 'accept', first.observation.id, '--by', 'Patrice']);
    consoleSpy.mockClear();

    await program.parseAsync([
      'node', 'buddy', 'user-model', 'observe', 'Already reviewed preference.', '--kind', 'preference', '--json',
    ]);

    const output = JSON.parse(getLogOutput(consoleSpy)) as {
      deduped: boolean;
      observation: { id: string; status: string };
      reviewCommand?: string;
    };
    expect(output).toMatchObject({
      deduped: true,
      observation: {
        id: first.observation.id,
        status: 'accepted',
      },
    });
    expect(output.reviewCommand).toBeUndefined();
  });

  it('refuses sensitive content', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'user-model', 'observe', 'has a medical diagnosis']);
    expect(getLogOutput(consoleErrSpy)).toMatch(/privacy scope/i);
  });

  it('accept requires --by and then appears in show', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'user-model', 'observe', 'Wants tests before done', '--kind', 'working-style']);
    const id = getLogOutput(consoleSpy).match(/\[(um-[a-z0-9]+)\]/)?.[1];
    expect(id).toBeTruthy();

    // Without --by, commander rejects the required option; nothing accepted.
    try {
      await program.parseAsync(['node', 'buddy', 'user-model', 'accept', id!]);
    } catch {
      /* expected */
    }
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'user-model', 'show']);
    expect(getLogOutput(consoleSpy)).toMatch(/no accepted observations/i);

    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'user-model', 'accept', id!, '--by', 'Patrice']);
    expect(getLogOutput(consoleSpy)).toContain('Accepted observation');

    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'user-model', 'show']);
    expect(getLogOutput(consoleSpy)).toContain('Wants tests before done');
  });

  it('list --json shows pending observations', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'user-model', 'observe', 'a pending pref']);
    consoleSpy.mockClear();
    await program.parseAsync(['node', 'buddy', 'user-model', 'list', '--status', 'pending', '--json']);
    const parsed = JSON.parse(getLogOutput(consoleSpy));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].status).toBe('pending');
  });

  it('refuses to discard the same observation twice', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'user-model', 'observe', 'temporary preference']);
    const id = getLogOutput(consoleSpy).match(/\[(um-[a-z0-9]+)\]/)?.[1];
    expect(id).toBeTruthy();

    await program.parseAsync([
      'node', 'buddy', 'user-model', 'discard', id!, '--by', 'Patrice', '--reason', 'first',
    ]);
    consoleErrSpy.mockClear();
    processExitSpy.mockClear();

    await program.parseAsync([
      'node', 'buddy', 'user-model', 'discard', id!, '--by', 'Patrice', '--reason', 'second',
    ]);

    expect(getLogOutput(consoleErrSpy)).toContain('already discarded');
    expect(processExitSpy).toHaveBeenCalledWith(1);
    const observation = JSON.parse(await fs.readFile(path.join(tmpDir, '.codebuddy', 'user-model.json'), 'utf-8'))
      .observations.find((item: { id: string }) => item.id === id);
    expect(observation.reviewNote).toBe('first');
  });

  it('runs analyze on a session and proposes observations', async () => {
    const { getSessionStore } = await import('../../src/persistence/session-store.js');
    const sessionStore = getSessionStore();
    const sessionId = 'test-session-123';
    (sessionStore as unknown as { currentSessionId: string }).currentSessionId = sessionId;

    const loadSessionSpy = jest.spyOn(sessionStore, 'loadSession').mockResolvedValue({
      id: sessionId,
      name: 'test-session',
      workingDirectory: tmpDir,
      model: 'grok-3',
      messages: [
        { type: 'user', content: 'Prefers typescript', timestamp: new Date().toISOString() }
      ],
      createdAt: new Date(),
      lastAccessedAt: new Date()
    });

    const providerDetector = await import('../../src/utils/provider-detector.js');
    const detectSpy = jest.spyOn(providerDetector, 'detectProviderFromEnv').mockReturnValue({
      apiKey: 'test-api-key',
      defaultModel: 'test-model',
      baseURL: 'http://test-base-url'
    });

    const { CodeBuddyClient } = await import('../../src/codebuddy/client.js');
    const chatResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify([
              { kind: 'preference', content: 'Prefers TypeScript', confidence: 0.9 }
            ])
          }
        }
      ]
    } as Awaited<ReturnType<CodeBuddyClient['chat']>>;
    const chatSpy = jest.spyOn(CodeBuddyClient.prototype, 'chat').mockResolvedValue(chatResponse);

    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'user-model', 'analyze']);

    const output = getLogOutput(consoleSpy);
    expect(output).toContain('Running LLM dialectic inference');
    expect(output).toContain('Prefers TypeScript');

    loadSessionSpy.mockRestore();
    detectSpy.mockRestore();
    chatSpy.mockRestore();
  });
});
