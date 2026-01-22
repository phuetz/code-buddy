/**
 * Docker Tool
 *
 * Provides container management capabilities for Code Buddy.
 * Supports common Docker operations with proper confirmation for destructive actions.
 */

import { spawn } from 'child_process';
import { ToolResult } from '../types/index.js';
import { ConfirmationService } from '../utils/confirmation-service.js';

/**
 * Execute a Docker command safely using spawn with array arguments
 */
function execDockerSafe(
  args: string[],
  cwd: string,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn('docker', args, {
      cwd,
      shell: false,
      env: { ...process.env, NO_COLOR: '1' },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 3000);
    }, timeout);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (exitCode: number | null) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          stdout: stdout.trim(),
          stderr: 'Command timed out',
          exitCode: 124,
        });
      } else {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
        });
      }
    });

    proc.on('error', (error: Error) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode: 1,
      });
    });
  });
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created: string;
}

export interface ImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerBuildOptions {
  dockerfile?: string;
  tag?: string;
  buildArgs?: Record<string, string>;
  noCache?: boolean;
  target?: string;
}

export interface DockerRunOptions {
  name?: string;
  ports?: string[];
  volumes?: string[];
  env?: Record<string, string>;
  detach?: boolean;
  rm?: boolean;
  network?: string;
  workdir?: string;
  user?: string;
}

export class DockerTool {
  private confirmationService = ConfirmationService.getInstance();
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  /**
   * Execute docker command safely
   */
  private async execDocker(
    args: string[],
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return execDockerSafe(args, this.cwd, timeout);
  }

  /**
   * Check if Docker is available and running
   */
  async isDockerAvailable(): Promise<boolean> {
    const result = await this.execDocker(['info']);
    return result.exitCode === 0;
  }

  /**
   * List running containers
   */
  async listContainers(all: boolean = false): Promise<ToolResult> {
    const args = ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.CreatedAt}}'];
    if (all) args.splice(1, 0, '-a');

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to list containers',
      };
    }

    if (!result.stdout) {
      return {
        success: true,
        output: all ? 'No containers found' : 'No running containers',
      };
    }

    const containers = result.stdout.split('\n').filter(Boolean);
    const formatted = containers
      .map((line) => {
        const [id, name, image, status, ports, created] = line.split('\t');
        return `${id?.slice(0, 12) || 'N/A'} | ${name || 'N/A'} | ${image || 'N/A'} | ${status || 'N/A'} | ${ports || 'none'} | ${created || 'N/A'}`;
      })
      .join('\n');

    return {
      success: true,
      output: `ID           | Name                 | Image               | Status              | Ports                | Created\n${'─'.repeat(100)}\n${formatted}`,
    };
  }

  /**
   * List Docker images
   */
  async listImages(): Promise<ToolResult> {
    const result = await this.execDocker([
      'images',
      '--format',
      '{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}',
    ]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to list images',
      };
    }

    if (!result.stdout) {
      return {
        success: true,
        output: 'No images found',
      };
    }

    const images = result.stdout.split('\n').filter(Boolean);
    const formatted = images
      .map((line) => {
        const [id, repo, tag, size, created] = line.split('\t');
        return `${id?.slice(0, 12) || 'N/A'} | ${repo || 'N/A'}:${tag || 'latest'} | ${size || 'N/A'} | ${created || 'N/A'}`;
      })
      .join('\n');

    return {
      success: true,
      output: `ID           | Repository:Tag                    | Size        | Created\n${'─'.repeat(80)}\n${formatted}`,
    };
  }

  /**
   * Build a Docker image
   */
  async build(context: string, options: DockerBuildOptions = {}): Promise<ToolResult> {
    // Request confirmation for build
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker build',
          filename: context,
          showVSCodeOpen: false,
          content: `Build image from: ${context}\nTag: ${options.tag || 'latest'}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Build cancelled by user',
        };
      }
    }

    const args = ['build'];

    if (options.dockerfile) {
      args.push('-f', options.dockerfile);
    }
    if (options.tag) {
      args.push('-t', options.tag);
    }
    if (options.noCache) {
      args.push('--no-cache');
    }
    if (options.target) {
      args.push('--target', options.target);
    }
    if (options.buildArgs) {
      for (const [key, value] of Object.entries(options.buildArgs)) {
        args.push('--build-arg', `${key}=${value}`);
      }
    }

    args.push(context);

    // Build can take a long time
    const result = await this.execDocker(args, 600000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Build failed',
        output: result.stdout,
      };
    }

    return {
      success: true,
      output: result.stdout || 'Image built successfully',
    };
  }

  /**
   * Run a Docker container
   */
  async run(image: string, command?: string, options: DockerRunOptions = {}): Promise<ToolResult> {
    // Request confirmation for run
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker run',
          filename: image,
          showVSCodeOpen: false,
          content: `Run container from image: ${image}\nName: ${options.name || 'auto'}\nPorts: ${options.ports?.join(', ') || 'none'}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Run cancelled by user',
        };
      }
    }

    const args = ['run'];

    if (options.name) {
      args.push('--name', options.name);
    }
    if (options.detach) {
      args.push('-d');
    }
    if (options.rm) {
      args.push('--rm');
    }
    if (options.network) {
      args.push('--network', options.network);
    }
    if (options.workdir) {
      args.push('-w', options.workdir);
    }
    if (options.user) {
      args.push('-u', options.user);
    }
    if (options.ports) {
      for (const port of options.ports) {
        args.push('-p', port);
      }
    }
    if (options.volumes) {
      for (const volume of options.volumes) {
        args.push('-v', volume);
      }
    }
    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    args.push(image);

    if (command) {
      // Split command safely
      args.push(...command.split(' ').filter(Boolean));
    }

    const result = await this.execDocker(args, 120000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Run failed',
        output: result.stdout,
      };
    }

    const output = options.detach
      ? `Container started: ${result.stdout.trim()}`
      : result.stdout || 'Container executed successfully';

    return {
      success: true,
      output,
    };
  }

  /**
   * Stop a running container
   */
  async stop(containerIdOrName: string, timeout?: number): Promise<ToolResult> {
    const args = ['stop'];
    if (timeout) {
      args.push('-t', String(timeout));
    }
    args.push(containerIdOrName);

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to stop container ${containerIdOrName}`,
      };
    }

    return {
      success: true,
      output: `Container ${containerIdOrName} stopped`,
    };
  }

  /**
   * Start a stopped container
   */
  async start(containerIdOrName: string): Promise<ToolResult> {
    const result = await this.execDocker(['start', containerIdOrName]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to start container ${containerIdOrName}`,
      };
    }

    return {
      success: true,
      output: `Container ${containerIdOrName} started`,
    };
  }

  /**
   * Remove a container (requires confirmation for running containers)
   */
  async removeContainer(containerIdOrName: string, force: boolean = false): Promise<ToolResult> {
    // Request confirmation for removal
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker remove container',
          filename: containerIdOrName,
          showVSCodeOpen: false,
          content: `Remove container: ${containerIdOrName}\nForce: ${force}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Remove cancelled by user',
        };
      }
    }

    const args = ['rm'];
    if (force) {
      args.push('-f');
    }
    args.push(containerIdOrName);

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to remove container ${containerIdOrName}`,
      };
    }

    return {
      success: true,
      output: `Container ${containerIdOrName} removed`,
    };
  }

  /**
   * Remove a Docker image (requires confirmation)
   */
  async removeImage(imageIdOrTag: string, force: boolean = false): Promise<ToolResult> {
    // Request confirmation for removal
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker remove image',
          filename: imageIdOrTag,
          showVSCodeOpen: false,
          content: `Remove image: ${imageIdOrTag}\nForce: ${force}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Remove cancelled by user',
        };
      }
    }

    const args = ['rmi'];
    if (force) {
      args.push('-f');
    }
    args.push(imageIdOrTag);

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to remove image ${imageIdOrTag}`,
      };
    }

    return {
      success: true,
      output: `Image ${imageIdOrTag} removed`,
    };
  }

  /**
   * Get container logs
   */
  async logs(containerIdOrName: string, tail?: number, follow: boolean = false): Promise<ToolResult> {
    const args = ['logs'];
    if (tail) {
      args.push('--tail', String(tail));
    }
    // Note: follow mode is not supported in this synchronous implementation
    if (follow) {
      args.push('--tail', '100'); // Just get last 100 lines instead
    }
    args.push(containerIdOrName);

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to get logs for ${containerIdOrName}`,
      };
    }

    return {
      success: true,
      output: result.stdout || 'No logs available',
    };
  }

  /**
   * Execute a command in a running container
   */
  async exec(containerIdOrName: string, command: string, interactive: boolean = false): Promise<ToolResult> {
    // Request confirmation for exec
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker exec',
          filename: containerIdOrName,
          showVSCodeOpen: false,
          content: `Execute in container ${containerIdOrName}:\n${command}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Exec cancelled by user',
        };
      }
    }

    const args = ['exec'];
    if (interactive) {
      args.push('-i');
    }
    args.push(containerIdOrName);
    args.push('sh', '-c', command);

    const result = await this.execDocker(args, 60000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Command failed in container ${containerIdOrName}`,
        output: result.stdout,
      };
    }

    return {
      success: true,
      output: result.stdout || 'Command executed successfully',
    };
  }

  /**
   * Pull an image from a registry
   */
  async pull(image: string): Promise<ToolResult> {
    const result = await this.execDocker(['pull', image], 300000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to pull image ${image}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `Image ${image} pulled successfully`,
    };
  }

  /**
   * Push an image to a registry
   */
  async push(image: string): Promise<ToolResult> {
    // Request confirmation for push
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker push',
          filename: image,
          showVSCodeOpen: false,
          content: `Push image to registry: ${image}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Push cancelled by user',
        };
      }
    }

    const result = await this.execDocker(['push', image], 300000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to push image ${image}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `Image ${image} pushed successfully`,
    };
  }

  /**
   * Inspect a container or image
   */
  async inspect(target: string, type: 'container' | 'image' = 'container'): Promise<ToolResult> {
    const args = type === 'image' ? ['image', 'inspect', target] : ['inspect', target];

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to inspect ${target}`,
      };
    }

    try {
      // Parse and format JSON output
      const data = JSON.parse(result.stdout);
      return {
        success: true,
        output: JSON.stringify(data, null, 2),
      };
    } catch {
      return {
        success: true,
        output: result.stdout,
      };
    }
  }

  /**
   * Docker Compose up
   */
  async composeUp(file?: string, services?: string[], detach: boolean = true): Promise<ToolResult> {
    // Request confirmation
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker Compose up',
          filename: file || 'docker-compose.yml',
          showVSCodeOpen: false,
          content: `Start services: ${services?.join(', ') || 'all'}\nDetached: ${detach}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Compose up cancelled by user',
        };
      }
    }

    const args = ['compose'];
    if (file) {
      args.push('-f', file);
    }
    args.push('up');
    if (detach) {
      args.push('-d');
    }
    if (services && services.length > 0) {
      args.push(...services);
    }

    const result = await this.execDocker(args, 300000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Compose up failed',
        output: result.stdout,
      };
    }

    return {
      success: true,
      output: result.stdout || 'Services started successfully',
    };
  }

  /**
   * Docker Compose down
   */
  async composeDown(file?: string, removeVolumes: boolean = false): Promise<ToolResult> {
    // Request confirmation
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker Compose down',
          filename: file || 'docker-compose.yml',
          showVSCodeOpen: false,
          content: `Stop and remove containers\nRemove volumes: ${removeVolumes}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Compose down cancelled by user',
        };
      }
    }

    const args = ['compose'];
    if (file) {
      args.push('-f', file);
    }
    args.push('down');
    if (removeVolumes) {
      args.push('-v');
    }

    const result = await this.execDocker(args, 120000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Compose down failed',
        output: result.stdout,
      };
    }

    return {
      success: true,
      output: result.stdout || 'Services stopped and removed',
    };
  }

  /**
   * Get Docker system information
   */
  async systemInfo(): Promise<ToolResult> {
    const result = await this.execDocker(['system', 'df']);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to get system info',
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Prune unused Docker resources (requires confirmation)
   */
  async prune(type: 'containers' | 'images' | 'volumes' | 'system' = 'system'): Promise<ToolResult> {
    // Request confirmation for prune
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Docker prune',
          filename: type,
          showVSCodeOpen: false,
          content: `Prune unused ${type}. This will remove all unused resources.`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Prune cancelled by user',
        };
      }
    }

    let args: string[];
    switch (type) {
      case 'containers':
        args = ['container', 'prune', '-f'];
        break;
      case 'images':
        args = ['image', 'prune', '-a', '-f'];
        break;
      case 'volumes':
        args = ['volume', 'prune', '-f'];
        break;
      case 'system':
      default:
        args = ['system', 'prune', '-a', '-f'];
        break;
    }

    const result = await this.execDocker(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Prune failed',
      };
    }

    return {
      success: true,
      output: result.stdout || `${type} pruned successfully`,
    };
  }
}

// Singleton instance
let dockerToolInstance: DockerTool | null = null;

export function getDockerTool(cwd?: string): DockerTool {
  if (!dockerToolInstance || cwd) {
    dockerToolInstance = new DockerTool(cwd);
  }
  return dockerToolInstance;
}
