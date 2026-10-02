import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveNpmLockOffline } from '../../src/sandbox/npm-offline-resolution.js';

describe.skipIf(process.platform !== 'linux')('Grok R3: le runtime Node ne donne pas son répertoire parent', () => {
  it('le npm confiné ne voit pas un fichier voisin du préfixe Node', async () => {
    const fixtures = path.join(process.cwd(), '_qa');
    fs.mkdirSync(fixtures, { recursive: true });
    const root = fs.mkdtempSync(path.join(fixtures, 'npm-node-prefix-'));
    const homeLike = path.join(root, 'installation');
    const binary = path.join(homeLike, 'bin', 'node');
    const npmRoot = path.join(homeLike, 'lib', 'node_modules', 'npm');
    const cli = path.join(npmRoot, 'bin', 'npm-cli.js');
    const scratch = path.join(root, 'scratch');
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.mkdirSync(scratch);
    fs.copyFileSync(process.execPath, binary); fs.chmodSync(binary, 0o755);
    fs.writeFileSync(path.join(npmRoot, 'package.json'), '{"name":"npm"}');
    const adjacent = path.join(homeLike, 'private-marker');
    fs.writeFileSync(adjacent, 'outside the granted runtime');
    fs.writeFileSync(cli, `const fs=require('node:fs'); console.log(fs.existsSync(${JSON.stringify(adjacent)})); fs.writeFileSync('package-lock.json', '{"lockfileVersion":3,"packages":{}}');`);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'execPath')!;
    Object.defineProperty(process, 'execPath', { ...descriptor, value: binary });
    try {
      const result = await resolveNpmLockOffline(scratch, cli, [], new AbortController().signal);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('false');
    } finally {
      Object.defineProperty(process, 'execPath', descriptor);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
