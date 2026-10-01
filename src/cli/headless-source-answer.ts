import path from 'node:path';
import { scrubSecrets } from '../security/secret-scrubber.js';
import { requestsRepositoryAction, type TaskEvidenceEntry } from './headless-task-outcome.js';

function normalized(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'")
    .toLowerCase();
}

export function isEntryExplanation(query: string): boolean {
  return (
    !requestsRepositoryAction(query) &&
    /\bentry\s*points?\b|\bpoint\s+d['’]?\s*entr[ée]e\b/i.test(query)
  );
}

/** Enforce a bounded literal project output contract, never a model guess.
 * Independently written: OpenClaw bootstrap rules inspired the priority;
 * Hermes verification-stop inspired the host-side acceptance boundary.
 */
export function exactProjectAnswer(query: string, system: string): string | undefined {
  if (requestsRepositoryAction(query)) return undefined;
  const digest = system.match(/<project_rules>([\s\S]*?)<\/project_rules>/)?.[1];
  if (!digest) return undefined;
  let answer: string | undefined;
  for (const rule of digest.split('\n')) {
    const match = rule.match(
      /^(?:Pour toute question sur|For (?:any|every) question about)\s+(.+?),\s*(?:réponds exactement|reply exactly|respond exactly)\s+([A-Za-z0-9_-]{1,160}),\s*(?:sans autre texte|with no other text)\.?$/i
    );
    if (!match) continue;
    const subject = normalized(match[1]!)
      .split(/\W+/)
      .filter((word) => word.length > 2 && !['the', 'sur', 'about'].includes(word));
    const words = new Set(normalized(query).split(/\W+/));
    if (
      subject.length &&
      subject.every((word) => words.has(word)) &&
      scrubSecrets(match[2]!) === match[2]
    )
      answer = match[2];
  }
  return answer;
}

function observedFile(entries: readonly TaskEvidenceEntry[], file: string): string | undefined {
  for (const entry of [...entries].reverse()) {
    if (
      entry.type !== 'tool_result' ||
      !entry.toolResult?.success ||
      entry.toolCall?.function.name !== 'view_file'
    )
      continue;
    try {
      const args = JSON.parse(entry.toolCall.function.arguments) as {
        path?: string;
        start_line?: number;
      };
      if (
        !args.path ||
        path
          .relative(process.cwd(), path.resolve(process.cwd(), args.path))
          .replaceAll('\\', '/') !== file ||
        (args.start_line ?? 1) !== 1
      )
        continue;
      const numbered = (entry.toolResult.output ?? entry.content)
        .split('\n')
        .filter((line) => /^\d+: /.test(line));
      if (!numbered.length || !numbered[0]!.startsWith('1: ')) continue;
      return numbered.map((line) => line.replace(/^\d+: /, '')).join('\n');
    } catch {
      /* A malformed tool call supplies no source evidence. */
    }
  }
  return undefined;
}

/** A compact entry explanation consists only of independently attested facts.
 * Never publish the model's inferred purpose or an unobserved return value.
 * Source parsing is lazy and applies only to this narrow informational request.
 */
export async function groundedEntryAnswer(
  query: string,
  entries: readonly TaskEvidenceEntry[]
): Promise<string | undefined> {
  if (!isEntryExplanation(query)) return undefined;
  const manifest = observedFile(entries, 'package.json');
  if (!manifest) return undefined;
  let main: string;
  let declared: string;
  try {
    const parsed = JSON.parse(manifest) as { main?: unknown };
    if (typeof parsed.main !== 'string') return undefined;
    const normalizedMain = path.posix.normalize(parsed.main);
    if (
      normalizedMain.startsWith('../') ||
      !/^(?:[\w-]+\/)*[\w.-]+\.(?:[cm]?[jt]sx?)$/.test(normalizedMain)
    )
      return undefined;
    main = normalizedMain;
    declared = parsed.main;
  } catch {
    return undefined;
  }
  const source = observedFile(entries, main);
  if (source === undefined) return undefined;
  const ts = await import('typescript');
  const tree = ts.createSourceFile(main, source, ts.ScriptTarget.Latest, true);
  const french = /\b(?:explique|point)\b/i.test(query);
  const lines = [
    french
      ? `Le champ \`main\` de package.json déclare \`${declared}\`.`
      : `The \`main\` field in package.json declares \`${declared}\`.`,
  ];
  const label = french ? 'Appel observé' : 'Observed call';
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement)) {
      const line = tree.getLineAndCharacterOfPosition(statement.getStart(tree)).line + 1;
      lines.push(
        `${french ? 'Import observé' : 'Observed import'} (${main}:${line}) : \`${statement.getText(tree)}\`.`
      );
    }
    const visit = (node: import('typescript').Node): void => {
      // Calls inside function bodies are conditional behavior, not entry actions.
      if (ts.isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        lines.push(`${label} (${main}:${line}) : \`${node.getText(tree)}\`.`);
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
  }
  return scrubSecrets(lines.join('\n'));
}
