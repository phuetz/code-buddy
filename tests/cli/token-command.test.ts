import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFleetCommands } from '../../src/commands/cli/fleet-commands.js';
import { verifyToken } from '../../src/server/auth/jwt.js';

describe('B-8: buddy token CLI command and buddy fleet token alias', () => {
  let originalEnvSecret: string | undefined;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalEnvSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalEnvSecret !== undefined) {
      process.env.JWT_SECRET = originalEnvSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  function createProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
    registerFleetCommands(program);
    return program;
  }

  it('buddy fleet token echoue avec code 2 si JWT_SECRET manque', async () => {
    const program = createProgram();
    const prevCode = process.exitCode;
    process.exitCode = undefined;
    await program.parseAsync(['node', 'buddy', 'fleet', 'token']);
    expect(process.exitCode).toBe(2);
    process.exitCode = prevCode;
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET is required'));
  });

  it('buddy token (alias racine sur program) existe et echoue avec code 2 si JWT_SECRET manque', async () => {
    const program = createProgram();
    const prevCode = process.exitCode;
    process.exitCode = undefined;
    await program.parseAsync(['node', 'buddy', 'token']);
    expect(process.exitCode).toBe(2);
    process.exitCode = prevCode;
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET is required'));
  });

  it('buddy token frappe un jeton JWT valide avec les scopes et ttl specifies', async () => {
    const secret = 'super-secret-key-at-least-32-chars-long-for-test';
    process.env.JWT_SECRET = secret;

    const program = createProgram();
    await program.parseAsync(['node', 'buddy', 'token', '--user', 'alice', '--ttl', '1h', '--scopes', 'chat,peer:invoke']);

    expect(consoleLogSpy).toHaveBeenCalled();
    const mintedToken = consoleLogSpy.mock.calls[0]?.[0] as string;
    expect(mintedToken).toBeTruthy();

    const verified = verifyToken(mintedToken, secret);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('alice');
    expect(verified?.scopes).toEqual(['chat', 'peer:invoke']);
  });
});
