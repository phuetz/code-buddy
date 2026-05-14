/**
 * Server Runner for External Integrations
 *
 * Provides a unified entry point for running code-buddy in server mode,
 * supporting both JSON-RPC and MCP protocols.
 *
 * Usage:
 *   grok --json-rpc          # Start JSON-RPC server
 *   grok --mcp-server        # Start MCP server
 *   grok --server json-rpc   # Alternative syntax
 *   grok --server mcp        # Alternative syntax
 */

import { createJsonRpcServer, JsonRpcServerOptions } from './json-rpc/index.js';
import { createMcpServer, McpServerOptions } from './mcp/index.js';
import { logger } from '../utils/logger.js';

export type ServerMode = 'json-rpc' | 'mcp';

export interface ServerRunnerOptions {
  mode: ServerMode;
  verbose?: boolean;
  workdir?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * Run code-buddy in server mode
 */
export async function runServer(options: ServerRunnerOptions): Promise<void> {
  const { mode, verbose, workdir, apiKey, baseURL, model } = options;

  // Log to stderr so stdout is clean for protocol messages
  const log = (msg: string) => {
    if (verbose) {
      logger.info(`[code-buddy] ${msg}`, { source: 'ServerRunner' });
    }
  };

  log(`Starting server in ${mode} mode...`);

  try {
    switch (mode) {
      case 'json-rpc': {
        const serverOptions: JsonRpcServerOptions = {
          verbose,
          workdir,
          apiKey,
          baseURL,
          model,
        };
        const server = createJsonRpcServer(serverOptions);
        await server.start();
        break;
      }

      case 'mcp': {
        const serverOptions: McpServerOptions = {
          name: 'code-buddy',
          version: '1.0.0',
          verbose,
          workdir,
        };
        const server = createMcpServer(serverOptions);
        await server.start();
        break;
      }

      default:
        throw new Error(`Unknown server mode: ${mode}`);
    }
  } catch (error) {
    logger.error(`Server error: ${error instanceof Error ? error.message : 'Unknown error'}`, { source: 'ServerRunner', error });
    process.exit(1);
  }
}

/**
 * Parse command line arguments and run appropriate server
 */
export function parseServerArgs(args: string[]): ServerRunnerOptions | null {
  let mode: ServerMode | null = null;
  let verbose = false;
  let workdir: string | undefined;
  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--json-rpc') {
      mode = 'json-rpc';
    } else if (arg === '--mcp-server') {
      mode = 'mcp';
    } else if (arg === '--server' && args[i + 1]) {
      const serverType = args[++i].toLowerCase();
      if (serverType === 'json-rpc' || serverType === 'jsonrpc') {
        mode = 'json-rpc';
      } else if (serverType === 'mcp') {
        mode = 'mcp';
      }
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--workdir' || arg === '-d') {
      workdir = args[++i];
    } else if (arg === '--api-key') {
      apiKey = args[++i];
    } else if (arg === '--base-url' || arg === '--baseURL' || arg === '-u') {
      baseURL = args[++i];
    } else if (arg === '--model' || arg === '-m') {
      model = args[++i];
    }
  }

  if (!mode) {
    return null;
  }

  return { mode, verbose, workdir, apiKey, baseURL, model };
}

/**
 * Check if args indicate server mode
 */
export function isServerMode(args: string[]): boolean {
  return args.some(arg =>
    arg === '--json-rpc' ||
    arg === '--mcp-server' ||
    arg === '--server'
  );
}

/**
 * Print server mode help
 */
export function printServerHelp(): void {
  // console.log is intentional here - printing help to stdout
  console.log(`
code-buddy Server Mode
====================

Run code-buddy as a server for external integrations.

Usage:
  grok --json-rpc [options]     Start JSON-RPC 2.0 server (stdin/stdout)
  grok --mcp-server [options]   Start MCP (Model Context Protocol) server

Options:
  --verbose, -v     Enable verbose logging (to stderr)
  --workdir, -d     Set working directory
  --api-key         Override detected provider credentials for this process
  --base-url, -u    API base URL used with --api-key
  --model, -m       Model used with --api-key

JSON-RPC Mode:
  Listens on stdin for JSON-RPC 2.0 requests, responds on stdout.
  Supports: ai/complete, ai/chat, tools/call, fcs/execute, context/*, git/*

  Example client (Node.js):
    const { spawn } = require('child_process');
    const grok = spawn('codebuddy', ['--json-rpc']);

    grok.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { clientName: 'my-app', clientVersion: '1.0' }
    }) + '\\n');

MCP Mode:
  Implements Model Context Protocol for AI tool sharing.
  Compatible with Claude Desktop, and other MCP clients.

  Configuration (claude_desktop_config.json):
    {
      "mcpServers": {
        "code-buddy": {
          "command": "codebuddy",
          "args": ["--mcp-server"]
        }
      }
    }

  Tools exposed:
    - codebuddy_ask: Ask CodeBuddy AI a question
    - codebuddy_complete_code: Get code completions
    - fcs_execute: Run FCS scripts
    - read_file, write_file, list_directory
    - search_content, git_status, execute_shell

  Resources exposed:
    - grok://cwd: Current working directory info
    - grok://git: Git repository status
    - grok://system: System information

  Prompts exposed:
    - code_review: Generate code review
    - explain_code: Explain code
    - generate_tests: Generate unit tests
    - fcs_script: Generate FCS script

For more information, see: https://github.com/code-buddy/docs/integrations
`);
}
