import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectCoreCode } from '../../src/tools/core-code-inspection.js';
import type { CoreRootResolution } from '../../src/identity/operational-self-model.js';

let root: string;
let core: CoreRootResolution;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-core-reader-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/theme.ts'), 'export const theme = "matrix";\nnotifyChange();\n');
  core = { root, layout: 'source', package: { name: '@phuetz/code-buddy', version: '2.0.0', description: '' } };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('attested core inspection', () => {
  it('returns actual implementation text and numbered search evidence', () => {
    expect(inspectCoreCode(core, { operation: 'read', path: 'src/theme.ts', line: 2 })).toMatchObject({
      path: 'src/theme.ts', line: 2, content: '2: notifyChange();\n3: ',
    });
    expect(inspectCoreCode(core, { operation: 'search', query: 'notifyChange' })).toMatchObject({
      matches: [{ path: 'src/theme.ts', line: 2, text: 'notifyChange();' }],
    });
  });

  it.each(['../secret.ts', '/etc/passwd', 'src/../../secret.ts', 'src/.private.ts', 'src\\theme.ts', 'package.json'])(
    'rejects unconfined or nonimplementation paths: %s', requested => {
      expect(() => inspectCoreCode(core, { operation: 'read', path: requested })).toThrow();
    },
  );

  it('rejects a symlink to files outside implementation directories', () => {
    fs.writeFileSync(path.join(root, 'private.ts'), 'secret');
    fs.symlinkSync(path.join(root, 'private.ts'), path.join(root, 'src/link.ts'));
    expect(() => inspectCoreCode(core, { operation: 'read', path: 'src/link.ts' })).toThrow('escapes');
    expect(inspectCoreCode(core, { operation: 'search', query: 'secret' })).toMatchObject({ matches: [] });
  });

  it('allows continuing a directory listing beyond the first 100 entries', () => {
    for (let i = 0; i < 120; i++) fs.mkdirSync(path.join(root, 'src', `module-${String(i).padStart(3, '0')}`));
    const first = inspectCoreCode(core, { operation: 'list' });
    const next = inspectCoreCode(core, { operation: 'list', offset: 100 });
    expect(first).toMatchObject({ nextOffset: 100, totalEntries: 121, truncated: true });
    expect(next).toMatchObject({ nextOffset: null, totalEntries: 121, truncated: false });
    expect('entries' in first && first.entries).toHaveLength(100);
    expect('entries' in next && next.entries).toHaveLength(21);
    expect(() => inspectCoreCode(core, { operation: 'list', offset: -1 })).toThrow('non-negative');
  });

  it('bounds reads and refuses unknown roots or oversized files', () => {
    fs.writeFileSync(path.join(root, 'src/long.ts'), Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'));
    const result = inspectCoreCode(core, { operation: 'read', path: 'src/long.ts' });
    expect(result).toMatchObject({ truncated: true });
    expect('content' in result && result.content?.split('\n')).toHaveLength(120);
    expect(() => inspectCoreCode({ ...core, layout: 'unknown' }, { operation: 'list' })).toThrow('not attested');
    fs.writeFileSync(path.join(root, 'src/huge.ts'), 'x'.repeat(512 * 1024 + 1));
    expect(() => inspectCoreCode(core, { operation: 'read', path: 'src/huge.ts' })).toThrow('512 KiB');
  });
});
