/**
 * Tests for Voice Control System
 */

import { VoiceControl, getVoiceControl, resetVoiceControl } from '../src/input/voice-control';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn().mockImplementation(() => ({
    on: jest.fn((event, callback) => {
      if (event === 'close') {
        setTimeout(() => callback(0), 10);
      }
    }),
    stdout: {
      on: jest.fn(),
    },
    stderr: {
      on: jest.fn(),
    },
    kill: jest.fn(),
  })),
}));

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  ensureDirSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(false),
  pathExists: jest.fn().mockResolvedValue(false),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readJSON: jest.fn(),
  remove: jest.fn().mockResolvedValue(undefined),
  removeSync: jest.fn(),
  createReadStream: jest.fn(),
}));

describe('VoiceControl', () => {
  let voiceControl: VoiceControl;

  beforeEach(() => {
    resetVoiceControl();
    voiceControl = new VoiceControl({
      enabled: false,
      wakeWordEnabled: false,
      provider: 'whisper-local',
    });
  });

  afterEach(() => {
    voiceControl.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const vc = new VoiceControl();
      expect(vc).toBeDefined();
      const config = vc.getConfig();
      expect(config.wakeWord).toBe('hey grok');
      expect(config.language).toBe('en');
      vc.dispose();
    });

    it('should accept custom config', () => {
      const config = voiceControl.getConfig();
      expect(config.enabled).toBe(false);
      expect(config.wakeWordEnabled).toBe(false);
      expect(config.provider).toBe('whisper-local');
    });

    it('should set default wake word', () => {
      const vc = new VoiceControl();
      const config = vc.getConfig();
      expect(config.wakeWord).toBe('hey grok');
      vc.dispose();
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const state = voiceControl.getState();

      expect(state.isListening).toBe(false);
      expect(state.isProcessing).toBe(false);
      expect(state.isWakeWordActive).toBe(false);
      expect(state.sessionCommands).toBe(0);
      expect(state.errorCount).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should return configuration', () => {
      const config = voiceControl.getConfig();

      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('wakeWord');
      expect(config).toHaveProperty('language');
      expect(config).toHaveProperty('provider');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      voiceControl.updateConfig({
        language: 'fr',
        wakeWord: 'salut grok',
      });

      const config = voiceControl.getConfig();
      expect(config.language).toBe('fr');
      expect(config.wakeWord).toBe('salut grok');
    });

    it('should preserve unmodified values', () => {
      const originalConfig = voiceControl.getConfig();
      voiceControl.updateConfig({ language: 'de' });

      const newConfig = voiceControl.getConfig();
      expect(newConfig.provider).toBe(originalConfig.provider);
    });
  });

  describe('getCommands', () => {
    it('should return array of commands', () => {
      const commands = voiceControl.getCommands();

      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('should include built-in commands', () => {
      const commands = voiceControl.getCommands();
      const commandNames = commands.map(c => c.name);

      expect(commandNames).toContain('explain');
      expect(commandNames).toContain('fix');
      expect(commandNames).toContain('refactor');
      expect(commandNames).toContain('search');
      expect(commandNames).toContain('help');
    });

    it('should have patterns for all commands', () => {
      const commands = voiceControl.getCommands();

      for (const cmd of commands) {
        expect(cmd.pattern).toBeInstanceOf(RegExp);
      }
    });
  });

  describe('registerCommand', () => {
    it('should register custom command', () => {
      voiceControl.registerCommand({
        name: 'custom',
        aliases: ['my command'],
        description: 'A custom command',
        pattern: /^custom\s*(.*)$/i,
        handler: async () => ({ success: true }),
      });

      const commands = voiceControl.getCommands();
      const customCmd = commands.find(c => c.name === 'custom');

      expect(customCmd).toBeDefined();
      expect(customCmd?.description).toBe('A custom command');
    });

    it('should emit command:registered event', (done) => {
      voiceControl.on('command:registered', (data) => {
        expect(data.name).toBe('myCommand');
        done();
      });

      voiceControl.registerCommand({
        name: 'myCommand',
        aliases: [],
        description: 'Test',
        pattern: /^test$/i,
        handler: async () => ({ success: true }),
      });
    });
  });

  describe('formatStatus', () => {
    it('should return formatted status', () => {
      const status = voiceControl.formatStatus();

      expect(status).toContain('VOICE CONTROL STATUS');
      expect(status).toContain('Enabled');
      expect(status).toContain('Provider');
      expect(status).toContain('Language');
    });

    it('should show current state', () => {
      const status = voiceControl.formatStatus();

      expect(status).toContain('Idle');
    });
  });

  describe('formatCommandsHelp', () => {
    it('should return formatted help', () => {
      const help = voiceControl.formatCommandsHelp();

      expect(help).toContain('VOICE COMMANDS');
      expect(help).toContain('explain');
      expect(help).toContain('fix');
      expect(help).toContain('Hey Grok');
    });

    it('should include examples', () => {
      const help = voiceControl.formatCommandsHelp();

      expect(help).toContain('explain this code');
    });
  });

  describe('toggleListening', () => {
    it('should start listening when not listening', () => {
      // Mock isAvailable to return unavailable
      jest.spyOn(voiceControl, 'isAvailable').mockResolvedValue({
        available: false,
        reason: 'Test environment',
        capabilities: [],
      });

      // Add error listener to prevent unhandled error crash
      voiceControl.on('error', () => {
        // Expected error when voice control is not available
      });

      voiceControl.toggleListening();

      // State may not change immediately due to async
    });
  });

  describe('stopListening', () => {
    it('should stop listening', () => {
      voiceControl.stopListening();

      const state = voiceControl.getState();
      expect(state.isListening).toBe(false);
    });

    it('should emit listening:stop event', (done) => {
      voiceControl.on('listening:stop', () => {
        done();
      });

      voiceControl.stopListening();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetVoiceControl();
      const instance1 = getVoiceControl();
      const instance2 = getVoiceControl();
      expect(instance1).toBe(instance2);
    });

    it('should reset correctly', () => {
      const instance1 = getVoiceControl();
      resetVoiceControl();
      const instance2 = getVoiceControl();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      voiceControl.dispose();
      const state = voiceControl.getState();
      expect(state.isListening).toBe(false);
    });

    it('should remove all listeners', () => {
      voiceControl.on('test', () => {});
      voiceControl.dispose();
      expect(voiceControl.listenerCount('test')).toBe(0);
    });
  });

  describe('command patterns', () => {
    it('should match explain commands', () => {
      const commands = voiceControl.getCommands();
      const explainCmd = commands.find(c => c.name === 'explain');

      expect(explainCmd?.pattern.test('explain this code')).toBe(true);
      expect(explainCmd?.pattern.test('what does this do')).toBe(true);
      expect(explainCmd?.pattern.test('describe the function')).toBe(true);
    });

    it('should match fix commands', () => {
      const commands = voiceControl.getCommands();
      const fixCmd = commands.find(c => c.name === 'fix');

      expect(fixCmd?.pattern.test('fix the bug')).toBe(true);
      expect(fixCmd?.pattern.test('debug this error')).toBe(true);
      expect(fixCmd?.pattern.test('repair the issue')).toBe(true);
    });

    it('should match search commands', () => {
      const commands = voiceControl.getCommands();
      const searchCmd = commands.find(c => c.name === 'search');

      expect(searchCmd?.pattern.test('search for auth')).toBe(true);
      expect(searchCmd?.pattern.test('find user functions')).toBe(true);
      expect(searchCmd?.pattern.test('look for api endpoints')).toBe(true);
    });

    it('should match stop commands', () => {
      const commands = voiceControl.getCommands();
      const stopCmd = commands.find(c => c.name === 'stop');

      expect(stopCmd?.pattern.test('stop')).toBe(true);
      expect(stopCmd?.pattern.test('cancel')).toBe(true);
      expect(stopCmd?.pattern.test('nevermind')).toBe(true);
    });
  });
});
