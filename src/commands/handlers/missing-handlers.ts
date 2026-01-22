/**
 * Missing Handlers
 *
 * Implements the following slash command handlers:
 * - __CHANGE_MODEL__ - /model
 * - __CHANGE_MODE__ - /mode
 * - __CLEAR_CHAT__ - /clear
 * - __COLAB__ - /colab
 * - __DIFF_CHECKPOINTS__ - /diff
 * - __FEATURES__ - /features
 * - __INIT_GROK__ - /init
 * - __LIST_CHECKPOINTS__ - /checkpoints
 * - __RESTORE_CHECKPOINT__ - /restore
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { handleColabCommand } from './colab-handler.js';
import fs from 'fs-extra';
import path from 'path';

// ============================================================================
// /model - Change Model
// ============================================================================

export async function handleChangeModel(args: string[]): Promise<CommandHandlerResult> {
  const { getSupportedModels, getModelInfo, suggestModel } = await import('../../utils/model-utils.js');
  const { getSettingsManager } = await import('../../utils/settings-manager.js');

  const modelName = args[0];
  const settingsManager = getSettingsManager();

  // If no model specified, show current model and list available models
  if (!modelName || modelName === 'list') {
    const currentModel = process.env.GROK_MODEL || 'grok-beta';
    const supportedModels = getSupportedModels();

    // Group models by provider
    const modelsByProvider: Record<string, string[]> = {};
    for (const model of supportedModels) {
      const info = getModelInfo(model);
      const provider = info.provider || 'other';
      if (!modelsByProvider[provider]) {
        modelsByProvider[provider] = [];
      }
      modelsByProvider[provider].push(model);
    }

    const lines: string[] = [];
    lines.push('Model Settings');
    lines.push('='.repeat(50));
    lines.push('');
    lines.push(`Current Model: ${currentModel}`);
    lines.push('');
    lines.push('Available Models:');
    lines.push('');

    const providerEmojis: Record<string, string> = {
      xai: '(xAI)',
      anthropic: '(Anthropic)',
      google: '(Google)',
      lmstudio: '(LM Studio)',
      ollama: '(Ollama)',
      other: '(Other)',
    };

    for (const [provider, models] of Object.entries(modelsByProvider)) {
      lines.push(`  ${providerEmojis[provider] || provider}:`);
      for (const model of models) {
        const marker = model === currentModel ? ' *' : '';
        lines.push(`    - ${model}${marker}`);
      }
      lines.push('');
    }

    lines.push('Usage: /model <model-name>');
    lines.push('');
    lines.push('Examples:');
    lines.push('  /model grok-beta');
    lines.push('  /model grok-3-latest');
    lines.push('  /model llama3.2 (requires GROK_BASE_URL for Ollama)');

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // Check if the model exists
  const suggestions = suggestModel(modelName);

  if (suggestions.length === 0) {
    // Try to set it anyway (might be a custom model)
    process.env.GROK_MODEL = modelName;
    settingsManager.updateUserSetting('model', modelName);

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Model changed to: ${modelName}

Note: This model is not in the supported list. It may work if:
- You have a custom GROK_BASE_URL set
- The model is available on your provider

Use /model list to see supported models.`,
        timestamp: new Date(),
      },
    };
  }

  // If exact match or single suggestion, use it
  const exactMatch = suggestions.find(s => s.toLowerCase() === modelName.toLowerCase());
  const targetModel = exactMatch || (suggestions.length === 1 ? suggestions[0] : null);

  if (targetModel) {
    process.env.GROK_MODEL = targetModel;
    settingsManager.updateUserSetting('model', targetModel);

    const modelInfo = getModelInfo(targetModel);

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Model changed to: ${targetModel}

Provider: ${modelInfo.provider}
Max Tokens: ${modelInfo.maxTokens.toLocaleString()}

The new model will be used for subsequent requests.`,
        timestamp: new Date(),
      },
    };
  }

  // Multiple suggestions - show them
  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: `Multiple models match "${modelName}":

${suggestions.map(s => `  - ${s}`).join('\n')}

Please specify the exact model name.`,
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /mode - Change Agent Mode
// ============================================================================

export async function handleChangeMode(args: string[]): Promise<CommandHandlerResult> {
  const { getOperatingModeManager } = await import('../../agent/operating-modes.js');

  const modeManager = getOperatingModeManager();
  const targetMode = args[0]?.toLowerCase();

  // If no mode specified, show current mode and available modes
  if (!targetMode || targetMode === 'status') {
    const currentMode = modeManager.getMode();
    const availableModes = modeManager.getAvailableModes();

    const lines: string[] = [];
    lines.push('Agent Mode Settings');
    lines.push('='.repeat(50));
    lines.push('');
    lines.push(`Current: ${modeManager.formatModeStatus()}`);
    lines.push('');
    lines.push('Available Modes:');
    lines.push('');

    for (const mode of availableModes) {
      const marker = mode.mode === currentMode ? ' *' : '';
      lines.push(`  ${mode.name}${marker}`);
      lines.push(`    ${mode.description}`);
      lines.push('');
    }

    lines.push('Usage: /mode <mode-name>');
    lines.push('');
    lines.push('Shortcuts:');
    lines.push('  /mode plan     - Planning only, no changes');
    lines.push('  /mode ask      - Chat only, no tools');
    lines.push('  /mode fast     - Quick mode, lower cost');
    lines.push('  /mode balanced - Default balanced mode');
    lines.push('  /mode quality  - Best quality, thorough');

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // Validate mode
  const validModes = ['quality', 'balanced', 'fast', 'plan', 'ask', 'custom', 'code'];

  // Handle 'code' as an alias for 'balanced'
  const normalizedMode = targetMode === 'code' ? 'balanced' : targetMode;

  if (!validModes.includes(normalizedMode)) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Unknown mode: ${targetMode}

Valid modes: ${validModes.join(', ')}

Use /mode to see descriptions of each mode.`,
        timestamp: new Date(),
      },
    };
  }

  // Set the mode
  modeManager.setMode(normalizedMode as 'quality' | 'balanced' | 'fast' | 'plan' | 'ask' | 'custom');

  const config = modeManager.getModeConfig();

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: `${modeManager.formatModeStatus()}

Tools: ${config.allowedTools === 'all' ? 'All enabled' : config.allowedTools === 'none' ? 'Disabled' : (config.allowedTools as string[]).join(', ')}
Max Tool Rounds: ${config.maxToolRounds}
Extended Thinking: ${config.enableExtendedThinking ? 'Enabled' : 'Disabled'}`,
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /clear - Clear Chat History
// ============================================================================

export function handleClearChat(): CommandHandlerResult {
  // This returns a special marker that the chat interface should handle
  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: 'Chat history cleared. Starting fresh conversation.',
      timestamp: new Date(),
    },
    // Special flag to indicate chat should be cleared
    prompt: '__CLEAR_HISTORY__',
  };
}

// ============================================================================
// /colab - AI Collaboration
// ============================================================================

export async function handleColab(args: string[]): Promise<CommandHandlerResult> {
  const result = await handleColabCommand(args);

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: result.output,
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /diff - Diff Between Checkpoints
// ============================================================================

export async function handleDiffCheckpoints(args: string[]): Promise<CommandHandlerResult> {
  const { createCheckpointManager } = await import('../../undo/checkpoint-manager.js');

  const checkpointManager = createCheckpointManager(process.cwd());
  const checkpoints = checkpointManager.getCheckpoints();

  if (checkpoints.length < 2) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Diff Checkpoints

Not enough checkpoints to compare. Need at least 2 checkpoints.
Current checkpoints: ${checkpoints.length}

Create checkpoints with file operations or use /checkpoints to see available ones.`,
        timestamp: new Date(),
      },
    };
  }

  let fromId: string;
  let toId: string;

  if (args[0] === 'last' || args.length === 0) {
    // Compare last two checkpoints
    fromId = checkpoints[checkpoints.length - 2].id;
    toId = checkpoints[checkpoints.length - 1].id;
  } else if (args.length === 1) {
    // Compare specified checkpoint with current
    fromId = args[0];
    toId = checkpoints[checkpoints.length - 1].id;
  } else {
    // Compare two specified checkpoints
    fromId = args[0];
    toId = args[1];
  }

  try {
    const changes = await checkpointManager.getDiff(fromId, toId);

    if (changes.length === 0) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Diff: ${fromId} -> ${toId}

No differences found between these checkpoints.`,
          timestamp: new Date(),
        },
      };
    }

    const lines: string[] = [];
    lines.push('Checkpoint Diff');
    lines.push('='.repeat(50));
    lines.push(`From: ${fromId}`);
    lines.push(`To: ${toId}`);
    lines.push('');

    for (const change of changes) {
      const icon = change.type === 'created' ? '+' : change.type === 'deleted' ? '-' : '~';
      lines.push(`[${icon}] ${change.path} (${change.type})`);

      if (change.diff) {
        lines.push('');
        // Show first few lines of diff
        const diffLines = change.diff.split('\n').slice(0, 10);
        lines.push(diffLines.join('\n'));
        if (change.diff.split('\n').length > 10) {
          lines.push('  ... (diff truncated)');
        }
        lines.push('');
      }
    }

    lines.push('');
    lines.push(`Total changes: ${changes.length} files`);

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Error comparing checkpoints: ${error instanceof Error ? error.message : String(error)}

Use /checkpoints to see available checkpoint IDs.`,
        timestamp: new Date(),
      },
    };
  }
}

// ============================================================================
// /features - Show Research-Based Features
// ============================================================================

export function handleFeatures(): CommandHandlerResult {
  const features = `
Research-Based Features in Grok CLI
════════════════════════════════════════════════════════════════════

Based on extensive analysis of AI coding assistants, Grok CLI implements
the following research-backed features:

CONTEXT MANAGEMENT
  - RAG-based code retrieval (codebase indexing)
  - Semantic code search with embeddings
  - Repository structure mapping
  - Dynamic context window management
  - Token usage optimization

AGENTIC CAPABILITIES
  - Iterative tool execution (up to 30 rounds)
  - Self-healing error correction
  - Multi-step planning and execution
  - Parallel tool calls for performance
  - Tree-of-thought reasoning

CHECKPOINT & UNDO SYSTEM
  - Automatic checkpoints before changes
  - File state snapshots
  - Undo/redo operations
  - Diff viewing between checkpoints

SECURITY & SAFETY
  - Three-tier security modes (suggest/auto-edit/full-auto)
  - Dangerous command detection
  - Path traversal prevention
  - API key protection
  - Audit logging

PERFORMANCE OPTIMIZATIONS
  - Lazy loading of heavy modules
  - Response caching
  - Prompt caching (up to 90% cost reduction)
  - Model routing for cost optimization
  - Streaming responses

DEVELOPER EXPERIENCE
  - Multiple operating modes (plan/code/ask)
  - Custom slash commands
  - Conversation branching
  - Session persistence
  - Export to multiple formats

MULTI-MODEL SUPPORT
  - xAI Grok models
  - Anthropic Claude (via custom URL)
  - Google Gemini (via custom URL)
  - Local LLMs via LM Studio/Ollama

AI COLLABORATION
  - Multi-AI handoff workflow
  - Task tracking system
  - Work logging
  - COLAB.md documentation

Use /help to see all available commands.
`.trim();

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: features,
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /init - Initialize .grok Directory
// ============================================================================

export async function handleInitGrok(args: string[]): Promise<CommandHandlerResult> {
  const cwd = process.cwd();
  const grokDir = path.join(cwd, '.grok');
  const codebuddyDir = path.join(cwd, '.codebuddy');

  const lines: string[] = [];
  lines.push('Initializing Grok CLI Configuration');
  lines.push('='.repeat(50));
  lines.push('');

  try {
    // Create .grok directory
    if (!await fs.pathExists(grokDir)) {
      await fs.ensureDir(grokDir);
      lines.push('[+] Created .grok/ directory');
    } else {
      lines.push('[=] .grok/ directory already exists');
    }

    // Create .codebuddy directory for compatibility
    if (!await fs.pathExists(codebuddyDir)) {
      await fs.ensureDir(codebuddyDir);
      lines.push('[+] Created .codebuddy/ directory');
    } else {
      lines.push('[=] .codebuddy/ directory already exists');
    }

    // Create commands directory
    const commandsDir = path.join(codebuddyDir, 'commands');
    if (!await fs.pathExists(commandsDir)) {
      await fs.ensureDir(commandsDir);
      lines.push('[+] Created .codebuddy/commands/ directory');
    }

    // Create GROK.md if it doesn't exist
    const grokMd = path.join(cwd, 'GROK.md');
    if (!await fs.pathExists(grokMd)) {
      const grokMdContent = `# GROK.md

This file provides custom instructions for Grok CLI when working in this repository.

## Project Overview

[Describe your project here]

## Coding Conventions

- [Add your coding standards]
- [File naming conventions]
- [Testing requirements]

## Important Notes

- [Add any important context for the AI]
- [Specific patterns or architectures to follow]

## Custom Commands

You can create custom slash commands by adding .md files to \`.codebuddy/commands/\`.

Example: Create \`.codebuddy/commands/deploy.md\` with:

\`\`\`
---
description: Deploy the application
---

Deploy the application using the following steps:
1. Run tests
2. Build the project
3. Deploy to production
\`\`\`

Then use \`/deploy\` to run it.
`;
      await fs.writeFile(grokMd, grokMdContent);
      lines.push('[+] Created GROK.md template');
    } else {
      lines.push('[=] GROK.md already exists');
    }

    // Create .gitignore additions
    const gitignore = path.join(cwd, '.gitignore');
    let gitignoreContent = '';
    if (await fs.pathExists(gitignore)) {
      gitignoreContent = await fs.readFile(gitignore, 'utf-8');
    }

    const grokIgnores = ['.codebuddy/cache/', '.codebuddy/sessions/', '.grok/cache/'];
    const newIgnores: string[] = [];

    for (const ignore of grokIgnores) {
      if (!gitignoreContent.includes(ignore)) {
        newIgnores.push(ignore);
      }
    }

    if (newIgnores.length > 0) {
      const addition = `\n# Grok CLI\n${newIgnores.join('\n')}\n`;
      await fs.appendFile(gitignore, addition);
      lines.push('[+] Added Grok paths to .gitignore');
    }

    lines.push('');
    lines.push('Initialization complete!');
    lines.push('');
    lines.push('Next steps:');
    lines.push('  1. Edit GROK.md to add project-specific instructions');
    lines.push('  2. Create custom commands in .codebuddy/commands/');
    lines.push('  3. Use /help to see all available commands');

  } catch (error) {
    lines.push(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: lines.join('\n'),
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /checkpoints - List All Checkpoints
// ============================================================================

export async function handleListCheckpoints(args: string[]): Promise<CommandHandlerResult> {
  const { createCheckpointManager } = await import('../../undo/checkpoint-manager.js');

  const checkpointManager = createCheckpointManager(process.cwd());
  const checkpoints = checkpointManager.getCheckpoints();
  const currentCheckpoint = checkpointManager.getCurrentCheckpoint();

  if (checkpoints.length === 0) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Checkpoints

No checkpoints found.

Checkpoints are created automatically when you:
- Edit files
- Run potentially destructive commands
- Use /checkpoint create <name>

Use /restore to restore to a previous state.`,
        timestamp: new Date(),
      },
    };
  }

  const lines: string[] = [];
  lines.push('Checkpoints');
  lines.push('='.repeat(60));
  lines.push(`Total: ${checkpoints.length} | Can Undo: ${checkpointManager.canUndo() ? 'Yes' : 'No'} | Can Redo: ${checkpointManager.canRedo() ? 'Yes' : 'No'}`);
  lines.push('');

  // Show checkpoints in reverse order (most recent first)
  const recentCheckpoints = [...checkpoints].reverse().slice(0, 20);

  for (const checkpoint of recentCheckpoints) {
    const isCurrent = currentCheckpoint?.id === checkpoint.id;
    const marker = isCurrent ? ' ->' : '   ';
    const autoIcon = checkpoint.metadata.automatic ? '(auto)' : '(manual)';
    const date = new Date(checkpoint.timestamp);
    const dateStr = date.toLocaleString();

    lines.push(`${marker} [${checkpoint.id}] ${checkpoint.name} ${autoIcon}`);
    lines.push(`       ${dateStr} | ${checkpoint.files.length} files | ${checkpoint.metadata.operation}`);

    if (checkpoint.tags.length > 0) {
      lines.push(`       Tags: ${checkpoint.tags.join(', ')}`);
    }
    lines.push('');
  }

  if (checkpoints.length > 20) {
    lines.push(`... and ${checkpoints.length - 20} more checkpoints`);
    lines.push('');
  }

  lines.push('Commands:');
  lines.push('  /restore <id>     - Restore to a checkpoint');
  lines.push('  /diff <id1> <id2> - Compare checkpoints');
  lines.push('  /undo             - Undo last change');
  lines.push('  /redo             - Redo undone change');

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: lines.join('\n'),
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /restore - Restore Checkpoint
// ============================================================================

export async function handleRestoreCheckpoint(args: string[]): Promise<CommandHandlerResult> {
  const { createCheckpointManager } = await import('../../undo/checkpoint-manager.js');

  const checkpointManager = createCheckpointManager(process.cwd());
  const checkpoints = checkpointManager.getCheckpoints();

  if (checkpoints.length === 0) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `No checkpoints available to restore.

Create checkpoints by making file changes or running /checkpoint create <name>.`,
        timestamp: new Date(),
      },
    };
  }

  const checkpointIdOrNumber = args[0];

  // If no argument, show recent checkpoints and prompt
  if (!checkpointIdOrNumber) {
    const recent = checkpoints.slice(-5).reverse();
    const lines: string[] = [];
    lines.push('Restore Checkpoint');
    lines.push('='.repeat(50));
    lines.push('');
    lines.push('Recent checkpoints:');
    lines.push('');

    for (let i = 0; i < recent.length; i++) {
      const cp = recent[i];
      const date = new Date(cp.timestamp);
      lines.push(`  [${i + 1}] ${cp.id} - ${cp.name}`);
      lines.push(`      ${date.toLocaleString()} | ${cp.files.length} files`);
    }

    lines.push('');
    lines.push('Usage:');
    lines.push('  /restore <id>     - Restore by checkpoint ID');
    lines.push('  /restore 1        - Restore to most recent checkpoint');
    lines.push('  /undo             - Quick undo (same as /restore to previous)');

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // Find checkpoint by ID or number
  let targetCheckpoint;

  const numberMatch = checkpointIdOrNumber.match(/^\d+$/);
  if (numberMatch) {
    const index = parseInt(numberMatch[0], 10) - 1;
    const recent = checkpoints.slice(-5).reverse();
    targetCheckpoint = recent[index];
  } else {
    targetCheckpoint = checkpoints.find(cp =>
      cp.id === checkpointIdOrNumber ||
      cp.id.startsWith(checkpointIdOrNumber)
    );
  }

  if (!targetCheckpoint) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Checkpoint not found: ${checkpointIdOrNumber}

Use /checkpoints to see available checkpoints.`,
        timestamp: new Date(),
      },
    };
  }

  try {
    const result = await checkpointManager.restoreCheckpoint(targetCheckpoint, 'restore');

    const lines: string[] = [];
    lines.push('Checkpoint Restored');
    lines.push('='.repeat(50));
    lines.push('');
    lines.push(`Checkpoint: ${targetCheckpoint.name} (${targetCheckpoint.id})`);
    lines.push(`Files restored: ${result.restoredFiles.length}`);
    lines.push('');

    if (result.restoredFiles.length > 0) {
      lines.push('Restored files:');
      for (const file of result.restoredFiles.slice(0, 10)) {
        lines.push(`  - ${file}`);
      }
      if (result.restoredFiles.length > 10) {
        lines.push(`  ... and ${result.restoredFiles.length - 10} more`);
      }
    }

    if (result.errors.length > 0) {
      lines.push('');
      lines.push('Errors:');
      for (const error of result.errors) {
        lines.push(`  - ${error.path}: ${error.error}`);
      }
    }

    lines.push('');
    lines.push('Use /redo to undo this restore if needed.');

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Failed to restore checkpoint: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date(),
      },
    };
  }
}
