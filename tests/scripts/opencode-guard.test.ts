import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const guard = fileURLToPath(new URL('../../scripts/opencode-guard.sh', import.meta.url));

function probe(candidates: string): number | null {
  return spawnSync('bash', ['-c', `
    source "$1"
    # BSD pgrep can include a shell whose command contains the search text.
    pgrep() { ${candidates}; }
    opencode_lane_running
  `, 'guard-test', guard], { encoding: 'utf8' }).status;
}

// This guard relies on POSIX ps/pgrep and runs only on the Linux host.
describe.skipIf(process.platform === 'win32')('OpenCode process guard', () => {
  it('ignores the guard shell and its parent', () => {
    expect(probe('printf "%s\\n" "$$" "$PPID"')).toBe(1);
  });
  it('blocks a different matching process even alongside ancestors', () => {
    expect(probe('printf "%s\\n" "$$" "$PPID" 999999999')).toBe(0);
  });
  it('allows an empty process list', () => {
    expect(probe('return 1')).toBe(1);
  });
});
