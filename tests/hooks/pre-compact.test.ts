import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { UserHooksManager } from '../../src/hooks/user-hooks.js';

describe('COMPACT1 — user pre_compact hook contract', () => {
  it('uses the existing hooks.json command format and sends JSON on stdin', () => {
    const workDir = fs.mkdtempSync(path.join(process.cwd(), '.compact1-test-'));
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

      expect(preserved).toBe('manual:123');
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
