import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { confineAllowlistedWrite, lookupMcpWriteAllowlist } from '../../src/mcp/mcp-write-allowlist.js';
it('resolves edit destinations from the current subdirectory while retaining the fixed project boundary', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'headless-write-scope-'));
  const cwd = path.join(root, 'sub'); mkdirSync(cwd);
  try {
    const editor = lookupMcpWriteAllowlist('str_replace_editor')!;
    expect(await confineAllowlistedWrite(root, { path: '../value.js' }, editor, cwd)).toBeNull();
    expect(await confineAllowlistedWrite(root, { path: '../../outside.js' }, editor, cwd)).toMatch(/outside workspace/);
    const patch = lookupMcpWriteAllowlist('apply_patch')!;
    expect(await confineAllowlistedWrite(root, { patch: '*** Begin Patch\n*** Add File: ../new.js\n+export {};\n*** End Patch' }, patch, cwd)).toBeNull();
    expect(await confineAllowlistedWrite(root, { patch: '*** Begin Patch\n*** Update File: value.js\n*** Move to: ../../outside.js\n@@\n-old\n+new\n*** End Patch' }, patch, cwd)).toMatch(/outside workspace/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
