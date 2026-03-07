/**
 * Deploy Tool
 *
 * Wraps cloud config generation and actual deployment execution.
 * Supports Fly.io, Railway, Render, Hetzner, Northflank, GCP.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

export type DeployAction = 'generate_config' | 'deploy' | 'status' | 'logs';
export type DeployPlatform = 'fly' | 'railway' | 'render' | 'hetzner' | 'northflank' | 'gcp';

export interface DeployToolInput {
  action: DeployAction;
  platform: DeployPlatform;
  appName?: string;
  region?: string;
  port?: number;
  env?: Record<string, string>;
  memory?: string;
  cpus?: number;
  outputDir?: string;
  tailLines?: number;
}

const DEPLOY_COMMANDS: Record<DeployPlatform, {
  deploy: string[];
  status: string[];
  logs: (lines: number) => string[];
  binary: string;
}> = {
  fly: {
    deploy: ['deploy'],
    status: ['status'],
    logs: (n) => ['logs', '--no-tail', '-n', String(n)],
    binary: 'fly',
  },
  railway: {
    deploy: ['up'],
    status: ['status'],
    logs: (n) => ['logs', '--lines', String(n)],
    binary: 'railway',
  },
  render: {
    deploy: ['deploy'],
    status: ['services', 'list'],
    logs: (n) => ['logs', '--tail', String(n)],
    binary: 'render',
  },
  hetzner: {
    deploy: ['server', 'create', '--type', 'cx11'],
    status: ['server', 'list'],
    logs: () => ['server', 'list'],
    binary: 'hcloud',
  },
  northflank: {
    deploy: ['deploy'],
    status: ['services', 'list'],
    logs: (n) => ['logs', '--lines', String(n)],
    binary: 'northflank',
  },
  gcp: {
    deploy: ['app', 'deploy', '--quiet'],
    status: ['app', 'describe'],
    logs: (n) => ['app', 'logs', 'read', '--limit', String(n)],
    binary: 'gcloud',
  },
};

export class DeployTool {
  async execute(input: DeployToolInput): Promise<ToolResult> {
    const { action, platform } = input;

    switch (action) {
      case 'generate_config':
        return this.generateConfig(input);
      case 'deploy':
        return this.deploy(platform);
      case 'status':
        return this.getStatus(platform);
      case 'logs':
        return this.getLogs(platform, input.tailLines ?? 50);
      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  private async generateConfig(input: DeployToolInput): Promise<ToolResult> {
    try {
      const { generateDeployConfig, writeDeployConfigs } = await import('../deploy/cloud-configs.js');

      const config = {
        platform: input.platform,
        appName: input.appName || 'codebuddy-app',
        region: input.region,
        port: input.port,
        env: input.env,
        memory: input.memory,
        cpus: input.cpus,
      };

      if (input.outputDir) {
        const result = await writeDeployConfigs(input.outputDir, config);
        return {
          success: result.success,
          output: result.success
            ? `Generated config files:\n${result.files.map(f => `  - ${f.path}`).join('\n')}\n\n${result.instructions}`
            : undefined,
          error: result.success ? undefined : result.instructions,
        };
      }

      const result = generateDeployConfig(config);
      return {
        success: result.success,
        output: result.success
          ? `${result.files.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}\n\n${result.instructions}`
          : undefined,
        error: result.success ? undefined : result.instructions,
      };
    } catch (err) {
      return { success: false, error: `Config generation failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  private async deploy(platform: DeployPlatform): Promise<ToolResult> {
    const cmd = DEPLOY_COMMANDS[platform];
    if (!cmd) {
      return { success: false, error: `Unsupported platform: ${platform}` };
    }

    try {
      const { stdout, stderr } = await execFileAsync(cmd.binary, cmd.deploy, {
        cwd: process.cwd(),
        timeout: 300_000, // 5 min timeout for deploys
      });
      logger.info(`Deploy to ${platform} completed`);
      return {
        success: true,
        output: `Deployed to ${platform} successfully.\n\n${stdout}${stderr ? `\nStderr:\n${stderr}` : ''}`,
      };
    } catch (err: unknown) {
      const error = err as { message?: string; stderr?: string; code?: string };
      if (error.code === 'ENOENT') {
        return { success: false, error: `CLI tool '${cmd.binary}' not found. Install it first:\n  ${this.getInstallHint(platform)}` };
      }
      return { success: false, error: `Deploy failed: ${error.stderr || error.message || String(err)}` };
    }
  }

  private async getStatus(platform: DeployPlatform): Promise<ToolResult> {
    const cmd = DEPLOY_COMMANDS[platform];
    if (!cmd) {
      return { success: false, error: `Unsupported platform: ${platform}` };
    }

    try {
      const { stdout } = await execFileAsync(cmd.binary, cmd.status, {
        cwd: process.cwd(),
        timeout: 30_000,
      });
      return { success: true, output: stdout };
    } catch (err: unknown) {
      const error = err as { message?: string; stderr?: string; code?: string };
      if (error.code === 'ENOENT') {
        return { success: false, error: `CLI tool '${cmd.binary}' not found.` };
      }
      return { success: false, error: `Status check failed: ${error.stderr || error.message || String(err)}` };
    }
  }

  private async getLogs(platform: DeployPlatform, lines: number): Promise<ToolResult> {
    const cmd = DEPLOY_COMMANDS[platform];
    if (!cmd) {
      return { success: false, error: `Unsupported platform: ${platform}` };
    }

    try {
      const { stdout } = await execFileAsync(cmd.binary, cmd.logs(lines), {
        cwd: process.cwd(),
        timeout: 30_000,
      });
      return { success: true, output: stdout };
    } catch (err: unknown) {
      const error = err as { message?: string; stderr?: string; code?: string };
      if (error.code === 'ENOENT') {
        return { success: false, error: `CLI tool '${cmd.binary}' not found.` };
      }
      return { success: false, error: `Log fetch failed: ${error.stderr || error.message || String(err)}` };
    }
  }

  private getInstallHint(platform: DeployPlatform): string {
    switch (platform) {
      case 'fly': return 'curl -L https://fly.io/install.sh | sh';
      case 'railway': return 'npm install -g @railway/cli';
      case 'render': return 'See https://render.com/docs/cli';
      case 'gcp': return 'curl https://sdk.cloud.google.com | bash';
      case 'hetzner': return 'brew install hcloud';
      case 'northflank': return 'npm install -g @northflank/cli';
      default: return `Install the ${platform} CLI`;
    }
  }
}

let deployToolInstance: DeployTool | null = null;

export function getDeployTool(): DeployTool {
  if (!deployToolInstance) {
    deployToolInstance = new DeployTool();
  }
  return deployToolInstance;
}

export function resetDeployTool(): void {
  deployToolInstance = null;
}
