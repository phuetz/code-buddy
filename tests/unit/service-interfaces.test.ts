/**
 * Service Interfaces Tests
 *
 * Tests to verify that the service interfaces are properly defined
 * and can be implemented.
 */

import type {
  IService,
  IHealthCheckable,
  IHealthCheckResult,
  HealthStatus,
  IServiceRegistry,
  IServiceMetadata,
  IDisposable,
  ISyncDisposable,
  ServiceScope,
  IServiceDescriptor,
  ILogger,
  ILogContext,
  LogLevel,
  IEventEmitter,
  EventHandler,
  IConfigProvider,
} from '../../src/infrastructure/interfaces/index.js';

describe('Service Interfaces', () => {
  describe('IService', () => {
    it('should be implementable', async () => {
      class MockService implements IService {
        readonly id = 'mock-service';
        readonly name = 'Mock Service';
        private initialized = false;

        isInitialized(): boolean {
          return this.initialized;
        }

        async initialize(): Promise<void> {
          this.initialized = true;
        }

        async dispose(): Promise<void> {
          this.initialized = false;
        }
      }

      const service = new MockService();

      expect(service.id).toBe('mock-service');
      expect(service.name).toBe('Mock Service');
      expect(service.isInitialized()).toBe(false);

      await service.initialize();
      expect(service.isInitialized()).toBe(true);

      await service.dispose();
      expect(service.isInitialized()).toBe(false);
    });
  });

  describe('IHealthCheckable', () => {
    it('should be implementable', async () => {
      class HealthyService implements IHealthCheckable {
        async checkHealth(): Promise<IHealthCheckResult> {
          return {
            status: 'healthy',
            message: 'Service is running normally',
            lastCheck: new Date(),
            details: { uptime: 1000 },
          };
        }
      }

      class DegradedService implements IHealthCheckable {
        async checkHealth(): Promise<IHealthCheckResult> {
          return {
            status: 'degraded',
            message: 'Service is running with reduced capacity',
            lastCheck: new Date(),
          };
        }
      }

      const healthy = new HealthyService();
      const degraded = new DegradedService();

      const healthyResult = await healthy.checkHealth();
      expect(healthyResult.status).toBe('healthy');
      expect(healthyResult.details?.uptime).toBe(1000);

      const degradedResult = await degraded.checkHealth();
      expect(degradedResult.status).toBe('degraded');
    });

    it('should support all health statuses', () => {
      const statuses: HealthStatus[] = ['healthy', 'degraded', 'unhealthy', 'unknown'];
      expect(statuses).toHaveLength(4);
    });
  });

  describe('IServiceRegistry', () => {
    it('should be implementable', async () => {
      class MockServiceRegistry implements IServiceRegistry {
        private services = new Map<string, IService>();
        private factories = new Map<string, () => IService | Promise<IService>>();

        register<T extends IService>(
          serviceId: string,
          factory: () => T | Promise<T>,
          _options?: { immediate?: boolean; priority?: number; metadata?: IServiceMetadata }
        ): void {
          this.factories.set(serviceId, factory);
        }

        get<T extends IService>(serviceId: string): T | undefined {
          return this.services.get(serviceId) as T | undefined;
        }

        has(serviceId: string): boolean {
          return this.factories.has(serviceId) || this.services.has(serviceId);
        }

        getServiceIds(): string[] {
          return [...new Set([...this.factories.keys(), ...this.services.keys()])];
        }

        async initializeAll(): Promise<void> {
          for (const [id, factory] of this.factories) {
            const service = await factory();
            await service.initialize();
            this.services.set(id, service);
          }
        }

        async disposeAll(): Promise<void> {
          for (const service of this.services.values()) {
            await service.dispose();
          }
          this.services.clear();
        }
      }

      const registry = new MockServiceRegistry();

      // Test registration
      registry.register('test-service', () => ({
        id: 'test-service',
        name: 'Test Service',
        isInitialized: () => true,
        initialize: async () => {},
        dispose: async () => {},
      }));

      expect(registry.has('test-service')).toBe(true);
      expect(registry.has('unknown-service')).toBe(false);
      expect(registry.getServiceIds()).toContain('test-service');

      // Test initialization
      await registry.initializeAll();
      const service = registry.get<IService>('test-service');
      expect(service).toBeDefined();
      expect(service?.id).toBe('test-service');

      // Test disposal
      await registry.disposeAll();
    });
  });

  describe('IDisposable', () => {
    it('should support async disposal', async () => {
      class AsyncDisposable implements IDisposable {
        disposed = false;

        async dispose(): Promise<void> {
          await new Promise(resolve => setTimeout(resolve, 10));
          this.disposed = true;
        }
      }

      const resource = new AsyncDisposable();
      expect(resource.disposed).toBe(false);

      await resource.dispose();
      expect(resource.disposed).toBe(true);
    });
  });

  describe('ISyncDisposable', () => {
    it('should support sync disposal', () => {
      class SyncDisposable implements ISyncDisposable {
        disposed = false;

        dispose(): void {
          this.disposed = true;
        }
      }

      const resource = new SyncDisposable();
      expect(resource.disposed).toBe(false);

      resource.dispose();
      expect(resource.disposed).toBe(true);
    });
  });

  describe('IServiceDescriptor', () => {
    it('should define service descriptors correctly', () => {
      const scopes: ServiceScope[] = ['singleton', 'transient', 'scoped'];
      expect(scopes).toHaveLength(3);

      const descriptor: IServiceDescriptor<IService> = {
        id: 'my-service',
        scope: 'singleton',
        factory: () => ({
          id: 'my-service',
          name: 'My Service',
          isInitialized: () => false,
          initialize: async () => {},
          dispose: async () => {},
        }),
        dependencies: ['dep1', 'dep2'],
      };

      expect(descriptor.id).toBe('my-service');
      expect(descriptor.scope).toBe('singleton');
      expect(descriptor.dependencies).toEqual(['dep1', 'dep2']);
    });
  });

  describe('ILogger', () => {
    it('should be implementable', () => {
      const logs: { level: LogLevel; message: string; context?: ILogContext }[] = [];

      const logger: ILogger = {
        debug: (message: string, context?: ILogContext) => {
          logs.push({ level: 'debug', message, context });
        },
        info: (message: string, context?: ILogContext) => {
          logs.push({ level: 'info', message, context });
        },
        warn: (message: string, context?: ILogContext) => {
          logs.push({ level: 'warn', message, context });
        },
        error: (message: string, context?: ILogContext) => {
          logs.push({ level: 'error', message, context });
        },
      };

      logger.debug('Debug message');
      logger.info('Info message', { key: 'value' });
      logger.warn('Warning message');
      logger.error('Error message', { errorCode: 500 });

      expect(logs).toHaveLength(4);
      expect(logs[0]).toEqual({ level: 'debug', message: 'Debug message', context: undefined });
      expect(logs[1]).toEqual({ level: 'info', message: 'Info message', context: { key: 'value' } });
      expect(logs[2]).toEqual({ level: 'warn', message: 'Warning message', context: undefined });
      expect(logs[3]).toEqual({
        level: 'error',
        message: 'Error message',
        context: { errorCode: 500 },
      });
    });
  });

  describe('IEventEmitter', () => {
    it('should be implementable with type safety', () => {
      type TestEvents = {
        message: string;
        count: number;
        data: { id: string; value: number };
      };

      class TypedEventEmitter implements IEventEmitter<TestEvents> {
        private handlers = new Map<keyof TestEvents, Set<EventHandler<unknown>>>();

        on<K extends keyof TestEvents>(event: K, handler: EventHandler<TestEvents[K]>): void {
          if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
          }
          this.handlers.get(event)!.add(handler as EventHandler<unknown>);
        }

        off<K extends keyof TestEvents>(event: K, handler: EventHandler<TestEvents[K]>): void {
          this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
        }

        emit<K extends keyof TestEvents>(event: K, data: TestEvents[K]): void {
          this.handlers.get(event)?.forEach(handler => handler(data));
        }

        once<K extends keyof TestEvents>(event: K, handler: EventHandler<TestEvents[K]>): void {
          const wrapper: EventHandler<TestEvents[K]> = data => {
            this.off(event, wrapper);
            handler(data);
          };
          this.on(event, wrapper);
        }
      }

      const emitter = new TypedEventEmitter();
      const messageHandler = jest.fn();
      const countHandler = jest.fn();

      emitter.on('message', messageHandler);
      emitter.on('count', countHandler);

      emitter.emit('message', 'Hello');
      emitter.emit('count', 42);

      expect(messageHandler).toHaveBeenCalledWith('Hello');
      expect(countHandler).toHaveBeenCalledWith(42);

      // Test off
      emitter.off('message', messageHandler);
      emitter.emit('message', 'World');
      expect(messageHandler).toHaveBeenCalledTimes(1);

      // Test once
      const onceHandler = jest.fn();
      emitter.once('count', onceHandler);
      emitter.emit('count', 1);
      emitter.emit('count', 2);
      expect(onceHandler).toHaveBeenCalledTimes(1);
      expect(onceHandler).toHaveBeenCalledWith(1);
    });
  });

  describe('IConfigProvider', () => {
    it('should be implementable', () => {
      interface AppConfig {
        apiUrl: string;
        timeout: number;
        debug: boolean;
      }

      class MockConfigProvider implements IConfigProvider<AppConfig> {
        private config: AppConfig = {
          apiUrl: 'https://api.example.com',
          timeout: 30000,
          debug: false,
        };

        get<K extends keyof AppConfig>(key: K): AppConfig[K] {
          return this.config[key];
        }

        getOrDefault<K extends keyof AppConfig>(key: K, defaultValue: AppConfig[K]): AppConfig[K] {
          return this.config[key] ?? defaultValue;
        }

        has<K extends keyof AppConfig>(key: K): boolean {
          return key in this.config;
        }

        getAll(): AppConfig {
          return { ...this.config };
        }
      }

      const provider = new MockConfigProvider();

      expect(provider.get('apiUrl')).toBe('https://api.example.com');
      expect(provider.get('timeout')).toBe(30000);
      expect(provider.get('debug')).toBe(false);

      expect(provider.has('apiUrl')).toBe(true);
      expect(provider.getAll()).toEqual({
        apiUrl: 'https://api.example.com',
        timeout: 30000,
        debug: false,
      });
    });
  });

  describe('IServiceMetadata', () => {
    it('should define service metadata', () => {
      const metadata: IServiceMetadata = {
        id: 'my-service',
        name: 'My Service',
        description: 'A test service',
        version: '1.0.0',
        dependencies: ['dep1', 'dep2'],
      };

      expect(metadata.id).toBe('my-service');
      expect(metadata.name).toBe('My Service');
      expect(metadata.description).toBe('A test service');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.dependencies).toEqual(['dep1', 'dep2']);
    });
  });
});
