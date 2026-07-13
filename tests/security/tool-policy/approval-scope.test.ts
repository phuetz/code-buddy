import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildToolApprovalKey,
  toolArgsApprovalPreview,
} from '../../../src/security/tool-policy/approval-scope.js';

describe('exact tool approval scopes', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is stable across object key order but changes with tool, args, or cwd', () => {
    const firstCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-approval-a-'));
    const secondCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-approval-b-'));
    tempDirs.push(firstCwd, secondCwd);
    const first = buildToolApprovalKey(
      'browser_click',
      { selector: '#publish', nested: { z: 1, a: 2 } },
      firstCwd,
    );
    const reordered = buildToolApprovalKey(
      'browser_click',
      { nested: { a: 2, z: 1 }, selector: '#publish' },
      firstCwd,
    );

    expect(reordered).toBe(first);
    expect(buildToolApprovalKey('browser_click', { selector: '#delete' }, firstCwd)).not.toBe(first);
    expect(buildToolApprovalKey('browser_type', { selector: '#publish' }, firstCwd)).not.toBe(first);
    expect(buildToolApprovalKey('browser_click', { selector: '#publish', nested: { z: 1, a: 2 } }, secondCwd)).not.toBe(first);
    expect(first).toMatch(/^tool-action:[a-f0-9]{64}$/);
  });

  it('redacts secret-shaped fields and bounds long dialog values', () => {
    const preview = toolArgsApprovalPreview({
      apiKey: 'should-never-appear',
      nested: { authorization: 'Bearer secret' },
      content: 'x'.repeat(800),
    });

    expect(preview).not.toContain('should-never-appear');
    expect(preview).not.toContain('Bearer secret');
    expect(preview).toContain('[REDACTED]');
    expect(preview).toContain('[800 chars]');
  });
});
