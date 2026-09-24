/**
 * workDir under the host temporary directory must stay visible inside bwrap.
 * A --tmpfs /tmp applied after the bind hides it and chdir fails.
 * Both bubblewrap and landlock+seccomp build that argv.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OSSandbox, type SandboxBackend } from '../../src/sandbox/os-sandbox.js';
import { probeNativeSandbox } from './native-sandbox-ready.js';

const nativeSandbox = await probeNativeSandbox();
const bwrapReady = nativeSandbox.bubblewrap.ok;
const landlockReady = nativeSandbox.landlock.ok;
const disposables: string[] = [];

function show(backend: string, present: boolean, exitCode: number, stderr: string): void {
  const line = `ASSERT tmpdir-${backend} fichier=${present ? 'PRESENT' : 'ABSENT'} exit=${exitCode} stderr=${JSON.stringify(stderr)}`;
  console.log(line);
  const outDir = process.env.MCP_BASH_OUT;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `tmpdir-${backend}.json`), JSON.stringify({
      line, present, exitCode, stderr,
    }, null, 2));
  }
}

async function writeInside(backend: Extract<SandboxBackend, 'bubblewrap' | 'landlock'>): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `bwrap-order-${backend}-`));
  disposables.push(workDir);
  const sandbox = new OSSandbox({
    backend,
    workDir,
    readOnlyPaths: ['/usr', '/lib', '/lib64', '/bin', '/sbin'],
    readWritePaths: [],
    allowNetwork: false,
    timeout: 20000,
  });
  const result = await sandbox.exec('/bin/sh', ['-c', "printf '%s\\n' ok > cible.txt"]);
  const target = path.join(workDir, 'cible.txt');
  const present = fs.existsSync(target);
  show(backend, present, result.exitCode, result.stderr);
  expect(present, `ASSERT tmpdir-${backend} fichier present`).toBe(true);
  expect(result.exitCode, `ASSERT tmpdir-${backend} exit 0`).toBe(0);
  expect(fs.readFileSync(target, 'utf8'), `ASSERT tmpdir-${backend} contenu`).toBe('ok\n');
}

describe.sequential('bwrap garde visible un workDir sous /tmp', () => {
  afterEach(() => {
    for (const dir of disposables.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!bwrapReady)(
    `bubblewrap ecrit dans un workDir sous le tmp hote${bwrapReady ? '' : ` — ignore : ${nativeSandbox.bubblewrap.reason}`}`,
    async () => {
      await writeInside('bubblewrap');
    },
    30_000,
  );

  it.skipIf(!landlockReady)(
    `landlock et seccomp ecrivent dans un workDir sous le tmp hote${landlockReady ? '' : ` — ignore : ${nativeSandbox.landlock.reason}`}`,
    async () => {
      await writeInside('landlock');
    },
    30_000,
  );
});
