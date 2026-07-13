import { Command } from 'commander';
import {
  addMCPServer,
  removeMCPServer,
  loadMCPConfig,
  PREDEFINED_SERVERS,
  setMCPServerEnabled,
} from '../mcp/config.js';
import { getMCPManager } from '../codebuddy/tools.js';
import { MCPServerConfig } from '../mcp/client.js';
import { getErrorMessage } from '../types/index.js';
import chalk from 'chalk';
import { logger } from "../utils/logger.js";
import readline from 'readline';
import { measureMCPPromptFootprint } from '../mcp/prompt-footprint.js';
import {
  loadMCPProfiles,
  removeMCPProfile,
  setActiveMCPProfile,
  upsertMCPProfile,
} from '../mcp/profiles.js';

function printPromptFootprint(tools: ReturnType<ReturnType<typeof getMCPManager>['getTools']>): void {
  const footprint = measureMCPPromptFootprint(tools);
  console.log(
    `  Prompt footprint: ~${footprint.estimatedTokens.toLocaleString()} tokens ` +
    `(${footprint.characters.toLocaleString()} chars, exact catalog before RAG selection)`,
  );
}

function buildPromptFootprintReport(
  serverName: string,
  enabled: boolean,
  tools: ReturnType<ReturnType<typeof getMCPManager>['getTools']>,
) {
  const footprint = measureMCPPromptFootprint(tools);
  return {
    server: serverName,
    enabled,
    toolCount: footprint.toolCount,
    characters: footprint.characters,
    bytes: footprint.bytes,
    estimatedTokens: footprint.estimatedTokens,
    heaviestTools: [...footprint.tools]
      .sort((left, right) => right.estimatedTokens - left.estimatedTokens)
      .slice(0, 5),
  };
}

export function confirmPrompt(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

export function createMCPCommand(): Command {
  const mcpCommand = new Command('mcp');
  mcpCommand.description('Manage MCP (Model Context Protocol) servers');

  for (const action of ['enable', 'disable'] as const) {
    mcpCommand
      .command(`${action} <name>`)
      .description(`${action === 'enable' ? 'Enable' : 'Disable'} a configured MCP server`)
      .action(async (name: string) => {
        const enabled = action === 'enable';
        const result = setMCPServerEnabled(name, enabled);
        if (!result.updated) {
          logger.error(chalk.red(`MCP server ${name} not found in any configuration source`));
          process.exit(1);
        }
        if (!enabled) {
          const manager = getMCPManager();
          if (manager.getServers().includes(name)) await manager.removeServer(name);
        }
        console.log(chalk.green(`✓ ${enabled ? 'Enabled' : 'Disabled'} MCP server: ${name}`));
        console.log(`  Source: ${result.path ?? result.source}`);
      });
  }

  const profileCommand = mcpCommand
    .command('profile')
    .description('Manage mission-specific MCP server sets');

  profileCommand
    .command('list')
    .description('List MCP profiles')
    .option('--json', 'Output machine-readable JSON')
    .action((options: { json?: boolean }) => {
      const config = loadMCPProfiles();
      if (options.json) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      const profiles = Object.values(config.profiles);
      if (profiles.length === 0) {
        console.log(chalk.yellow('No MCP profiles configured'));
        return;
      }
      console.log(chalk.bold('MCP profiles:'));
      for (const profile of profiles) {
        const active = config.activeProfile === profile.name ? chalk.green(' (active)') : '';
        console.log(`  ${chalk.bold(profile.name)}${active}: ${profile.servers.join(', ')}`);
        if (profile.description) console.log(`    ${profile.description}`);
      }
    });

  profileCommand
    .command('create <name> <servers...>')
    .description('Create or replace a profile from configured server names')
    .option('-d, --description <text>', 'Profile description')
    .action((name: string, servers: string[], options: { description?: string }) => {
      const available = new Set(loadMCPConfig({ includeDisabled: true }).servers.map(server => server.name));
      const unknown = servers.filter(server => !available.has(server));
      if (unknown.length > 0) {
        logger.error(chalk.red(`Unknown MCP server(s): ${unknown.join(', ')}`));
        process.exit(1);
      }
      const profile = upsertMCPProfile(name, servers, options.description);
      console.log(chalk.green(`✓ Saved MCP profile: ${profile.name}`));
      console.log(`  Servers: ${profile.servers.join(', ')}`);
    });

  profileCommand
    .command('use <name>')
    .description('Activate exactly the servers in a profile')
    .action(async (name: string) => {
      const profiles = loadMCPProfiles();
      const profile = profiles.profiles[name];
      if (!profile) {
        logger.error(chalk.red(`Unknown MCP profile: ${name}`));
        process.exit(1);
      }

      const inventory = loadMCPConfig({ includeDisabled: true }).servers;
      const available = new Set(inventory.map(server => server.name));
      const missing = profile.servers.filter(server => !available.has(server));
      if (missing.length > 0) {
        logger.error(chalk.red(`Profile references missing server(s): ${missing.join(', ')}`));
        process.exit(1);
      }

      const desired = new Set(profile.servers);
      for (const server of inventory) {
        const shouldEnable = desired.has(server.name);
        if ((server.enabled !== false) === shouldEnable) continue;
        const result = setMCPServerEnabled(server.name, shouldEnable);
        if (!result.updated) throw new Error(`Could not update MCP server: ${server.name}`);
      }

      const manager = getMCPManager();
      for (const connected of manager.getServers()) {
        if (!desired.has(connected)) await manager.removeServer(connected);
      }
      setActiveMCPProfile(name);
      console.log(chalk.green(`✓ Activated MCP profile: ${name}`));
      console.log(`  Enabled: ${profile.servers.join(', ')}`);
    });

  profileCommand
    .command('delete <name>')
    .description('Delete a profile without deleting its servers')
    .action((name: string) => {
      if (!removeMCPProfile(name)) {
        logger.error(chalk.red(`Unknown MCP profile: ${name}`));
        process.exit(1);
      }
      console.log(chalk.green(`✓ Deleted MCP profile: ${name}`));
    });

  // Add server command
  mcpCommand
    .command('add <name>')
    .description('Add an MCP server')
    .option('-t, --transport <type>', 'Transport type (stdio, http, sse, streamable_http)', 'stdio')
    .option('-c, --command <command>', 'Command to run the server (for stdio transport)')
    .option('-a, --args [args...]', 'Arguments for the server command (for stdio transport)', [])
    .option('-u, --url <url>', 'URL for HTTP/SSE transport')
    .option('-h, --headers [headers...]', 'HTTP headers (key=value format)', [])
    .option('-e, --env [env...]', 'Environment variables (key=value format)', [])
    .action(async (name: string, options) => {
      try {
        // Check if it's a predefined server
        if (PREDEFINED_SERVERS[name]) {
          const preset = { ...PREDEFINED_SERVERS[name] };
          preset.enabled = true;

          // Inject env vars from CLI --env options or prompt context
          if (preset.transport?.env) {
            const envOverrides: Record<string, string> = {};
            for (const envVar of options.env || []) {
              const [key, value] = envVar.split('=', 2);
              if (key && value) envOverrides[key] = value;
            }

            // Merge: CLI overrides > process.env > preset defaults
            const transportEnv = { ...preset.transport.env };
            for (const key of Object.keys(transportEnv)) {
              if (envOverrides[key]) {
                transportEnv[key] = envOverrides[key];
              } else if (process.env[key]) {
                transportEnv[key] = process.env[key]!;
              }
              if (!transportEnv[key]) {
                console.log(chalk.yellow(`⚠ ${key} is not set. Set it via environment or: buddy mcp add ${name} -e ${key}=YOUR_KEY`));
              }
            }
            preset.transport = { ...preset.transport, env: transportEnv };
          }

          addMCPServer(preset);
          console.log(chalk.green(`✓ Added predefined MCP server: ${name}`));

          // Try to connect immediately
          try {
            const manager = getMCPManager();
            await manager.addServer(preset);
            console.log(chalk.green(`✓ Connected to MCP server: ${name}`));

            const tools = manager.getTools().filter(t => t.serverName === name);
            console.log(chalk.blue(`  Available tools: ${tools.length}`));
          } catch (connectError) {
            console.log(chalk.yellow(`⚠ Server saved but connection failed: ${getErrorMessage(connectError)}`));
            console.log(chalk.yellow('  Check your API key and try: buddy mcp test ' + name));
          }

          return;
        }

        // Custom server
        const transportType = options.transport.toLowerCase();
        
        if (transportType === 'stdio') {
          if (!options.command) {
            logger.error(chalk.red('Error: --command is required for stdio transport'));
            process.exit(1);
          }

          console.log(chalk.yellow('\nSecurity notice: This MCP server will execute a command on your system.'));
          console.log(chalk.yellow(`  Command: ${options.command} ${(options.args || []).join(' ')}`));
          console.log(chalk.yellow('  Only add MCP servers from trusted sources.\n'));

          const confirmed = await confirmPrompt('Do you want to proceed? (y/N): ');
          if (!confirmed) {
            console.log('MCP server addition cancelled.');
            return;
          }
        } else if (transportType === 'http' || transportType === 'sse' || transportType === 'streamable_http') {
          if (!options.url) {
            logger.error(chalk.red(`Error: --url is required for ${transportType} transport`));
            process.exit(1);
          }
        } else {
          logger.error(chalk.red('Error: Transport type must be stdio, http, sse, or streamable_http'));
          process.exit(1);
        }

        // Parse environment variables
        const env: Record<string, string> = {};
        for (const envVar of options.env || []) {
          const [key, value] = envVar.split('=', 2);
          if (key && value) {
            env[key] = value;
          }
        }

        // Parse headers
        const headers: Record<string, string> = {};
        for (const header of options.headers || []) {
          const [key, value] = header.split('=', 2);
          if (key && value) {
            headers[key] = value;
          }
        }

        const config = {
          name,
          transport: {
            type: transportType as 'stdio' | 'http' | 'sse' | 'streamable_http',
            command: options.command,
            args: options.args || [],
            url: options.url,
            env,
            headers: Object.keys(headers).length > 0 ? headers : undefined
          }
        };

        addMCPServer(config);
        console.log(chalk.green(`✓ Added MCP server: ${name}`));
        
        // Try to connect immediately
        const manager = getMCPManager();
        await manager.addServer(config);
        console.log(chalk.green(`✓ Connected to MCP server: ${name}`));
        
        const tools = manager.getTools().filter(t => t.serverName === name);
        console.log(chalk.blue(`  Available tools: ${tools.length}`));

      } catch (error: unknown) {
        logger.error(chalk.red(`Error adding MCP server: ${getErrorMessage(error)}`));
        process.exit(1);
      }
    });

  // Add server from JSON command
  mcpCommand
    .command('add-json <name> <json>')
    .description('Add an MCP server from JSON configuration')
    .action(async (name: string, jsonConfig: string) => {
      try {
        let config;
        try {
          config = JSON.parse(jsonConfig);
        } catch (_error) {
          logger.error(chalk.red('Error: Invalid JSON configuration'));
          process.exit(1);
        }

        const serverConfig: MCPServerConfig = {
          name,
          transport: {
            type: 'stdio', // default
            command: config.command,
            args: config.args || [],
            env: config.env || {},
            url: config.url,
            headers: config.headers
          }
        };

        // Override transport type if specified
        if (config.transport) {
          if (typeof config.transport === 'string') {
            serverConfig.transport.type = config.transport as 'stdio' | 'http' | 'sse';
          } else if (typeof config.transport === 'object') {
            serverConfig.transport = { ...serverConfig.transport, ...config.transport };
          }
        }

        // Security confirmation for stdio transport
        if (serverConfig.transport?.type === 'stdio' && serverConfig.transport.command) {
          console.log(chalk.yellow('\nSecurity notice: This MCP server will execute a command on your system.'));
          console.log(chalk.yellow(`  Command: ${serverConfig.transport.command} ${(serverConfig.transport.args || []).join(' ')}`));
          console.log(chalk.yellow('  Only add MCP servers from trusted sources.\n'));

          const confirmed = await confirmPrompt('Do you want to proceed? (y/N): ');
          if (!confirmed) {
            console.log('MCP server addition cancelled.');
            return;
          }
        }

        addMCPServer(serverConfig);
        console.log(chalk.green(`✓ Added MCP server: ${name}`));
        
        // Try to connect immediately
        const manager = getMCPManager();
        await manager.addServer(serverConfig);
        console.log(chalk.green(`✓ Connected to MCP server: ${name}`));
        
        const tools = manager.getTools().filter(t => t.serverName === name);
        console.log(chalk.blue(`  Available tools: ${tools.length}`));

      } catch (error: unknown) {
        logger.error(chalk.red(`Error adding MCP server: ${getErrorMessage(error)}`));
        process.exit(1);
      }
    });

  // Remove server command
  mcpCommand
    .command('remove <name>')
    .description('Remove an MCP server')
    .action(async (name: string) => {
      try {
        const manager = getMCPManager();
        await manager.removeServer(name);
        removeMCPServer(name);
        console.log(chalk.green(`✓ Removed MCP server: ${name}`));
      } catch (error: unknown) {
        logger.error(chalk.red(`Error removing MCP server: ${getErrorMessage(error)}`));
        process.exit(1);
      }
    });

  // List servers command
  mcpCommand
    .command('list')
    .description('List configured MCP servers')
    .action(() => {
      const config = loadMCPConfig({ includeDisabled: true });
      const manager = getMCPManager();
      
      if (config.servers.length === 0) {
        console.log(chalk.yellow('No MCP servers configured'));
        return;
      }

      console.log(chalk.bold('Configured MCP servers:'));
      console.log();

      for (const server of config.servers) {
        const isConnected = manager.getServers().includes(server.name);
        const status = server.enabled === false
          ? chalk.yellow('○ Disabled')
          : isConnected
            ? chalk.green('✓ Connected')
            : chalk.red('✗ Disconnected');
        
        console.log(`${chalk.bold(server.name)}: ${status}`);
        
        // Display transport information
        if (server.transport) {
          console.log(`  Transport: ${server.transport.type}`);
          if (server.transport.type === 'stdio') {
            console.log(`  Command: ${server.transport.command} ${(server.transport.args || []).join(' ')}`);
          } else if (server.transport.type === 'http' || server.transport.type === 'sse') {
            console.log(`  URL: ${server.transport.url}`);
          }
        } else if (server.command) {
          // Legacy format
          console.log(`  Command: ${server.command} ${(server.args || []).join(' ')}`);
        }
        
        if (isConnected) {
          const transportType = manager.getTransportType(server.name);
          if (transportType) {
            console.log(`  Active Transport: ${transportType}`);
          }
          
          const tools = manager.getTools().filter(t => t.serverName === server.name);
          console.log(`  Tools: ${tools.length}`);
          printPromptFootprint(tools);
          if (tools.length > 0) {
            tools.forEach(tool => {
              const displayName = tool.name.replace(`mcp__${server.name}__`, '');
              console.log(`    - ${displayName}: ${tool.description}`);
            });
          }
        }
        
        console.log();
      }
    });

  mcpCommand
    .command('audit [name]')
    .description('Measure MCP prompt footprint by server and tool')
    .option('--all', 'Include disabled servers')
    .option('--json', 'Output machine-readable JSON')
    .action(async (name: string | undefined, options: { all?: boolean; json?: boolean }) => {
      const inventory = loadMCPConfig({ includeDisabled: true }).servers;
      const selected = name
        ? inventory.filter(server => server.name === name)
        : inventory.filter(server => options.all || server.enabled !== false);

      if (selected.length === 0) {
        logger.error(chalk.red(name ? `MCP server ${name} not found` : 'No MCP servers selected'));
        process.exit(1);
      }

      const manager = getMCPManager();
      const reports: Array<ReturnType<typeof buildPromptFootprintReport> & { error?: string }> = [];
      for (const server of selected) {
        const wasConnected = manager.getServers().includes(server.name);
        try {
          if (!wasConnected) await manager.addServer(server);
          const tools = manager.getTools().filter(tool => tool.serverName === server.name);
          reports.push(buildPromptFootprintReport(server.name, server.enabled !== false, tools));
        } catch (error) {
          reports.push({
            ...buildPromptFootprintReport(server.name, server.enabled !== false, []),
            error: getErrorMessage(error),
          });
        } finally {
          if (!wasConnected && manager.getServers().includes(server.name)) {
            await manager.removeServer(server.name);
          }
        }
      }

      if (options.json) {
        console.log(JSON.stringify({ servers: reports }, null, 2));
        return;
      }

      console.log(chalk.bold('MCP prompt footprint audit:'));
      for (const report of reports) {
        console.log(`\n${chalk.bold(report.server)}${report.enabled ? '' : ' (disabled)'}`);
        if (report.error) {
          console.log(chalk.red(`  Error: ${report.error}`));
          continue;
        }
        console.log(`  Tools: ${report.toolCount}`);
        console.log(`  Full catalog: ~${report.estimatedTokens.toLocaleString()} tokens (${report.characters.toLocaleString()} chars)`);
        if (report.heaviestTools.length > 0) {
          console.log('  Heaviest tools:');
          for (const tool of report.heaviestTools) {
            const displayName = tool.name.replace(`mcp__${report.server}__`, '');
            console.log(`    - ${displayName}: ~${tool.estimatedTokens.toLocaleString()} tokens`);
          }
        }
      }
      const total = reports.reduce((sum, report) => sum + report.estimatedTokens, 0);
      console.log(`\nTotal full catalogs: ~${total.toLocaleString()} tokens before RAG selection`);
    });

  // Test server command
  mcpCommand
    .command('test <name>')
    .description('Test connection to an MCP server')
    .action(async (name: string) => {
      const manager = getMCPManager();
      let connected = false;
      try {
        const config = loadMCPConfig();
        const serverConfig = config.servers.find(s => s.name === name);
        
        if (!serverConfig) {
          logger.error(chalk.red(`Server ${name} not found`));
          process.exit(1);
        }

        console.log(chalk.blue(`Testing connection to ${name}...`));
        
        await manager.addServer(serverConfig);
        connected = true;
        
        const tools = manager.getTools().filter(t => t.serverName === name);
        console.log(chalk.green(`✓ Successfully connected to ${name}`));
        console.log(chalk.blue(`  Available tools: ${tools.length}`));
        printPromptFootprint(tools);
        
        if (tools.length > 0) {
          console.log('  Tools:');
          tools.forEach(tool => {
            const displayName = tool.name.replace(`mcp__${name}__`, '');
            console.log(`    - ${displayName}: ${tool.description}`);
          });
        }

      } catch (error: unknown) {
        logger.error(chalk.red(`✗ Failed to connect to ${name}: ${getErrorMessage(error)}`));
        process.exit(1);
      } finally {
        // `mcp test` is a probe, not a long-lived session. Always tear down the
        // transport so stdio children and their database/network handles do not
        // keep the CLI process alive after a successful discovery.
        if (connected) {
          await manager.removeServer(name);
        }
      }
    });

  return mcpCommand;
}
