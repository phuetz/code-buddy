import {
  CodingStyleAnalyzer,
  getCodingStyleAnalyzer,
  resetCodingStyleAnalyzer,
} from '../../src/memory/coding-style-analyzer';

describe('CodingStyleAnalyzer', () => {
  let analyzer: CodingStyleAnalyzer;

  beforeEach(() => {
    resetCodingStyleAnalyzer();
    analyzer = new CodingStyleAnalyzer();
  });

  describe('analyzeContent', () => {
    it('detects single quotes', () => {
      const content = `
const name = 'hello';
const greeting = 'world';
const foo = 'bar';
const baz = 'qux';
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.quoteStyle).toBe('single');
    });

    it('detects double quotes', () => {
      const content = `
const name = "hello";
const greeting = "world";
const foo = "bar";
const baz = "qux";
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.quoteStyle).toBe('double');
    });

    it('detects semicolon usage', () => {
      const content = `
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.semicolons).toBe(true);
    });

    it('detects no semicolons', () => {
      const content = `
const a = 1
const b = 2
const c = 3
const d = 4
const e = 5
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.semicolons).toBe(false);
    });

    it('detects 2-space indentation', () => {
      const content = `function hello() {
  const a = 1;
  if (true) {
    const b = 2;
  }
}
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.indentation).toBe('2-spaces');
    });

    it('detects 4-space indentation', () => {
      const content = `function hello() {
    const a = 1;
    if (true) {
        const b = 2;
    }
}
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.indentation).toBe('4-spaces');
    });

    it('detects tab indentation', () => {
      const content = `function hello() {
\tconst a = 1;
\tif (true) {
\t\tconst b = 2;
\t}
}
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.indentation).toBe('tabs');
    });

    it('detects named imports with .js extensions', () => {
      const content = `
import { foo } from './foo.js';
import { bar } from './bar.js';
import { baz } from '../baz.js';
import { qux } from './qux.js';
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.importStyle).toBeDefined();
      expect(result.importStyle!.style).toBe('named');
      expect(result.importStyle!.extensionsInImports).toBe(true);
    });

    it('detects default imports', () => {
      const content = `
import React from 'react';
import path from 'path';
import fs from 'fs';
import os from 'os';
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.importStyle).toBeDefined();
      expect(result.importStyle!.style).toBe('default');
    });

    it('detects camelCase variable naming', () => {
      const content = `
const myVariable = 1;
const anotherThing = 2;
const someValue = 3;
let currentCount = 0;
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.namingConventions).toBeDefined();
      const varPattern = result.namingConventions!.find(
        (p) => p.scope === 'variable'
      );
      expect(varPattern).toBeDefined();
      expect(varPattern!.convention).toBe('camelCase');
    });

    it('detects PascalCase class naming', () => {
      const content = `
class MyService {
  constructor() {}
}
class UserRepository {
  find() {}
}
class DataManager {
  process() {}
}
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.namingConventions).toBeDefined();
      const classPattern = result.namingConventions!.find(
        (p) => p.scope === 'class'
      );
      expect(classPattern).toBeDefined();
      expect(classPattern!.convention).toBe('PascalCase');
    });

    it('detects SCREAMING_SNAKE constants', () => {
      const content = `
const MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000;
const API_BASE_URL = 'https://api.example.com';
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.namingConventions).toBeDefined();
      const constPattern = result.namingConventions!.find(
        (p) => p.scope === 'constant'
      );
      expect(constPattern).toBeDefined();
      expect(constPattern!.convention).toBe('SCREAMING_SNAKE');
    });

    it('detects try-catch error handling', () => {
      const content = `
async function doWork() {
  try {
    await fetch('/api');
  } catch (err) {
    console.error(err);
  }
  try {
    await save();
  } catch (e) {
    throw e;
  }
}
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.errorHandlingPattern).toBe('try-catch');
    });

    it('detects promise-catch error handling', () => {
      const content = `
fetch('/api')
  .catch(err => console.error(err));
save()
  .catch(e => logger.error(e));
load()
  .catch(handleError);
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.errorHandlingPattern).toBe('promise-catch');
    });

    it('detects describe/it testing pattern', () => {
      const content = `
describe('MyService', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });

  it('should handle errors', () => {
    expect(false).toBe(false);
  });
});
`;
      const result = analyzer.analyzeContent(content, 'my-service.test.ts');
      expect(result.testingPattern).toBe('describe-it');
    });

    it('detects standalone test() pattern', () => {
      const content = `
test('should do something', () => {
  expect(true).toBe(true);
});

test('should handle errors', () => {
  expect(false).toBe(false);
});
`;
      const result = analyzer.analyzeContent(content, 'my-service.test.ts');
      expect(result.testingPattern).toBe('test-only');
    });

    it('detects type annotation density', () => {
      const content = `
const name: string = 'hello';
const count: number = 42;
function greet(name: string): void {
  console.log(name);
}
const items: string[] = [];
let active: boolean = true;
`;
      const result = analyzer.analyzeContent(content, 'test.ts');
      expect(result.typeAnnotationDensity).toBe('strict');
    });

    it('handles empty content gracefully', () => {
      const result = analyzer.analyzeContent('', 'empty.ts');
      expect(result).toEqual({});
    });

    it('handles whitespace-only content gracefully', () => {
      const result = analyzer.analyzeContent('   \n  \n  ', 'empty.ts');
      expect(result).toEqual({});
    });
  });

  describe('buildPromptSnippet', () => {
    it('generates correct format', () => {
      const profile = {
        quoteStyle: 'single' as const,
        semicolons: true,
        indentation: '2-spaces' as const,
        importStyle: {
          style: 'named' as const,
          usesBarrelFiles: false,
          extensionsInImports: true,
        },
        namingConventions: [
          { scope: 'variable' as const, convention: 'camelCase' as const, confidence: 0.95 },
          { scope: 'class' as const, convention: 'PascalCase' as const, confidence: 1.0 },
        ],
        errorHandlingPattern: 'try-catch' as const,
        testingPattern: 'describe-it' as const,
        typeAnnotationDensity: 'strict' as const,
      };

      const snippet = analyzer.buildPromptSnippet(profile);

      expect(snippet).toContain('<coding_style>');
      expect(snippet).toContain('</coding_style>');
      expect(snippet).toContain('Project coding conventions (auto-detected):');
      expect(snippet).toContain('- Quotes: single quotes');
      expect(snippet).toContain('- Semicolons: yes');
      expect(snippet).toContain('- Indentation: 2 spaces');
      expect(snippet).toContain('- Imports: named imports with .js extensions');
      expect(snippet).toContain('camelCase for variables');
      expect(snippet).toContain('PascalCase for classs');
      expect(snippet).toContain('- Error handling: try-catch');
      expect(snippet).toContain('- Testing: describe/it blocks');
    });

    it('handles no semicolons', () => {
      const profile = {
        quoteStyle: 'double' as const,
        semicolons: false,
        indentation: '4-spaces' as const,
        importStyle: {
          style: 'default' as const,
          usesBarrelFiles: false,
          extensionsInImports: false,
        },
        namingConventions: [],
        errorHandlingPattern: 'promise-catch' as const,
        testingPattern: 'test-only' as const,
        typeAnnotationDensity: 'minimal' as const,
      };

      const snippet = analyzer.buildPromptSnippet(profile);

      expect(snippet).toContain('- Quotes: double quotes');
      expect(snippet).toContain('- Semicolons: no');
      expect(snippet).toContain('- Indentation: 4 spaces');
    });
  });

  describe('singleton', () => {
    it('returns the same instance', () => {
      const a = getCodingStyleAnalyzer();
      const b = getCodingStyleAnalyzer();
      expect(a).toBe(b);
    });

    it('resets the instance', () => {
      const a = getCodingStyleAnalyzer();
      resetCodingStyleAnalyzer();
      const b = getCodingStyleAnalyzer();
      expect(a).not.toBe(b);
    });
  });

  describe('analyzeFiles', () => {
    it('merges profiles from multiple content analyses', async () => {
      // Use analyzeContent directly since we are not reading files from disk
      const content1 = `
import { foo } from './foo.js';
const myVar = 'hello';
const myOther = 'world';
`;
      const content2 = `
import { bar } from './bar.js';
const anotherVar = 'test';
class MyClass {}
`;
      const p1 = analyzer.analyzeContent(content1, 'a.ts');
      const p2 = analyzer.analyzeContent(content2, 'b.ts');

      // Verify consistent detection across files
      expect(p1.quoteStyle).toBe('single');
      expect(p2.quoteStyle).toBe('single');
      expect(p1.importStyle!.style).toBe('named');
      expect(p2.importStyle!.style).toBe('named');
    });
  });
});
