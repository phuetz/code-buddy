/**
 * Agent Configuration Tests
 */

import {
  createAgentConfig,
  generateSessionKey,
  parseSessionKey,
  isCapabilityAllowed,
  isToolGroupAllowed,
  DEFAULT_CAPABILITIES,
} from '../../../src/agent/isolation/agent-config.js';

describe('Agent Configuration', () => {
  describe('createAgentConfig', () => {
    it('should create config with defaults', () => {
      const config = createAgentConfig('agent-1', 'coding', 'Coding Agent');

      expect(config.id).toBe('agent-1');
      expect(config.type).toBe('coding');
      expect(config.name).toBe('Coding Agent');
      expect(config.capabilities).toEqual(DEFAULT_CAPABILITIES.coding);
      expect(config.maxConcurrentOps).toBe(5);
    });

    it('should apply overrides', () => {
      const config = createAgentConfig('agent-1', 'coding', 'Coding Agent', {
        maxConcurrentOps: 10,
        description: 'A custom coding agent',
      });

      expect(config.maxConcurrentOps).toBe(10);
      expect(config.description).toBe('A custom coding agent');
    });

    it('should use type-specific default capabilities', () => {
      const codingConfig = createAgentConfig('a1', 'coding', 'Coding');
      const researchConfig = createAgentConfig('a2', 'research', 'Research');

      expect(codingConfig.capabilities.canWrite).toBe(true);
      expect(researchConfig.capabilities.canWrite).toBe(false);
    });
  });

  describe('generateSessionKey', () => {
    it('should generate formatted session key', () => {
      const key = generateSessionKey('agent-1', 'session-abc');
      expect(key).toBe('agent:agent-1:session-abc');
    });
  });

  describe('parseSessionKey', () => {
    it('should parse valid session key', () => {
      const result = parseSessionKey('agent:agent-1:session-abc');

      expect(result).toEqual({
        agentId: 'agent-1',
        sessionId: 'session-abc',
      });
    });

    it('should return null for invalid key', () => {
      expect(parseSessionKey('invalid')).toBeNull();
      expect(parseSessionKey('wrong:format')).toBeNull();
      expect(parseSessionKey('notAgent:id:session')).toBeNull();
    });
  });

  describe('isCapabilityAllowed', () => {
    it('should check boolean capabilities', () => {
      const config = createAgentConfig('a1', 'coding', 'Coding');

      expect(isCapabilityAllowed(config, 'canRead')).toBe(true);
      expect(isCapabilityAllowed(config, 'canWrite')).toBe(true);
      expect(isCapabilityAllowed(config, 'canNetwork')).toBe(false);
    });

    it('should return false for non-boolean capabilities', () => {
      const config = createAgentConfig('a1', 'coding', 'Coding');

      // Testing runtime behavior with a key that has a non-boolean value
      expect(isCapabilityAllowed(config, 'allowedToolGroups' as keyof typeof config.capabilities)).toBe(false);
    });
  });

  describe('isToolGroupAllowed', () => {
    it('should allow tool groups in allowed list', () => {
      const config = createAgentConfig('a1', 'coding', 'Coding');

      expect(isToolGroupAllowed(config, 'group:fs')).toBe(true);
      expect(isToolGroupAllowed(config, 'group:git')).toBe(true);
    });

    it('should deny tool groups in denied list', () => {
      const config = createAgentConfig('a1', 'coding', 'Coding');

      expect(isToolGroupAllowed(config, 'group:dangerous')).toBe(false);
    });

    it('should allow child groups when parent is allowed', () => {
      const config = createAgentConfig('a1', 'coding', 'Coding');

      expect(isToolGroupAllowed(config, 'group:fs:read')).toBe(true);
      expect(isToolGroupAllowed(config, 'group:fs:write')).toBe(true);
    });

    it('should deny child groups when parent is denied', () => {
      const config = createAgentConfig('a1', 'coding', 'Coding');

      expect(isToolGroupAllowed(config, 'group:dangerous:shell')).toBe(false);
    });

    it('should handle custom agent with empty allowed list', () => {
      const config = createAgentConfig('a1', 'custom', 'Custom');

      // Empty allowed list = allow all (except denied)
      expect(isToolGroupAllowed(config, 'group:anything')).toBe(true);
    });
  });
});
