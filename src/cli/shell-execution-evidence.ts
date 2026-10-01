import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseBashCommand } from '../security/bash-parser.js';

/** Host-side evidence, captured before execution; never supplied by tool arguments. */
export interface ShellExecutionEvidence {
  command: string;
  cwd: string;
  testScript?: string;
  editFiles?: Array<{ file: string; sha256: string }>;
  changedFiles?: string[];
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
  const scope = shellCheckScope(command);
  if (!/[$`<>\n]/.test(scope.body)) {
    const parsed = parseBashCommand(scope.body);
    if (!parsed.warnings.length) {
      const edits = parsed.commands.filter(part => !part.isSubshell && part.command === 'sed' && part.args[0] === '-i')
        .flatMap(part => part.args.slice(2)).filter(file => !file.startsWith('-'))
        .map(file => path.resolve(scope.directory ?? cwd, file))
        .flatMap(file => { const sha256 = fileDigest(file); return sha256 ? [{ file, sha256 }] : []; });
      if (edits.length) evidence.editFiles = edits;
    }
  }
  return evidence;
}

function fileDigest(file: string): string | undefined {
  try {
    const stat = statSync(file);
    if (stat.isFile() && stat.size <= 4 * 1024 * 1024) return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch { /* An unreadable file supplies no change evidence. */ }
  return undefined;
}

/** A successful sed status alone does not prove that any byte was edited. */
export function completeShellExecution(evidence: ShellExecutionEvidence): ShellExecutionEvidence {
  const { editFiles, ...record } = evidence;
  return { ...record, ...(editFiles ? { changedFiles: editFiles.filter(before => {
    const after = fileDigest(before.file);
    return after !== undefined && after !== before.sha256;
  }).map(before => before.file) } : {}) };
}
