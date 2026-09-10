import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDevicesCommand, createPairCommand } from '../../src/commands/device-auth.js';
import type { SpawnSyncFn } from '../../src/commands/token.js';
import { DeviceAuthStore } from '../../src/server/auth/device-store.js';

const root = resolve('_qa/device-auth/cli');
mkdirSync(root, { recursive: true });

describe('buddy pair / buddy devices', () => {
  let store: DeviceAuthStore;
  let program: Command;
  let output: ReturnType<typeof vi.spyOn>;
  let errors: ReturnType<typeof vi.spyOn>;
  let exit: typeof process.exitCode;
  const spawn = vi.fn<SpawnSyncFn>(() => ({ status: 0, stdout: '\u001b[47mQR\u001b[0m', stderr: '' }));
  beforeEach(() => {
    store = new DeviceAuthStore(join(mkdtempSync(join(root, 'case-')), 'devices.json'), Date.now, vi.fn());
    exit = process.exitCode;
    process.exitCode = undefined;
    spawn.mockClear();
    output = vi.spyOn(console, 'log').mockImplementation(() => {});
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    program = new Command().exitOverride();
    program.addCommand(createPairCommand({ store, env: {}, spawn }));
    program.addCommand(createDevicesCommand({ store }));
  });
  afterEach(() => {
    process.exitCode = exit;
    vi.restoreAllMocks();
  });
  const run = (args: string[]) => program.parseAsync(['node', 'buddy', ...args]);
  const printed = () => output.mock.calls.map(args => args.join(' ')).join('\n');

  it('prints a single-use code and an ANSI QR containing exactly the agreed JSON payload', async () => {
    await run(['pair', '--url', 'https://buddy.example.test/']);
    const payload = JSON.parse(spawn.mock.calls[0][1][2]);
    expect(payload).toEqual({ url: 'https://buddy.example.test', pairingCode: expect.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/) });
    expect(spawn.mock.calls[0]).toEqual([
      'qrencode', ['-t', 'ANSIUTF8', JSON.stringify(payload)],
      { encoding: 'utf8', timeout: 4000, windowsHide: true },
    ]);
    expect(printed()).toContain(`Pairing code: ${payload.pairingCode}`);
    expect(printed()).toContain('\u001b[47mQR\u001b[0m');
    expect(printed()).toContain('10 minutes, one use');
    expect(readFileSync(store.file, 'utf8')).not.toContain(payload.pairingCode);
    expect(errors).not.toHaveBeenCalled();
  });

  it('supports JSON output without requiring a JWT signing secret or network request', async () => {
    await run(['pair', '--json']);
    const payload = JSON.parse(printed());
    expect(payload.url).toBe('http://127.0.0.1:3000');
    expect(payload.pairingCode).toHaveLength(8);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('lists, renames and revokes a persisted real public key', async () => {
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await webcrypto.subtle.exportKey('jwk', keys.publicKey);
    const { deviceId } = await store.register(store.createPairing().pairingCode, 'Original', jwk);
    await run(['devices', 'list', '--json']);
    expect(JSON.parse(printed())).toEqual([{ deviceId, deviceName: 'Original', createdAt: expect.any(String), updatedAt: expect.any(String) }]);
    output.mockClear();
    await run(['devices', 'rename', deviceId, 'New name']);
    expect(printed()).toBe('Device renamed');
    expect(store.list()[0].deviceName).toBe('New name');
    output.mockClear();
    await run(['devices', 'revoke', deviceId]);
    expect(printed()).toBe('Device revoked');
    expect(new DeviceAuthStore(store.file, Date.now, vi.fn()).isActive(deviceId)).toBe(false);
  });

  it.each(['revoke', 'rename'])('reports an unknown id generically for %s', async command => {
    await run(['devices', command, 'unknown-sensitive-input', ...(command === 'rename' ? ['Name'] : [])]);
    expect(process.exitCode).toBe(1);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('unknown-sensitive-input');
  });

  it('rejects server URLs containing credentials before issuing a code', async () => {
    await run(['pair', '--url', 'https://user:private@buddy.example.test']);
    expect(process.exitCode).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(errors.mock.calls.flat().join(' ')).not.toContain('private');
    expect(store.list()).toEqual([]);
  });

  it('keeps the code usable and explains how to install qrencode when unavailable', async () => {
    program = new Command().exitOverride().addCommand(createPairCommand({
      store, env: {}, spawn: () => ({ status: 127, stdout: '', stderr: '' }),
    }));
    await run(['pair']);
    expect(printed()).toContain('Pairing code:');
    expect(errors.mock.calls.flat().join(' ')).toContain('qrencode');
  });
});
