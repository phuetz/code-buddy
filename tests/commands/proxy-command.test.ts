import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the server bootstrap so no real HTTP listener is ever opened.
const startServerMock = vi.fn();
const getServerBaseUrlMock = vi.fn();

vi.mock('../../src/server/index.js', () => ({
  startServer: (...args: unknown[]) => startServerMock(...args),
  getServerBaseUrl: (...args: unknown[]) => getServerBaseUrlMock(...args),
}));

import { logger } from '../../src/utils/logger.js';

import { registerProxyCommands } from '../../src/commands/cli/proxy-command.js';

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

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

describe('proxy CLI command', () => {
  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit called');
    }) as never);
    startServerMock.mockReset();
    getServerBaseUrlMock.mockReset();
    // Default happy-path mock: never binds a real socket.
    startServerMock.mockResolvedValue({
      app: {},
      server: {},
      config: { port: 8787, host: '127.0.0.1', authEnabled: true },
    });
    getServerBaseUrlMock.mockReturnValue('http://127.0.0.1:8787');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('registers a `proxy` subcommand', () => {
    const program = createProgram();
    registerProxyCommands(program);
    const proxy = program.commands.find((c) => c.name() === 'proxy');
    expect(proxy).toBeTruthy();
    expect(proxy?.description()).toContain('OpenAI-compatible');
  });

  it('starts the server with WS + channel intake disabled and prints the OpenAI endpoint', async () => {
    const program = createProgram();
    registerProxyCommands(program);

    await program.parseAsync(['node', 'test', 'proxy']);

    expect(startServerMock).toHaveBeenCalledTimes(1);
    const arg = startServerMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      port: 8787,
      host: '127.0.0.1',
      authEnabled: true,
      websocketEnabled: false,
      channelIntakeEnabled: false,
    });

    const output = getLogOutput();
    expect(output).toContain('http://127.0.0.1:8787/v1/chat/completions');
    expect(output).toContain('http://127.0.0.1:8787/api/chat/completions');
  });

  it('allows network access without authentication only with explicit opt-in', async () => {
    const program = createProgram();
    registerProxyCommands(program);

    await program.parseAsync(['node', 'test', 'proxy', '--port', '9099', '--host', '0.0.0.0', '--no-auth', '--allow-unauthenticated-network-access']);

    const arg = startServerMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      port: 9099,
      host: '0.0.0.0',
      authEnabled: false,
    });
  });

  it.each(['0.0.0.0', '192.168.1.20', '::', 'example.test', '127.0.0.1.example.test'])(
    'refuses unauthenticated network binding to %s before starting the server', async (host) => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        const program = createProgram();
        registerProxyCommands(program);
        await expect(program.parseAsync(['node', 'test', 'proxy', '--host', host, '--no-auth']))
          .rejects.toThrow('process.exit called');
        expect(startServerMock).not.toHaveBeenCalled();
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--allow-unauthenticated-network-access'));
      } finally {
        errorSpy.mockRestore();
      }
    },
  );

  it.each(['127.0.0.1', '127.0.0.2', '::1', 'localhost'])(
    'allows local development without authentication on %s', async (host) => {
      const program = createProgram();
      registerProxyCommands(program);
      await program.parseAsync(['node', 'test', 'proxy', '--host', host, '--no-auth']);
      expect(startServerMock).toHaveBeenCalledWith(expect.objectContaining({ host, authEnabled: false }));
    },
  );

  it('keeps authentication enabled on a network address by default', async () => {
    const program = createProgram();
    registerProxyCommands(program);
    await program.parseAsync(['node', 'test', 'proxy', '--host', '0.0.0.0']);
    expect(startServerMock).toHaveBeenCalledWith(expect.objectContaining({ authEnabled: true }));
  });

  it('emits machine-readable JSON with --json', async () => {
    const program = createProgram();
    registerProxyCommands(program);

    await program.parseAsync(['node', 'test', 'proxy', '--json']);

    const output = getLogOutput();
    const parsed = JSON.parse(output) as {
      baseUrl: string;
      openaiEndpoint: string;
      legacyEndpoint: string;
      modelsEndpoint: string;
      authEnabled: boolean;
    };
    expect(parsed.baseUrl).toBe('http://127.0.0.1:8787');
    expect(parsed.openaiEndpoint).toBe('http://127.0.0.1:8787/v1/chat/completions');
    expect(parsed.legacyEndpoint).toBe('http://127.0.0.1:8787/api/chat/completions');
    expect(parsed.modelsEndpoint).toBe('http://127.0.0.1:8787/v1/models');
    expect(parsed.authEnabled).toBe(true);
  });

  it('rejects an invalid port without calling startServer', async () => {
    const program = createProgram();
    registerProxyCommands(program);

    await expect(
      program.parseAsync(['node', 'test', 'proxy', '--port', 'not-a-port'])
    ).rejects.toThrow('process.exit called');

    expect(startServerMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits non-zero when the server fails to start', async () => {
    startServerMock.mockRejectedValueOnce(new Error('port in use'));
    const program = createProgram();
    registerProxyCommands(program);

    await expect(program.parseAsync(['node', 'test', 'proxy'])).rejects.toThrow('process.exit called');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
