import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Host-side evidence, captured before execution; never supplied by tool arguments. */
export interface ShellExecutionEvidence {
  command: string;
  cwd: string;
  testScript?: string;
}

/** A literal, absolute cd in a compound command affects that child shell only. */
export function shellCheckScope(command: string): { directory?: string; body: string } {
  const scoped = command.match(/^cd\s+(\/[^\s;&|<>$`'"\\]+|"\/[^"$`\\]+"|'\/[^'\\]+')\s*&&\s*(.+)$/);
  return scoped ? { directory: scoped[1]!.replace(/^['"]|['"]$/g, ''), body: scoped[2]! } : { body: command };
}

export function captureShellExecution(command: string, cwd: string): ShellExecutionEvidence {
  const evidence: ShellExecutionEvidence = { command, cwd };
  // npm/yarn's project default can match a direct invocation only when there
  // are no lifecycle hooks. Record the script actually present at this call,
  // rather than reading a package file retroactively after an agent edit.
  try {
    const scripts: unknown = JSON.parse(readFileSync(path.join(shellCheckScope(command).directory ?? cwd, 'package.json'), 'utf8')).scripts;
    if (scripts && typeof scripts === 'object') {
      const values = scripts as Record<string, unknown>;
      if (typeof values.test === 'string' && values.pretest === undefined && values.posttest === undefined) {
        evidence.testScript = values.test;
      }
    }
  } catch { /* No package script is evidence of nothing. */ }
  return evidence;
}
