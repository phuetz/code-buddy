/**
 * Kubernetes Tool Adapters
 *
 * ITool-compliant adapter for KubernetesTool operations.
 * This adapter wraps the existing KubernetesTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { KubernetesTool, K8sResourceType } from '../kubernetes-tool.js';

// ============================================================================
// Shared KubernetesTool Instance
// ============================================================================

let kubernetesInstance: KubernetesTool | null = null;

function getKubernetes(): KubernetesTool {
  if (!kubernetesInstance) {
    kubernetesInstance = new KubernetesTool();
  }
  return kubernetesInstance;
}

/**
 * Reset the shared KubernetesTool instance (for testing)
 */
export function resetKubernetesInstance(): void {
  kubernetesInstance = null;
}

// ============================================================================
// KubernetesOperationTool
// ============================================================================

/**
 * KubernetesOperationTool - ITool adapter for Kubernetes operations
 *
 * Unified tool that handles all Kubernetes operations via an operation parameter.
 */
export class KubernetesOperationTool implements ITool {
  readonly name = 'kubernetes';
  readonly description = 'Execute Kubernetes cluster management operations using kubectl';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;
    const args = (input.args as Record<string, unknown>) || {};

    const k8s = getKubernetes();

    switch (operation) {
      case 'cluster_info':
        return await k8s.clusterInfo();

      case 'get_context':
        return await k8s.getCurrentContext();

      case 'list_contexts':
        return await k8s.listContexts();

      case 'use_context':
        return await k8s.useContext(args.context as string);

      case 'get':
        return await k8s.get(
          args.resourceType as K8sResourceType,
          args.name as string | undefined,
          {
            namespace: args.namespace as string | undefined,
            allNamespaces: args.allNamespaces as boolean | undefined,
            selector: args.selector as string | undefined,
            output: args.output as 'wide' | 'yaml' | 'json' | 'name' | undefined,
          }
        );

      case 'describe':
        return await k8s.describe(
          args.resourceType as K8sResourceType,
          args.name as string,
          args.namespace as string | undefined
        );

      case 'apply':
        return await k8s.apply(args.path as string, {
          namespace: args.namespace as string | undefined,
          dryRun: args.dryRun as boolean | undefined,
          force: args.force as boolean | undefined,
        });

      case 'delete':
        return await k8s.delete(
          args.resourceType as K8sResourceType,
          args.name as string,
          {
            namespace: args.namespace as string | undefined,
            force: args.force as boolean | undefined,
            gracePeriod: args.gracePeriod as number | undefined,
          }
        );

      case 'logs':
        return await k8s.logs(args.name as string, {
          namespace: args.namespace as string | undefined,
          container: args.container as string | undefined,
          tail: args.tail as number | undefined,
          previous: args.previous as boolean | undefined,
          timestamps: args.timestamps as boolean | undefined,
        });

      case 'exec':
        return await k8s.exec(
          args.name as string,
          args.command as string,
          {
            namespace: args.namespace as string | undefined,
            container: args.container as string | undefined,
          }
        );

      case 'scale':
        return await k8s.scale(
          args.resourceType as 'deployments' | 'statefulsets' | 'replicasets',
          args.name as string,
          {
            namespace: args.namespace as string | undefined,
            replicas: args.replicas as number,
          }
        );

      case 'rollout_status':
        return await k8s.rolloutStatus(
          args.resourceType as 'deployments' | 'statefulsets' | 'daemonsets',
          args.name as string,
          args.namespace as string | undefined
        );

      case 'rollout_restart':
        return await k8s.rolloutRestart(
          args.resourceType as 'deployments' | 'statefulsets' | 'daemonsets',
          args.name as string,
          args.namespace as string | undefined
        );

      case 'port_forward':
        return await k8s.portForward(
          args.resourceType as 'pods' | 'services',
          args.name as string,
          args.localPort as number,
          args.remotePort as number,
          args.namespace as string | undefined
        );

      case 'get_events':
        return await k8s.getEvents(
          args.namespace as string | undefined,
          args.fieldSelector as string | undefined
        );

      case 'top':
        return await k8s.top(
          args.resourceType as 'pods' | 'nodes',
          args.namespace as string | undefined
        );

      case 'create_namespace':
        return await k8s.createNamespace(args.name as string);

      case 'set_namespace':
        return await k8s.setNamespace(args.namespace as string);

      case 'create_configmap':
        return await k8s.createConfigMap(
          args.name as string,
          args.data as Record<string, string>,
          args.namespace as string | undefined
        );

      case 'create_secret':
        return await k8s.createSecret(
          args.name as string,
          args.data as Record<string, string>,
          args.namespace as string | undefined,
          args.secretType as string | undefined
        );

      default:
        return {
          success: false,
          error: `Unknown Kubernetes operation: ${operation}`,
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
            description: 'Kubernetes operation to perform',
            enum: [
              'cluster_info',
              'get_context',
              'list_contexts',
              'use_context',
              'get',
              'describe',
              'apply',
              'delete',
              'logs',
              'exec',
              'scale',
              'rollout_status',
              'rollout_restart',
              'port_forward',
              'get_events',
              'top',
              'create_namespace',
              'set_namespace',
              'create_configmap',
              'create_secret',
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
      'cluster_info',
      'get_context',
      'list_contexts',
      'use_context',
      'get',
      'describe',
      'apply',
      'delete',
      'logs',
      'exec',
      'scale',
      'rollout_status',
      'rollout_restart',
      'port_forward',
      'get_events',
      'top',
      'create_namespace',
      'set_namespace',
      'create_configmap',
      'create_secret',
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
      keywords: ['kubernetes', 'k8s', 'kubectl', 'cluster', 'pod', 'deployment', 'service', 'devops'],
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
    resetKubernetesInstance();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all kubernetes tool instances
 */
export function createKubernetesTools(): ITool[] {
  return [
    new KubernetesOperationTool(),
  ];
}
