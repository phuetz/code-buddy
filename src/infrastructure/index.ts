/**
 * Infrastructure Module
 *
 * Provides dependency injection and service management for the application.
 *
 * @module infrastructure
 */

// Types and interfaces
export type {
  // Settings
  IUserSettings,
  IProjectSettings,
  ISettingsManager,
  // Checkpoints
  IFileSnapshot,
  ICheckpoint,
  ICheckpointManager,
  // Sessions
  ISessionMetadata,
  ISession,
  ISessionMessage,
  ISessionStore,
  // Cost Tracking
  ITokenUsage,
  ICostReport,
  ICostTracker,
  // Container
  IServiceContainer,
  IServiceContainerConfig,
} from './types.js';

// Service interfaces
export type {
  // Service lifecycle
  IService,
  // Health checks
  HealthStatus,
  IHealthCheckResult,
  IHealthCheckable,
  // Registry
  IServiceMetadata,
  IServiceRegistrationOptions,
  IServiceRegistry,
  // Disposable
  IDisposable,
  ISyncDisposable,
  // Service descriptor
  ServiceScope,
  IServiceDescriptor,
  // Logger
  LogLevel,
  ILogContext,
  ILogger,
  // Events
  EventHandler,
  IEventEmitter,
  // Configuration
  IConfigProvider,
} from './interfaces/index.js';

// Service Container
export {
  ServiceContainer,
  getServiceContainer,
  createTestContainer,
} from './service-container.js';
