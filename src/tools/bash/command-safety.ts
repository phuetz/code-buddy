import { validateCommand } from '../../utils/input-validator.js';
import { parseBashCommand } from '../../security/bash-parser.js';

/** Additional safety checks shared by buffered, streaming and rewritten commands. */
export function validateShellCommandSafety(command: string): ReturnType<typeof validateCommand> {
  // Only a complete native AST can prove that bare cat writes literal data.
  // Interpreter input, pipelines, redefined commands and uncertain parses
  // keep the original checks. Executable headers and destinations stay visible.
  const parsed = parseBashCommand(command);
  const result = validateCommand(parsed.credentialPolicyInput ?? command);
  return result.valid ? { ...result, value: command } : result;
}
