/**
 * Infrastructure Interfaces Module
 *
 * Exports all infrastructure-related interfaces for dependency injection
 * and type-safe implementations.
 */

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
} from './service.interface.js';
