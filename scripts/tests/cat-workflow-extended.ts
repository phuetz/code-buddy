/**
 * Cat 40: Lobster Engine Extended (7 tests, no API)
 * Cat 41: Coding Style Analyzer (5 tests, no API)
 */

import type { TestDef } from './types.js';
import { LobsterEngine } from '../../src/workflows/lobster-engine.js';

// ============================================================================
// Cat 40: Lobster Engine Extended
// ============================================================================

export function cat40LobsterExtended(): TestDef[] {
  return [
    {
      name: '40.1-cycle-detection',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const validation = engine.validateWorkflow({
          name: 'cycle-test', version: '1.0',
          steps: [
            { id: 'a', name: 'A', command: 'echo a', dependsOn: ['b'] },
            { id: 'b', name: 'B', command: 'echo b', dependsOn: ['a'] },
          ],
        });
        LobsterEngine.resetInstance();
        return {
          pass: !validation.valid && validation.errors.some(e => e.includes('cycle')),
          metadata: { errors: validation.errors },
        };
      },
    },
    {
      name: '40.2-duplicate-step-ids',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const validation = engine.validateWorkflow({
          name: 'dup-test', version: '1.0',
          steps: [
            { id: 'step1', name: 'A', command: 'echo a' },
            { id: 'step1', name: 'B', command: 'echo b' },
          ],
        });
        LobsterEngine.resetInstance();
        return {
          pass: !validation.valid && validation.errors.some(e => e.includes('Duplicate')),
          metadata: { errors: validation.errors },
        };
      },
    },
    {
      name: '40.3-unknown-dependency',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const validation = engine.validateWorkflow({
          name: 'unk-dep', version: '1.0',
          steps: [
            { id: 'a', name: 'A', command: 'echo a', dependsOn: ['nonexistent'] },
          ],
        });
        LobsterEngine.resetInstance();
        return {
          pass: !validation.valid && validation.errors.some(e => e.includes('unknown')),
          metadata: { errors: validation.errors },
        };
      },
    },
    {
      name: '40.4-variable-resolution',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const result = engine.resolveVariables('Hello ${name}, build ${version}', { name: 'World', version: '2.0' });
        LobsterEngine.resetInstance();
        return {
          pass: result === 'Hello World, build 2.0',
          metadata: { result },
        };
      },
    },
    {
      name: '40.5-step-reference-resolution',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const result = engine.resolveVariables('Input: $build.stdout, Code: $test.exitCode', {
          'build.stdout': 'compiled', 'test.exitCode': '0',
        });
        LobsterEngine.resetInstance();
        return {
          pass: result === 'Input: compiled, Code: 0',
          metadata: { result },
        };
      },
    },
    {
      name: '40.6-condition-evaluation',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const t1 = engine.evaluateCondition('$build.approved', { 'build.approved': 'true' });
        const t2 = engine.evaluateCondition('$test.exitCode == 0', { 'test.exitCode': '0' });
        const t3 = engine.evaluateCondition('$test.exitCode != 1', { 'test.exitCode': '0' });
        const f1 = engine.evaluateCondition('false', {});
        const f2 = engine.evaluateCondition('$test.exitCode == 1', { 'test.exitCode': '0' });
        const empty = engine.evaluateCondition(undefined, {});
        LobsterEngine.resetInstance();
        return {
          pass: t1 && t2 && t3 && !f1 && !f2 && empty,
          metadata: { t1, t2, t3, f1, f2, empty },
        };
      },
    },
    {
      name: '40.7-resume-token-roundtrip',
      timeout: 5000,
      fn: async () => {
        const engine = LobsterEngine.getInstance();
        const steps = ['step1', 'step2', 'step3'];
        const token = engine.generateResumeToken(steps);
        const parsed = engine.parseResumeToken(token);
        LobsterEngine.resetInstance();
        return {
          pass: JSON.stringify(parsed) === JSON.stringify(steps) && typeof token === 'string' && token.length > 0,
          metadata: { token, parsed },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 41: Coding Style Analyzer
// ============================================================================

export function cat41CodingStyleAnalyzer(): TestDef[] {
  return [
    {
      name: '41.1-instantiation',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/memory/coding-style-analyzer.js');
        const Analyzer = mod.CodingStyleAnalyzer || mod.default;
        const analyzer = new Analyzer();
        return { pass: analyzer !== undefined };
      },
    },
    {
      name: '41.2-analyze-typescript-style',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/memory/coding-style-analyzer.js');
        const Analyzer = mod.CodingStyleAnalyzer || mod.default;
        const analyzer = new Analyzer();
        const code = `
import { foo } from './bar.js';

export function greetUser(name: string): string {
  const greeting = 'Hello, ' + name;
  return greeting;
}

export const MAX_RETRY = 3;
`;
        // Method is analyzeContent(content, filePath)
        const result = analyzer.analyzeContent(code, 'test.ts');
        return {
          pass: result !== undefined && typeof result === 'object',
          metadata: result as unknown as Record<string, unknown>,
        };
      },
    },
    {
      name: '41.3-detect-indent-style',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/memory/coding-style-analyzer.js');
        const Analyzer = mod.CodingStyleAnalyzer || mod.default;
        const analyzer = new Analyzer();
        const twoSpace = `function foo() {\n  return 1;\n}\n`;
        const fourSpace = `function foo() {\n    return 1;\n}\n`;
        const r1 = analyzer.analyzeContent(twoSpace, 'two.ts');
        const r2 = analyzer.analyzeContent(fourSpace, 'four.ts');
        return {
          pass: r1.indentation !== r2.indentation,
          metadata: { r1Indent: r1.indentation, r2Indent: r2.indentation },
        };
      },
    },
    {
      name: '41.4-detect-quotes',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/memory/coding-style-analyzer.js');
        const Analyzer = mod.CodingStyleAnalyzer || mod.default;
        const analyzer = new Analyzer();
        const singleQuotes = `const a = 'hello';\nconst b = 'world';\n`;
        const result = analyzer.analyzeContent(singleQuotes, 'quotes.ts');
        return {
          pass: result.quoteStyle === 'single',
          metadata: { quoteStyle: result.quoteStyle },
        };
      },
    },
    {
      name: '41.5-detect-semicolons',
      timeout: 5000,
      fn: async () => {
        const mod = await import('../../src/memory/coding-style-analyzer.js');
        const Analyzer = mod.CodingStyleAnalyzer || mod.default;
        const analyzer = new Analyzer();
        const withSemis = `const a = 1;\nconst b = 2;\nfunction f() { return 3; }\n`;
        const result = analyzer.analyzeContent(withSemis, 'semis.ts');
        return {
          pass: result.semicolons === true,
          metadata: { semicolons: result.semicolons },
        };
      },
    },
  ];
}
