import { CommandHandlerResult } from './branch-handlers.js';
import { getPluginMarketplace } from '../../plugins/marketplace.js';

/**
 * Plugins - Manage plugin marketplace
 */
export async function handlePlugins(args: string[]): Promise<CommandHandlerResult> {
  const marketplace = getPluginMarketplace();
  const action = args[0] || 'status';
  const param = args.slice(1).join(' ');

  let content = '';

  try {
    switch (action) {
      case 'list':
        const installed = marketplace.getInstalled();
        if (installed.length === 0) {
          content = 'No plugins installed. Use /plugins search <query> to find plugins.';
        } else {
          content = '📦 Installed Plugins:\n\n';
          installed.forEach(p => {
            const status = p.enabled ? '✅' : '❌';
            content += `${status} ${p.id} v${p.version} - ${p.description}\n`;
          });
        }
        break;

      case 'search':
        if (!param) {
          return {
            handled: true,
            entry: {
              type: 'assistant',
              content: 'Usage: /plugins search <query>',
              timestamp: new Date(),
            },
          };
        }
        content = '🔍 Searching marketplace...\n\n';
        const results = await marketplace.search(param);
        if (results.length === 0) {
          content += 'No plugins found matching your query.';
        } else {
          results.forEach(r => {
            content += `• ${r.id} v${r.version} by ${r.author}\n`;
            content += `  ${r.description}\n\n`;
          });
          content += 'Use /plugins install <id> to install a plugin.';
        }
        break;

      case 'install':
        if (!param) {
          return {
            handled: true,
            entry: {
              type: 'assistant',
              content: 'Usage: /plugins install <id>',
              timestamp: new Date(),
            },
          };
        }
        content = `⏳ Installing plugin ${param}...`;
        const installedPlugin = await marketplace.install(param);
        content = `✅ Successfully installed ${installedPlugin?.name} v${installedPlugin?.version}`;
        break;

      case 'uninstall':
      case 'remove':
        if (!param) {
          return {
            handled: true,
            entry: {
              type: 'assistant',
              content: 'Usage: /plugins uninstall <id>',
              timestamp: new Date(),
            },
          };
        }
        await marketplace.uninstall(param);
        content = `✅ Successfully uninstalled ${param}`;
        break;

      case 'status':
      default:
        content = marketplace.formatStatus();
        break;
    }

    return {
      handled: true,
      entry: {
        type: 'assistant',
        content,
        timestamp: new Date(),
      },
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `❌ Plugin error: ${errorMessage}`,
        timestamp: new Date(),
      },
    };
  }
}
