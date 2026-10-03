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
        ? ['-e', args.includes('audit')
          ? `const fs=require('node:fs');const root=JSON.parse(fs.readFileSync('package.json'));process.stdout.write(JSON.stringify({workspaces:root.workspaces,child:fs.existsSync('packages/child/package.json')?JSON.parse(fs.readFileSync('packages/child/package.json')):null}))`
          : args.includes('pack')
          ? `require('node:fs').writeFileSync('fixture-1.0.0.tgz','archive-sentinel');process.stderr.write('npm notice archive fixture\\nnpm notice done\\n');process.stdout.write(${JSON.stringify(args.includes('--json') ? JSON.stringify([{id:'fixture@1.0.0',filename:'fixture-1.0.0.tgz',size:16}]) : 'fixture-1.0.0.tgz\n')})`
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

it.skipIf(process.platform === 'win32').each([false, true])('annonce le chemin réel du paquet sans écraser un fichier existant (json=%s)', async (jsonOutput) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-pack-'));
  const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
  fs.mkdirSync(workspace); fs.mkdirSync(temporary);
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
  const broker = await startNpmRegistryBroker(workspace, temporary);
  try {
    const { execFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const execute = () => new Promise<{ error: ExecFileException | null; stdout: string; stderr: string }>(resolve => {
      execFile(process.execPath, [path.join(broker.directory, 'npm-client.mjs'), 'pack', 'fixture@1.0.0', jsonOutput ? '--json' : '--silent'],
        { encoding: 'utf8', cwd: workspace }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    const first = await execute();
    expect(first.error, first.stderr).toBeNull();
    const reported = jsonOutput ? JSON.parse(first.stdout)[0].filename : first.stdout.trim();
    const archive = path.join(temporary, 'fixture-1.0.0.tgz');
    expect(reported).toBe(archive);
    expect(fs.readFileSync(reported, 'utf8')).toBe('archive-sentinel');
    if (jsonOutput) expect(JSON.parse(first.stdout)[0]).toMatchObject({ id: 'fixture@1.0.0', size: 16 });
    expect(fs.readFileSync(archive, 'utf8')).toBe('archive-sentinel');
    fs.writeFileSync(archive, 'existing-file');
    expect((await execute()).error).toBeTruthy();
    expect(fs.readFileSync(archive, 'utf8')).toBe('existing-file');
    expect(fs.existsSync(path.join(workspace, 'fixture-1.0.0.tgz'))).toBe(false);
  } finally { await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('conserve les manifestes des workspaces dans l’entrée de l’audit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-workspace-'));
  const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
  fs.mkdirSync(path.join(workspace, 'packages/child'), { recursive: true }); fs.mkdirSync(temporary);
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(workspace, 'packages/child/package.json'), JSON.stringify({ name: 'fixture-child', version: '1.0.0', dependencies: { zod: '^3.25.0' }, scripts: { prepare: 'must-not-run' } }));
  fs.writeFileSync(path.join(workspace, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'packages/child': { name: 'fixture-child', version: '1.0.0' } } }));
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
  const broker = await startNpmRegistryBroker(workspace, temporary);
  try {
    const { execFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const text = await new Promise<string>((resolve, reject) => execFile(process.execPath,
      [path.join(broker.directory, 'npm-client.mjs'), 'audit', '--json'], { encoding: 'utf8' },
      (error, stdout) => error ? reject(error) : resolve(stdout)));
    expect(JSON.parse(text)).toEqual({ workspaces: ['packages/*'], child: { name: 'fixture-child', version: '1.0.0', dependencies: { zod: '^3.25.0' } } });
  } finally { await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});

// Root workspace globs are also input to the trusted npm process.
it.skipIf(process.platform === 'win32').each(['../outside', '/outside', 'packages/../../outside', 'packages\\..\\..\\outside'])('refuse le motif workspace extérieur %s avant le processus de registre', async (pattern) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-pattern-'));
  const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
  fs.mkdirSync(workspace); fs.mkdirSync(temporary);
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', workspaces: [pattern] }));
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
  const broker = await startNpmRegistryBroker(workspace, temporary);
  try {
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const mocked = await import('node:child_process');
    const before = vi.mocked(mocked.execFile).mock.calls.length;
    const result = await new Promise<{ error: ExecFileException | null; stderr: string }>(resolve => actual.execFile(process.execPath,
      [path.join(broker.directory, 'npm-client.mjs'), 'audit', '--json'], { encoding: 'utf8' },
      (error, _stdout, stderr) => resolve({ error, stderr })));
    expect(result.error).toBeTruthy();
    expect(result.stderr).toContain('Workspace patterns must stay inside');
    expect(vi.mocked(mocked.execFile).mock.calls).toHaveLength(before);
  } finally { await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('laisse le chemin du paquet après les notices dans un tube fusionné', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-pack-pipe-'));
  const workspace = path.join(root, 'workspace'); const temporary = path.join(root, 'tmp');
  fs.mkdirSync(workspace); fs.mkdirSync(temporary);
  fs.writeFileSync(path.join(workspace, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  vi.stubEnv('CODEBUDDY_SHELL_CAPABILITIES', 'npm-registry');
  const broker = await startNpmRegistryBroker(workspace, temporary);
  try {
    const { execFile } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const text = await new Promise<string>((resolve, reject) => {
      execFile('/bin/sh', ['-c', '"$1" "$2" pack fixture@1.0.0 2>&1 | tail -1', 'pack-test',
        process.execPath, path.join(broker.directory, 'npm-client.mjs')],
      { encoding: 'utf8', cwd: workspace }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    expect(text.trim()).toBe(path.join(temporary, 'fixture-1.0.0.tgz'));
    expect(fs.readFileSync(text.trim(), 'utf8')).toBe('archive-sentinel');
  } finally { await broker.close(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});
