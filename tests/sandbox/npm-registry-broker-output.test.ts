import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExecFileOptionsWithStringEncoding, ExecFileException } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((file: string, args: string[], options: ExecFileOptionsWithStringEncoding,
      callback: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      // Replay a registry response without a network dependency. Both the trusted
      // runner and generated client remain real child processes with real pipes.
      const command = args.includes('--registry=https://registry.npmjs.org')
        ? ['-e', args.includes('pack')
          ? `require('node:fs').writeFileSync('fixture-1.0.0.tgz','archive-sentinel');process.stdout.write('fixture-1.0.0.tgz\\n')`
          : `process.stdout.write(JSON.stringify({metadata:'réponse'.repeat(200000)}))`]
        : args;
      return actual.execFile(file, command, options, callback);
    }),
  };
});

import { startNpmRegistryBroker } from '../../src/sandbox/npm-registry-broker.js';

describe('sortie de la passerelle npm révélée par le replay B', () => {
  it.skipIf(process.platform === 'win32')('vide une sortie JSON de plus de 1 Mo sans couper le tube à 64 Ko', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-output-'));
    const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
    fs.mkdirSync(workspace); fs.mkdirSync(temporary);
    fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
    const broker = await startNpmRegistryBroker(workspace, temporary);
    try {
      // Async subprocess: the parent must keep serving the awaited Unix request.
      const { execFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      const text = await new Promise<string>((resolve, reject) => {
        execFile(process.execPath, [path.join(broker.directory, 'npm-client.mjs'), 'view', 'fixture', '--json'],
          { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
      });
      const expected = JSON.stringify({ metadata: 'réponse'.repeat(200000) });
      expect(text).toHaveLength(expected.length);
      expect(JSON.parse(text)).toEqual(JSON.parse(expected));
    } finally {
      await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

it.skipIf(process.platform === 'win32')('garde le paquet du registre dans le temporaire sans écraser un fichier existant', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-pack-'));
  const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
  fs.mkdirSync(workspace); fs.mkdirSync(temporary);
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
  const broker = await startNpmRegistryBroker(workspace, temporary);
  try {
    const { execFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const execute = () => new Promise<{ error: ExecFileException | null; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [path.join(broker.directory, 'npm-client.mjs'), 'pack', 'fixture@1.0.0', '--silent'],
        { encoding: 'utf8' }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    const first = await execute();
    expect(first.error, first.stderr).toBeNull();
    expect(first.stdout.trim()).toBe('fixture-1.0.0.tgz');
    const archive = path.join(temporary, 'fixture-1.0.0.tgz');
    expect(fs.readFileSync(archive, 'utf8')).toBe('archive-sentinel');
    fs.writeFileSync(archive, 'existing-file');
    expect((await execute()).error).toBeTruthy();
    expect(fs.readFileSync(archive, 'utf8')).toBe('existing-file');
    expect(fs.existsSync(path.join(workspace, 'fixture-1.0.0.tgz'))).toBe(false);
  } finally { await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});
