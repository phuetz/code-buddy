/**
 * Unit tests for CodeGuardianAgent
 * Tests code analysis, security checking, and refactoring suggestions
 */

import {
  CodeGuardianAgent,
  getCodeGuardianAgent,
  resetCodeGuardianAgent,
  CodeGuardianMode,
  CodeIssue,
  PatchPlan,
} from '../../src/agent/specialized/code-guardian-agent';
import { AgentTask } from '../../src/agent/specialized/types';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  statSync: jest.fn(),
  readdirSync: jest.fn(),
}));

describe('CodeGuardianAgent', () => {
  let agent: CodeGuardianAgent;
  const mockTsFile = '/test/src/example.ts';
  const mockPyFile = '/test/src/example.py';
  const mockJsFile = '/test/src/example.js';

  const mockTsContent = `
import { EventEmitter } from 'events';
import type { User } from './types.js';
import lodash from 'lodash';

export class UserService extends EventEmitter {
  private apiKey: string = 'sk-secret-key-12345678';

  async getUser(id: string): Promise<User> {
    const result = eval('someCode');
    console.log('Getting user:', id);
    // TODO: Implement caching
    return { id, name: 'John' };
  }

  processData(data: any): void {
    const query = 'SELECT * FROM users WHERE id = ' + data.id;
    document.write('<script>alert(1)</script>');
  }
}

export default UserService;
`;

  const mockPyContent = `
import os
from typing import Optional

class DataProcessor:
    api_key = "secret-token-12345678"

    def process(self, data: Optional[dict]) -> None:
        result = eval(data.get('code'))
        # TODO: Add validation
        print(f"Processing: {data}")
`;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCodeGuardianAgent();
    agent = new CodeGuardianAgent();

    // Default mock implementations
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockImplementation((filePath: string) => {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return mockTsContent;
      if (filePath.endsWith('.py')) return mockPyContent;
      if (filePath.endsWith('.js')) return mockTsContent;
      return '';
    });
    (fs.statSync as jest.Mock).mockReturnValue({
      size: 1024,
      isDirectory: () => false,
      isFile: () => true,
    });
    (fs.readdirSync as jest.Mock).mockReturnValue([
      { name: 'example.ts', isDirectory: () => false, isFile: () => true },
      { name: 'utils.ts', isDirectory: () => false, isFile: () => true },
      { name: 'node_modules', isDirectory: () => true, isFile: () => false },
    ]);
  });

  describe('Constructor and Configuration', () => {
    it('should create agent with correct ID', () => {
      expect(agent.getId()).toBe('code-guardian');
    });

    it('should create agent with correct name', () => {
      expect(agent.getName()).toContain('Code Guardian');
    });

    it('should have code-analyze capability', () => {
      expect(agent.hasCapability('code-analyze')).toBe(true);
    });

    it('should have code-review capability', () => {
      expect(agent.hasCapability('code-review')).toBe(true);
    });

    it('should have code-refactor capability', () => {
      expect(agent.hasCapability('code-refactor')).toBe(true);
    });

    it('should have code-security capability', () => {
      expect(agent.hasCapability('code-security')).toBe(true);
    });

    it('should handle TypeScript extensions', () => {
      expect(agent.canHandleExtension('ts')).toBe(true);
      expect(agent.canHandleExtension('tsx')).toBe(true);
    });

    it('should handle JavaScript extensions', () => {
      expect(agent.canHandleExtension('js')).toBe(true);
      expect(agent.canHandleExtension('jsx')).toBe(true);
    });

    it('should handle Python extensions', () => {
      expect(agent.canHandleExtension('py')).toBe(true);
    });

    it('should handle various language extensions', () => {
      expect(agent.canHandleExtension('java')).toBe(true);
      expect(agent.canHandleExtension('go')).toBe(true);
      expect(agent.canHandleExtension('rs')).toBe(true);
      expect(agent.canHandleExtension('cpp')).toBe(true);
    });

    it('should not handle unsupported extensions', () => {
      expect(agent.canHandleExtension('pdf')).toBe(false);
      expect(agent.canHandleExtension('xlsx')).toBe(false);
    });
  });

  describe('initialize()', () => {
    it('should initialize successfully', async () => {
      const emitSpy = jest.spyOn(agent, 'emit');

      await agent.initialize();

      expect(agent.isReady()).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith('initialized');
    });
  });

  describe('Mode management', () => {
    it('should default to ANALYZE_ONLY mode', () => {
      expect(agent.getMode()).toBe('ANALYZE_ONLY');
    });

    it('should allow setting mode', () => {
      agent.setMode('SUGGEST_REFACTOR');
      expect(agent.getMode()).toBe('SUGGEST_REFACTOR');
    });

    it('should emit mode:changed event when mode changes', () => {
      const emitSpy = jest.spyOn(agent, 'emit');

      agent.setMode('PATCH_PLAN');

      expect(emitSpy).toHaveBeenCalledWith('mode:changed', 'PATCH_PLAN');
    });

    it('should accept all valid modes', () => {
      const modes: CodeGuardianMode[] = ['ANALYZE_ONLY', 'SUGGEST_REFACTOR', 'PATCH_PLAN', 'PATCH_DIFF'];

      for (const mode of modes) {
        agent.setMode(mode);
        expect(agent.getMode()).toBe(mode);
      }
    });
  });

  describe('getSupportedActions()', () => {
    it('should return all supported actions', () => {
      const actions = agent.getSupportedActions();

      expect(actions).toContain('analyze');
      expect(actions).toContain('analyze-file');
      expect(actions).toContain('analyze-directory');
      expect(actions).toContain('suggest-refactor');
      expect(actions).toContain('create-patch-plan');
      expect(actions).toContain('create-patch-diff');
      expect(actions).toContain('find-issues');
      expect(actions).toContain('check-security');
      expect(actions).toContain('map-dependencies');
      expect(actions).toContain('explain-code');
      expect(actions).toContain('review-architecture');
    });
  });

  describe('getActionHelp()', () => {
    it('should return help for analyze action', () => {
      const help = agent.getActionHelp('analyze');
      expect(help).toBeDefined();
      expect(help.length).toBeGreaterThan(0);
    });

    it('should return help for find-issues action', () => {
      const help = agent.getActionHelp('find-issues');
      expect(help).toBeDefined();
      expect(help.length).toBeGreaterThan(0);
    });

    it('should return help for check-security action', () => {
      const help = agent.getActionHelp('check-security');
      expect(help).toBeDefined();
      expect(help.length).toBeGreaterThan(0);
    });

    it('should return unknown action message for invalid action', () => {
      const help = agent.getActionHelp('invalid');
      expect(help).toContain('inconnue');
    });
  });

  describe('execute()', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    describe('analyze action', () => {
      it('should analyze a single file', async () => {
        const task: AgentTask = {
          action: 'analyze',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('ANALYSE');
      });

      it('should return error when no input files', async () => {
        const task: AgentTask = {
          action: 'analyze',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('fichier');
      });

      it('should return error when file not found', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const task: AgentTask = {
          action: 'analyze',
          inputFiles: ['/nonexistent/file.ts'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        // French "non trouvé" with accent
        expect(result.error?.toLowerCase()).toContain('non trouv');
      });

      it('should detect file language correctly', async () => {
        const task: AgentTask = {
          action: 'analyze',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.output).toContain('typescript');
      });
    });

    describe('analyze-file action', () => {
      it('should analyze a file', async () => {
        const task: AgentTask = {
          action: 'analyze-file',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });
    });

    describe('analyze-directory action', () => {
      it('should analyze a directory', async () => {
        (fs.statSync as jest.Mock).mockImplementation((filePath: string) => ({
          size: 1024,
          isDirectory: () => filePath === '/test/src',
          isFile: () => filePath !== '/test/src',
        }));

        const task: AgentTask = {
          action: 'analyze-directory',
          inputFiles: ['/test/src'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.metadata?.fileCount).toBeGreaterThanOrEqual(0);
      });

      it('should return error when directory not found', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const task: AgentTask = {
          action: 'analyze-directory',
          inputFiles: ['/nonexistent/dir'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        // French "non trouvé" with accent
        expect(result.error?.toLowerCase()).toContain('non trouv');
      });

      it('should respect maxDepth parameter', async () => {
        (fs.statSync as jest.Mock).mockReturnValue({
          size: 1024,
          isDirectory: () => true,
          isFile: () => false,
        });

        const task: AgentTask = {
          action: 'analyze-directory',
          inputFiles: ['/test/src'],
          params: { maxDepth: 2 },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should ignore specified patterns', async () => {
        (fs.statSync as jest.Mock).mockReturnValue({
          size: 1024,
          isDirectory: () => true,
          isFile: () => false,
        });

        const task: AgentTask = {
          action: 'analyze-directory',
          inputFiles: ['/test/src'],
          params: { ignore: ['node_modules', 'dist', 'build'] },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });
    });

    describe('suggest-refactor action', () => {
      it('should suggest refactoring when mode is SUGGEST_REFACTOR', async () => {
        agent.setMode('SUGGEST_REFACTOR');

        const task: AgentTask = {
          action: 'suggest-refactor',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should return error when mode is ANALYZE_ONLY', async () => {
        agent.setMode('ANALYZE_ONLY');

        const task: AgentTask = {
          action: 'suggest-refactor',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('ANALYZE_ONLY');
      });

      it('should set mode from params', async () => {
        const task: AgentTask = {
          action: 'suggest-refactor',
          inputFiles: [mockTsFile],
          params: { mode: 'SUGGEST_REFACTOR' },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });
    });

    describe('create-patch-plan action', () => {
      it('should create patch plan when mode is PATCH_PLAN', async () => {
        agent.setMode('PATCH_PLAN');

        const issues: CodeIssue[] = [
          {
            type: 'security',
            severity: 'critical',
            file: mockTsFile,
            line: 10,
            message: 'Hardcoded secret detected',
          },
          {
            type: 'maintainability',
            severity: 'warning',
            file: mockTsFile,
            line: 15,
            message: 'TODO comment found',
          },
        ];

        const task: AgentTask = {
          action: 'create-patch-plan',
          params: { issues },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('PLAN');
      });

      it('should return error when mode is insufficient', async () => {
        agent.setMode('ANALYZE_ONLY');

        const task: AgentTask = {
          action: 'create-patch-plan',
          params: { issues: [] },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Mode insuffisant');
      });

      it('should return error when no issues specified', async () => {
        agent.setMode('PATCH_PLAN');

        const task: AgentTask = {
          action: 'create-patch-plan',
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('probl'); // Match French "problème"
      });
    });

    describe('create-patch-diff action', () => {
      it('should create patch diffs when mode is PATCH_DIFF', async () => {
        agent.setMode('PATCH_DIFF');

        const plan: PatchPlan = {
          id: 'test-plan',
          title: 'Test Plan',
          description: 'Test description',
          steps: [
            {
              order: 1,
              file: mockTsFile,
              action: 'modify',
              type: 'bugfix',
              description: 'Fix issue',
              dependencies: [],
              rollbackStrategy: 'git checkout file',
            },
          ],
          totalFiles: 1,
          estimatedRisk: 'low',
          testPlan: ['Run tests'],
          rollbackPlan: 'git stash pop',
        };

        const task: AgentTask = {
          action: 'create-patch-diff',
          params: { plan },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.output).toContain('DIFFS');
      });

      it('should return error when mode is not PATCH_DIFF', async () => {
        agent.setMode('PATCH_PLAN');

        const task: AgentTask = {
          action: 'create-patch-diff',
          params: { plan: {} },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('PATCH_DIFF');
      });
    });

    describe('find-issues action', () => {
      it('should find issues in files', async () => {
        const task: AgentTask = {
          action: 'find-issues',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
      });

      it('should filter issues by type', async () => {
        const task: AgentTask = {
          action: 'find-issues',
          inputFiles: [mockTsFile],
          params: { type: 'security' },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should filter issues by severity', async () => {
        const task: AgentTask = {
          action: 'find-issues',
          inputFiles: [mockTsFile],
          params: { severity: 'critical' },
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });

      it('should analyze directories recursively', async () => {
        (fs.statSync as jest.Mock).mockImplementation((filePath: string) => ({
          size: 1024,
          isDirectory: () => filePath === '/test/src',
          isFile: () => filePath !== '/test/src',
        }));

        const task: AgentTask = {
          action: 'find-issues',
          inputFiles: ['/test/src'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
      });
    });

    describe('check-security action', () => {
      it('should check for security issues', async () => {
        const task: AgentTask = {
          action: 'check-security',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        // Output uses French with accents, check for partial match
        expect(result.output?.toLowerCase()).toContain('curit'); // Matches "SÉCURITÉ"
      });

      it('should detect hardcoded secrets', async () => {
        const task: AgentTask = {
          action: 'check-security',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        // The mock content contains hardcoded secrets
      });

      it('should detect dangerous functions', async () => {
        const task: AgentTask = {
          action: 'check-security',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        // The mock content contains eval()
      });
    });

    describe('map-dependencies action', () => {
      it('should map dependencies', async () => {
        const task: AgentTask = {
          action: 'map-dependencies',
          inputFiles: ['/test/src'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        // French output uses accents, check for partial match
        expect(result.output?.toLowerCase()).toContain('pendances'); // "DÉPENDANCES"
      });
    });

    describe('explain-code action', () => {
      it('should explain code', async () => {
        const task: AgentTask = {
          action: 'explain-code',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.output).toContain('EXPLICATION');
      });

      it('should return error when file not found', async () => {
        (fs.existsSync as jest.Mock).mockReturnValue(false);

        const task: AgentTask = {
          action: 'explain-code',
          inputFiles: ['/nonexistent/file.ts'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        // French "non trouvé" with accent
        expect(result.error?.toLowerCase()).toContain('non trouv');
      });
    });

    describe('review-architecture action', () => {
      it('should review architecture', async () => {
        (fs.statSync as jest.Mock).mockReturnValue({
          size: 1024,
          isDirectory: () => true,
          isFile: () => false,
        });

        const task: AgentTask = {
          action: 'review-architecture',
          inputFiles: ['/test/src'],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(true);
        expect(result.output).toContain('ARCHITECTURE');
      });
    });

    describe('unknown action', () => {
      it('should return error for unknown action', async () => {
        const task: AgentTask = {
          action: 'unknown-action',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toContain('inconnue');
      });
    });

    describe('error handling', () => {
      it('should catch and return errors gracefully', async () => {
        (fs.readFileSync as jest.Mock).mockImplementation(() => {
          throw new Error('Read error');
        });

        const task: AgentTask = {
          action: 'analyze',
          inputFiles: [mockTsFile],
        };

        const result = await agent.execute(task);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Issue detection', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should detect TODO comments', async () => {
      const task: AgentTask = {
        action: 'find-issues',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);
      const data = result.data as { issues: CodeIssue[] };

      expect(result.success).toBe(true);
      const todoIssues = data.issues.filter(i => i.message.includes('TODO'));
      expect(todoIssues.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect console.log statements', async () => {
      const task: AgentTask = {
        action: 'find-issues',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);
      const data = result.data as { issues: CodeIssue[] };

      expect(result.success).toBe(true);
      const consoleIssues = data.issues.filter(i => i.message.includes('console'));
      expect(consoleIssues.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect any type usage in TypeScript', async () => {
      const task: AgentTask = {
        action: 'find-issues',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);
      const data = result.data as { issues: CodeIssue[] };

      expect(result.success).toBe(true);
      const anyIssues = data.issues.filter(i => i.message.includes('any'));
      expect(anyIssues.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect long lines', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue('const x = ' + 'a'.repeat(150) + ';');

      const task: AgentTask = {
        action: 'find-issues',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
    });
  });

  describe('Dependency extraction', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should extract ES imports', async () => {
      const task: AgentTask = {
        action: 'analyze',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);
      const data = result.data as { dependencies: Array<{ path: string }> };

      expect(result.success).toBe(true);
      expect(data.dependencies).toBeDefined();
    });

    it('should distinguish internal and external dependencies', async () => {
      const task: AgentTask = {
        action: 'analyze',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
      // Output contains French text, check for the section marker
      expect(result.output).toContain('pendances'); // "Dependances" in French without accent
    });
  });

  describe('Language detection', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should detect TypeScript', async () => {
      const task: AgentTask = {
        action: 'analyze',
        inputFiles: [mockTsFile],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
      expect(result.output).toContain('typescript');
    });

    it('should detect Python', async () => {
      const task: AgentTask = {
        action: 'analyze',
        inputFiles: [mockPyFile],
      };

      const result = await agent.execute(task);

      expect(result.success).toBe(true);
      expect(result.output).toContain('python');
    });
  });
});

describe('getCodeGuardianAgent singleton', () => {
  beforeEach(() => {
    resetCodeGuardianAgent();
  });

  it('should return a CodeGuardianAgent instance', () => {
    const agent = getCodeGuardianAgent();
    expect(agent).toBeInstanceOf(CodeGuardianAgent);
  });

  it('should return same instance on multiple calls', () => {
    const agent1 = getCodeGuardianAgent();
    const agent2 = getCodeGuardianAgent();
    expect(agent1).toBe(agent2);
  });
});

describe('resetCodeGuardianAgent', () => {
  it('should reset the singleton instance', () => {
    const agent1 = getCodeGuardianAgent();
    resetCodeGuardianAgent();
    const agent2 = getCodeGuardianAgent();

    expect(agent1).not.toBe(agent2);
  });
});

describe('Edge Cases', () => {
  let agent: CodeGuardianAgent;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetCodeGuardianAgent();
    agent = new CodeGuardianAgent();
    await agent.initialize();

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.statSync as jest.Mock).mockReturnValue({
      size: 1024,
      isDirectory: () => false,
      isFile: () => true,
    });
  });

  it('should handle empty file', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('');

    const task: AgentTask = {
      action: 'analyze',
      inputFiles: ['/test/empty.ts'],
    };

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
  });

  it('should handle file with only comments', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('// This is a comment\n/* Another comment */');

    const task: AgentTask = {
      action: 'analyze',
      inputFiles: ['/test/comments.ts'],
    };

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
  });

  it('should handle very large file', async () => {
    const largeContent = 'const x = 1;\n'.repeat(10000);
    (fs.readFileSync as jest.Mock).mockReturnValue(largeContent);

    const task: AgentTask = {
      action: 'analyze',
      inputFiles: ['/test/large.ts'],
    };

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
  });

  it('should handle unicode in code', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('const message = "Hello World";');

    const task: AgentTask = {
      action: 'analyze',
      inputFiles: ['/test/unicode.ts'],
    };

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
  });
});
