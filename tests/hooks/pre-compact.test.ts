import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { UserHooksManager } from '../../src/hooks/user-hooks.js';
import { tmpdir as osTmpdirForTests } from 'node:os';
import { realpathSync as fsRealpathForTmp } from 'node:fs';

describe('COMPACT1 — user pre_compact hook contract', () => {
  it('does not run project commands at a synchronous boundary without human approval', () => {
    const workDir = fsRealpathForTmp(fs.mkdtempSync(path.join(osTmpdirForTests(), 'compact1-test-')));
    try {
      const script = path.join(workDir, 'stdin-hook.cjs');
      fs.writeFileSync(script, [
        "const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));",
        "process.stdout.write(`${input.reason}:${input.tokensBefore}`);",
      ].join('\n'));
      fs.mkdirSync(path.join(workDir, '.codebuddy'), { recursive: true });
      fs.writeFileSync(path.join(workDir, '.codebuddy', 'hooks.json'), JSON.stringify({
        hooks: {
          pre_compact: [{ type: 'command', command: `node ${script}` }],
        },
      }));

      const manager = new UserHooksManager(workDir);
      const preserved = manager.runPreCompact({
        reason: 'manual',
        tokensBefore: 123,
        messagesBefore: 8,
      });

      expect(preserved).toBeUndefined();
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
