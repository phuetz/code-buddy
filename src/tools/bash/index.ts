/**
 * Bash tool module - barrel export.
 *
 * Re-exports BashTool for backward compatibility with existing imports
 * from 'src/tools/bash' or 'src/tools/bash.js'.
 */

export {
  BASH_COMMAND_COMPLETED_WITH_NO_OUTPUT,
  BashTool,
} from './bash-tool.js';
