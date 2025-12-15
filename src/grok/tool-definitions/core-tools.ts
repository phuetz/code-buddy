/**
 * Core Tool Definitions
 *
 * Essential tools for file operations and command execution:
 * - File viewing and creation
 * - Text editing
 * - Bash command execution
 * - Morph fast apply (conditional)
 */

import type { GrokTool } from './types.js';

// View file or directory contents
export const VIEW_FILE_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "view_file",
    description: "View contents of a file or list directory contents",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to file or directory to view",
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

// Create a new file
export const CREATE_FILE_TOOL: GrokTool = {
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
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
  },
};

// String replace editor
export const STR_REPLACE_EDITOR_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "str_replace_editor",
    description: "Replace specific text in a file. Use this for single line edits only",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the file to edit",
        },
        old_str: {
          type: "string",
          description: "Text to replace (must match exactly, or will use fuzzy matching for multi-line strings)",
        },
        new_str: {
          type: "string",
          description: "Text to replace with",
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

// Bash command execution
export const BASH_TOOL: GrokTool = {
  type: "function",
  function: {
    name: "bash",
    description: "Execute a bash command",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The bash command to execute",
        },
      },
      required: ["command"],
    },
  },
};

// Morph Fast Apply tool (conditional on MORPH_API_KEY)
export const MORPH_EDIT_TOOL: GrokTool = {
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

/**
 * Core tools array (without Morph - that's added conditionally)
 */
export const CORE_TOOLS: GrokTool[] = [
  VIEW_FILE_TOOL,
  CREATE_FILE_TOOL,
  STR_REPLACE_EDITOR_TOOL,
  BASH_TOOL,
];

/**
 * Check if Morph Fast Apply should be enabled
 */
export function isMorphEnabled(): boolean {
  return !!process.env.MORPH_API_KEY;
}
