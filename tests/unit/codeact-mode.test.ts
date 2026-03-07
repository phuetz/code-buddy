/**
 * CodeAct Mode Tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CodeActMode, getCodeActMode } from '../../src/agent/modes/codeact-mode.js';

describe('CodeActMode', () => {
  beforeEach(() => {
    CodeActMode.resetInstance();
  });

  describe('singleton', () => {
    it('returns same instance', () => {
      const a = getCodeActMode();
      const b = getCodeActMode();
      expect(a).toBe(b);
    });

    it('resetInstance creates new instance', () => {
      const a = getCodeActMode();
      CodeActMode.resetInstance();
      const b = getCodeActMode();
      expect(a).not.toBe(b);
    });
  });

  describe('enable/disable', () => {
    it('defaults to disabled', () => {
      expect(getCodeActMode().isEnabled()).toBe(false);
    });

    it('can be enabled', () => {
      getCodeActMode().enable();
      expect(getCodeActMode().isEnabled()).toBe(true);
    });

    it('can be disabled', () => {
      getCodeActMode().enable();
      getCodeActMode().disable();
      expect(getCodeActMode().isEnabled()).toBe(false);
    });

    it('toggle flips state', () => {
      const mode = getCodeActMode();
      expect(mode.toggle()).toBe(true);
      expect(mode.toggle()).toBe(false);
    });

    it('can enable with custom config', () => {
      getCodeActMode().enable({ language: 'typescript', scriptTimeout: 60000 });
      const config = getCodeActMode().getConfig();
      expect(config.language).toBe('typescript');
      expect(config.scriptTimeout).toBe(60000);
    });
  });

  describe('getSystemPrompt', () => {
    it('returns empty string when disabled', () => {
      expect(getCodeActMode().getSystemPrompt()).toBe('');
    });

    it('returns prompt with language when enabled', () => {
      getCodeActMode().enable({ language: 'python' });
      const prompt = getCodeActMode().getSystemPrompt();
      expect(prompt).toContain('CodeAct mode');
      expect(prompt).toContain('python');
    });

    it('replaces language placeholder', () => {
      getCodeActMode().enable({ language: 'typescript' });
      const prompt = getCodeActMode().getSystemPrompt();
      expect(prompt).toContain('typescript');
    });
  });

  describe('filterTools', () => {
    const mockTools = [
      { function: { name: 'run_script' } },
      { function: { name: 'view_file' } },
      { function: { name: 'search' } },
      { function: { name: 'bash' } },
      { function: { name: 'docker' } },
      { function: { name: 'git' } },
      { function: { name: 'reason' } },
      { function: { name: 'list_directory' } },
      { function: { name: 'create_file' } },
    ];

    it('returns all tools when disabled', () => {
      const result = getCodeActMode().filterTools(mockTools);
      expect(result).toHaveLength(mockTools.length);
    });

    it('filters to allowed tools when enabled', () => {
      getCodeActMode().enable();
      const result = getCodeActMode().filterTools(mockTools);
      const names = result.map(t => t.function.name);
      expect(names).toContain('run_script');
      expect(names).toContain('view_file');
      expect(names).toContain('search');
      expect(names).toContain('bash');
      expect(names).toContain('list_directory');
      expect(names).toContain('create_file');
      expect(names).not.toContain('docker');
      expect(names).not.toContain('git');
      expect(names).not.toContain('reason');
    });
  });

  describe('stats', () => {
    it('tracks script executions', () => {
      const mode = getCodeActMode();
      mode.enable();
      mode.recordExecution(1000);
      mode.recordExecution(2000);

      const state = mode.getState();
      expect(state.executedScripts).toBe(2);
      expect(state.totalDuration).toBe(3000);
    });

    it('resets stats on enable', () => {
      const mode = getCodeActMode();
      mode.enable();
      mode.recordExecution(1000);
      mode.enable();

      const state = mode.getState();
      expect(state.executedScripts).toBe(0);
      expect(state.totalDuration).toBe(0);
    });
  });

  describe('getAllowedTools', () => {
    it('returns the allowed tool names', () => {
      const tools = getCodeActMode().getAllowedTools();
      expect(tools).toContain('run_script');
      expect(tools).toContain('view_file');
      expect(tools).toContain('bash');
    });
  });

  describe('config', () => {
    it('has sensible defaults', () => {
      const config = getCodeActMode().getConfig();
      expect(config.language).toBe('python');
      expect(config.allowPackageInstall).toBe(true);
      expect(config.scriptTimeout).toBe(120000);
      expect(config.preferE2B).toBe(false);
      expect(config.persistScripts).toBe(true);
    });

    it('can be updated via setConfig', () => {
      const mode = getCodeActMode();
      mode.setConfig({ language: 'shell' });
      expect(mode.getConfig().language).toBe('shell');
      // Other values unchanged
      expect(mode.getConfig().allowPackageInstall).toBe(true);
    });
  });
});
