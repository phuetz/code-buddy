import path from 'node:path';
import { createRequire } from 'node:module';
import { parseBashCommand } from '../security/bash-parser.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';
import type { TaskEvidenceEntry } from './headless-task-outcome.js';

const require = createRequire(import.meta.url);

/** A computed repository-output explanation needs more than a matching prefix.
 * Free prose cannot be certified by keyword presence. Accept a bounded report
 * of literal source observations and an actual entry execution instead. The
 * provider must produce it; the host never substitutes an answer.
 */
export function checkSourceOutputReport(
  query: string, body: string, files: ReadonlyMap<string, string>, entries: readonly TaskEvidenceEntry[],
): { reasons: string[]; guidance: string } | undefined {
  const text = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const runtimeOutput = /\b(?:stdout|printed|prints?|imprime|imprimee)\b/.test(text)
    || /\b(?:observed|computed|actual|standard)\s+output\b|\boutput\s+(?:of|from|computed)\b/.test(text)
    || /\b(?:explain|report|show|describe|trace|determine)\s+(?:(?:the|its)\s+)?output\b/.test(text);
  if (!runtimeOutput
    || !/\.[cm]?[jt]s\b|package\.json|\b(?:manifest|repository|checked-in|current source|these files|fichiers)\b/.test(text)) return undefined;
  const guidance = 'For a computed repository-output explanation, run the entry file, then read the project instructions, its complete source and local dependencies. After the required project prefix, return only JSON: {"sources":[{"path":"relative file","content":"exact complete observed source text"}],"stdout":"exact observed stdout"}. Include the manifest first if it declares the entry, then the entry and its dependencies in import order. Do not add prose or inferred facts.';
  const reject = () => ({ reasons: ['source_output_unverified'], guidance });
  let entry = query.match(/(?:[\w.-]+\/)*[\w.-]+\.[cm]?[jt]s\b/)?.[0];
  const sources: Array<{ path: string; content: string }> = [];
  if (!entry) {
    const manifest = files.get('package.json');
    if (manifest === undefined) return reject();
    try { entry = (JSON.parse(manifest) as { main?: string }).main; } catch { return reject(); }
    if (typeof entry !== 'string') return reject();
    sources.push({ path: 'package.json', content: manifest });
  }
  entry = path.posix.normalize(entry);
  if (path.posix.isAbsolute(entry) || entry.startsWith('../')) return reject();
  // TypeScript is loaded only for this bounded source-report verification.
  const ts = require('typescript') as typeof import('typescript');
  const seen = new Set<string>();
  const visit = (file: string): boolean => {
    if (seen.has(file)) return true;
    if (seen.size >= 32 || file.startsWith('../') || path.posix.isAbsolute(file)) return false;
    const content = files.get(file);
    if (content === undefined) return false;
    seen.add(file); sources.push({ path: file, content });
    const tree = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const dependencies: string[] = [];
    let supported = true;
    const walk = (node: import('typescript').Node): void => {
      let specifier: import('typescript').Node | undefined;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        specifier = node.arguments[0];
        if (!specifier) supported = false;
      }
      if (specifier) {
        if (!ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) supported = false;
        else dependencies.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.text)));
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
    return supported && dependencies.every(visit);
  };
  if (!visit(entry)) return reject();
  let stdout: string | undefined;
  for (const item of entries) {
    if (item.type !== 'tool_result' || !item.toolCall) continue;
    const tool = TOOL_ALIASES[item.toolCall.function.name] ?? item.toolCall.function.name;
    if (tool !== 'bash') {
      if (!['view_file', 'list_directory', 'search', 'tool_search', 'restore_context'].includes(tool)) stdout = undefined;
      continue;
    }
    const shell = item.toolResult?.metadata?.shellExecution as { command?: string; cwd?: string } | undefined;
    if (!item.toolResult?.success || !shell?.command || !shell.cwd || /[$`<>;&|\n]/.test(shell.command)) {
      stdout = undefined; continue;
    }
    const parsed = parseBashCommand(shell.command);
    const command = parsed.commands[0];
    if (!parsed.warnings.length && parsed.commands.length === 1 && command
      && ['cat', 'ls', 'pwd', 'head', 'tail'].includes(command.command)) continue;
    stdout = undefined;
    if (parsed.warnings.length || parsed.commands.length !== 1 || command?.command !== 'node'
      || command.args.length !== 1 || command.args[0]!.startsWith('-')) continue;
    if (path.resolve(shell.cwd, command.args[0]!) !== path.resolve(process.cwd(), entry)) continue;
    stdout = item.toolResult.output;
  }
  if (stdout === undefined) return reject();
  let report: unknown;
  try { report = JSON.parse(body); } catch { return reject(); }
  // JSON permits formatting freedom, but no additional unverified assertions.
  if (!report || typeof report !== 'object' || Array.isArray(report)) return reject();
  const value = report as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || value.stdout !== stdout || !Array.isArray(value.sources)
    || value.sources.length !== sources.length) return reject();
  if (!sources.every((source, index) => {
    const observed = (value.sources as unknown[])[index];
    return observed !== null && typeof observed === 'object' && !Array.isArray(observed)
      && Object.keys(observed).length === 2 && (observed as Record<string, unknown>).path === source.path
      && (observed as Record<string, unknown>).content === source.content;
  })) return reject();
  return { reasons: [], guidance };
}
