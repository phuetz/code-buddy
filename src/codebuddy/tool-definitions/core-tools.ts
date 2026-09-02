/**
 * Core Tool Definitions
 *
 * Essential tools for file operations and command execution:
 * - File viewing and creation
 * - Text editing
 * - Bash command execution
 * - Morph fast apply (conditional)
 */

import type { CodeBuddyTool } from './types.js';
import {
  getShellCommandParamDescription,
  getShellToolDescription,
} from '../../utils/shell-configuration.js';

// View file or directory contents
export const VIEW_FILE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "view_file",
    description: "View contents of a file or list directory contents. Read/inspect a file before editing it — never guess its contents.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file or directory to view",
        },
        file_path: {
          type: "string",
          description: "Alias for path",
        },
        target_file: {
          type: "string",
          description: "Alias for path",
        },
        start_line: {
          type: "number",
          description: "Starting line number for partial file view (optional)",
        },
        end_line: {
          type: "number",
          description: "Ending line number for partial file view (optional)",
        },
      },
      required: ["path"],
    },
  },
};

// Hermes-compatible read file alias
export const READ_FILE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read file contents with optional 1-indexed line range. Hermes-compatible alias for view_file.",
    parameters: VIEW_FILE_TOOL.function.parameters,
  },
};

// Create a new file
export const CREATE_FILE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "create_file",
    description: "Create a new file with specified content",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path where the file should be created",
        },
        file_path: {
          type: "string",
          description: "Alias for path",
        },
        target_file: {
          type: "string",
          description: "Alias for path",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
};

// Hermes-compatible write file alias
export const WRITE_FILE_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "write_file",
    description: "Create a new file with specified content. Hermes-compatible alias for create_file.",
    parameters: CREATE_FILE_TOOL.function.parameters,
  },
};

// String replace editor
export const STR_REPLACE_EDITOR_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "str_replace_editor",
    description: "Replace specific text in a file. Use this for single line edits only. After editing, verify the change with view_file.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to edit",
        },
        file_path: {
          type: "string",
          description: "Alias for path",
        },
        target_file: {
          type: "string",
          description: "Alias for path",
        },
        old_str: {
          type: "string",
          description: "Text to replace (must match exactly, or will use fuzzy matching for multi-line strings)",
        },
        old_text: {
          type: "string",
          description: "Alias for old_str",
        },
        old_content: {
          type: "string",
          description: "Alias for old_str",
        },
        find: {
          type: "string",
          description: "Alias for old_str",
        },
        old_string: {
          type: "string",
          description: "Alias for old_str",
        },
        new_str: {
          type: "string",
          description: "Text to replace with",
        },
        new_text: {
          type: "string",
          description: "Alias for new_str",
        },
        new_content: {
          type: "string",
          description: "Alias for new_str",
        },
        replace: {
          type: "string",
          description: "Alias for new_str",
        },
        new_string: {
          type: "string",
          description: "Alias for new_str",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default: false, only replaces first occurrence)",
        },
      },
      required: ["path", "old_str", "new_str"],
    },
  },
};

// Hermes-compatible patch alias
export const PATCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "patch",
    description: "Replace text in an existing file. Hermes-compatible alias for str_replace_editor.",
    parameters: STR_REPLACE_EDITOR_TOOL.function.parameters,
  },
};

// Dedicated directory listing (read-only, no bash needed)
export const LIST_DIRECTORY_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List files and directories at a given path. Returns name, type, size, and modification time. Auto-approved read-only operation.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list (default: current directory)",
          default: ".",
        },
      },
      required: [],
    },
  },
};

// Bash command execution
export const BASH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "bash",
    // Derived from the shell that actually executes (PowerShell on Windows):
    // the model picks its command syntax from this text.
    description: getShellToolDescription(),
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: getShellCommandParamDescription(),
        },
      },
      required: ["command"],
    },
  },
};

// Hermes-compatible terminal alias
export const TERMINAL_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "terminal",
    description: "Execute a shell command with Code Buddy's existing shell safety checks. Hermes-compatible alias for bash.",
    parameters: BASH_TOOL.function.parameters,
  },
};

// Morph Fast Apply tool (conditional on MORPH_API_KEY)
export const MORPH_EDIT_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "edit_file",
    description: `Use this tool to make an edit to an existing file.

This will be read by a less intelligent model, which will quickly apply the edit. You should make it clear what the edit is, while also minimizing the unchanged code you write.
When writing the edit, you should specify each edit in sequence, with the special comment // ... existing code ... to represent unchanged code in between edited lines.

For example:

// ... existing code ...
FIRST_EDIT
// ... existing code ...
SECOND_EDIT
// ... existing code ...
THIRD_EDIT
// ... existing code ...

You should still bias towards repeating as few lines of the original file as possible to convey the change.
But, each edit should contain sufficient context of unchanged lines around the code you're editing to resolve ambiguity.
DO NOT omit spans of pre-existing code (or comments) without using the // ... existing code ... comment to indicate its absence. If you omit the existing code comment, the model may inadvertently delete these lines.
If you plan on deleting a section, you must provide context before and after to delete it. If the initial code is \`\`\`code \\n Block 1 \\n Block 2 \\n Block 3 \\n code\`\`\`, and you want to remove Block 2, you would output \`\`\`// ... existing code ... \\n Block 1 \\n  Block 3 \\n // ... existing code ...\`\`\`.
Make sure it is clear what the edit should be, and where it should be applied.
Make edits to a file in a single edit_file call instead of multiple edit_file calls to the same file. The apply model can handle many distinct edits at once.`,
    parameters: {
      type: "object",
      properties: {
        target_file: {
          type: "string",
          description: "The target file to modify."
        },
        instructions: {
          type: "string",
          description: "A single sentence instruction describing what you are going to do for the sketched edit. This is used to assist the less intelligent model in applying the edit. Use the first person to describe what you are going to do. Use it to disambiguate uncertainty in the edit."
        },
        code_edit: {
          type: "string",
          description: "Specify ONLY the precise lines of code that you wish to edit. NEVER specify or write out unchanged code. Instead, represent all unchanged code using the comment of the language you're editing in - example: // ... existing code ..."
        }
      },
      required: ["target_file", "instructions", "code_edit"]
    }
  }
};

// Codex-style unified-diff patch (audit 2026-09-02) : le dispatch existait
// (`registry/text-editor-tools.ts`) et WritePolicy strict pointe vers cet
// outil (« Use apply_patch with a unified diff instead »), mais aucune
// définition LLM n'était enregistrée — le modèle ne pouvait ni le voir ni le
// trouver via tool_search. Les alwaysInclude de tool-selection-strategy.ts et
// agent-executor.ts le demandaient déjà.
export const APPLY_PATCH_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "apply_patch",
    description:
      "Apply a patch to modify files using the *** Begin Patch / *** End Patch format with -/+ lines. Supports adding, deleting, and updating files with fuzzy matching. Preferred (and required under strict write policy) for multi-file or multi-hunk edits.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description:
            "The patch content. Format: '*** Begin Patch' then one or more '*** Update File: path' / '*** Add File: path' / '*** Delete File: path' sections with context lines and -/+ change lines, then '*** End Patch'.",
        },
        intent: {
          type: "string",
          description: "What this change is trying to achieve (used by the diff-review gate when enabled).",
        },
      },
      required: ["patch"],
    },
  },
};

/**
 * Core tools array (without Morph - that's added conditionally)
 */
// PTY hand-off — dispatch: src/tools/interactive-shell-tool.ts.
// The streaming runner intercepts __INTERACTIVE_SHELL_REQUEST__ and pauses
// the agentic loop until the user types "exit".
export const INTERACTIVE_SHELL_TOOL: CodeBuddyTool = {
  type: "function",
  function: {
    name: "interactive_shell",
    description:
      "Launch an interactive PTY shell and hand over control to the user. Use this ONLY when a command requires manual user intervention (answering prompts, editing in Vim, resolving git conflicts) or when you are stuck and need the user to run commands manually. The agentic loop PAUSES until the user types \"exit\". Not a substitute for bash.",
    parameters: {
      type: "object",
      properties: {
        initial_command: {
          type: "string",
          description:
            "Optional command to pre-fill or execute immediately when the interactive shell opens (e.g. \"npm init\" or \"git rebase -i HEAD~3\").",
        },
        reason: {
          type: "string",
          description: "Explain to the user why you are handing over control.",
        },
      },
      required: ["reason"],
    },
  },
};

export const CORE_TOOLS: CodeBuddyTool[] = [
  VIEW_FILE_TOOL,
  READ_FILE_TOOL,
  CREATE_FILE_TOOL,
  WRITE_FILE_TOOL,
  STR_REPLACE_EDITOR_TOOL,
  PATCH_TOOL,
  APPLY_PATCH_TOOL,
  LIST_DIRECTORY_TOOL,
  BASH_TOOL,
  TERMINAL_TOOL,
  INTERACTIVE_SHELL_TOOL,
];

/**
 * Check if Morph Fast Apply should be enabled
 */
export function isMorphEnabled(): boolean {
  return !!process.env.MORPH_API_KEY;
}
