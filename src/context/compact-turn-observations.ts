import path from 'node:path';
import type { CodeBuddyMessage } from '../codebuddy/client.js';

/** Model view only: exact native results remain in the host evidence ledger.
 * OpenClaw/Hermes inspired bounded observations and explicit recovery; this
 * implementation never summarizes away a guard or claims an unseen result.
 */
export function compactObservation(content: string, identifier: string, limit = 400): string {
  if (content.length <= limit) return content;
  const note = `\n[Partial observation. Exact text: restore_context({"identifier":${JSON.stringify(identifier)}})]`;
  const lines = content.split('\n');
  const diagnostics = lines.filter((line) =>
    /error|expected|actual|location:|\bat\b.*\.(?:js|ts):|not ok|# (?:tests|fail|pass)|passing|failing|Test (?:Files|Suites)|Tests\s/i.test(
      line
    )
  );
  const selected = (
    diagnostics.length
      ? [...diagnostics, ...lines.slice(0, 1), ...lines.slice(-2)]
      : [...lines.slice(0, 4), ...lines.slice(-4)]
  ).filter((line, index, all) => all.indexOf(line) === index);
  const available = Math.max(0, limit - note.length);
  let excerpt = '';
  for (const line of selected) {
    if (excerpt.length + line.length + 1 <= available) excerpt += line + '\n';
  }
  return excerpt.trimEnd() + note;
}

export function compactTurnObservations(
  messages: readonly CodeBuddyMessage[],
  recoverable: (identifier: string) => boolean,
  cwd?: string
): CodeBuddyMessage[] {
  let recent = 0;
  const fileReads = new Set(
    messages.flatMap((message) =>
      message.role === 'assistant'
        ? (message.tool_calls
            ?.filter((call) => call.type === 'function' && call.function.name === 'view_file')
            .map((call) => call.id) ?? [])
        : []
    )
  );
  const checks = new Set(
    messages.flatMap((message) =>
      message.role === 'assistant'
        ? (message.tool_calls
            ?.filter(
              (call) =>
                call.type === 'function' &&
                ['bash', 'test_runner', 'lint_project'].includes(call.function.name)
            )
            .map((call) => call.id) ?? [])
        : []
    )
  );
  const omitted = new Set<string>();
  const seenHints = new Set<string>();
  const reduced = messages
    .map((message) => ({ ...message }))
    .reverse()
    .map((message) => {
      if (message.role === 'system' && cwd && typeof message.content === 'string') {
        message.content = message.content
          .replace(
            `Working directory: ${cwd}`,
            'Working directory: . (project root; use relative paths)'
          )
          .replace(`<persistent_memory>\nProject: ${path.basename(cwd)}\n</persistent_memory>`, '');
      }
      if (message.role === 'assistant' && message.tool_calls?.length) {
        message.content = '';
        if (cwd)
          message.tool_calls = message.tool_calls.map((call) => {
            if (call.type !== 'function') return call;
            try {
              const args = JSON.parse(call.function.arguments) as Record<string, unknown>;
              if (typeof args.command === 'string' && args.command.startsWith(`cd ${cwd} && `))
                args.command = args.command.slice(`cd ${cwd} && `.length);
              for (const key of ['path', 'file_path', 'target_file']) {
                if (typeof args[key] !== 'string' || !path.isAbsolute(args[key])) continue;
                const relative = path.relative(cwd, args[key]);
                if (relative && !relative.startsWith('..') && !path.isAbsolute(relative))
                  args[key] = relative;
              }
              return { ...call, function: { ...call.function, arguments: JSON.stringify(args) } };
            } catch {
              return call;
            }
          });
      }
      if (message.role === 'tool') {
        recent++;
        if (cwd && typeof message.content === 'string') {
          // Only tool metadata lines, never source lines or user strings.
          message.content = message.content
            .split('\n')
            .map((line) =>
              /^(?:Lines |Contents of |Updated |--- [ab]\/|\+\+\+ [ab]\/|\s*location: |\s*at )/.test(
                line
              )
                ? line.replaceAll(cwd + '/', '')
                : line
            )
            .join('\n');
        }
        if (
          recent > 1 &&
          message.tool_call_id &&
          recoverable(message.tool_call_id) &&
          !(
            fileReads.has(message.tool_call_id) &&
            typeof message.content === 'string' &&
            message.content.length <= 400 &&
            /^\d+: /m.test(message.content)
          )
        ) {
          if (
            checks.has(message.tool_call_id) &&
            typeof message.content === 'string' &&
            /not ok|# fail [1-9]|exit code [1-9]|error TS\d|FAILED/m.test(message.content)
          ) {
            message.content = compactObservation(message.content, message.tool_call_id, 320);
          } else omitted.add(message.tool_call_id);
        }
      }
      return message;
    })
    .reverse()
    .filter((message) => {
      if (message.role === 'tool' && message.tool_call_id && omitted.has(message.tool_call_id))
        return false;
      if (message.role === 'assistant' && message.tool_calls?.length) {
        message.tool_calls = message.tool_calls.filter((call) => !omitted.has(call.id));
        if (!message.tool_calls.length && !message.content) return false;
      }
      return true;
    });
  // One recovery ledger replaces entire old pairs, never orphan results.
  if (omitted.size)
    reduced.push({
      role: 'system',
      content:
        'Earlier exact observations, retrieve with restore_context(identifier): ' +
        [...omitted].reverse().join(', '),
    });
  return reduced
    .reverse()
    .filter((message) => {
      if (
        message.role !== 'system' ||
        typeof message.content !== 'string' ||
        !message.content.startsWith('<context type="middleware-hint">')
      )
        return true;
      const stable = message.content.replace(/\[Auto-Repair \d+\/\d+\]/, '[Auto-Repair]');
      if (seenHints.has(stable)) return false;
      seenHints.add(stable);
      return true;
    })
    .reverse();
}
