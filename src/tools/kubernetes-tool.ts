/**
 * Kubernetes Tool
 *
 * Provides Kubernetes cluster management capabilities for Code Buddy.
 * Supports common kubectl operations with proper confirmation for destructive actions.
 */

import { spawn } from 'child_process';
import { ToolResult } from '../types/index.js';
import { ConfirmationService } from '../utils/confirmation-service.js';

/**
 * Execute a kubectl command safely using spawn with array arguments
 */
function execKubectlSafe(
  args: string[],
  cwd: string,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const proc = spawn('kubectl', args, {
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

export type K8sResourceType =
  | 'pods'
  | 'deployments'
  | 'services'
  | 'configmaps'
  | 'secrets'
  | 'namespaces'
  | 'nodes'
  | 'ingresses'
  | 'persistentvolumeclaims'
  | 'statefulsets'
  | 'daemonsets'
  | 'jobs'
  | 'cronjobs'
  | 'replicasets';

export interface K8sGetOptions {
  namespace?: string;
  allNamespaces?: boolean;
  selector?: string;
  output?: 'wide' | 'yaml' | 'json' | 'name';
  showLabels?: boolean;
}

export interface K8sApplyOptions {
  namespace?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface K8sDeleteOptions {
  namespace?: string;
  force?: boolean;
  gracePeriod?: number;
}

export interface K8sLogsOptions {
  namespace?: string;
  container?: string;
  tail?: number;
  previous?: boolean;
  timestamps?: boolean;
}

export interface K8sExecOptions {
  namespace?: string;
  container?: string;
}

export interface K8sScaleOptions {
  namespace?: string;
  replicas: number;
}

export class KubernetesTool {
  private confirmationService = ConfirmationService.getInstance();
  private cwd: string;
  private currentContext: string | null = null;
  private currentNamespace: string = 'default';

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  /**
   * Execute kubectl command safely
   */
  private async execKubectl(
    args: string[],
    timeout?: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return execKubectlSafe(args, this.cwd, timeout);
  }

  /**
   * Check if kubectl is available and connected to a cluster
   */
  async isKubectlAvailable(): Promise<boolean> {
    const result = await this.execKubectl(['cluster-info']);
    return result.exitCode === 0;
  }

  /**
   * Get cluster information
   */
  async clusterInfo(): Promise<ToolResult> {
    const result = await this.execKubectl(['cluster-info']);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to get cluster info. Is kubectl configured?',
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Get current context
   */
  async getCurrentContext(): Promise<ToolResult> {
    const result = await this.execKubectl(['config', 'current-context']);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to get current context',
      };
    }

    this.currentContext = result.stdout.trim();
    return {
      success: true,
      output: `Current context: ${this.currentContext}`,
    };
  }

  /**
   * List available contexts
   */
  async listContexts(): Promise<ToolResult> {
    const result = await this.execKubectl(['config', 'get-contexts']);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to list contexts',
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Switch context
   */
  async useContext(contextName: string): Promise<ToolResult> {
    // Request confirmation for context switch
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes switch context',
          filename: contextName,
          showVSCodeOpen: false,
          content: `Switch to context: ${contextName}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Context switch cancelled by user',
        };
      }
    }

    const result = await this.execKubectl(['config', 'use-context', contextName]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to switch to context ${contextName}`,
      };
    }

    this.currentContext = contextName;
    return {
      success: true,
      output: `Switched to context: ${contextName}`,
    };
  }

  /**
   * Get resources
   */
  async get(resourceType: K8sResourceType, name?: string, options: K8sGetOptions = {}): Promise<ToolResult> {
    const args = ['get', resourceType];

    if (name) {
      args.push(name);
    }

    if (options.allNamespaces) {
      args.push('-A');
    } else if (options.namespace) {
      args.push('-n', options.namespace);
    }

    if (options.selector) {
      args.push('-l', options.selector);
    }

    if (options.output) {
      args.push('-o', options.output);
    }

    if (options.showLabels) {
      args.push('--show-labels');
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to get ${resourceType}`,
      };
    }

    if (!result.stdout) {
      return {
        success: true,
        output: `No ${resourceType} found`,
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Describe a resource
   */
  async describe(resourceType: K8sResourceType, name: string, namespace?: string): Promise<ToolResult> {
    const args = ['describe', resourceType, name];

    if (namespace) {
      args.push('-n', namespace);
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to describe ${resourceType}/${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Apply a manifest file or directory
   */
  async apply(pathOrUrl: string, options: K8sApplyOptions = {}): Promise<ToolResult> {
    // Request confirmation for apply
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes apply',
          filename: pathOrUrl,
          showVSCodeOpen: false,
          content: `Apply manifest: ${pathOrUrl}\nNamespace: ${options.namespace || 'default'}\nDry-run: ${options.dryRun || false}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Apply cancelled by user',
        };
      }
    }

    const args = ['apply', '-f', pathOrUrl];

    if (options.namespace) {
      args.push('-n', options.namespace);
    }

    if (options.dryRun) {
      args.push('--dry-run=client');
    }

    if (options.force) {
      args.push('--force');
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Apply failed',
        output: result.stdout,
      };
    }

    return {
      success: true,
      output: result.stdout || 'Manifest applied successfully',
    };
  }

  /**
   * Delete a resource
   */
  async delete(
    resourceType: K8sResourceType,
    name: string,
    options: K8sDeleteOptions = {}
  ): Promise<ToolResult> {
    // Request confirmation for delete
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes delete',
          filename: `${resourceType}/${name}`,
          showVSCodeOpen: false,
          content: `Delete ${resourceType}: ${name}\nNamespace: ${options.namespace || 'default'}\nForce: ${options.force || false}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Delete cancelled by user',
        };
      }
    }

    const args = ['delete', resourceType, name];

    if (options.namespace) {
      args.push('-n', options.namespace);
    }

    if (options.force) {
      args.push('--force');
    }

    if (options.gracePeriod !== undefined) {
      args.push('--grace-period', String(options.gracePeriod));
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to delete ${resourceType}/${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `${resourceType}/${name} deleted`,
    };
  }

  /**
   * Get pod logs
   */
  async logs(podName: string, options: K8sLogsOptions = {}): Promise<ToolResult> {
    const args = ['logs', podName];

    if (options.namespace) {
      args.push('-n', options.namespace);
    }

    if (options.container) {
      args.push('-c', options.container);
    }

    if (options.tail) {
      args.push('--tail', String(options.tail));
    }

    if (options.previous) {
      args.push('-p');
    }

    if (options.timestamps) {
      args.push('--timestamps');
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to get logs for ${podName}`,
      };
    }

    return {
      success: true,
      output: result.stdout || 'No logs available',
    };
  }

  /**
   * Execute a command in a pod
   */
  async exec(
    podName: string,
    command: string,
    options: K8sExecOptions = {}
  ): Promise<ToolResult> {
    // Request confirmation for exec
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes exec',
          filename: podName,
          showVSCodeOpen: false,
          content: `Execute in pod ${podName}:\n${command}`,
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

    const args = ['exec', podName];

    if (options.namespace) {
      args.push('-n', options.namespace);
    }

    if (options.container) {
      args.push('-c', options.container);
    }

    args.push('--', 'sh', '-c', command);

    const result = await this.execKubectl(args, 60000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Command failed in pod ${podName}`,
        output: result.stdout,
      };
    }

    return {
      success: true,
      output: result.stdout || 'Command executed successfully',
    };
  }

  /**
   * Scale a deployment, statefulset, or replicaset
   */
  async scale(
    resourceType: 'deployments' | 'statefulsets' | 'replicasets',
    name: string,
    options: K8sScaleOptions
  ): Promise<ToolResult> {
    // Request confirmation for scale
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes scale',
          filename: `${resourceType}/${name}`,
          showVSCodeOpen: false,
          content: `Scale ${resourceType}/${name} to ${options.replicas} replicas`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Scale cancelled by user',
        };
      }
    }

    const args = ['scale', resourceType, name, `--replicas=${options.replicas}`];

    if (options.namespace) {
      args.push('-n', options.namespace);
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to scale ${resourceType}/${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `${resourceType}/${name} scaled to ${options.replicas} replicas`,
    };
  }

  /**
   * Rollout status for a deployment
   */
  async rolloutStatus(resourceType: 'deployments' | 'statefulsets' | 'daemonsets', name: string, namespace?: string): Promise<ToolResult> {
    const args = ['rollout', 'status', resourceType, name];

    if (namespace) {
      args.push('-n', namespace);
    }

    const result = await this.execKubectl(args, 120000);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to get rollout status for ${resourceType}/${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Rollout restart for a deployment
   */
  async rolloutRestart(resourceType: 'deployments' | 'statefulsets' | 'daemonsets', name: string, namespace?: string): Promise<ToolResult> {
    // Request confirmation for restart
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes rollout restart',
          filename: `${resourceType}/${name}`,
          showVSCodeOpen: false,
          content: `Restart ${resourceType}/${name}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Restart cancelled by user',
        };
      }
    }

    const args = ['rollout', 'restart', resourceType, name];

    if (namespace) {
      args.push('-n', namespace);
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to restart ${resourceType}/${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `${resourceType}/${name} restarted`,
    };
  }

  /**
   * Port forward to a pod or service
   */
  async portForward(
    resourceType: 'pods' | 'services',
    name: string,
    localPort: number,
    remotePort: number,
    namespace?: string
  ): Promise<ToolResult> {
    // Request confirmation for port-forward
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes port-forward',
          filename: `${resourceType}/${name}`,
          showVSCodeOpen: false,
          content: `Forward localhost:${localPort} to ${name}:${remotePort}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Port-forward cancelled by user',
        };
      }
    }

    // Note: Port forward runs in background, we just start it
    const resourcePrefix = resourceType === 'services' ? 'svc/' : 'pod/';
    const args = ['port-forward', `${resourcePrefix}${name}`, `${localPort}:${remotePort}`];

    if (namespace) {
      args.push('-n', namespace);
    }

    // Start port-forward in background (it won't block)
    const proc = spawn('kubectl', args, {
      cwd: this.cwd,
      detached: true,
      stdio: 'ignore',
    });

    proc.unref();

    return {
      success: true,
      output: `Port-forward started: localhost:${localPort} -> ${name}:${remotePort}\nPID: ${proc.pid}`,
    };
  }

  /**
   * Get events in a namespace
   */
  async getEvents(namespace?: string, fieldSelector?: string): Promise<ToolResult> {
    const args = ['get', 'events', '--sort-by=.lastTimestamp'];

    if (namespace) {
      args.push('-n', namespace);
    } else {
      args.push('-A');
    }

    if (fieldSelector) {
      args.push('--field-selector', fieldSelector);
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || 'Failed to get events',
      };
    }

    return {
      success: true,
      output: result.stdout || 'No events found',
    };
  }

  /**
   * Get resource usage (requires metrics-server)
   */
  async top(resourceType: 'pods' | 'nodes', namespace?: string): Promise<ToolResult> {
    const args = ['top', resourceType];

    if (resourceType === 'pods' && namespace) {
      args.push('-n', namespace);
    } else if (resourceType === 'pods') {
      args.push('-A');
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to get ${resourceType} metrics. Is metrics-server installed?`,
      };
    }

    return {
      success: true,
      output: result.stdout,
    };
  }

  /**
   * Create a namespace
   */
  async createNamespace(name: string): Promise<ToolResult> {
    // Request confirmation
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes create namespace',
          filename: name,
          showVSCodeOpen: false,
          content: `Create namespace: ${name}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Create namespace cancelled by user',
        };
      }
    }

    const result = await this.execKubectl(['create', 'namespace', name]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to create namespace ${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `Namespace ${name} created`,
    };
  }

  /**
   * Set current namespace for subsequent commands
   */
  async setNamespace(namespace: string): Promise<ToolResult> {
    const result = await this.execKubectl([
      'config',
      'set-context',
      '--current',
      `--namespace=${namespace}`,
    ]);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to set namespace ${namespace}`,
      };
    }

    this.currentNamespace = namespace;
    return {
      success: true,
      output: `Namespace set to: ${namespace}`,
    };
  }

  /**
   * Create a ConfigMap from literal values or file
   */
  async createConfigMap(
    name: string,
    data: Record<string, string>,
    namespace?: string
  ): Promise<ToolResult> {
    // Request confirmation
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes create configmap',
          filename: name,
          showVSCodeOpen: false,
          content: `Create ConfigMap: ${name}\nKeys: ${Object.keys(data).join(', ')}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Create configmap cancelled by user',
        };
      }
    }

    const args = ['create', 'configmap', name];

    for (const [key, value] of Object.entries(data)) {
      args.push(`--from-literal=${key}=${value}`);
    }

    if (namespace) {
      args.push('-n', namespace);
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to create ConfigMap ${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `ConfigMap ${name} created`,
    };
  }

  /**
   * Create a Secret from literal values
   */
  async createSecret(
    name: string,
    data: Record<string, string>,
    namespace?: string,
    type: string = 'generic'
  ): Promise<ToolResult> {
    // Request confirmation
    const sessionFlags = this.confirmationService.getSessionFlags();
    if (!sessionFlags.bashCommands && !sessionFlags.allOperations) {
      const confirmationResult = await this.confirmationService.requestConfirmation(
        {
          operation: 'Kubernetes create secret',
          filename: name,
          showVSCodeOpen: false,
          content: `Create Secret: ${name}\nKeys: ${Object.keys(data).join(', ')}\nType: ${type}`,
        },
        'bash'
      );

      if (!confirmationResult.confirmed) {
        return {
          success: false,
          error: confirmationResult.feedback || 'Create secret cancelled by user',
        };
      }
    }

    const args = ['create', 'secret', type, name];

    for (const [key, value] of Object.entries(data)) {
      args.push(`--from-literal=${key}=${value}`);
    }

    if (namespace) {
      args.push('-n', namespace);
    }

    const result = await this.execKubectl(args);

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: result.stderr || `Failed to create Secret ${name}`,
      };
    }

    return {
      success: true,
      output: result.stdout || `Secret ${name} created`,
    };
  }
}

// Singleton instance
let kubernetesToolInstance: KubernetesTool | null = null;

export function getKubernetesTool(cwd?: string): KubernetesTool {
  if (!kubernetesToolInstance || cwd) {
    kubernetesToolInstance = new KubernetesTool(cwd);
  }
  return kubernetesToolInstance;
}
