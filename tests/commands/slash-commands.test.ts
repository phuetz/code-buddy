/**
 * Tests for SlashCommandManager
 *
 * Comprehensive tests covering:
 * - Built-in command loading
 * - Custom command parsing from markdown
 * - Command execution with arguments
 * - Partial command matching
 * - Template creation
 */

import {
  SlashCommandManager,
  getSlashCommandManager,
  resetSlashCommandManager,
} from '../../src/commands/slash-commands';

// Mock fs module with explicit typing
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

 
const fs = require('fs');

describe('SlashCommandManager', () => {
  let manager: SlashCommandManager;
  let tempDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSlashCommandManager();

    tempDir = '/tmp/test-grok';

    // Default mock: directories don't exist
    fs.existsSync.mockImplementation((p: string) => false);
    fs.readdirSync.mockReturnValue([]);
    fs.readFileSync.mockReturnValue('');
    fs.mkdirSync.mockImplementation(() => undefined);
    fs.writeFileSync.mockImplementation(() => undefined);

    manager = new SlashCommandManager(tempDir);
  });

  describe('Built-in Commands', () => {
    test('should load all built-in commands', () => {
      const commands = manager.getCommands();

      // Check core commands exist
      const commandNames = commands.map(c => c.name);
      expect(commandNames).toContain('help');
      expect(commandNames).toContain('clear');
      expect(commandNames).toContain('model');
      expect(commandNames).toContain('mode');
      expect(commandNames).toContain('commit');
      expect(commandNames).toContain('review');
      expect(commandNames).toContain('test');
    });

    test('should mark built-in commands correctly', () => {
      const helpCmd = manager.getCommand('help');
      expect(helpCmd).toBeDefined();
      expect(helpCmd?.isBuiltin).toBe(true);
    });

    test('should have proper structure for commands with arguments', () => {
      const modeCmd = manager.getCommand('mode');
      expect(modeCmd?.arguments).toBeDefined();
      expect(modeCmd?.arguments?.length).toBeGreaterThan(0);
      expect(modeCmd?.arguments?.[0].name).toBe('mode');
    });

    test('should have many built-in commands', () => {
      const commands = manager.getCommands();
      expect(commands.length).toBeGreaterThan(30);
    });
  });

  describe('Custom Command Loading', () => {
    test('should load custom commands from markdown files', () => {
      const customContent = `---
description: Custom test command
---

This is a custom prompt.
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['custom-cmd.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const customCmd = newManager.getCommand('custom-cmd');

      expect(customCmd).toBeDefined();
      expect(customCmd?.isBuiltin).toBe(false);
      expect(customCmd?.description).toBe('Custom test command');
    });

    test('should parse frontmatter arguments', () => {
      const customContent = `---
description: Command with args
argument: file, File to process, required
argument: output, Output path
---

Process $1 and save to $2
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['with-args.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const cmd = newManager.getCommand('with-args');

      expect(cmd?.arguments).toBeDefined();
      expect(cmd?.arguments?.length).toBe(2);
      expect(cmd?.arguments?.[0].name).toBe('file');
      expect(cmd?.arguments?.[0].required).toBe(true);
      expect(cmd?.arguments?.[1].name).toBe('output');
      expect(cmd?.arguments?.[1].required).toBe(false);
    });

    test('should handle markdown files without frontmatter', () => {
      const customContent = `# My Command

This is the prompt for my command.
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['no-frontmatter.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const cmd = newManager.getCommand('no-frontmatter');

      expect(cmd).toBeDefined();
      expect(cmd?.description).toBe('My Command');
      expect(cmd?.prompt).toContain('This is the prompt');
    });

    test('should skip non-markdown files', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['command.md', 'readme.txt', 'script.js']);
      fs.readFileSync.mockReturnValue('# Test\nPrompt');

      const newManager = new SlashCommandManager(tempDir);
      const cmd = newManager.getCommand('readme');

      expect(cmd).toBeUndefined();
    });
  });

  describe('Command Execution', () => {
    test('should execute built-in help command', () => {
      const result = manager.execute('/help');

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('__HELP__');
      expect(result.command?.name).toBe('help');
    });

    test('should execute command without leading slash', () => {
      const result = manager.execute('help');

      expect(result.success).toBe(true);
      expect(result.prompt).toBe('__HELP__');
    });

    test('should fail for unknown commands', () => {
      const result = manager.execute('/unknowncommand');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown command');
    });

    test('should substitute $1, $2 placeholders with arguments', () => {
      const customContent = `---
description: Test command
---

Process file $1 with option $2
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['process.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const result = newManager.execute('/process myfile.txt --verbose');

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('myfile.txt');
      expect(result.prompt).toContain('--verbose');
    });

    test('should substitute $@ with all arguments', () => {
      const customContent = `---
description: Echo command
---

Echo all: $@
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['echo.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const result = newManager.execute('/echo one two three');

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('one two three');
    });

    test('should append context if no placeholders exist', () => {
      const customContent = `---
description: Simple command
---

Do something
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['simple.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const result = newManager.execute('/simple extra args here');

      expect(result.success).toBe(true);
      expect(result.prompt).toContain('Context:');
      expect(result.prompt).toContain('extra args here');
    });
  });

  describe('Command Formatting', () => {
    test('should format commands list', () => {
      const formatted = manager.formatCommandsList();

      expect(formatted).toContain('Available Slash Commands');
      expect(formatted).toContain('Built-in Commands');
      expect(formatted).toContain('/help');
      expect(formatted).toContain('/commit');
    });

    test('should include custom commands section if present', () => {
      const customContent = `---
description: My custom command
---

Custom prompt
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['mycustom.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const formatted = newManager.formatCommandsList();

      expect(formatted).toContain('Custom Commands');
      expect(formatted).toContain('/mycustom');
    });

    test('should show argument syntax in list', () => {
      const formatted = manager.formatCommandsList();

      // Mode command has required argument
      expect(formatted).toContain('<mode>');
    });
  });

  describe('Template Creation', () => {
    test('should create command template file', () => {
      const filePath = manager.createCommandTemplate('newcmd', 'A new command');

      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(filePath).toContain('newcmd.md');
    });

    test('should include description in template', () => {
      manager.createCommandTemplate('testcmd', 'Test description');

      const writeCall = fs.writeFileSync.mock.calls[0];
      const content = writeCall[1] as string;

      expect(content).toContain('description: Test description');
      expect(content).toContain('# testcmd');
    });
  });

  describe('Reload Functionality', () => {
    test('should reload commands', () => {
      // Initial load has no custom commands
      expect(manager.getCommand('dynamic')).toBeUndefined();

      // Simulate adding a new command file
      fs.readdirSync.mockReturnValue(['dynamic.md']);
      fs.readFileSync.mockReturnValue('# Dynamic\nNew prompt');
      fs.existsSync.mockReturnValue(true);

      manager.reload();

      const cmd = manager.getCommand('dynamic');
      expect(cmd).toBeDefined();
    });
  });

  describe('Singleton Pattern', () => {
    test('should return same instance without working directory', () => {
      resetSlashCommandManager();

      const instance1 = getSlashCommandManager();
      const instance2 = getSlashCommandManager();

      expect(instance1).toBe(instance2);
    });

    test('should create new instance with different working directory', () => {
      resetSlashCommandManager();

      const instance1 = getSlashCommandManager('/path/one');
      const instance2 = getSlashCommandManager('/path/two');

      // New instance created for different path
      expect(instance2).not.toBe(instance1);
    });

    test('should reset singleton correctly', () => {
      const instance1 = getSlashCommandManager();
      resetSlashCommandManager();
      const instance2 = getSlashCommandManager();

      expect(instance2).not.toBe(instance1);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty command input', () => {
      const result = manager.execute('/');

      expect(result.success).toBe(false);
    });

    test('should handle whitespace-only input', () => {
      const result = manager.execute('   ');

      expect(result.success).toBe(false);
    });

    test('should handle commands with extra whitespace', () => {
      const result = manager.execute('/help   extra   spaces');

      expect(result.success).toBe(true);
    });

    test('should override builtin with custom command', () => {
      const customContent = `---
description: Custom help override
---

My custom help
`;

      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['help.md']);
      fs.readFileSync.mockReturnValue(customContent);

      const newManager = new SlashCommandManager(tempDir);
      const helpCmd = newManager.getCommand('help');

      expect(helpCmd?.isBuiltin).toBe(false);
      expect(helpCmd?.description).toBe('Custom help override');
    });

    test('should handle getAllCommands alias', () => {
      const commands1 = manager.getCommands();
      const commands2 = manager.getAllCommands();

      expect(commands1.length).toBe(commands2.length);
    });
  });

  describe('Special Built-in Commands', () => {
    test('should have YOLO mode command', () => {
      const yoloCmd = manager.getCommand('yolo');
      expect(yoloCmd).toBeDefined();
      expect(yoloCmd?.prompt).toBe('__YOLO_MODE__');
    });

    test('should have cost tracking command', () => {
      const costCmd = manager.getCommand('cost');
      expect(costCmd).toBeDefined();
      expect(costCmd?.arguments).toBeDefined();
    });

    test('should have security command', () => {
      const secCmd = manager.getCommand('security');
      expect(secCmd).toBeDefined();
    });

    test('should have memory command', () => {
      const memCmd = manager.getCommand('memory');
      expect(memCmd).toBeDefined();
      expect(memCmd?.prompt).toBe('__MEMORY__');
    });

    test('should have theme command', () => {
      const themeCmd = manager.getCommand('theme');
      expect(themeCmd).toBeDefined();
      expect(themeCmd?.prompt).toBe('__THEME__');
    });
  });
});
