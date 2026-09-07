import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerFleetCommands } from '../../src/commands/cli/fleet-commands.js';
import {
  TOKEN_ROLE_SCOPES,
  buildMobileOpenUrl,
  createTokenCommand,
  mintBuddyToken,
  parseServiceEnv,
  type TokenCommandDependencies,
} from '../../src/commands/token.js';
import { verifyToken } from '../../src/server/auth/jwt.js';

const SECRET = 'test-only-jwt-secret-not-real-32b!!';
const QA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../_qa/tok');
const QA_HOME = path.join(QA_ROOT, 'home');
const QA_WORK = path.join(QA_ROOT, 'work');

function captured(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
}

function createProgram(deps: TokenCommandDependencies = {}): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  program.addCommand(createTokenCommand(deps));
  registerFleetCommands(program);
  return program;
}

describe('buddy token (PWA / API JWT)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let previousSecret: string | undefined;
  let previousHome: string | undefined;
  let previousUrl: string | undefined;
  let previousPort: string | undefined;
  let previousExit: string | number | undefined;

  beforeEach(() => {
    mkdirSync(QA_HOME, { recursive: true });
    mkdirSync(QA_WORK, { recursive: true });
    previousSecret = process.env.JWT_SECRET;
    previousHome = process.env.HOME;
    previousUrl = process.env.CODEBUDDY_SERVER_URL;
    previousPort = process.env.CODEBUDDY_SERVER_PORT;
    previousExit = process.exitCode;
    delete process.env.JWT_SECRET;
    delete process.env.CODEBUDDY_SERVER_URL;
    delete process.env.CODEBUDDY_SERVER_PORT;
    process.env.HOME = QA_HOME;
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousUrl === undefined) delete process.env.CODEBUDDY_SERVER_URL;
    else process.env.CODEBUDDY_SERVER_URL = previousUrl;
    if (previousPort === undefined) delete process.env.CODEBUDDY_SERVER_PORT;
    else process.env.CODEBUDDY_SERVER_PORT = previousPort;
    process.exitCode = previousExit as string | number | undefined;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('refuses clearly when JWT_SECRET is absent (exit 2) and never prints a secret', async () => {
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'token']);
    expect(process.exitCode).toBe(2);
    const err = captured(errorSpy);
    expect(err).toContain('JWT_SECRET is required');
    expect(err).toContain('--env');
    expect(err).toContain('~/.codebuddy/server.env');
    expect(captured(logSpy) + err).not.toContain(QA_HOME);
    expect(captured(logSpy) + err).not.toMatch(/\/home\//);
  });

  it('buddy fleet token is the same mint path', async () => {
    process.env.JWT_SECRET = SECRET;
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'fleet', 'token', '--user', 'peer-a', '--json']);
    const payload = JSON.parse(captured(logSpy)) as { user: string; token: string; url: string };
    expect(payload.user).toBe('peer-a');
    expect(verifyToken(payload.token, SECRET)?.sub).toBe('peer-a');
    expect(payload.url).toContain('/__codebuddy__/mobile/#token=');
  });

  it('defaults user to mobile, role user, 30 days, role scopes, and prints expiry + PWA URL', async () => {
    process.env.JWT_SECRET = SECRET;
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'token', '--url', 'http://127.0.0.1:5601']);
    const jwt = String(logSpy.mock.calls[0]?.[0] ?? '');
    const verified = verifyToken(jwt, SECRET);
    expect(verified).not.toBeNull();
    expect(verified?.sub).toBe('mobile');
    expect(verified?.userId).toBe('mobile');
    expect(verified?.role).toBe('user');
    expect(verified?.scopes).toEqual([...TOKEN_ROLE_SCOPES.user]);
    const ttl = (verified?.exp ?? 0) - (verified?.iat ?? 0);
    expect(ttl).toBe(30 * 24 * 60 * 60);
    const out = captured(logSpy);
    expect(out).toMatch(/Expire/i);
    expect(out).toContain('http://127.0.0.1:5601/__codebuddy__/mobile/#token=');
    expect(out).not.toContain(SECRET);
    expect(captured(errorSpy)).not.toContain(SECRET);
  });

  it('--json is pipeable and never includes the signing secret', async () => {
    process.env.JWT_SECRET = SECRET;
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync([
      'node',
      'buddy',
      'token',
      '--user',
      'demo',
      '--days',
      '1',
      '--url',
      'http://127.0.0.1:5601',
      '--json',
    ]);
    const payload = JSON.parse(captured(logSpy)) as {
      token: string;
      user: string;
      role: string;
      scopes: string[];
      expiresAt: string;
      url: string;
    };
    expect(payload.user).toBe('demo');
    expect(payload.role).toBe('user');
    expect(payload.url).toBe(
      `http://127.0.0.1:5601/__codebuddy__/mobile/#token=${encodeURIComponent(payload.token)}`,
    );
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());
    expect(verifyToken(payload.token, SECRET)?.sub).toBe('demo');
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(JSON.stringify(payload)).not.toMatch(/jwt_secret/i);
  });

  it('reads JWT_SECRET from --env without printing file values', async () => {
    const envFile = path.join(QA_WORK, 'service.env');
    writeFileSync(envFile, 'export JWT_SECRET="env-file-secret-not-real-32b!!!!"\nOTHER=keep-me-secret\n', 'utf8');
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'token', '--env', envFile, '--json', '--user', 'from-env']);
    const payload = JSON.parse(captured(logSpy)) as { token: string };
    expect(verifyToken(payload.token, 'env-file-secret-not-real-32b!!!!')?.sub).toBe('from-env');
    const dumped = captured(logSpy) + captured(errorSpy);
    expect(dumped).not.toContain('env-file-secret-not-real-32b!!!!');
    expect(dumped).not.toContain('keep-me-secret');
  });

  it('falls back to ~/.codebuddy/server.env under HOME when JWT_SECRET is unset', async () => {
    const dir = path.join(QA_HOME, '.codebuddy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'server.env'), 'JWT_SECRET=home-server-env-secret-not-real-32\n', 'utf8');
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'token', '--json', '--user', 'from-home']);
    const payload = JSON.parse(captured(logSpy)) as { token: string };
    expect(verifyToken(payload.token, 'home-server-env-secret-not-real-32')?.sub).toBe('from-home');
    expect(captured(logSpy) + captured(errorSpy)).not.toContain('home-server-env-secret-not-real-32');
    rmSync(path.join(dir, 'server.env'));
  });

  it('refuses a missing --env file', async () => {
    const missing = path.join(QA_WORK, 'no-such.env');
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'token', '--env', missing]);
    expect(process.exitCode).toBe(2);
    expect(captured(errorSpy)).toMatch(/introuvable|not found/i);
  });

  it('rejects --days outside 1–365', async () => {
    process.env.JWT_SECRET = SECRET;
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync(['node', 'buddy', 'token', '--days', '366']);
    expect(process.exitCode).toBe(2);
    expect(captured(errorSpy)).toMatch(/365/);
  });

  it('--role admin uses admin scopes; --ttl remains valid', async () => {
    process.env.JWT_SECRET = SECRET;
    const program = createProgram({ homedir: () => QA_HOME });
    await program.parseAsync([
      'node',
      'buddy',
      'token',
      '--role',
      'admin',
      '--ttl',
      '1h',
      '--json',
    ]);
    const payload = JSON.parse(captured(logSpy)) as { role: string; scopes: string[]; token: string };
    expect(payload.role).toBe('admin');
    expect(payload.scopes).toEqual([...TOKEN_ROLE_SCOPES.admin]);
    const verified = verifyToken(payload.token, SECRET);
    expect(verified?.scopes).toEqual(['admin']);
    expect((verified?.exp ?? 0) - (verified?.iat ?? 0)).toBe(3600);
  });

  it('--qr without qrencode tells the operator to install it', async () => {
    process.env.JWT_SECRET = SECRET;
    const spawn = vi.fn().mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      error: Object.assign(new Error('not found'), { code: 'ENOENT' }),
    });
    const program = createProgram({ homedir: () => QA_HOME, spawn });
    await program.parseAsync(['node', 'buddy', 'token', '--qr', '--url', 'http://127.0.0.1:5601']);
    expect(spawn).toHaveBeenCalled();
    expect(String(spawn.mock.calls[0]?.[0])).toBe('qrencode');
    expect(spawn.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['-t', 'ANSIUTF8']));
    expect(captured(errorSpy) + captured(logSpy)).toMatch(/qrencode/);
    expect(captured(errorSpy) + captured(logSpy)).not.toContain(SECRET);
  });

  it('--qr prints ANSI from qrencode stdout', async () => {
    process.env.JWT_SECRET = SECRET;
    const spawn = vi.fn().mockReturnValue({
      status: 0,
      stdout: '[QR-ANSI-FAKE]',
      stderr: '',
    });
    const program = createProgram({ homedir: () => QA_HOME, spawn });
    await program.parseAsync(['node', 'buddy', 'token', '--qr', '--url', 'http://127.0.0.1:5608']);
    expect(captured(logSpy)).toContain('[QR-ANSI-FAKE]');
    const encodedUrl = String(spawn.mock.calls[0]?.[1]?.[2] ?? '');
    expect(encodedUrl).toContain('http://127.0.0.1:5608/__codebuddy__/mobile/#token=');
  });
});

describe('token helpers', () => {
  it('parseServiceEnv strips export/quotes/comments', () => {
    const parsed = parseServiceEnv(
      '# comment\nexport JWT_SECRET="abc"\nCODEBUDDY_SERVER_URL=http://127.0.0.1:5601\n',
    );
    expect(parsed.JWT_SECRET).toBe('abc');
    expect(parsed.CODEBUDDY_SERVER_URL).toBe('http://127.0.0.1:5601');
  });

  it('buildMobileOpenUrl strips trailing slashes and puts the token in the hash', () => {
    expect(buildMobileOpenUrl('http://127.0.0.1:5601/', 'aaa.bbb.ccc')).toBe(
      'http://127.0.0.1:5601/__codebuddy__/mobile/#token=aaa.bbb.ccc',
    );
  });

  it('mintBuddyToken does not echo the secret when the env file is used', async () => {
    const result = await mintBuddyToken(
      { user: 'demo', days: 1, json: true, url: 'http://127.0.0.1:5601' },
      {
        env: { JWT_SECRET: SECRET },
        homedir: () => QA_HOME,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(os.homedir).toBeTypeOf('function');
  });
});
