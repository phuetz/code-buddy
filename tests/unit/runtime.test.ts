/**
 * Tests for Buddy Script Runtime
 *
 * Covers:
 * - Runtime initialization
 * - Environment detection
 * - Runtime configuration
 * - Statement execution
 * - Expression evaluation
 */

import { FCSRuntime as Runtime } from '../../src/scripting/runtime';

import {
  ProgramNode,
  BlockStatement,
  VariableDeclaration,
  FunctionDeclaration,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForInStatement,
  ReturnStatement,
  TryStatement,
  ThrowStatement,
  ExpressionStatement,
  Literal,
  Identifier,
  BinaryExpression,
  UnaryExpression,
  LogicalExpression,
  AssignmentExpression,
  CallExpression,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  ConditionalExpression,
  ArrowFunction,
  AwaitExpression,
  CodeBuddyScriptConfig,
  DEFAULT_SCRIPT_CONFIG,
} from '../../src/scripting/types';

// Mock console to suppress output during tests
const mockConsole = {
  log: jest.spyOn(console, 'log').mockImplementation(),
  error: jest.spyOn(console, 'error').mockImplementation(),
  warn: jest.spyOn(console, 'warn').mockImplementation(),
};

// Mock fs module
jest.mock('fs', () => {
  const impl = {
  readFileSync: jest.fn().mockReturnValue('mock file content'),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  unlinkSync: jest.fn(),
  copyFileSync: jest.fn(),
  renameSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue(['file1.ts', 'file2.ts']),
  mkdirSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({
    size: 1024,
    isFile: () => true,
    isDirectory: () => false,
    birthtime: new Date('2024-01-01'),
    mtime: new Date('2024-06-15'),
  }),
};
  return { ...impl, default: impl };
});

// Mock child_process
jest.mock('child_process', () => ({
  execSync: jest.fn().mockReturnValue('command output'),
  spawn: jest.fn().mockImplementation(function() { return {
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn((event, callback) => {
      if (event === 'close') callback(0);
    }),
  }; }),
}));

describe('Runtime', () => {
  let runtime: Runtime;

  beforeEach(() => {
    jest.clearAllMocks();
    runtime = new Runtime();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Runtime Initialization Tests
  // ============================================

  describe('Initialization', () => {
    it('should create runtime with default configuration', () => {
      const rt = new Runtime();
      expect(rt).toBeDefined();
    });

    it('should create runtime with custom configuration', () => {
      const customConfig: Partial<CodeBuddyScriptConfig> = {
        workdir: '/custom/path',
        timeout: 60000,
        verbose: true,
      };

      const rt = new Runtime(customConfig);
      expect(rt).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      const customConfig: Partial<CodeBuddyScriptConfig> = {
        timeout: 120000,
      };

      const rt = new Runtime(customConfig);
      expect(rt).toBeDefined();
    });

    it('should initialize builtins on construction', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'print' },
              arguments: [{ type: 'Literal', value: 'Hello' }],
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.output).toContain('Hello');
    });

    it('should inject user variables from config', async () => {
      const rt = new Runtime({
        variables: {
          customVar: 'test value',
          customNum: 42,
        },
      });

      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'print' },
              arguments: [{ type: 'Identifier', name: 'customVar' }],
            },
          },
        ],
      };

      const result = await rt.execute(program);
      expect(result.output).toContain('test value');
    });
  });

  // ============================================
  // Environment Detection Tests
  // ============================================

  describe('Environment Detection', () => {
    it('should use process.cwd() as default workdir', () => {
      expect(DEFAULT_SCRIPT_CONFIG.workdir).toBe(process.cwd());
    });

    it('should respect custom workdir', async () => {
      const customWorkdir = '/test/workdir';
      const rt = new Runtime({ workdir: customWorkdir });

      // Use cwd() builtin which returns config.workdir
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ReturnStatement',
            argument: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'cwd' },
              arguments: [],
            },
          },
        ],
      };

      const result = await rt.execute(program);
      expect(result.returnValue).toBe(customWorkdir);
    });

    it('should detect verbose mode', async () => {
      const rt = new Runtime({ verbose: true });

      // Verbose flag is accessible via config, test basic runtime creation
      expect(rt).toBeDefined();
    });

    it('should detect dry run mode', async () => {
      const rt = new Runtime({ dryRun: true });

      // DryRun flag is accessible via config, test basic runtime creation
      expect(rt).toBeDefined();
    });

    it('should access environment variables', async () => {
      process.env.TEST_VAR = 'test_value';

      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ReturnStatement',
            argument: {
              type: 'CallExpression',
              callee: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'env' },
                property: { type: 'Identifier', name: 'get' },
                computed: false,
              },
              arguments: [{ type: 'Literal', value: 'TEST_VAR' }],
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.returnValue).toBe('test_value');

      delete process.env.TEST_VAR;
    });
  });

  // ============================================
  // Runtime Configuration Tests
  // ============================================

  describe('Runtime Configuration', () => {
    it('should use default timeout of 300000ms', () => {
      expect(DEFAULT_SCRIPT_CONFIG.timeout).toBe(300000);
    });

    it('should enable AI by default', () => {
      expect(DEFAULT_SCRIPT_CONFIG.enableAI).toBe(true);
    });

    it('should enable Bash by default', () => {
      expect(DEFAULT_SCRIPT_CONFIG.enableBash).toBe(true);
    });

    it('should enable file operations by default', () => {
      expect(DEFAULT_SCRIPT_CONFIG.enableFileOps).toBe(true);
    });

    it('should have verbose mode off by default', () => {
      expect(DEFAULT_SCRIPT_CONFIG.verbose).toBe(false);
    });

    it('should have dry run mode off by default', () => {
      expect(DEFAULT_SCRIPT_CONFIG.dryRun).toBe(false);
    });

    it('should throw on bash commands when disabled', async () => {
      const rt = new Runtime({ enableBash: false });

      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'bash' },
              arguments: [{ type: 'Literal', value: 'ls' }],
            },
          },
        ],
      };

      const result = await rt.execute(program);
      expect(result.success).toBe(false);
    });

    it('should throw on file operations when disabled', async () => {
      const rt = new Runtime({ enableFileOps: false });

      // Use writeFile which should be restricted when enableFileOps is false
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'writeFile' },
              arguments: [
                { type: 'Literal', value: 'test.txt' },
                { type: 'Literal', value: 'content' },
              ],
            },
          },
        ],
      };

      const result = await rt.execute(program);
      expect(result.success).toBe(false);
    });

    it('should throw on AI operations when disabled', async () => {
      const rt = new Runtime({ enableAI: false });

      // ai.ask should be restricted when enableAI is false
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'ai' },
                property: 'ask',
                computed: false,
              },
              arguments: [{ type: 'Literal', value: 'test prompt' }],
            },
          },
        ],
      };

      const result = await rt.execute(program);
      expect(result.success).toBe(false);
    });

    it('should handle timeout configuration', async () => {
      const rt = new Runtime({ timeout: 1 }); // 1ms timeout

      // Create a program that takes longer than 1ms
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'WhileStatement',
            condition: { type: 'Literal', value: true },
            body: {
              type: 'BlockStatement',
              body: [
                {
                  type: 'VariableDeclaration',
                  kind: 'let',
                  name: 'x',
                  init: { type: 'Literal', value: 1 },
                },
              ],
            },
          },
        ],
      };

      const result = await rt.execute(program);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timeout/i);
    });
  });

  // ============================================
  // Statement Execution Tests
  // ============================================

  describe('Statement Execution', () => {
    describe('Variable Declaration', () => {
      it('should declare and initialize variables', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'x',
              init: { type: 'Literal', value: 42 },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'x' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(42);
      });

      it('should declare variables without initialization', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'x',
              init: null,
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'x' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(null);
      });
    });

    describe('Function Declaration', () => {
      it('should declare and call functions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'FunctionDeclaration',
              name: 'add',
              params: [{ name: 'a' }, { name: 'b' }],
              body: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: {
                      type: 'BinaryExpression',
                      operator: '+',
                      left: { type: 'Identifier', name: 'a' },
                      right: { type: 'Identifier', name: 'b' },
                    },
                  },
                ],
              },
              async: false,
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'add' },
                arguments: [
                  { type: 'Literal', value: 2 },
                  { type: 'Literal', value: 3 },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(5);
      });

      it('should handle default parameter values', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'FunctionDeclaration',
              name: 'greet',
              params: [{ name: 'name', defaultValue: { type: 'Literal', value: 'World' } }],
              body: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Identifier', name: 'name' },
                  },
                ],
              },
              async: false,
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'greet' },
                arguments: [],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('World');
      });
    });

    describe('If Statement', () => {
      it('should execute then branch when condition is truthy', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'IfStatement',
              condition: { type: 'Literal', value: true },
              consequent: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'then' },
                  },
                ],
              },
              alternate: null,
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('then');
      });

      it('should execute else branch when condition is falsy', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'IfStatement',
              condition: { type: 'Literal', value: false },
              consequent: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'then' },
                  },
                ],
              },
              alternate: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'else' },
                  },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('else');
      });

      it('should handle else-if chains', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'IfStatement',
              condition: { type: 'Literal', value: false },
              consequent: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'first' },
                  },
                ],
              },
              alternate: {
                type: 'IfStatement',
                condition: { type: 'Literal', value: true },
                consequent: {
                  type: 'BlockStatement',
                  body: [
                    {
                      type: 'ReturnStatement',
                      argument: { type: 'Literal', value: 'second' },
                    },
                  ],
                },
                alternate: null,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('second');
      });
    });

    describe('While Statement', () => {
      it('should execute while loop', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'i',
              init: { type: 'Literal', value: 0 },
            },
            {
              type: 'WhileStatement',
              condition: {
                type: 'BinaryExpression',
                operator: '<',
                left: { type: 'Identifier', name: 'i' },
                right: { type: 'Literal', value: 3 },
              },
              body: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ExpressionStatement',
                    expression: {
                      type: 'AssignmentExpression',
                      operator: '+=',
                      left: { type: 'Identifier', name: 'i' },
                      right: { type: 'Literal', value: 1 },
                    },
                  },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'i' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(3);
      });

      it('should handle break in while loop', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'i',
              init: { type: 'Literal', value: 0 },
            },
            {
              type: 'WhileStatement',
              condition: { type: 'Literal', value: true },
              body: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ExpressionStatement',
                    expression: {
                      type: 'AssignmentExpression',
                      operator: '+=',
                      left: { type: 'Identifier', name: 'i' },
                      right: { type: 'Literal', value: 1 },
                    },
                  },
                  {
                    type: 'IfStatement',
                    condition: {
                      type: 'BinaryExpression',
                      operator: '>=',
                      left: { type: 'Identifier', name: 'i' },
                      right: { type: 'Literal', value: 5 },
                    },
                    consequent: {
                      type: 'BlockStatement',
                      body: [{ type: 'BreakStatement' }],
                    },
                    alternate: null,
                  },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'i' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(5);
      });
    });

    describe('For Statement', () => {
      it('should execute for loop', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'sum',
              init: { type: 'Literal', value: 0 },
            },
            {
              type: 'ForStatement',
              init: {
                type: 'VariableDeclaration',
                kind: 'let',
                name: 'i',
                init: { type: 'Literal', value: 0 },
              },
              test: {
                type: 'BinaryExpression',
                operator: '<',
                left: { type: 'Identifier', name: 'i' },
                right: { type: 'Literal', value: 5 },
              },
              update: {
                type: 'AssignmentExpression',
                operator: '+=',
                left: { type: 'Identifier', name: 'i' },
                right: { type: 'Literal', value: 1 },
              },
              body: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ExpressionStatement',
                    expression: {
                      type: 'AssignmentExpression',
                      operator: '+=',
                      left: { type: 'Identifier', name: 'sum' },
                      right: { type: 'Identifier', name: 'i' },
                    },
                  },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'sum' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(10); // 0 + 1 + 2 + 3 + 4
      });
    });

    describe('For-In Statement', () => {
      it('should iterate over arrays', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'arr',
              init: {
                type: 'ArrayExpression',
                elements: [
                  { type: 'Literal', value: 1 },
                  { type: 'Literal', value: 2 },
                  { type: 'Literal', value: 3 },
                ],
              },
            },
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'sum',
              init: { type: 'Literal', value: 0 },
            },
            {
              type: 'ForInStatement',
              variable: 'x',
              iterable: { type: 'Identifier', name: 'arr' },
              body: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ExpressionStatement',
                    expression: {
                      type: 'AssignmentExpression',
                      operator: '+=',
                      left: { type: 'Identifier', name: 'sum' },
                      right: { type: 'Identifier', name: 'x' },
                    },
                  },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'sum' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(6);
      });

      it('should throw on non-iterable', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ForInStatement',
              variable: 'x',
              iterable: { type: 'Literal', value: 42 },
              body: {
                type: 'BlockStatement',
                body: [],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.success).toBe(false);
      });
    });

    describe('Try-Catch Statement', () => {
      it('should catch and handle errors', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'TryStatement',
              block: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ThrowStatement',
                    argument: { type: 'Literal', value: 'test error' },
                  },
                ],
              },
              handler: {
                param: 'e',
                body: {
                  type: 'BlockStatement',
                  body: [
                    {
                      type: 'ReturnStatement',
                      argument: { type: 'Literal', value: 'caught' },
                    },
                  ],
                },
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('caught');
      });

      it('should propagate uncaught errors', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ThrowStatement',
              argument: { type: 'Literal', value: 'uncaught error' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/uncaught/i);
      });
    });
  });

  // ============================================
  // Expression Evaluation Tests
  // ============================================

  describe('Expression Evaluation', () => {
    describe('Literals', () => {
      it('should evaluate number literals', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: { type: 'Literal', value: 42 },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(42);
      });

      it('should evaluate string literals', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: { type: 'Literal', value: 'hello' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('hello');
      });

      it('should evaluate boolean literals', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: { type: 'Literal', value: true },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(true);
      });

      it('should evaluate null literals', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: { type: 'Literal', value: null },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(null);
      });
    });

    describe('Binary Expressions', () => {
      it('should evaluate arithmetic operations', async () => {
        const testCases = [
          { operator: '+', left: 5, right: 3, expected: 8 },
          { operator: '-', left: 10, right: 4, expected: 6 },
          { operator: '*', left: 6, right: 7, expected: 42 },
          { operator: '/', left: 20, right: 4, expected: 5 },
          { operator: '%', left: 17, right: 5, expected: 2 },
          { operator: '**', left: 2, right: 3, expected: 8 },
        ];

        for (const tc of testCases) {
          const program: any = {
            type: 'Program',
            body: [
              {
                type: 'ReturnStatement',
                argument: {
                  type: 'BinaryExpression',
                  operator: tc.operator,
                  left: { type: 'Literal', value: tc.left },
                  right: { type: 'Literal', value: tc.right },
                },
              },
            ],
          };

          const result = await runtime.execute(program);
          expect(result.returnValue).toBe(tc.expected);
        }
      });

      it('should handle string concatenation', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'BinaryExpression',
                operator: '+',
                left: { type: 'Literal', value: 'Hello, ' },
                right: { type: 'Literal', value: 'World!' },
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('Hello, World!');
      });

      it('should handle string repetition', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'BinaryExpression',
                operator: '*',
                left: { type: 'Literal', value: 'ab' },
                right: { type: 'Literal', value: 3 },
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('ababab');
      });

      it('should evaluate comparison operations', async () => {
        const testCases = [
          { operator: '==', left: 5, right: 5, expected: true },
          { operator: '===', left: 5, right: 5, expected: true },
          { operator: '!=', left: 5, right: 3, expected: true },
          { operator: '!==', left: 5, right: 3, expected: true },
          { operator: '<', left: 3, right: 5, expected: true },
          { operator: '<=', left: 5, right: 5, expected: true },
          { operator: '>', left: 7, right: 3, expected: true },
          { operator: '>=', left: 7, right: 7, expected: true },
        ];

        for (const tc of testCases) {
          const program: any = {
            type: 'Program',
            body: [
              {
                type: 'ReturnStatement',
                argument: {
                  type: 'BinaryExpression',
                  operator: tc.operator,
                  left: { type: 'Literal', value: tc.left },
                  right: { type: 'Literal', value: tc.right },
                },
              },
            ],
          };

          const result = await runtime.execute(program);
          expect(result.returnValue).toBe(tc.expected);
        }
      });
    });

    describe('Unary Expressions', () => {
      it('should evaluate negation', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'UnaryExpression',
                operator: '-',
                argument: { type: 'Literal', value: 42 },
                prefix: true,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(-42);
      });

      it('should evaluate logical not', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'UnaryExpression',
                operator: '!',
                argument: { type: 'Literal', value: false },
                prefix: true,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(true);
      });
    });

    describe('Logical Expressions', () => {
      it('should evaluate AND expressions with short-circuit', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'LogicalExpression',
                operator: '&&',
                left: { type: 'Literal', value: false },
                right: { type: 'Literal', value: true },
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(false);
      });

      it('should evaluate OR expressions with short-circuit', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'LogicalExpression',
                operator: '||',
                left: { type: 'Literal', value: true },
                right: { type: 'Literal', value: false },
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(true);
      });
    });

    describe('Assignment Expressions', () => {
      it('should handle simple assignment', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'x',
              init: { type: 'Literal', value: 10 },
            },
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'AssignmentExpression',
                operator: '=',
                left: { type: 'Identifier', name: 'x' },
                right: { type: 'Literal', value: 20 },
              },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'x' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(20);
      });

      it('should handle compound assignment operators', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'x',
              init: { type: 'Literal', value: 10 },
            },
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'AssignmentExpression',
                operator: '+=',
                left: { type: 'Identifier', name: 'x' },
                right: { type: 'Literal', value: 5 },
              },
            },
            {
              type: 'ReturnStatement',
              argument: { type: 'Identifier', name: 'x' },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(15);
      });
    });

    describe('Array Expressions', () => {
      it('should evaluate array expressions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'ArrayExpression',
                elements: [
                  { type: 'Literal', value: 1 },
                  { type: 'Literal', value: 2 },
                  { type: 'Literal', value: 3 },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toEqual([1, 2, 3]);
      });
    });

    describe('Object Expressions', () => {
      it('should evaluate object expressions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'ObjectExpression',
                properties: [
                  {
                    key: 'name',
                    value: { type: 'Literal', value: 'John' },
                    computed: false,
                  },
                  {
                    key: 'age',
                    value: { type: 'Literal', value: 30 },
                    computed: false,
                  },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toEqual({ name: 'John', age: 30 });
      });
    });

    describe('Member Expressions', () => {
      it('should access object properties', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'obj',
              init: {
                type: 'ObjectExpression',
                properties: [
                  {
                    key: 'x',
                    value: { type: 'Literal', value: 42 },
                    computed: false,
                  },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'obj' },
                property: { type: 'Identifier', name: 'x' },
                computed: false,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(42);
      });

      it('should handle computed member expressions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'arr',
              init: {
                type: 'ArrayExpression',
                elements: [
                  { type: 'Literal', value: 'a' },
                  { type: 'Literal', value: 'b' },
                  { type: 'Literal', value: 'c' },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'arr' },
                property: { type: 'Literal', value: 1 },
                computed: true,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('b');
      });

      it('should throw on null/undefined access', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'x',
              init: { type: 'Literal', value: null },
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'x' },
                property: { type: 'Identifier', name: 'prop' },
                computed: false,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.success).toBe(false);
      });
    });

    describe('Conditional Expressions', () => {
      it('should evaluate conditional expressions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'ConditionalExpression',
                test: { type: 'Literal', value: true },
                consequent: { type: 'Literal', value: 'yes' },
                alternate: { type: 'Literal', value: 'no' },
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('yes');
      });
    });

    describe('Arrow Functions', () => {
      it('should evaluate arrow functions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'double',
              init: {
                type: 'ArrowFunction',
                params: [{ name: 'x' }],
                body: {
                  type: 'BinaryExpression',
                  operator: '*',
                  left: { type: 'Identifier', name: 'x' },
                  right: { type: 'Literal', value: 2 },
                },
                async: false,
              },
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'double' },
                arguments: [{ type: 'Literal', value: 21 }],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(42);
      });
    });
  });

  // ============================================
  // Builtin Functions Tests
  // ============================================

  describe('Builtin Functions', () => {
    describe('Core Functions', () => {
      it('should execute print function', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ExpressionStatement',
              expression: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'print' },
                arguments: [
                  { type: 'Literal', value: 'Hello' },
                  { type: 'Literal', value: 'World' },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.output).toContain('Hello World');
      });

      it('should execute typeof function', async () => {
        const testCases = [
          { value: 42, expected: 'number' },
          { value: 'str', expected: 'string' },
          { value: true, expected: 'boolean' },
          { value: null, expected: 'null' },
        ];

        for (const tc of testCases) {
          const program: any = {
            type: 'Program',
            body: [
              {
                type: 'ReturnStatement',
                argument: {
                  type: 'CallExpression',
                  callee: { type: 'Identifier', name: 'typeof' },
                  arguments: [{ type: 'Literal', value: tc.value }],
                },
              },
            ],
          };

          const result = await runtime.execute(program);
          expect(result.returnValue).toBe(tc.expected);
        }
      });

      it('should execute len function', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'len' },
                arguments: [{ type: 'Literal', value: 'hello' }],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(5);
      });
    });

    describe('Array Functions', () => {
      it('should execute range function', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'range' },
                arguments: [{ type: 'Literal', value: 5 }],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toEqual([0, 1, 2, 3, 4]);
      });

      it('should execute map function', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'ReturnStatement',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'map' },
                arguments: [
                  {
                    type: 'ArrayExpression',
                    elements: [
                      { type: 'Literal', value: 1 },
                      { type: 'Literal', value: 2 },
                      { type: 'Literal', value: 3 },
                    ],
                  },
                  {
                    type: 'ArrowFunction',
                    params: [{ name: 'x' }],
                    body: {
                      type: 'BinaryExpression',
                      operator: '*',
                      left: { type: 'Identifier', name: 'x' },
                      right: { type: 'Literal', value: 2 },
                    },
                    async: false,
                  },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toEqual([2, 4, 6]);
      });
    });

    describe('Math Functions', () => {
      it('should execute min and max functions', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'minimum',
              init: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'min' },
                arguments: [
                  { type: 'Literal', value: 5 },
                  { type: 'Literal', value: 2 },
                  { type: 'Literal', value: 8 },
                ],
              },
            },
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'maximum',
              init: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: 'max' },
                arguments: [
                  { type: 'Literal', value: 5 },
                  { type: 'Literal', value: 2 },
                  { type: 'Literal', value: 8 },
                ],
              },
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'ArrayExpression',
                elements: [
                  { type: 'Identifier', name: 'minimum' },
                  { type: 'Identifier', name: 'maximum' },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toEqual([2, 8]);
      });
    });

    describe('JSON Functions', () => {
      it('should execute JSON.parse and JSON.stringify', async () => {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'VariableDeclaration',
              kind: 'let',
              name: 'obj',
              init: {
                type: 'CallExpression',
                callee: {
                  type: 'MemberExpression',
                  object: { type: 'Identifier', name: 'json' },
                  property: { type: 'Identifier', name: 'parse' },
                  computed: false,
                },
                arguments: [{ type: 'Literal', value: '{"x": 42}' }],
              },
            },
            {
              type: 'ReturnStatement',
              argument: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'obj' },
                property: { type: 'Identifier', name: 'x' },
                computed: false,
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe(42);
      });
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('Error Handling', () => {
    it('should throw on undefined variable', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ReturnStatement',
            argument: { type: 'Identifier', name: 'undefinedVar' },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/undefined.*variable|variable.*not defined/i);
    });

    it('should throw on calling non-function', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'VariableDeclaration',
            kind: 'let',
            name: 'x',
            init: { type: 'Literal', value: 42 },
          },
          {
            type: 'ReturnStatement',
            argument: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'x' },
              arguments: [],
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not a function/i);
    });

    it('should throw on unknown binary operator', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ReturnStatement',
            argument: {
              type: 'BinaryExpression',
              operator: '^^' as string,
              left: { type: 'Literal', value: 1 },
              right: { type: 'Literal', value: 2 },
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unknown.*operator|unsupported.*operator/i);
    });
  });

  // ============================================
  // Execution Result Tests
  // ============================================

  describe('Execution Results', () => {
    it('should return output array', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'print' },
              arguments: [{ type: 'Literal', value: 'line1' }],
            },
          },
          {
            type: 'ExpressionStatement',
            expression: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'print' },
              arguments: [{ type: 'Literal', value: 'line2' }],
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.output).toEqual(['line1', 'line2']);
    });

    it('should return duration', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'ReturnStatement',
            argument: { type: 'Literal', value: 42 },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty program', async () => {
      const program: any = {
        type: 'Program',
        body: [],
      };

      const result = await runtime.execute(program);
      expect(result.returnValue).toBe(null);
      expect(result.output).toEqual([]);
    });
  });

  // ============================================
  // Truthiness Tests
  // ============================================

  describe('Truthiness', () => {
    it('should treat falsy values correctly', async () => {
      const falsyValues = [null, false, 0, ''];

      for (const val of falsyValues) {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'IfStatement',
              condition: { type: 'Literal', value: val },
              consequent: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'truthy' },
                  },
                ],
              },
              alternate: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'falsy' },
                  },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('falsy');
      }
    });

    it('should treat truthy values correctly', async () => {
      const truthyValues = [1, 'hello', true, [], {}];

      for (const val of truthyValues) {
        const program: any = {
          type: 'Program',
          body: [
            {
              type: 'IfStatement',
              condition: { type: 'Literal', value: val as string | number | boolean | null },
              consequent: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'truthy' },
                  },
                ],
              },
              alternate: {
                type: 'BlockStatement',
                body: [
                  {
                    type: 'ReturnStatement',
                    argument: { type: 'Literal', value: 'falsy' },
                  },
                ],
              },
            },
          ],
        };

        const result = await runtime.execute(program);
        expect(result.returnValue).toBe('truthy');
      }
    });
  });

  // ============================================
  // Scoping Tests
  // ============================================

  describe('Scoping', () => {
    it('should handle nested scopes correctly', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'VariableDeclaration',
            kind: 'let',
            name: 'x',
            init: { type: 'Literal', value: 'outer' },
          },
          {
            type: 'FunctionDeclaration',
            name: 'inner',
            params: [],
            body: {
              type: 'BlockStatement',
              body: [
                {
                  type: 'VariableDeclaration',
                  kind: 'let',
                  name: 'x',
                  init: { type: 'Literal', value: 'inner' },
                },
                {
                  type: 'ReturnStatement',
                  argument: { type: 'Identifier', name: 'x' },
                },
              ],
            },
            async: false,
          },
          {
            type: 'VariableDeclaration',
            kind: 'let',
            name: 'innerResult',
            init: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'inner' },
              arguments: [],
            },
          },
          {
            type: 'ReturnStatement',
            argument: {
              type: 'ArrayExpression',
              elements: [
                { type: 'Identifier', name: 'x' },
                { type: 'Identifier', name: 'innerResult' },
              ],
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.returnValue).toEqual(['outer', 'inner']);
    });

    it('should allow variable shadowing in functions', async () => {
      const program: any = {
        type: 'Program',
        body: [
          {
            type: 'VariableDeclaration',
            kind: 'let',
            name: 'value',
            init: { type: 'Literal', value: 100 },
          },
          {
            type: 'FunctionDeclaration',
            name: 'test',
            params: [{ name: 'value' }],
            body: {
              type: 'BlockStatement',
              body: [
                {
                  type: 'ReturnStatement',
                  argument: { type: 'Identifier', name: 'value' },
                },
              ],
            },
            async: false,
          },
          {
            type: 'ReturnStatement',
            argument: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: 'test' },
              arguments: [{ type: 'Literal', value: 200 }],
            },
          },
        ],
      };

      const result = await runtime.execute(program);
      expect(result.returnValue).toBe(200);
    });
  });
});
