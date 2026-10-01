import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureShellExecution } from '../../src/cli/shell-execution-evidence.js';

describe('shell project script evidence', () => {
  it('keeps a snapshot of the executed project script, including a literal quoted cd', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shell project '));
    try {
      const file = path.join(directory, 'package.json');
      writeFileSync(file, JSON.stringify({ scripts: { test: 'node --test first.test.js' } }));
      const first = captureShellExecution(`cd "${directory}" && npm test`, tmpdir());
      writeFileSync(file, JSON.stringify({ scripts: { test: 'node --test second.test.js' } }));
      expect(first.testScript).toBe('node --test first.test.js');
      expect(captureShellExecution('npm test', directory).testScript).toBe('node --test second.test.js');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it.each(['pretest', 'posttest'])('does not reduce a lifecycle with %s to its node command', lifecycle => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shell-lifecycle-'));
    try {
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'node --test math.test.js', [lifecycle]: 'node required-check.js' } }));
      expect(captureShellExecution('npm test', directory).testScript).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
