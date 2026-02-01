/**
 * Policy Resolver Tests
 */

import { PolicyResolver, getAllowedTools, filterByPolicy } from '../../../src/security/tool-policy/policy-resolver.js';
import { DEFAULT_POLICY_CONFIG, PolicyConfig, PolicyRule } from '../../../src/security/tool-policy/types.js';
import { getToolGroups } from '../../../src/security/tool-policy/tool-groups.js';

describe('PolicyResolver', () => {
  let resolver: PolicyResolver;
  let config: PolicyConfig;

  beforeEach(() => {
    config = { ...DEFAULT_POLICY_CONFIG };
    resolver = new PolicyResolver(config);
  });

  describe('resolve', () => {
    it('should allow read operations with coding profile', () => {
      const decision = resolver.resolve('view_file');
      expect(decision.action).toBe('allow');
      expect(decision.source).toBe('profile');
    });

    it('should allow file write operations with coding profile', () => {
      const decision = resolver.resolve('str_replace_editor');
      expect(decision.action).toBe('allow');
    });

    it('should require confirmation for bash commands with coding profile', () => {
      const decision = resolver.resolve('bash');
      expect(decision.action).toBe('confirm');
    });

    it('should require confirmation for dangerous operations', () => {
      const decision = resolver.resolve('delete_file');
      expect(decision.action).toBe('confirm');
    });

    it('should require confirmation for git write operations', () => {
      const decision = resolver.resolve('git_push');
      expect(decision.action).toBe('confirm');
    });

    it('should allow web search', () => {
      const decision = resolver.resolve('web_search');
      expect(decision.action).toBe('allow');
    });

    it('should handle unknown tools with default action', () => {
      const decision = resolver.resolve('unknown_tool');
      expect(decision.action).toBe('confirm');
      expect(decision.source).toBe('default');
    });
  });

  describe('profile switching', () => {
    it('should deny writes with minimal profile', () => {
      config.activeProfile = 'minimal';
      resolver = new PolicyResolver(config);

      const decision = resolver.resolve('create_file');
      expect(decision.action).toBe('deny');
    });

    it('should allow all operations with full profile', () => {
      config.activeProfile = 'full';
      resolver = new PolicyResolver(config);

      const decision = resolver.resolve('bash');
      expect(decision.action).toBe('allow');
    });

    it('should still require confirmation for dangerous ops in full profile', () => {
      config.activeProfile = 'full';
      resolver = new PolicyResolver(config);

      const decision = resolver.resolve('git_push');
      expect(decision.action).toBe('confirm');
    });
  });

  describe('global rules', () => {
    it('should apply global rule override', () => {
      config.globalRules = [
        {
          group: 'group:runtime:shell',
          action: 'deny',
          reason: 'Shell commands disabled by admin',
          priority: 100,
        },
      ];
      resolver = new PolicyResolver(config);

      const decision = resolver.resolve('bash');
      expect(decision.action).toBe('deny');
      expect(decision.source).toBe('global');
    });

    it('should prioritize higher priority rules', () => {
      config.globalRules = [
        {
          group: 'group:runtime',
          action: 'deny',
          reason: 'Runtime disabled',
          priority: 10,
        },
        {
          group: 'group:runtime:shell',
          action: 'allow',
          reason: 'Shell allowed',
          priority: 20,
        },
      ];
      resolver = new PolicyResolver(config);

      const decision = resolver.resolve('bash');
      expect(decision.action).toBe('allow');
    });
  });

  describe('agent-specific rules', () => {
    it('should apply agent-specific rules', () => {
      config.agentRules = {
        'coding-agent': [
          {
            group: 'group:web',
            action: 'deny',
            reason: 'Web access disabled for coding agent',
          },
        ],
      };
      resolver = new PolicyResolver(config);

      const decision = resolver.resolve('web_fetch', { agentId: 'coding-agent' });
      expect(decision.action).toBe('deny');
      expect(decision.source).toBe('agent');
    });
  });

  describe('session overrides', () => {
    it('should respect session overrides', () => {
      const sessionOverrides = new Map<string, 'allow' | 'deny' | 'confirm'>();
      sessionOverrides.set('bash', 'allow');

      const decision = resolver.resolve('bash', { sessionOverrides });
      expect(decision.action).toBe('allow');
      expect(decision.source).toBe('session');
    });
  });

  describe('conditional rules', () => {
    it('should evaluate path conditions', () => {
      config.globalRules = [
        {
          group: 'group:fs:write',
          action: 'deny',
          reason: 'Cannot modify config files',
          conditions: [
            { type: 'path', value: '**/.env*' },
          ],
        },
      ];
      resolver = new PolicyResolver(config);

      const decisionEnv = resolver.resolve('create_file', { args: { path: '/app/.env' } });
      expect(decisionEnv.action).toBe('deny');

      const decisionOther = resolver.resolve('create_file', { args: { path: '/app/src/index.ts' } });
      expect(decisionOther.action).toBe('allow');
    });
  });
});

describe('Utility functions', () => {
  let resolver: PolicyResolver;

  beforeEach(() => {
    resolver = new PolicyResolver({ ...DEFAULT_POLICY_CONFIG });
  });

  describe('getAllowedTools', () => {
    it('should filter out denied tools', () => {
      const config = { ...DEFAULT_POLICY_CONFIG, activeProfile: 'minimal' as const };
      resolver = new PolicyResolver(config);

      const tools = ['view_file', 'create_file', 'bash'];
      const allowed = getAllowedTools(resolver, tools);

      expect(allowed).toContain('view_file');
      expect(allowed).not.toContain('create_file');
      expect(allowed).not.toContain('bash');
    });
  });

  describe('filterByPolicy', () => {
    it('should filter tools by action', () => {
      const tools = ['view_file', 'bash', 'delete_file'];
      const confirmTools = filterByPolicy(resolver, tools, 'confirm');

      expect(confirmTools).toContain('bash');
      expect(confirmTools).toContain('delete_file');
      expect(confirmTools).not.toContain('view_file');
    });
  });
});
