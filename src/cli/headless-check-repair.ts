// Legacy diagnostic helpers, retained for evidence regressions only.
// The agent loop does not call them: it neither authors checks nor final replies.
import path from 'node:path';
import { evaluateHeadlessTaskOutcome, type TaskEvidenceEntry } from './headless-task-outcome.js';

function ordinaryRepair(query: string): boolean {
  const intent = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return /^(?:please |s'il te plait )?(?:run|execute|lance|lancer) (?:the |les )?(?:project )?tests? (?:and|et|puis) (?:fix|repair|corrige|repare) (?:the |les )?(?:failures|errors|echecs|erreurs)[.!]?$/.test(
    intent
  );
}

/** Host-side completion inspired by Hermes' verification stop. No inferred success. */
export function completedCheckRepairAnswer(
  query: string,
  entries: readonly TaskEvidenceEntry[],
  cwd: string
): string | undefined {
  const intent = query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  // Complete only this bounded workflow; additional requested work must continue.
  if (!ordinaryRepair(query)) return undefined;
  if (!evaluateHeadlessTaskOutcome(query, entries).success) return undefined;
  const modified = new Set<string>();
  let lastEdit = -1;
  let verified = -1;
  for (const [index, entry] of entries.entries()) {
    if (entry.type !== 'tool_result' || !entry.toolResult?.success || !entry.toolCall) continue;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(entry.toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = entry.toolCall.function.name;
    const shell = entry.toolResult.metadata?.shellExecution as
      | { command?: string; cwd?: string; testScript?: string; changedFiles?: string[] }
      | undefined;
    const files: string[] = [];
    if (
      ['str_replace_editor', 'create_file'].includes(name) &&
      !['view', 'read'].includes(String(args.command))
    ) {
      const target = args.path ?? args.file_path;
      if (typeof target === 'string') files.push(target);
    }
    if (name === 'apply_patch')
      for (const match of String(args.patch ?? args.input ?? '').matchAll(
        /\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/g
      ))
        files.push(match[1]!.trim());
    if (name === 'bash' && Array.isArray(shell?.changedFiles)) files.push(...shell.changedFiles);
    for (const file of files) {
      const relative = path.relative(cwd, path.resolve(cwd, file));
      // Changing the checks is not evidence that the implementation was repaired.
      if (
        /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.|(?:^|\/)(?:package\.json|.*lock.*|.*config.*)$/i.test(
          relative
        )
      )
        return undefined;
      modified.add(relative);
      lastEdit = index;
    }
    if (
      name === 'bash' &&
      shell?.cwd === cwd &&
      shell.testScript &&
      /^(?:npm (?:test|run test)|(?:pnpm|yarn|bun) test)(?:\s+2>&1)?$/.test(shell.command ?? '')
    )
      verified = index;
  }
  if (verified < 0 || verified < lastEdit) return undefined;
  const french = /\b(?:lance|lancer|corrige|repare)\b/.test(intent);
  return french
    ? `Le contrôle du projet a réussi.${modified.size ? ` Fichiers modifiés observés : ${[...modified].join(', ')}.` : ' Aucune modification nécessaire.'}`
    : `The project check passed.${modified.size ? ` Observed modified files: ${[...modified].join(', ')}.` : ' No modification was needed.'}`;
}

/** Schedule the observed default project script initially and after a source edit.
 * The caller submits this host-authored call to the normal tool execution loop:
 * permissions, confinement, cost limits and loop guards all still apply.
 */
export function projectCheckToRun(
  query: string,
  entries: readonly TaskEvidenceEntry[]
): string | undefined {
  if (!ordinaryRepair(query) || entries.some((entry) => entry.terminationReason || entry.truncated))
    return undefined;
  let hasScript = false;
  let pending = true;
  for (const entry of entries) {
    if (entry.type !== 'tool_result' || !entry.toolCall || !entry.toolResult) continue;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(entry.toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      continue;
    }
    const name = entry.toolCall.function.name;
    if (name === 'view_file' && args.path === 'package.json' && entry.toolResult.success) {
      try {
        const text = (entry.toolResult.output ?? entry.content)
          .split('\n')
          .filter((line) => /^\d+: /.test(line))
          .map((line) => line.replace(/^\d+: /, ''))
          .join('\n');
        const manifest = JSON.parse(text) as { scripts?: { test?: unknown } };
        hasScript = typeof manifest.scripts?.test === 'string' && !!manifest.scripts.test.trim();
      } catch {
        /* A partial manifest is not evidence of a runnable script. */
      }
    }
    if (
      ['str_replace_editor', 'create_file', 'apply_patch'].includes(name) &&
      entry.toolResult.success &&
      !['view', 'read'].includes(String(args.command))
    )
      pending = true;
    // One host check per observed edit; failed checks return to the model.
    if (name === 'bash' && /\b(?:test|tests|vitest|jest|pytest)\b/.test(String(args.command)))
      pending = false;
  }
  return hasScript && pending ? 'npm test' : undefined;
}
