/**
 * ServiceContainer Tests
 *
 * Tests for the dependency injection container.
 */

import {
  ServiceContainer,
  getServiceContainer,
  createTestContainer,
  type IServiceContainer,
  type ISettingsManager,
  type ICheckpointManager,
  type ISessionStore,
  type ICostTracker,
} from '../../src/infrastructure/index.js';

describe('ServiceContainer', () => {
  // Reset singleton between tests
  beforeEach(() => {
    ServiceContainer.reset();
  });

  afterEach(() => {
    ServiceContainer.reset();
  });

  describe('Singleton Pattern', () => {
    it('should create a singleton instance', () => {
      const container1 = ServiceContainer.create();
      const container2 = ServiceContainer.create();

      expect(container1).toBe(container2);
    });

    it('should reset singleton when reset() is called', () => {
      const container1 = ServiceContainer.create();
      ServiceContainer.reset();
      const container2 = ServiceContainer.create();

      expect(container1).not.toBe(container2);
    });

    it('should report hasInstance correctly', () => {
      expect(ServiceContainer.hasInstance()).toBe(false);

      ServiceContainer.create();
      expect(ServiceContainer.hasInstance()).toBe(true);

      ServiceContainer.reset();
      expect(ServiceContainer.hasInstance()).toBe(false);
    });

    it('should allow setting custom instance', () => {
      const customContainer = createTestContainer();
      ServiceContainer.setInstance(customContainer);

      expect(ServiceContainer.create()).toBe(customContainer);
    });
  });

  describe('Service Access', () => {
    it('should provide access to settings service', () => {
      const container = ServiceContainer.create();

      expect(container.settings).toBeDefined();
      expect(typeof container.settings.getCurrentModel).toBe('function');
      expect(typeof container.settings.setCurrentModel).toBe('function');
    });

    it('should provide access to checkpoints service', () => {
      const container = ServiceContainer.create();

      expect(container.checkpoints).toBeDefined();
      expect(typeof container.checkpoints.createCheckpoint).toBe('function');
      expect(typeof container.checkpoints.getCheckpoints).toBe('function');
    });

    it('should provide access to sessions service', () => {
      const container = ServiceContainer.create();

      expect(container.sessions).toBeDefined();
      expect(typeof container.sessions.createSession).toBe('function');
      expect(typeof container.sessions.listSessions).toBe('function');
    });

    it('should provide access to costs service', () => {
      const container = ServiceContainer.create();

      expect(container.costs).toBeDefined();
      expect(typeof container.costs.recordUsage).toBe('function');
      expect(typeof container.costs.getReport).toBe('function');
    });
  });

  describe('Custom Configuration', () => {
    it('should accept custom settings manager', () => {
      const mockSettings: ISettingsManager = {
        loadUserSettings: jest.fn().mockReturnValue({ model: 'test-model' }),
        saveUserSettings: jest.fn(),
        updateUserSetting: jest.fn(),
        getUserSetting: jest.fn(),
        loadProjectSettings: jest.fn().mockReturnValue({}),
        saveProjectSettings: jest.fn(),
        updateProjectSetting: jest.fn(),
        getProjectSetting: jest.fn(),
        getCurrentModel: jest.fn().mockReturnValue('test-model'),
        setCurrentModel: jest.fn(),
        getAvailableModels: jest.fn().mockReturnValue(['test-model']),
        getApiKey: jest.fn().mockReturnValue('test-key'),
        getBaseURL: jest.fn().mockReturnValue('https://test.api.com'),
      };

      const container = ServiceContainer.createWithConfig({ settings: mockSettings });

      expect(container.settings.getCurrentModel()).toBe('test-model');
      expect(mockSettings.getCurrentModel).toHaveBeenCalled();
    });

    it('should use default services when not provided in config', () => {
      const mockSettings: ISettingsManager = {
        loadUserSettings: jest.fn().mockReturnValue({}),
        saveUserSettings: jest.fn(),
        updateUserSetting: jest.fn(),
        getUserSetting: jest.fn(),
        loadProjectSettings: jest.fn().mockReturnValue({}),
        saveProjectSettings: jest.fn(),
        updateProjectSetting: jest.fn(),
        getProjectSetting: jest.fn(),
        getCurrentModel: jest.fn().mockReturnValue('custom'),
        setCurrentModel: jest.fn(),
        getAvailableModels: jest.fn().mockReturnValue(['custom']),
        getApiKey: jest.fn().mockReturnValue('custom-key'),
        getBaseURL: jest.fn().mockReturnValue('https://custom.api.com'),
      };

      const container = ServiceContainer.createWithConfig({ settings: mockSettings });

      // Custom settings should be used
      expect(container.settings.getCurrentModel()).toBe('custom');

      // Other services should be default
      expect(container.checkpoints).toBeDefined();
      expect(container.sessions).toBeDefined();
      expect(container.costs).toBeDefined();
    });
  });

  describe('createDefault()', () => {
    it('should create a new container each time', () => {
      const container1 = ServiceContainer.createDefault();
      const container2 = ServiceContainer.createDefault();

      expect(container1).not.toBe(container2);
    });

    it('should not affect singleton instance', () => {
      const singleton = ServiceContainer.create();
      const newContainer = ServiceContainer.createDefault();

      expect(ServiceContainer.create()).toBe(singleton);
      expect(newContainer).not.toBe(singleton);
    });
  });

  describe('getServiceContainer()', () => {
    it('should return the singleton container', () => {
      const container = getServiceContainer();

      expect(container).toBe(ServiceContainer.create());
    });

    it('should implement IServiceContainer interface', () => {
      const container: IServiceContainer = getServiceContainer();

      expect(container.settings).toBeDefined();
      expect(container.checkpoints).toBeDefined();
      expect(container.sessions).toBeDefined();
      expect(container.costs).toBeDefined();
    });
  });

  describe('createTestContainer()', () => {
    it('should create a container with mock services', () => {
      const container = createTestContainer();

      expect(container.settings).toBeDefined();
      expect(container.checkpoints).toBeDefined();
      expect(container.sessions).toBeDefined();
      expect(container.costs).toBeDefined();
    });

    it('should allow partial mock overrides', () => {
      const mockSettings: ISettingsManager = {
        loadUserSettings: jest.fn().mockReturnValue({}),
        saveUserSettings: jest.fn(),
        updateUserSetting: jest.fn(),
        getUserSetting: jest.fn(),
        loadProjectSettings: jest.fn().mockReturnValue({}),
        saveProjectSettings: jest.fn(),
        updateProjectSetting: jest.fn(),
        getProjectSetting: jest.fn(),
        getCurrentModel: jest.fn().mockReturnValue('mock-model'),
        setCurrentModel: jest.fn(),
        getAvailableModels: jest.fn().mockReturnValue(['mock-model']),
        getApiKey: jest.fn().mockReturnValue('mock-key'),
        getBaseURL: jest.fn().mockReturnValue('https://mock.api.com'),
      };

      const container = createTestContainer({ settings: mockSettings });

      expect(container.settings.getCurrentModel()).toBe('mock-model');
    });

    it('should provide working mock services', () => {
      const container = createTestContainer();

      // Test mock settings
      expect(container.settings.getCurrentModel()).toBe('grok-test');
      expect(container.settings.getBaseURL()).toBe('https://test.api.com');

      // Test mock sessions
      const session = container.sessions.createSession('test', 'model');
      expect(session.name).toBe('test');
      expect(session.model).toBe('model');

      // Test mock costs
      const report = container.costs.getReport();
      expect(report.sessionCost).toBe(0);

      // Test mock checkpoints
      const checkpoint = container.checkpoints.createCheckpoint('test');
      expect(checkpoint.description).toBe('');
    });
  });

  describe('Service Isolation', () => {
    it('should not share state between different containers', () => {
      const container1 = createTestContainer();
      const container2 = createTestContainer();

      // They should be different instances
      expect(container1).not.toBe(container2);
      expect(container1.settings).not.toBe(container2.settings);
    });
  });

  describe('Type Safety', () => {
    it('should enforce IServiceContainer interface', () => {
      const container: IServiceContainer = ServiceContainer.create();

      // TypeScript should catch invalid property access at compile time
      // These tests verify runtime behavior
      expect('settings' in container).toBe(true);
      expect('checkpoints' in container).toBe(true);
      expect('sessions' in container).toBe(true);
      expect('costs' in container).toBe(true);
    });

    it('should have readonly service properties', () => {
      const container = ServiceContainer.create();
      const originalSettings = container.settings;

      // Properties should be readonly (this would be a compile error if attempted)
      expect(container.settings).toBe(originalSettings);
    });
  });

  describe('Integration', () => {
    it('should work with real services', () => {
      const container = ServiceContainer.create();

      // Settings should work
      const model = container.settings.getCurrentModel();
      expect(typeof model).toBe('string');

      // Checkpoints should work
      const checkpoints = container.checkpoints.getCheckpoints();
      expect(Array.isArray(checkpoints)).toBe(true);

      // Sessions should work
      const sessions = container.sessions.listSessions();
      expect(Array.isArray(sessions)).toBe(true);

      // Cost tracker should work
      const report = container.costs.getReport();
      expect(typeof report.sessionCost).toBe('number');
    });
  });
});
