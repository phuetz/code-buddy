/**
 * Docker Sandbox Module
 *
 * Per-session Docker isolation for secure code execution.
 *
 * Features:
 * - Session-to-container mapping
 * - Per-container tool policies
 * - Network policies
 * - Resource limits
 * - Health monitoring
 */

// Types
export type {
  DockerSandboxConfig,
  SessionContainer,
  ContainerStatus,
  ExecutionOptions,
  ExecutionResult,
  NetworkPolicy,
  ContainerMetrics,
  VolumeMount,
  ResourceLimits,
  PoolConfig,
  SandboxEvents,
} from './types.js';

export {
  DEFAULT_SANDBOX_CONFIG,
  DEFAULT_NETWORK_POLICY,
  DEFAULT_POOL_CONFIG,
} from './types.js';

// Manager
export {
  DockerSandboxManager,
  DockerCliClient,
  MockDockerClient,
  getDockerSandboxManager,
  resetDockerSandboxManager,
} from './manager.js';

export type {
  IDockerClient,
} from './manager.js';
