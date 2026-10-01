export interface ReplacementEdit {
  old_string: string;
  new_string: string;
}

const OLD_KEYS = ['old_str', 'old_text', 'old_content', 'find', 'old_string', 'pattern', 'search', 'oldText'];
const NEW_KEYS = ['new_str', 'new_text', 'new_content', 'replace', 'new_string', 'replacement', 'replace_with', 'newText'];

function textAlias(input: Record<string, unknown>, keys: string[], label: string): string {
  const values = keys.map(key => input[key]).filter(value => value !== undefined && value !== null);
  if (!values.length || values.some(value => typeof value !== 'string')) throw new Error(`${label} must be a string`);
  if (new Set(values).size > 1) throw new Error(`Conflicting ${label} aliases; supply one literal replacement.`);
  return values[0] as string;
}

function parseTextualOperation(text: string): Record<string, unknown>[] {
  const shell = text.match(/^\[\s*(?:replace|replace_text|str_replace)\s*,([\s\S]*)\]\s*$/);
  if (!shell) throw new Error('operations must specify quoted literal before/after text, or a JSON replacement array.');
  const body = shell[1]!;
  const field = /\s*(\w+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,|$)/gy;
  const result: Record<string, unknown> = {};
  let cursor = 0;
  while (cursor < body.length) {
    field.lastIndex = cursor;
    const match = field.exec(body);
    if (!match || ![...OLD_KEYS, ...NEW_KEYS].includes(match[1]!)) throw new Error('operations accepts only quoted literal replacement fields; expressions are not evaluated.');
    if (result[match[1]!] !== undefined) throw new Error('Duplicate replacement field.');
    const quoted = match[2]!;
    result[match[1]!] = quoted.startsWith('"') ? JSON.parse(quoted)
      : quoted.slice(1, -1).replace(/\\([\\'"nrt])/g, (_match, char: string) => char === 'n' ? '\n' : char === 'r' ? '\r' : char === 't' ? '\t' : char);
    cursor = field.lastIndex;
  }
  return [result];
}

function parseTextualChanges(text: string): Record<string, unknown>[] {
  if (text.includes('\n@@ ')) {
    if ((text.match(/^\+\+\+ /gm) ?? []).length > 1) throw new Error('changes must describe one file.');
    const edits: Record<string, unknown>[] = [];
    let old: string[] | undefined;
    let next: string[] = [];
    const finish = () => { if (old) edits.push({ old_str: old.join('\n'), new_str: next.join('\n') }); };
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('@@ ')) { finish(); old = []; next = []; continue; }
      if (!old) continue;
      if (line === '' || line === '\\ No newline at end of file') continue;
      if (line.startsWith('--- ') || line.startsWith('+++ ')) throw new Error('changes must describe one file.');
      if (line.startsWith('-')) old.push(line.slice(1));
      else if (line.startsWith('+')) next.push(line.slice(1));
      else if (line.startsWith(' ')) { old.push(line.slice(1)); next.push(line.slice(1)); }
      else throw new Error('Invalid unified diff line; supply literal old_str and new_str.');
    }
    finish();
    return edits;
  }
  const labeled = text.match(/^(?:---\r?\n)?old:[ \t]*(?:\|[ \t]*\r?\n)?([\s\S]*?)\r?\nnew:[ \t]*(?:\|[ \t]*\r?\n)?([\s\S]*)$/);
  if (labeled && (text.match(/^new:/gm) ?? []).length === 1) {
    return [{ old_str: labeled[1]!.trimEnd(), new_str: labeled[2]!.trimEnd() }];
  }
  for (const separator of [' -> ', '\n---\n']) {
    const parts = text.split(separator);
    if (parts.length === 2) return [{ old_str: parts[0], new_str: parts[1] }];
  }
  throw new Error('changes requires explicit before/after text or a single-file unified diff; a replacement-only overwrite is not inferred.');
}

function parseReplacementBatch(value: unknown, operations: boolean): unknown {
  if (typeof value !== 'string') return value;
  if (value.length > 262144) throw new Error('Textual replacement batch exceeds 256 KiB.');
  const text = value.trim();
  try { const decoded: unknown = JSON.parse(text); if (Array.isArray(decoded)) return decoded; } catch { /* Try the bounded literal formats below. */ }
  return operations ? parseTextualOperation(text) : parseTextualChanges(text);
}

/** Tolerate documented aliases, never infer regex or arbitrary operation semantics. */
export function normalizeReplacementArguments(input: Record<string, unknown>): {
  edits: ReplacementEdit[];
  replaceAll: boolean;
} {
  if (input.replace_all !== undefined && typeof input.replace_all !== 'boolean') throw new Error('replace_all must be a boolean');
  if (input.regex !== undefined && input.regex !== false) throw new Error('regex replacements are not supported; supply literal before/after text.');
  if (input.operations !== undefined && input.changes !== undefined) throw new Error('Supply operations or changes, not both.');
  const batch = parseReplacementBatch(input.operations ?? input.changes, input.operations !== undefined);
  if (batch === undefined) return { edits: [{ old_string: textAlias(input, OLD_KEYS, 'old_str'), new_string: textAlias(input, NEW_KEYS, 'new_str') }], replaceAll: input.replace_all === true };
  if (OLD_KEYS.some(key => input[key] !== undefined) || NEW_KEYS.some(key => input[key] !== undefined)) throw new Error('Supply a batch or a single replacement, not both.');
  if (!Array.isArray(batch) || batch.length === 0 || batch.length > 32) throw new Error('operations/changes must contain 1–32 literal replacement objects.');
  const edits = batch.map((operation: unknown) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('Each replacement must be an object.');
    const edit = operation as Record<string, unknown>;
    const kind = edit.op ?? edit.type ?? edit.command;
    if (kind !== undefined && !['replace', 'replace_text', 'str_replace'].includes(String(kind))) throw new Error('Only literal replace/str_replace operations are supported.');
    if (edit.regex !== undefined && edit.regex !== false) throw new Error('regex replacements are not supported.');
    if (edit.path !== undefined || edit.file_path !== undefined) throw new Error('A replacement batch uses one top-level file path.');
    if (edit.replace_all !== undefined && edit.replace_all !== false) throw new Error('Batch replacements apply once each; replace_all is not supported.');
    const old = textAlias(edit, OLD_KEYS, 'old_str');
    if (!old) throw new Error('A batch replacement cannot search for an empty string.');
    return { old_string: old, new_string: textAlias(edit, NEW_KEYS, 'new_str') };
  });
  if (edits.length > 1 && input.replace_all === true) throw new Error('Batch replacements apply once each; replace_all is not supported.');
  return { edits, replaceAll: input.replace_all === true };
}
