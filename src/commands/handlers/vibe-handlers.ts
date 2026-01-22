/**
 * Vibe Handlers - Mistral Vibe CLI-inspired command handlers
 *
 * Implements:
 * - /reload - Reload configuration
 * - /log - Show log file info
 * - /compact - Compact conversation history
 * - /tools - List and filter tools
 * - /vim - Toggle vim mode
 * - /config - Validate configuration files
 */

import type { CommandHandlerResult } from './branch-handlers.js';

// ============================================================================
// /reload - Reload Configuration
// ============================================================================

export async function handleReload(): Promise<CommandHandlerResult> {
  const lines: string[] = [];

  lines.push('Reloading Configuration');
  lines.push('='.repeat(50));

  try {
    // Reload settings manager
    const { getSettingsManager } = await import('../../utils/settings-manager.js');
    const settingsManager = getSettingsManager();
    settingsManager.loadUserSettings();
    lines.push('  [OK] User settings reloaded');

    // Reload slash commands
    const { getSlashCommandManager } = await import('../slash-commands.js');
    const slashManager = getSlashCommandManager();
    slashManager.reload();
    lines.push('  [OK] Slash commands reloaded');

    // Reload custom agents
    try {
      const { resetCustomAgentLoader } = await import('../../agent/custom/custom-agent-loader.js');
      resetCustomAgentLoader();
      lines.push('  [OK] Custom agents reloaded');
    } catch {
      lines.push('  [--] Custom agents (not initialized)');
    }

    // Note about themes
    lines.push('  [--] Themes (restart required for changes)');

    // Reset tool filter
    try {
      const { resetToolFilter } = await import('../../utils/tool-filter.js');
      resetToolFilter();
      lines.push('  [OK] Tool filter reset');
    } catch {
      lines.push('  [--] Tool filter (not initialized)');
    }

    lines.push('');
    lines.push('Configuration reloaded successfully.');

  } catch (error) {
    lines.push(`  [ERROR] Failed to reload: ${error instanceof Error ? error.message : String(error)}`);
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
// /log - Show Log Information
// ============================================================================

export async function handleLog(): Promise<CommandHandlerResult> {
  const { formatLogInfo } = await import('../../utils/interactive-setup.js');

  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: formatLogInfo(),
      timestamp: new Date(),
    },
  };
}

// ============================================================================
// /compact - Compact Conversation
// ============================================================================

export async function handleCompact(
  args: string[],
  conversationHistory?: Array<{ type: string; content: string }>
): Promise<CommandHandlerResult> {
  const lines: string[] = [];

  lines.push('Compacting Conversation');
  lines.push('='.repeat(50));

  if (!conversationHistory || conversationHistory.length === 0) {
    lines.push('No conversation history to compact.');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: lines.join('\n'),
        timestamp: new Date(),
      },
    };
  }

  // Calculate current token estimate
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const currentTokens = conversationHistory.reduce(
    (sum, entry) => sum + estimateTokens(entry.content || ''),
    0
  );

  lines.push(`Current messages: ${conversationHistory.length}`);
  lines.push(`Estimated tokens: ${currentTokens.toLocaleString()}`);
  lines.push('');

  // The actual compaction is handled by the middleware
  // This command triggers a compact signal
  lines.push('Compaction will be applied on the next message.');
  lines.push('The system will summarize older messages to free up context space.');
  lines.push('');
  lines.push('Tip: You can also use /clear to start a fresh conversation.');

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
// /tools - List and Filter Tools
// ============================================================================

export async function handleTools(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'list';
  const lines: string[] = [];

  try {
    const { CODEBUDDY_TOOLS } = await import('../../codebuddy/tools.js');
    const {
      getToolFilter,
      setToolFilter,
      resetToolFilter,
      filterTools,
      parsePatterns,
    } = await import('../../utils/tool-filter.js');

    switch (action) {
      case 'list': {
        const currentFilter = getToolFilter();
        const result = filterTools(CODEBUDDY_TOOLS, currentFilter);

        lines.push('Available Tools');
        lines.push('='.repeat(50));
        lines.push(`Total: ${result.filteredCount}/${result.originalCount} enabled`);
        lines.push('');

        // Group tools by category
        const categories: Record<string, string[]> = {
          'File Operations': [],
          'Search': [],
          'Git': [],
          'Code Intelligence': [],
          'Multimodal': [],
          'System': [],
          'MCP': [],
          'Other': [],
        };

        for (const tool of result.tools) {
          const name = tool.function.name;

          if (name.includes('file') || name.includes('create') || name.includes('view')) {
            categories['File Operations'].push(name);
          } else if (name.includes('search') || name.includes('find')) {
            categories['Search'].push(name);
          } else if (name.includes('git')) {
            categories['Git'].push(name);
          } else if (name.includes('symbol') || name.includes('reference') || name.includes('definition')) {
            categories['Code Intelligence'].push(name);
          } else if (['pdf', 'audio', 'video', 'screenshot', 'ocr', 'diagram', 'qr'].includes(name)) {
            categories['Multimodal'].push(name);
          } else if (name === 'bash' || name.includes('clipboard') || name.includes('archive')) {
            categories['System'].push(name);
          } else if (name.startsWith('mcp__')) {
            categories['MCP'].push(name);
          } else {
            categories['Other'].push(name);
          }
        }

        for (const [category, tools] of Object.entries(categories)) {
          if (tools.length > 0) {
            lines.push(`${category}:`);
            lines.push(`  ${tools.join(', ')}`);
            lines.push('');
          }
        }

        if (result.filtered.length > 0) {
          lines.push(`Filtered out: ${result.filtered.length} tools`);
        }
        break;
      }

      case 'filter': {
        const pattern = args.slice(1).join(' ');
        if (!pattern) {
          lines.push('Usage: /tools filter <pattern>');
          lines.push('');
          lines.push('Examples:');
          lines.push('  /tools filter bash,search,*file*');
          lines.push('  /tools filter !web_*');
          break;
        }

        const enabledPatterns = parsePatterns(pattern);
        setToolFilter({
          enabledPatterns,
          disabledPatterns: [],
        });

        const result = filterTools(CODEBUDDY_TOOLS, getToolFilter());
        lines.push(`Tool filter applied: ${result.filteredCount}/${result.originalCount} tools enabled`);
        lines.push('');
        lines.push('Enabled tools:');
        lines.push(`  ${result.tools.map(t => t.function.name).join(', ')}`);
        break;
      }

      case 'reset': {
        resetToolFilter();
        lines.push('Tool filter reset. All tools are now enabled.');
        lines.push(`Total: ${CODEBUDDY_TOOLS.length} tools available`);
        break;
      }

      default:
        lines.push('Usage: /tools [list|filter <pattern>|reset]');
        lines.push('');
        lines.push('Actions:');
        lines.push('  list   - List all available tools');
        lines.push('  filter - Filter tools by pattern (glob/regex)');
        lines.push('  reset  - Reset to show all tools');
    }

  } catch (error) {
    lines.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
// /vim - Toggle Vim Mode
// ============================================================================

export async function handleVimMode(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'status';
  const lines: string[] = [];

  const isVimMode = process.env.GROK_VIM_MODE === 'true';

  switch (action) {
    case 'on':
      process.env.GROK_VIM_MODE = 'true';
      lines.push('Vim mode: ENABLED');
      lines.push('');
      lines.push('Keybindings:');
      lines.push('  ESC     - Enter normal mode');
      lines.push('  i       - Enter insert mode');
      lines.push('  v       - Enter visual mode');
      lines.push('  h/j/k/l - Move cursor');
      lines.push('  w/b     - Word forward/backward');
      lines.push('  0/$     - Start/end of line');
      lines.push('  dd      - Delete line');
      lines.push('  yy      - Yank (copy) line');
      lines.push('  p       - Paste');
      lines.push('  u       - Undo');
      lines.push('');
      lines.push('Note: Restart the session for changes to take effect.');
      break;

    case 'off':
      process.env.GROK_VIM_MODE = 'false';
      lines.push('Vim mode: DISABLED');
      lines.push('Using standard input mode.');
      break;

    case 'toggle':
      process.env.GROK_VIM_MODE = isVimMode ? 'false' : 'true';
      lines.push(`Vim mode: ${!isVimMode ? 'ENABLED' : 'DISABLED'}`);
      break;

    case 'status':
    default:
      lines.push('Vim Mode Status');
      lines.push('='.repeat(30));
      lines.push(`Current: ${isVimMode ? 'ENABLED' : 'DISABLED'}`);
      lines.push('');
      lines.push('Commands:');
      lines.push('  /vim on     - Enable vim mode');
      lines.push('  /vim off    - Disable vim mode');
      lines.push('  /vim toggle - Toggle vim mode');
      lines.push('');
      lines.push('You can also use --vim flag when starting grok.');
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
// /config - Configuration Validation
// ============================================================================

export async function handleConfig(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase() || 'validate';
  const lines: string[] = [];

  try {
    const {
      handleConfigValidateCommand,
      getZodConfigValidator,
      ZOD_SCHEMAS,
    } = await import('../../utils/config-validator.js');

    switch (action) {
      case 'validate': {
        // Run full validation
        const report = await handleConfigValidateCommand();
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: report,
            timestamp: new Date(),
          },
        };
      }

      case 'show': {
        // Show current configuration values
        const { getSettingsManager } = await import('../../utils/settings-manager.js');
        const settingsManager = getSettingsManager();

        lines.push('Current Configuration');
        lines.push('='.repeat(50));
        lines.push('');

        // User settings
        const userSettings = settingsManager.loadUserSettings();
        lines.push('--- User Settings (~/.codebuddy/user-settings.json) ---');
        lines.push(`  provider: ${userSettings.provider || 'grok'}`);
        lines.push(`  defaultModel: ${userSettings.defaultModel || 'grok-code-fast-1'}`);
        lines.push(`  baseURL: ${userSettings.baseURL || 'https://api.x.ai/v1'}`);
        lines.push(`  apiKey: ${userSettings.apiKey ? '[SET]' : '[NOT SET]'}`);
        lines.push(`  models: ${userSettings.models?.length || 0} configured`);
        lines.push('');

        // Project settings
        const projectSettings = settingsManager.loadProjectSettings();
        lines.push('--- Project Settings (.codebuddy/settings.json) ---');
        lines.push(`  model: ${projectSettings.model || '(using default)'}`);
        lines.push('');

        // Environment variables
        lines.push('--- Environment Variables ---');
        const envVars = [
          'GROK_API_KEY',
          'GROK_BASE_URL',
          'GROK_MODEL',
          'MORPH_API_KEY',
          'YOLO_MODE',
          'MAX_COST',
          'DEBUG',
        ];
        for (const key of envVars) {
          const value = process.env[key];
          if (value) {
            // Mask sensitive values
            if (key.includes('KEY') || key.includes('SECRET')) {
              lines.push(`  ${key}: [SET]`);
            } else {
              lines.push(`  ${key}: ${value}`);
            }
          }
        }
        lines.push('');
        break;
      }

      case 'defaults': {
        // Show default values for a schema
        const schemaName = args[1] || 'settings.json';
        const validator = getZodConfigValidator();
        const defaults = validator.getDefaults(schemaName);

        if (defaults) {
          lines.push(`Default Values for ${schemaName}`);
          lines.push('='.repeat(50));
          lines.push('');
          lines.push(JSON.stringify(defaults, null, 2));
        } else {
          lines.push(`Unknown schema: ${schemaName}`);
          lines.push('');
          lines.push('Available schemas:');
          for (const name of Object.keys(ZOD_SCHEMAS)) {
            lines.push(`  - ${name}`);
          }
        }
        break;
      }

      case 'docs': {
        // Generate documentation for a schema
        const schemaName = args[1] || 'settings.json';
        const validator = getZodConfigValidator();
        const docs = validator.generateDocs(schemaName);
        lines.push(docs);
        break;
      }

      case 'schemas': {
        // List available schemas
        lines.push('Available Configuration Schemas');
        lines.push('='.repeat(50));
        lines.push('');
        for (const name of Object.keys(ZOD_SCHEMAS)) {
          lines.push(`  - ${name}`);
        }
        lines.push('');
        lines.push('Use "/config defaults <schema>" to see default values');
        lines.push('Use "/config docs <schema>" to see documentation');
        break;
      }

      default:
        lines.push('Configuration Management');
        lines.push('='.repeat(50));
        lines.push('');
        lines.push('Usage: /config <action> [options]');
        lines.push('');
        lines.push('Actions:');
        lines.push('  validate         - Validate all configuration files');
        lines.push('  show             - Show current configuration values');
        lines.push('  defaults <name>  - Show default values for a schema');
        lines.push('  docs <name>      - Show documentation for a schema');
        lines.push('  schemas          - List available configuration schemas');
        lines.push('');
        lines.push('Examples:');
        lines.push('  /config validate');
        lines.push('  /config show');
        lines.push('  /config defaults settings.json');
        lines.push('  /config docs user-settings.json');
    }

  } catch (error) {
    lines.push('Configuration Error');
    lines.push('='.repeat(50));
    lines.push(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
