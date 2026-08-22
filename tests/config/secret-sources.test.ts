/**
 * Pluggable secret sources (Hermes SecretSource parity) — real env/file
 * resolution, a custom registered source, and the 1Password `op://` notation
 * exercised against a REAL fake `op` binary on PATH (a shell script — the
 * exact execFile path production uses; only the binary's identity is faked,
 * since an honest live 1Password validation is account-gated).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getSecretSourceIds,
  registerSecretSource,
  resolveSecretRef,
  resolveSecretRefs,
} from '../../src/config/secret-ref.js';

let binDir: string;
const originalPath = process.env.PATH;

beforeAll(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-op-'));
  const fakeOp = path.join(binDir, 'op');
  fs.writeFileSync(
    fakeOp,
    '#!/bin/sh\nif [ "$1" = "read" ]; then echo "secret-for:$2"; else exit 64; fi\n',
    { mode: 0o755 },
  );
  process.env.PATH = `${binDir}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe('built-in sources', () => {
  it('resolves env and file refs (existing behaviour intact)', async () => {
    process.env.SECRET_SRC_TEST = 'valeur-env';
    const secretFile = path.join(binDir, 'token.txt');
    fs.writeFileSync(secretFile, '  token-fichier\n');
    expect(await resolveSecretRef('key=${env:SECRET_SRC_TEST}')).toBe('key=valeur-env');
    expect(await resolveSecretRef(`\${file:${secretFile}}`)).toBe('token-fichier');
    delete process.env.SECRET_SRC_TEST;
  });

  it('lists the built-in source ids including op', () => {
    const ids = getSecretSourceIds();
    for (const id of ['env', 'file', 'exec', 'op']) expect(ids).toContain(id);
  });
});

// The fake `op` binary is a POSIX shell script (shebang + chmod) — not runnable on Windows.
const opSkipped = process.platform === 'win32';

describe.skipIf(opSkipped)('1Password op:// notation', () => {
  it('resolves a whole-value op:// ref through the op CLI', async () => {
    expect(await resolveSecretRef('op://vault/item/field')).toBe('secret-for:op://vault/item/field');
  });

  it('resolves the ${op:...} token form', async () => {
    expect(await resolveSecretRef('token=${op:vault/api/key}')).toBe('token=secret-for:op://vault/api/key');
  });
});

describe('pluggable sources', () => {
  it('a registered custom source resolves its own scheme', async () => {
    registerSecretSource({
      id: 'vault-test',
      resolve: async (ref) => `from-vault:${ref}`,
    });
    expect(await resolveSecretRef('pwd=${vault-test:db/main}')).toBe('pwd=from-vault:db/main');
  });

  it.skipIf(opSkipped)('deep object resolution walks nested values', async () => {
    const resolved = await resolveSecretRefs({
      plain: 42,
      nested: { secret: 'op://v/i/f', list: ['${vault-test:x}'] },
    });
    expect(resolved).toEqual({
      plain: 42,
      nested: { secret: 'secret-for:op://v/i/f', list: ['from-vault:x'] },
    });
  });
});
