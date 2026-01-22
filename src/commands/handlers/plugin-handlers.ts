import { CommandHandlerResult } from './branch-handlers.js';
import { getPluginMarketplace } from '../../plugins/marketplace.js';
import { getPluginManager } from '../../plugins/plugin-manager.js';

/**
 * Plugins - Manage plugin marketplace and local plugins
 */
export async function handlePlugins(args: string[]): Promise<CommandHandlerResult> {
  const marketplace = getPluginMarketplace();
  const pluginManager = getPluginManager();
  const action = args[0] || 'status';
  const param = args.slice(1).join(' ');

  let content = '';

  try {
    switch (action) {
      case 'list':
        // Get plugins from both systems (legacy marketplace and new plugin manager)
        const installed = marketplace.getInstalled();
        const loaded = pluginManager.getAllPlugins();
        
        if (installed.length === 0 && loaded.length === 0) {
          content = 'No plugins installed or loaded. Use /plugins search <query> to find plugins.';
        } else {
          content = '📦 Installed Plugins:\n\n';
          
          if (loaded.length > 0) {
            content += 'Running (New System):\n';
            loaded.forEach(p => {
              const statusIcon = p.status === 'active' ? '🟢' : p.status === 'error' ? '🔴' : '⚪';
              content += `${statusIcon} ${p.manifest.name} (v${p.manifest.version}) - ${p.manifest.description}\n`;
            });
            content += '\n';
          }

          if (installed.length > 0) {
            content += 'Installed (Legacy):\n';
            installed.forEach(p => {
              const status = p.enabled ? '✅' : '❌';
              content += `${status} ${p.id} v${p.version} - ${p.description}\n`;
            });
          }
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
        
      case 'enable':
        if (!param) {
          return {
            handled: true,
            entry: { type: 'assistant', content: 'Usage: /plugins enable <id>', timestamp: new Date() }
          };
        }
        const activated = await pluginManager.activatePlugin(param);
        if (activated) {
          content = `✅ Plugin ${param} activated`;
        } else {
          content = `❌ Failed to activate plugin ${param} (or not found)`;
        }
        break;

      case 'disable':
        if (!param) {
          return {
            handled: true,
            entry: { type: 'assistant', content: 'Usage: /plugins disable <id>', timestamp: new Date() }
          };
        }
        const deactivated = await pluginManager.deactivatePlugin(param);
        if (deactivated) {
          content = `✅ Plugin ${param} deactivated`;
        } else {
          content = `❌ Failed to deactivate plugin ${param}`;
        }
        break;

      case 'status':
      default:
        // Combine status from both
        const legacyStatus = marketplace.formatStatus();
        const loadedPlugins = pluginManager.getAllPlugins();
        
        content = `🔌 Plugin System Status\n${'='.repeat(30)}\n\n`;
        content += `Active Plugins: ${loadedPlugins.filter(p => p.status === 'active').length}\n`;
        content += `Loaded Plugins: ${loadedPlugins.length}\n\n`;
        
        if (loadedPlugins.length > 0) {
          content += `Running:\n`;
          loadedPlugins.forEach(p => {
            content += `  • ${p.manifest.name}: ${p.status.toUpperCase()}\n`;
          });
          content += '\n';
        }
        
        content += `Legacy Marketplace:\n${legacyStatus}`;
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
