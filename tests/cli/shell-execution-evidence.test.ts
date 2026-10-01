import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as shellParser from '../../src/security/bash-parser.js';
import { captureShellExecution, completeShellExecution } from '../../src/cli/shell-execution-evidence.js';

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
  it('distinguishes an observed edit from sed success without byte changes', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shell-edit-'));
    try {
      const file = path.join(directory, 'greet.js');
      writeFileSync(file, 'Bonjour');
      const unchanged = captureShellExecution("sed -i 's/ABSENT/Salut/' greet.js", directory);
      expect(completeShellExecution(unchanged).changedFiles).toEqual([]);
      const edited = captureShellExecution("sed -i 's/Bonjour/Salut/' greet.js", directory);
      writeFileSync(file, 'Salut');
      expect(completeShellExecution(edited).changedFiles).toEqual([file]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('captures a literal sed target even when native argument extraction omits raw_string', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shell-native-edit-'));
    const parsed = vi.spyOn(shellParser, 'parseBashCommand').mockReturnValue({ commands: [{ command: 'sed', args: ['-i', 'greet.js'], raw: "sed -i 's/Bonjour/Salut/' greet.js", connector: null, isSubshell: false }], warnings: [], usedTreeSitter: true });
    try {
      const file = path.join(directory, 'greet.js');
      writeFileSync(file, 'Bonjour');
      const before = captureShellExecution("sed -i 's/Bonjour/Salut/' greet.js", directory);
      writeFileSync(file, 'Salut');
      expect(completeShellExecution(before).changedFiles).toEqual([file]);
    } finally { parsed.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
  });
  it.each(['pretest', 'posttest'])('does not reduce a lifecycle with %s to its node command', lifecycle => {
    const directory = mkdtempSync(path.join(tmpdir(), 'shell-lifecycle-'));
    try {
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'node --test math.test.js', [lifecycle]: 'node required-check.js' } }));
      expect(captureShellExecution('npm test', directory).testScript).toBeUndefined();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
