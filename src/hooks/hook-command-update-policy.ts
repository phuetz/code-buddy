/** A hook may replace tool commands only with this literal, non-reading subset. */
import { hookShellPolicy } from './hook-import-policy.js';

// No interpreter, file reader, expansion, redirection, control character or
// compound command. Quotes contain literal ASCII data only. Without the m flag,
// the anchors require a complete command and reject even a final line break.
const LITERAL_COMMAND = /^ *(?:printf|echo|true|false|exit)(?: +(?:[A-Za-z0-9_.,:/@+=%-]+|'[A-Za-z0-9_.,:/@+=% -]*'|"[A-Za-z0-9_.,:/@+=% -]*"))* *$/;

/** Textual credential detection cannot prove an arbitrary interpreter safe. */
export function hookCommandUpdateRefusal(command: unknown): string | undefined {
  if (typeof command !== 'string' || !command || command.length > 8192) {
    return 'replacement is not a readable, bounded command';
  }
  if (!LITERAL_COMMAND.test(command)) {
    return 'only literal printf, echo, true, false and exit replacements are admitted';
  }
  if (/^ *printf +['"]?-/.test(command)) return 'printf options are not admitted';
  const reasons = hookShellPolicy(command, 'command update');
  if (reasons.length) return reasons.join('; ');
  return undefined;
}
