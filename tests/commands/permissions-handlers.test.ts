/**
 * Tests for permissions-handlers (Claude Code-style tool permissions)
 */

import { handlePermissions } from '../../src/commands/handlers/permissions-handlers';
import { resetToolFilter, getToolFilter } from '../../src/utils/tool-filter';

describe('Permissions Handlers', () => {
  beforeEach(() => {
    resetToolFilter();
  });

  afterEach(() => {
    resetToolFilter();
  });

  describe('handlePermissions', () => {
    it('should return help when no args provided', () => {
      const result = handlePermissions([]);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Tool Permissions Management');
      expect(result.entry?.content).toContain('/permissions');
    });

    it('should return help with "help" arg', () => {
      const result = handlePermissions(['help']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Tool Permissions Management');
    });

    it('should list permissions', () => {
      const result = handlePermissions(['list']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Tool Permissions');
      expect(result.entry?.content).toContain('Commands:');
    });

    it('should show default mode when no permissions set', () => {
      const result = handlePermissions(['list']);

      expect(result.entry?.content).toContain('All tools enabled');
    });
  });

  describe('add permission', () => {
    it('should add a single tool to allowlist', () => {
      const result = handlePermissions(['add', 'bash']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Added');
      expect(result.entry?.content).toContain('bash');

      const filter = getToolFilter();
      expect(filter.enabledPatterns).toContain('bash');
    });

    it('should add multiple tools', () => {
      handlePermissions(['add', 'bash']);
      handlePermissions(['add', 'read_file']);

      const filter = getToolFilter();
      expect(filter.enabledPatterns).toContain('bash');
      expect(filter.enabledPatterns).toContain('read_file');
    });

    it('should show error when no tool specified', () => {
      const result = handlePermissions(['add']);

      expect(result.entry?.content).toContain('Usage:');
    });

    it('should accept "allow" as alias for "add"', () => {
      const result = handlePermissions(['allow', 'bash']);

      expect(result.entry?.content).toContain('Added');
    });

    it('should add category of tools', () => {
      const result = handlePermissions(['add', 'file-read']);

      expect(result.entry?.content).toContain('Added category');
      expect(result.entry?.content).toContain('file-read');

      const filter = getToolFilter();
      expect(filter.enabledPatterns).toContain('read_file');
      expect(filter.enabledPatterns).toContain('search_files');
    });
  });

  describe('remove permission', () => {
    it('should add tool to blocklist', () => {
      const result = handlePermissions(['remove', 'bash']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Blocked');

      const filter = getToolFilter();
      expect(filter.disabledPatterns).toContain('bash');
    });

    it('should accept "deny" as alias', () => {
      const result = handlePermissions(['deny', 'bash']);

      expect(result.entry?.content).toContain('Blocked');
    });

    it('should accept "block" as alias', () => {
      const result = handlePermissions(['block', 'bash']);

      expect(result.entry?.content).toContain('Blocked');
    });

    it('should block category of tools', () => {
      const result = handlePermissions(['remove', 'dangerous']);

      expect(result.entry?.content).toContain('Blocked category');

      const filter = getToolFilter();
      expect(filter.disabledPatterns).toContain('bash');
      expect(filter.disabledPatterns).toContain('execute_command');
    });

    it('should show error when no tool specified', () => {
      const result = handlePermissions(['remove']);

      expect(result.entry?.content).toContain('Usage:');
    });
  });

  describe('reset permission', () => {
    it('should reset permissions to default', () => {
      // First add some permissions
      handlePermissions(['add', 'bash']);
      handlePermissions(['remove', 'read_file']);

      // Then reset
      const result = handlePermissions(['reset']);

      expect(result.entry?.content).toContain('reset');

      const filter = getToolFilter();
      expect(filter.enabledPatterns).toHaveLength(0);
      expect(filter.disabledPatterns).toHaveLength(0);
    });
  });

  describe('list categories', () => {
    it('should list available tool categories', () => {
      const result = handlePermissions(['categories']);

      expect(result.handled).toBe(true);
      expect(result.entry?.content).toContain('Tool Categories');
      expect(result.entry?.content).toContain('file-read');
      expect(result.entry?.content).toContain('file-write');
      expect(result.entry?.content).toContain('bash');
      expect(result.entry?.content).toContain('dangerous');
    });
  });

  describe('permissions list with active permissions', () => {
    it('should show allowed tools', () => {
      handlePermissions(['add', 'bash']);
      handlePermissions(['add', 'read_file']);

      const result = handlePermissions(['list']);

      expect(result.entry?.content).toContain('Allowed tools');
      expect(result.entry?.content).toContain('bash');
      expect(result.entry?.content).toContain('read_file');
    });

    it('should show blocked tools', () => {
      handlePermissions(['remove', 'bash']);
      handlePermissions(['remove', 'execute_command']);

      const result = handlePermissions(['list']);

      expect(result.entry?.content).toContain('Blocked tools');
      expect(result.entry?.content).toContain('bash');
      expect(result.entry?.content).toContain('execute_command');
    });
  });

  describe('entry structure', () => {
    it('should return proper entry type', () => {
      const result = handlePermissions(['list']);

      expect(result.entry?.type).toBe('assistant');
      expect(result.entry?.timestamp).toBeInstanceOf(Date);
    });

    it('should always set handled to true', () => {
      const results = [
        handlePermissions([]),
        handlePermissions(['list']),
        handlePermissions(['add', 'bash']),
        handlePermissions(['remove', 'bash']),
        handlePermissions(['reset']),
        handlePermissions(['categories']),
        handlePermissions(['help']),
      ];

      results.forEach(result => {
        expect(result.handled).toBe(true);
      });
    });
  });
});
