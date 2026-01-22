/**
 * Service Interfaces
 *
 * Base interfaces for services in the CodeBuddy system.
 * These interfaces define the lifecycle and dependency patterns
 * for all services.
 */

// ============================================================================
// Service Lifecycle Interface
// ============================================================================

/**
 * Base interface for all services.
 *
 * Defines the minimal contract for service lifecycle management:
 * - Initialization
 * - Disposal
 * - Health checks
 */
export interface IService {
  /**
   * Unique service identifier
   */
  readonly id: string;

  /**
   * Service name for display/logging
   */
  readonly name: string;

  /**
   * Check if the service is initialized
   */
  isInitialized(): boolean;

  /**
   * Initialize the service
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void>;

  /**
   * Dispose of service resources
   * @returns Promise that resolves when disposal is complete
   */
  dispose(): Promise<void>;
}

// ============================================================================
// Service Health Interface
// ============================================================================

/**
 * Health status of a service
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Health check result
 */
export interface IHealthCheckResult {
  status: HealthStatus;
  message?: string;
  lastCheck: Date;
  details?: Record<string, unknown>;
}

/**
 * Interface for services that support health checks
 */
export interface IHealthCheckable {
  /**
   * Check the health of the service
   */
  checkHealth(): Promise<IHealthCheckResult>;
}

// ============================================================================
// Service Registry Interface
// ============================================================================

/**
 * Service metadata for registration
 */
export interface IServiceMetadata {
  id: string;
  name: string;
  description?: string;
  version?: string;
  dependencies?: string[];
}

/**
 * Service registration options
 */
export interface IServiceRegistrationOptions {
  /**
   * Whether the service should be initialized immediately
   */
  immediate?: boolean;

  /**
   * Priority for initialization order (higher = earlier)
   */
  priority?: number;

  /**
   * Service metadata
   */
  metadata?: IServiceMetadata;
}

/**
 * Interface for service registry
 */
export interface IServiceRegistry {
  /**
   * Register a service
   */
  register<T extends IService>(
    serviceId: string,
    factory: () => T | Promise<T>,
    options?: IServiceRegistrationOptions
  ): void;

  /**
   * Get a service by ID
   */
  get<T extends IService>(serviceId: string): T | undefined;

  /**
   * Check if a service is registered
   */
  has(serviceId: string): boolean;

  /**
   * Get all registered service IDs
   */
  getServiceIds(): string[];

  /**
   * Initialize all registered services
   */
  initializeAll(): Promise<void>;

  /**
   * Dispose all registered services
   */
  disposeAll(): Promise<void>;
}

// ============================================================================
// Disposable Interface
// ============================================================================

/**
 * Interface for disposable resources
 */
export interface IDisposable {
  /**
   * Dispose of resources
   */
  dispose(): void | Promise<void>;
}

/**
 * Interface for synchronously disposable resources
 */
export interface ISyncDisposable {
  /**
   * Dispose of resources synchronously
   */
  dispose(): void;
}

// ============================================================================
// Service Scope Interface
// ============================================================================

/**
 * Service lifetime scope
 */
export type ServiceScope = 'singleton' | 'transient' | 'scoped';

/**
 * Service descriptor
 */
export interface IServiceDescriptor<T = unknown> {
  /**
   * Service identifier
   */
  id: string;

  /**
   * Service lifetime scope
   */
  scope: ServiceScope;

  /**
   * Factory function to create the service
   */
  factory: () => T | Promise<T>;

  /**
   * Dependencies required by this service
   */
  dependencies?: string[];
}

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Log level
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log context
 */
export interface ILogContext {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Logger interface for service logging
 */
export interface ILogger {
  debug(message: string, context?: ILogContext): void;
  info(message: string, context?: ILogContext): void;
  warn(message: string, context?: ILogContext): void;
  error(message: string, context?: ILogContext): void;
}

// ============================================================================
// Event Emitter Interface
// ============================================================================

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (data: T) => void;

/**
 * Type-safe event emitter interface
 */
export interface IEventEmitter<TEvents extends Record<string, unknown>> {
  /**
   * Subscribe to an event
   */
  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void;

  /**
   * Unsubscribe from an event
   */
  off<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void;

  /**
   * Emit an event
   */
  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void;

  /**
   * Subscribe to an event once
   */
  once<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void;
}

// ============================================================================
// Configuration Interface
// ============================================================================

/**
 * Configuration provider interface
 */
export interface IConfigProvider<T = Record<string, unknown>> {
  /**
   * Get a configuration value
   */
  get<K extends keyof T>(key: K): T[K];

  /**
   * Get a configuration value with a default
   */
  getOrDefault<K extends keyof T>(key: K, defaultValue: T[K]): T[K];

  /**
   * Check if a configuration key exists
   */
  has<K extends keyof T>(key: K): boolean;

  /**
   * Get all configuration values
   */
  getAll(): T;
}
