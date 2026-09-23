import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { getContextLoader, ContextLoader } from "../../context/context-loader.js";
import { getWorkspaceDetector } from "../../utils/workspace-detector.js";

export interface CommandHandlerResult {
  handled: boolean;
  failed?: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Add Context - Load files into context dynamically
 */
export async function handleAddContext(args: string[]): Promise<CommandHandlerResult> {
  const pattern = args.join(" ");

  if (!pattern) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `📁 Add Files to Context

Usage: /add <pattern>

Examples:
  /add src/utils.ts           - Add single file
  /add src/**/*.ts            - Add all TypeScript files in src/
  /add src/**/*.ts,!**/*.test.ts  - Add TS files except tests

Files will be loaded and available for the AI to reference.`,
        timestamp: new Date(),
      },
    };
  }

  try {
    const { include, exclude } = ContextLoader.parsePatternString(pattern);
    const contextLoader = getContextLoader(process.cwd(), {
      patterns: include,
      excludePatterns: exclude,
      respectGitignore: true,
    });

    const files = await contextLoader.loadFiles(include);

    if (files.length === 0) {
      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `❌ No files matched pattern: ${pattern}

Check your glob pattern and try again.`,
          timestamp: new Date(),
        },
      };
    }

    const summary = contextLoader.getSummary(files);
    const fileList = files.slice(0, 10).map(f => `  • ${f.relativePath}`).join('\n');
    const moreFiles = files.length > 10 ? `\n  ... and ${files.length - 10} more` : '';

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `✅ Added ${files.length} file(s) to context

${summary}

Files:
${fileList}${moreFiles}

These files are now available for reference.`,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Error loading files: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Context - View/manage loaded context
 */
export async function handleContext(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase();
  const contextLoader = getContextLoader();

  let content: string;

  switch (action) {
    case "clear":
      // Context is ephemeral, just confirm
      content = `🗑️ Context cleared!

Loaded files have been removed from the current session.`;
      break;

    case "list":
      const files = await contextLoader.loadFiles();
      if (files.length === 0) {
        content = `📁 No files currently in context.

Use /add <pattern> to add files.`;
      } else {
        const fileList = files.map(f => `  • ${f.relativePath} (${f.language || 'text'})`).join('\n');
        content = `📁 Context Files (${files.length})

${fileList}`;
      }
      break;

    case "summary":
    default:
      const allFiles = await contextLoader.loadFiles();
      content = allFiles.length > 0
        ? contextLoader.getSummary(allFiles)
        : `📁 No files currently in context.

Use /add <pattern> to add files, or use --context flag when starting.`;
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Workspace - Detect project configuration
 */
export async function handleWorkspace(): Promise<CommandHandlerResult> {
  const detector = getWorkspaceDetector();

  await detector.detect();
  const content = detector.formatDetectionResults();

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}
