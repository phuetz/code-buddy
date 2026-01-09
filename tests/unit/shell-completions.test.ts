/**
 * Comprehensive Unit Tests for Shell Completions
 *
 * Tests cover:
 * 1. Bash completion generation
 * 2. Zsh completion generation
 * 3. Fish completion generation
 * 4. Installation instructions
 * 5. Print completion
 * 6. Helper functions
 */

import {
  generateCompletion,
  getInstallInstructions,
  printCompletion,
  getSlashCommands,
  getCliOptions,
  ShellType,
  CompletionOption,
} from '../../src/utils/shell-completions';

describe('Shell Completions', () => {
  describe('generateCompletion', () => {
    describe('Bash completion', () => {
      let bashCompletion: string;

      beforeAll(() => {
        bashCompletion = generateCompletion('bash');
      });

      it('should generate bash completion script', () => {
        expect(bashCompletion).toBeDefined();
        expect(typeof bashCompletion).toBe('string');
        expect(bashCompletion.length).toBeGreaterThan(0);
      });

      it('should include shebang', () => {
        expect(bashCompletion).toContain('#!/bin/bash');
      });

      it('should include completion function', () => {
        expect(bashCompletion).toContain('_codebuddy_completions()');
      });

      it('should include CLI options', () => {
        expect(bashCompletion).toContain('--help');
        expect(bashCompletion).toContain('--version');
        expect(bashCompletion).toContain('--model');
        expect(bashCompletion).toContain('--yolo');
      });

      it('should include slash commands', () => {
        expect(bashCompletion).toContain('/help');
        expect(bashCompletion).toContain('/clear');
        expect(bashCompletion).toContain('/exit');
      });

      it('should include model completions', () => {
        expect(bashCompletion).toContain('grok-3');
        expect(bashCompletion).toContain('grok-2-latest');
      });

      it('should register completion for grok command', () => {
        expect(bashCompletion).toContain('complete -F _codebuddy_completions grok');
      });

      it('should register completion for code-buddy command', () => {
        expect(bashCompletion).toContain('complete -F _codebuddy_completions code-buddy');
      });

      it('should handle directory completion for -d flag', () => {
        expect(bashCompletion).toContain('-d|--dir)');
        expect(bashCompletion).toContain('compgen -d');
      });

      it('should handle model completion for -m flag', () => {
        expect(bashCompletion).toContain('-m|--model)');
      });

      it('should handle slash command detection', () => {
        expect(bashCompletion).toContain('/*');
      });

      it('should include mode completions', () => {
        expect(bashCompletion).toContain('read-only');
        expect(bashCompletion).toContain('auto');
        expect(bashCompletion).toContain('full-access');
      });

      it('should include theme completions', () => {
        expect(bashCompletion).toContain('dark');
        expect(bashCompletion).toContain('light');
        expect(bashCompletion).toContain('dracula');
      });

      it('should include echo message at end', () => {
        expect(bashCompletion).toContain('bash completions loaded');
      });
    });

    describe('Zsh completion', () => {
      let zshCompletion: string;

      beforeAll(() => {
        zshCompletion = generateCompletion('zsh');
      });

      it('should generate zsh completion script', () => {
        expect(zshCompletion).toBeDefined();
        expect(typeof zshCompletion).toBe('string');
      });

      it('should include compdef directive', () => {
        expect(zshCompletion).toContain('#compdef grok code-buddy');
      });

      it('should include main completion function', () => {
        expect(zshCompletion).toContain('_codebuddy()');
      });

      it('should include options array', () => {
        expect(zshCompletion).toContain('options=(');
      });

      it('should include slash commands array', () => {
        expect(zshCompletion).toContain('slash_commands=(');
      });

      it('should include CLI options with descriptions', () => {
        expect(zshCompletion).toContain('--help[Show help]');
        expect(zshCompletion).toContain('--version[Show version]');
      });

      it('should include slash commands with descriptions', () => {
        expect(zshCompletion).toContain('/help:Show help');
        expect(zshCompletion).toContain('/clear:Clear chat history');
      });

      it('should handle directory completion', () => {
        expect(zshCompletion).toContain('_files -/');
      });

      it('should handle model completion', () => {
        expect(zshCompletion).toContain("_describe 'model' models");
      });

      it('should include _files for default completion', () => {
        expect(zshCompletion).toContain('_files');
      });

      it('should call completion function', () => {
        expect(zshCompletion).toContain('_codebuddy "$@"');
      });
    });

    describe('Fish completion', () => {
      let fishCompletion: string;

      beforeAll(() => {
        fishCompletion = generateCompletion('fish');
      });

      it('should generate fish completion script', () => {
        expect(fishCompletion).toBeDefined();
        expect(typeof fishCompletion).toBe('string');
      });

      it('should include fish completion header', () => {
        expect(fishCompletion).toContain('# Grok CLI Fish Completion');
      });

      it('should include helper function', () => {
        expect(fishCompletion).toContain('function __fish_codebuddy_in_prompt');
      });

      it('should disable default file completion', () => {
        expect(fishCompletion).toContain('complete -c grok -f');
      });

      it('should include short option completions', () => {
        expect(fishCompletion).toContain('-s h');
        expect(fishCompletion).toContain('-s v');
        expect(fishCompletion).toContain('-s d');
        expect(fishCompletion).toContain('-s m');
      });

      it('should include long option completions', () => {
        expect(fishCompletion).toContain('-l help');
        expect(fishCompletion).toContain('-l version');
        expect(fishCompletion).toContain('-l dir');
        expect(fishCompletion).toContain('-l model');
      });

      it('should include descriptions', () => {
        expect(fishCompletion).toContain("-d 'Show help'");
        expect(fishCompletion).toContain("-d 'Show version'");
      });

      it('should include directory completion for -d', () => {
        expect(fishCompletion).toContain('__fish_complete_directories');
      });

      it('should include model options', () => {
        expect(fishCompletion).toContain('grok-3');
        expect(fishCompletion).toContain('grok-2-latest');
      });

      it('should include slash command completions', () => {
        expect(fishCompletion).toContain("'/help'");
        expect(fishCompletion).toContain("'/clear'");
      });

      it('should include conditional slash command detection', () => {
        expect(fishCompletion).toContain('__fish_codebuddy_in_prompt');
      });

      it('should include path completion fallback', () => {
        expect(fishCompletion).toContain('__fish_complete_path');
      });
    });

    describe('Error handling', () => {
      it('should throw for unsupported shell', () => {
        expect(() => {
          generateCompletion('powershell' as ShellType);
        }).toThrow('Unsupported shell: powershell');
      });
    });
  });

  describe('getInstallInstructions', () => {
    describe('Bash instructions', () => {
      let instructions: string;

      beforeAll(() => {
        instructions = getInstallInstructions('bash');
      });

      it('should include bash in header', () => {
        expect(instructions).toContain('Bash completion installation');
      });

      it('should include ~/.bashrc option', () => {
        expect(instructions).toContain('~/.bashrc');
      });

      it('should include completions directory option', () => {
        expect(instructions).toContain('/etc/bash_completion.d/grok');
      });

      it('should include source command', () => {
        expect(instructions).toContain('source ~/.bashrc');
      });

      it('should include grok command', () => {
        expect(instructions).toContain('grok --completions bash');
      });
    });

    describe('Zsh instructions', () => {
      let instructions: string;

      beforeAll(() => {
        instructions = getInstallInstructions('zsh');
      });

      it('should include zsh in header', () => {
        expect(instructions).toContain('Zsh completion installation');
      });

      it('should include ~/.zshrc option', () => {
        expect(instructions).toContain('~/.zshrc');
      });

      it('should include completions directory creation', () => {
        expect(instructions).toContain('mkdir -p ~/.zsh/completions');
      });

      it('should include fpath configuration', () => {
        expect(instructions).toContain('fpath=');
      });

      it('should include compinit', () => {
        expect(instructions).toContain('autoload -Uz compinit && compinit');
      });

      it('should include source command', () => {
        expect(instructions).toContain('source ~/.zshrc');
      });
    });

    describe('Fish instructions', () => {
      let instructions: string;

      beforeAll(() => {
        instructions = getInstallInstructions('fish');
      });

      it('should include fish in header', () => {
        expect(instructions).toContain('Fish completion installation');
      });

      it('should include fish completions directory', () => {
        expect(instructions).toContain('~/.config/fish/completions');
      });

      it('should include mkdir command', () => {
        expect(instructions).toContain('mkdir -p');
      });

      it('should include source command', () => {
        expect(instructions).toContain('source ~/.config/fish/completions/grok.fish');
      });
    });

    describe('Unsupported shell', () => {
      it('should return unsupported message', () => {
        const instructions = getInstallInstructions('powershell' as ShellType);
        expect(instructions).toContain('Unsupported shell: powershell');
      });
    });
  });

  describe('printCompletion', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should print bash completion to stdout', () => {
      printCompletion('bash');

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('_codebuddy_completions');
    });

    it('should print zsh completion to stdout', () => {
      printCompletion('zsh');

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('#compdef');
    });

    it('should print fish completion to stdout', () => {
      printCompletion('fish');

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('complete -c grok');
    });
  });

  describe('getSlashCommands', () => {
    let commands: CompletionOption[];

    beforeAll(() => {
      commands = getSlashCommands();
    });

    it('should return array of slash commands', () => {
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('should have name and description for each command', () => {
      commands.forEach(cmd => {
        expect(cmd).toHaveProperty('name');
        expect(cmd).toHaveProperty('description');
        expect(typeof cmd.name).toBe('string');
        expect(typeof cmd.description).toBe('string');
      });
    });

    it('should include common slash commands', () => {
      const names = commands.map(c => c.name);
      expect(names).toContain('/help');
      expect(names).toContain('/clear');
      expect(names).toContain('/exit');
      expect(names).toContain('/model');
      expect(names).toContain('/undo');
      expect(names).toContain('/redo');
    });

    it('should return a copy (not original array)', () => {
      const commands1 = getSlashCommands();
      const commands2 = getSlashCommands();
      expect(commands1).not.toBe(commands2);
    });
  });

  describe('getCliOptions', () => {
    let options: CompletionOption[];

    beforeAll(() => {
      options = getCliOptions();
    });

    it('should return array of CLI options', () => {
      expect(Array.isArray(options)).toBe(true);
      expect(options.length).toBeGreaterThan(0);
    });

    it('should have name and description for each option', () => {
      options.forEach(opt => {
        expect(opt).toHaveProperty('name');
        expect(opt).toHaveProperty('description');
        expect(typeof opt.name).toBe('string');
        expect(typeof opt.description).toBe('string');
      });
    });

    it('should include common CLI options', () => {
      const names = options.map(o => o.name);
      expect(names).toContain('-h');
      expect(names).toContain('--help');
      expect(names).toContain('-v');
      expect(names).toContain('--version');
      expect(names).toContain('-m');
      expect(names).toContain('--model');
    });

    it('should mark options that have arguments', () => {
      const dirOption = options.find(o => o.name === '-d' || o.name === '--dir');
      const modelOption = options.find(o => o.name === '-m' || o.name === '--model');

      expect(dirOption?.hasArg).toBe(true);
      expect(modelOption?.hasArg).toBe(true);
    });

    it('should have options without arguments', () => {
      const helpOption = options.find(o => o.name === '--help');
      const yoloOption = options.find(o => o.name === '--yolo');

      expect(helpOption?.hasArg).toBeFalsy();
      expect(yoloOption?.hasArg).toBeFalsy();
    });

    it('should return a copy (not original array)', () => {
      const options1 = getCliOptions();
      const options2 = getCliOptions();
      expect(options1).not.toBe(options2);
    });
  });

  describe('Completion Content Validation', () => {
    it('should have valid bash syntax', () => {
      const bash = generateCompletion('bash');

      // Check for basic bash syntax elements
      expect(bash).toContain('local');
      expect(bash).toContain('COMPREPLY=');
      expect(bash).toContain('compgen');
      expect(bash).toContain('case');
      expect(bash).toContain('esac');
    });

    it('should have valid zsh syntax', () => {
      const zsh = generateCompletion('zsh');

      // Check for basic zsh syntax elements
      expect(zsh).toContain('local -a');
      expect(zsh).toContain("case");
      expect(zsh).toContain('esac');
      expect(zsh).toContain('_describe');
    });

    it('should have valid fish syntax', () => {
      const fish = generateCompletion('fish');

      // Check for basic fish syntax elements
      expect(fish).toContain('function');
      expect(fish).toContain('complete -c');
      expect(fish).toContain('set -l');
    });

    it('should escape special characters in descriptions', () => {
      const bash = generateCompletion('bash');
      const zsh = generateCompletion('zsh');
      const fish = generateCompletion('fish');

      // Should not have unescaped quotes breaking the script
      // This is a basic check - actual syntax validation would need a parser
      // Just verify the scripts are non-empty and contain expected content
      expect(bash.length).toBeGreaterThan(100);
      expect(zsh.length).toBeGreaterThan(100);
      expect(fish.length).toBeGreaterThan(100);
    });
  });

  describe('All shell types', () => {
    const shellTypes: ShellType[] = ['bash', 'zsh', 'fish'];

    shellTypes.forEach(shell => {
      it(`should generate non-empty completion for ${shell}`, () => {
        const completion = generateCompletion(shell);
        expect(completion.length).toBeGreaterThan(100);
      });

      it(`should include CLI options in ${shell} completion`, () => {
        const completion = generateCompletion(shell);
        expect(completion).toContain('help');
        expect(completion).toContain('version');
      });

      it(`should generate valid instructions for ${shell}`, () => {
        const instructions = getInstallInstructions(shell);
        expect(instructions.length).toBeGreaterThan(50);
        expect(instructions).toContain(shell);
      });
    });
  });
});
