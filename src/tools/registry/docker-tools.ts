/**
 * Docker Tool Adapters
 *
 * ITool-compliant adapter for DockerTool operations.
 * This adapter wraps the existing DockerTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { DockerTool } from '../docker-tool.js';

// ============================================================================
// Shared DockerTool Instance
// ============================================================================

let dockerInstance: DockerTool | null = null;

function getDocker(): DockerTool {
  if (!dockerInstance) {
    dockerInstance = new DockerTool();
  }
  return dockerInstance;
}

/**
 * Reset the shared DockerTool instance (for testing)
 */
export function resetDockerInstance(): void {
  dockerInstance = null;
}

// ============================================================================
// DockerOperationTool
// ============================================================================

/**
 * DockerOperationTool - ITool adapter for Docker operations
 *
 * Unified tool that handles all Docker operations via an operation parameter.
 */
export class DockerOperationTool implements ITool {
  readonly name = 'docker';
  readonly description = 'Execute Docker container and image management operations';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;
    const args = (input.args as Record<string, unknown>) || {};

    const docker = getDocker();

    switch (operation) {
      case 'list_containers':
        return await docker.listContainers(args.all as boolean);

      case 'list_images':
        return await docker.listImages();

      case 'run':
        return await docker.run(
          args.image as string,
          args.command as string | undefined,
          {
            name: args.name as string | undefined,
            ports: args.ports as string[] | undefined,
            volumes: args.volumes as string[] | undefined,
            env: args.env as Record<string, string> | undefined,
            detach: args.detach as boolean | undefined,
            rm: args.rm as boolean | undefined,
            network: args.network as string | undefined,
          }
        );

      case 'stop':
        return await docker.stop(args.container as string);

      case 'start':
        return await docker.start(args.container as string);

      case 'remove_container':
        return await docker.removeContainer(
          args.container as string,
          args.force as boolean
        );

      case 'remove_image':
        return await docker.removeImage(
          args.image as string,
          args.force as boolean
        );

      case 'logs':
        return await docker.logs(
          args.container as string,
          args.tail as number | undefined
        );

      case 'exec':
        return await docker.exec(
          args.container as string,
          args.command as string
        );

      case 'build':
        return await docker.build(args.context as string, {
          dockerfile: args.dockerfile as string | undefined,
          tag: args.tag as string | undefined,
          noCache: args.noCache as boolean | undefined,
          buildArgs: args.buildArgs as Record<string, string> | undefined,
        });

      case 'pull':
        return await docker.pull(args.image as string);

      case 'push':
        return await docker.push(args.image as string);

      case 'inspect':
        return await docker.inspect(
          (args.container as string) || (args.image as string),
          args.image ? 'image' : 'container'
        );

      case 'compose_up':
        return await docker.composeUp(
          args.file as string | undefined,
          args.services as string[] | undefined,
          (args.detach as boolean) ?? true
        );

      case 'compose_down':
        return await docker.composeDown(
          args.file as string | undefined,
          args.removeVolumes as boolean
        );

      case 'system_info':
        return await docker.systemInfo();

      case 'prune':
        return await docker.prune(
          args.pruneType as 'containers' | 'images' | 'volumes' | 'system'
        );

      default:
        return {
          success: false,
          error: `Unknown Docker operation: ${operation}`,
        };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'Docker operation to perform',
            enum: [
              'list_containers',
              'list_images',
              'run',
              'stop',
              'start',
              'remove_container',
              'remove_image',
              'logs',
              'exec',
              'build',
              'pull',
              'push',
              'inspect',
              'compose_up',
              'compose_down',
              'system_info',
              'prune',
            ],
          },
          args: {
            type: 'object',
            description: 'Operation-specific arguments',
          },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.operation !== 'string' || data.operation.trim() === '') {
      return { valid: false, errors: ['operation must be a non-empty string'] };
    }

    const validOperations = [
      'list_containers',
      'list_images',
      'run',
      'stop',
      'start',
      'remove_container',
      'remove_image',
      'logs',
      'exec',
      'build',
      'pull',
      'push',
      'inspect',
      'compose_up',
      'compose_down',
      'system_info',
      'prune',
    ];

    if (!validOperations.includes(data.operation)) {
      return { valid: false, errors: [`Unknown operation: ${data.operation}`] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'system' as ToolCategoryType,
      keywords: ['docker', 'container', 'image', 'compose', 'devops'],
      priority: 6,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  dispose(): void {
    resetDockerInstance();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all docker tool instances
 */
export function createDockerTools(): ITool[] {
  return [
    new DockerOperationTool(),
  ];
}
