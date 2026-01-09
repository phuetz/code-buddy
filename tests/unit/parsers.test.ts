/**
 * Comprehensive Unit Tests for Parsers Module
 *
 * Tests code parsing, AST handling, and language-specific parsers:
 * - AST Parser (src/tools/intelligence/ast-parser.ts)
 * - FCS Parser (src/fcs/parser.ts, src/fcs/lexer.ts)
 * - Buddy Script Parser (src/scripting/parser.ts, src/scripting/lexer.ts)
 * - Test Output Parser (src/utils/test-output-parser.ts)
 */

// ============================================================================
// AST Parser Tests
// ============================================================================

describe('AST Parser', () => {
  // Lazy import to avoid memory issues
  let ASTParser: any;
  let createASTParser: any;
  let getASTParser: any;
  let resetASTParser: any;

  beforeAll(async () => {
    const module = await import('../../src/tools/intelligence/ast-parser');
    ASTParser = module.ASTParser;
    createASTParser = module.createASTParser;
    getASTParser = module.getASTParser;
    resetASTParser = module.resetASTParser;
  });

  beforeEach(() => {
    if (resetASTParser) resetASTParser();
  });

  describe('Factory Functions', () => {
    it('should create a new parser instance with createASTParser', () => {
      const p = createASTParser();
      expect(p).toBeInstanceOf(ASTParser);
    });

    it('should return singleton instance with getASTParser', () => {
      const p1 = getASTParser();
      const p2 = getASTParser();
      expect(p1).toBe(p2);
    });

    it('should reset singleton with resetASTParser', () => {
      const p1 = getASTParser();
      resetASTParser();
      const p2 = getASTParser();
      expect(p1).not.toBe(p2);
    });
  });

  describe('Language Detection', () => {
    it('should detect TypeScript from .ts extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.ts')).toBe('typescript');
    });

    it('should detect TypeScript from .tsx extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.tsx')).toBe('typescript');
    });

    it('should detect JavaScript from .js extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.js')).toBe('javascript');
    });

    it('should detect JavaScript from .jsx extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.jsx')).toBe('javascript');
    });

    it('should detect JavaScript from .mjs extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.mjs')).toBe('javascript');
    });

    it('should detect Python from .py extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.py')).toBe('python');
    });

    it('should detect Go from .go extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.go')).toBe('go');
    });

    it('should detect Rust from .rs extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.rs')).toBe('rust');
    });

    it('should detect Java from .java extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.java')).toBe('java');
    });

    it('should detect C from .c extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.c')).toBe('c');
    });

    it('should detect C++ from .cpp extension', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.cpp')).toBe('cpp');
    });

    it('should return unknown for unsupported extensions', () => {
      const parser = createASTParser();
      expect(parser.detectLanguage('/path/to/file.xyz')).toBe('unknown');
    });
  });

  describe('TypeScript/JavaScript Parsing', () => {
    const tsCode = `
import { foo } from './foo';
import * as bar from './bar';
import baz from './baz';

export const MY_CONSTANT = 42;

export interface IUser {
  name: string;
}

export type UserRole = 'admin' | 'user';

export enum Status { Active, Inactive }

export class UserService {
  async getUser(id: string) { return null; }
}

export function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}
`;

    it('should parse TypeScript content correctly', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');

      expect(result.filePath).toBe('test.ts');
      expect(result.language).toBe('typescript');
      expect(result.errors).toHaveLength(0);
      expect(result.metadata.hasErrors).toBe(false);
    });

    it('should extract class symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const classes = result.symbols.filter((s: any) => s.type === 'class');

      expect(classes.length).toBeGreaterThanOrEqual(1);
      const userService = classes.find((c: any) => c.name === 'UserService');
      expect(userService).toBeDefined();
    });

    it('should extract function symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const functions = result.symbols.filter((s: any) => s.type === 'function');

      expect(functions.length).toBeGreaterThanOrEqual(1);
      const calculateTotal = functions.find((f: any) => f.name === 'calculateTotal');
      expect(calculateTotal).toBeDefined();
    });

    it('should extract interface symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const interfaces = result.symbols.filter((s: any) => s.type === 'interface');

      expect(interfaces.length).toBeGreaterThanOrEqual(1);
      const iUser = interfaces.find((i: any) => i.name === 'IUser');
      expect(iUser).toBeDefined();
    });

    it('should extract type alias symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const types = result.symbols.filter((s: any) => s.type === 'type');

      expect(types.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract enum symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const enums = result.symbols.filter((s: any) => s.type === 'enum');

      expect(enums.length).toBeGreaterThanOrEqual(1);
      const status = enums.find((e: any) => e.name === 'Status');
      expect(status).toBeDefined();
    });

    it('should extract constant symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');
      const constants = result.symbols.filter((s: any) => s.type === 'constant');

      expect(constants.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract imports', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');

      expect(result.imports.length).toBeGreaterThanOrEqual(2);
    });

    it('should calculate complexity', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');

      expect(result.metadata.complexity).toBeDefined();
      expect(result.metadata.complexity).toBeGreaterThan(0);
    });

    it('should provide source ranges for symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(tsCode, 'test.ts', 'typescript');

      result.symbols.forEach((symbol: any) => {
        expect(symbol.range).toBeDefined();
        expect(symbol.range.start.line).toBeGreaterThan(0);
      });
    });
  });

  describe('Python Parsing', () => {
    const pyCode = `
from typing import List

class UserService:
    def __init__(self):
        self._users = []

    def get_user(self, user_id: str):
        return None

def calculate_total(items: List[int]) -> int:
    return sum(items)

MY_CONSTANT = 42
`;

    it('should parse Python content correctly', () => {
      const parser = createASTParser();
      const result = parser.parseContent(pyCode, 'test.py', 'python');

      expect(result.filePath).toBe('test.py');
      expect(result.language).toBe('python');
      expect(result.errors).toHaveLength(0);
    });

    it('should extract Python class symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(pyCode, 'test.py', 'python');
      const classes = result.symbols.filter((s: any) => s.type === 'class');

      expect(classes.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract Python function symbols', () => {
      const parser = createASTParser();
      const result = parser.parseContent(pyCode, 'test.py', 'python');
      const functions = result.symbols.filter((s: any) =>
        s.type === 'function' || s.type === 'method'
      );

      expect(functions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Go Parsing', () => {
    const goCode = `
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

type UserService interface {
    GetUser(id string) (*User, error)
}

func NewUser(name string, age int) *User {
    return &User{Name: name, Age: age}
}

const MaxUsers = 100
`;

    it('should parse Go content correctly', () => {
      const parser = createASTParser();
      const result = parser.parseContent(goCode, 'main.go', 'go');

      expect(result.filePath).toBe('main.go');
      expect(result.language).toBe('go');
      expect(result.errors).toHaveLength(0);
    });

    it('should extract Go struct as class', () => {
      const parser = createASTParser();
      const result = parser.parseContent(goCode, 'main.go', 'go');
      const classes = result.symbols.filter((s: any) => s.type === 'class');

      expect(classes.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract Go interface', () => {
      const parser = createASTParser();
      const result = parser.parseContent(goCode, 'main.go', 'go');
      const interfaces = result.symbols.filter((s: any) => s.type === 'interface');

      expect(interfaces.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract Go functions', () => {
      const parser = createASTParser();
      const result = parser.parseContent(goCode, 'main.go', 'go');
      const functions = result.symbols.filter((s: any) => s.type === 'function');

      expect(functions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      const parser = createASTParser();
      parser.clearCache();
      const stats = parser.getCacheStats();

      expect(stats.size).toBe(0);
    });

    it('should report cache stats', () => {
      const parser = createASTParser();
      const stats = parser.getCacheStats();

      expect(typeof stats.size).toBe('number');
      expect(Array.isArray(stats.entries)).toBe(true);
    });
  });
});

// ============================================================================
// FCS Parser Tests
// ============================================================================

describe('FCS Parser', () => {
  let tokenizeFCS: any;
  let parseFCS: any;
  let FCSTokenType: any;

  beforeAll(async () => {
    const lexerModule = await import('../../src/fcs/lexer');
    const parserModule = await import('../../src/fcs/parser');
    const typesModule = await import('../../src/fcs/types');

    tokenizeFCS = lexerModule.tokenize;
    parseFCS = parserModule.parse;
    FCSTokenType = typesModule.TokenType;
  });

  describe('FCS Lexer', () => {
    it('should tokenize simple identifiers', () => {
      const tokens = tokenizeFCS('hello');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Identifier && t.value === 'hello')).toBe(true);
    });

    it('should tokenize keywords', () => {
      const tokens = tokenizeFCS('let const func if else while for');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Keyword && t.value === 'let')).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Keyword && t.value === 'const')).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Keyword && t.value === 'func')).toBe(true);
    });

    it('should tokenize numbers', () => {
      const tokens = tokenizeFCS('42 3.14 0xFF 0b1010 1e10');
      const numbers = tokens.filter((t: any) => t.type === FCSTokenType.Number);
      expect(numbers.length).toBeGreaterThanOrEqual(5);
    });

    it('should tokenize strings', () => {
      const tokens = tokenizeFCS('"hello" \'world\'');
      const strings = tokens.filter((t: any) => t.type === FCSTokenType.String);
      expect(strings.length).toBe(2);
    });

    it('should tokenize template strings', () => {
      const tokens = tokenizeFCS('`hello ${name}`');
      const strings = tokens.filter((t: any) => t.type === FCSTokenType.String);
      expect(strings.length).toBe(1);
      expect(strings[0].value).toContain('${name}');
    });

    it('should tokenize booleans', () => {
      const tokens = tokenizeFCS('true false');
      const bools = tokens.filter((t: any) => t.type === FCSTokenType.Boolean);
      expect(bools.length).toBe(2);
    });

    it('should tokenize null', () => {
      const tokens = tokenizeFCS('null');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Null)).toBe(true);
    });

    it('should tokenize operators', () => {
      const tokens = tokenizeFCS('+ - * / % ** == != < > <= >= && || !');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Plus)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Minus)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Multiply)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Divide)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Power)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Equal)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.And)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Or)).toBe(true);
    });

    it('should tokenize assignment operators', () => {
      const tokens = tokenizeFCS('= += -= *= /=');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Assign)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.PlusAssign)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.MinusAssign)).toBe(true);
    });

    it('should tokenize delimiters', () => {
      const tokens = tokenizeFCS('( ) { } [ ]');
      expect(tokens.some((t: any) => t.type === FCSTokenType.LeftParen)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.RightParen)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.LeftBrace)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.RightBrace)).toBe(true);
    });

    it('should tokenize punctuation', () => {
      const tokens = tokenizeFCS('; , . :');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Semicolon)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Comma)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Dot)).toBe(true);
      expect(tokens.some((t: any) => t.type === FCSTokenType.Colon)).toBe(true);
    });

    it('should tokenize arrow operator', () => {
      const tokens = tokenizeFCS('=> ->');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Arrow)).toBe(true);
    });

    it('should tokenize pipeline operator', () => {
      const tokens = tokenizeFCS('|>');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Pipeline)).toBe(true);
    });

    it('should tokenize decorators', () => {
      const tokens = tokenizeFCS('@test @deprecated');
      const decorators = tokens.filter((t: any) => t.type === FCSTokenType.Decorator);
      expect(decorators.length).toBe(2);
    });

    it('should skip line comments', () => {
      const tokens = tokenizeFCS('x // this is a comment\ny');
      expect(tokens.filter((t: any) => t.type === FCSTokenType.Identifier).length).toBe(2);
    });

    it('should skip block comments', () => {
      const tokens = tokenizeFCS('x /* block comment */ y');
      expect(tokens.filter((t: any) => t.type === FCSTokenType.Identifier).length).toBe(2);
    });

    it('should handle escape sequences in strings', () => {
      const tokens = tokenizeFCS('"hello\\nworld\\t!"');
      const strings = tokens.filter((t: any) => t.type === FCSTokenType.String);
      expect(strings[0].value).toBe('hello\nworld\t!');
    });

    it('should track line and column', () => {
      const tokens = tokenizeFCS('x\ny');
      const xToken = tokens.find((t: any) => t.value === 'x');
      const yToken = tokens.find((t: any) => t.value === 'y');

      expect(xToken?.line).toBe(1);
      expect(yToken?.line).toBe(2);
    });

    it('should throw on unexpected characters', () => {
      expect(() => tokenizeFCS('x ^ y')).toThrow();
    });

    it('should handle shebang', () => {
      const tokens = tokenizeFCS('#!/usr/bin/env fcs\nlet x = 1');
      expect(tokens.some((t: any) => t.type === FCSTokenType.Keyword && t.value === 'let')).toBe(true);
    });
  });

  describe('FCS Parser - Expressions', () => {
    it('should parse literal expressions', () => {
      const ast = parseFCS(tokenizeFCS('42'));
      expect(ast.type).toBe('Program');
      expect(ast.statements.length).toBe(1);
    });

    it('should parse identifier expressions', () => {
      const ast = parseFCS(tokenizeFCS('myVar'));
      expect(ast.statements[0]).toMatchObject({
        type: 'ExpressionStmt',
      });
    });

    it('should parse binary expressions', () => {
      const ast = parseFCS(tokenizeFCS('1 + 2'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Binary');
      expect(stmt.expression.operator).toBe(FCSTokenType.Plus);
    });

    it('should parse unary expressions', () => {
      const ast = parseFCS(tokenizeFCS('-x'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Unary');
    });

    it('should parse call expressions', () => {
      const ast = parseFCS(tokenizeFCS('foo(1, 2, 3)'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Call');
      expect(stmt.expression.arguments.length).toBe(3);
    });

    it('should parse member expressions', () => {
      const ast = parseFCS(tokenizeFCS('obj.prop'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Member');
      expect(stmt.expression.member).toBe('prop');
    });

    it('should parse index expressions', () => {
      const ast = parseFCS(tokenizeFCS('arr[0]'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Index');
    });

    it('should parse array literals', () => {
      const ast = parseFCS(tokenizeFCS('[1, 2, 3]'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Array');
      expect(stmt.expression.elements.length).toBe(3);
    });

    it('should parse dict literals', () => {
      const ast = parseFCS(tokenizeFCS('{ a: 1, b: 2 }'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Dict');
    });

    it('should parse lambda expressions', () => {
      const ast = parseFCS(tokenizeFCS('(x) => x * 2'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Lambda');
      expect(stmt.expression.parameters).toContain('x');
    });

    it('should parse ternary expressions', () => {
      const ast = parseFCS(tokenizeFCS('x ? 1 : 2'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Ternary');
    });

    it('should parse pipeline expressions', () => {
      const ast = parseFCS(tokenizeFCS('x |> double'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Call');
    });

    it('should parse assignment expressions', () => {
      const ast = parseFCS(tokenizeFCS('x = 5'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.type).toBe('Assignment');
    });

    it('should respect operator precedence', () => {
      const ast = parseFCS(tokenizeFCS('1 + 2 * 3'));
      const stmt = ast.statements[0] as any;
      expect(stmt.expression.operator).toBe(FCSTokenType.Plus);
      expect(stmt.expression.right.operator).toBe(FCSTokenType.Multiply);
    });
  });

  describe('FCS Parser - Statements', () => {
    it('should parse variable declarations with let', () => {
      const ast = parseFCS(tokenizeFCS('let x = 42'));
      expect(ast.statements[0]).toMatchObject({
        type: 'VarDeclaration',
        name: 'x',
        isConst: false,
      });
    });

    it('should parse variable declarations with const', () => {
      const ast = parseFCS(tokenizeFCS('const PI = 3.14'));
      expect(ast.statements[0]).toMatchObject({
        type: 'VarDeclaration',
        name: 'PI',
        isConst: true,
      });
    });

    it('should parse function declarations', () => {
      const ast = parseFCS(tokenizeFCS('func add(a, b) { return a + b }'));
      const fn = ast.statements[0] as any;
      expect(fn.type).toBe('FunctionDeclaration');
      expect(fn.name).toBe('add');
      expect(fn.parameters.length).toBe(2);
    });

    it('should parse async function declarations', () => {
      const ast = parseFCS(tokenizeFCS('async func fetch() { }'));
      const fn = ast.statements[0] as any;
      expect(fn.type).toBe('FunctionDeclaration');
      expect(fn.isAsync).toBe(true);
    });

    it('should parse class declarations', () => {
      const ast = parseFCS(tokenizeFCS('class User { }'));
      const cls = ast.statements[0] as any;
      expect(cls.type).toBe('ClassDeclaration');
      expect(cls.name).toBe('User');
    });

    it('should parse class with base class', () => {
      const ast = parseFCS(tokenizeFCS('class Admin: User { }'));
      const cls = ast.statements[0] as any;
      expect(cls.baseClass).toBe('User');
    });

    it('should parse if statements', () => {
      const ast = parseFCS(tokenizeFCS('if x > 0 { y = 1 }'));
      const ifStmt = ast.statements[0] as any;
      expect(ifStmt.type).toBe('If');
    });

    it('should parse if-else statements', () => {
      const ast = parseFCS(tokenizeFCS('if x > 0 { y = 1 } else { y = 0 }'));
      const ifStmt = ast.statements[0] as any;
      expect(ifStmt.type).toBe('If');
      expect(ifStmt.elseBranch).not.toBeNull();
    });

    it('should parse while statements', () => {
      const ast = parseFCS(tokenizeFCS('while x > 0 { x = x - 1 }'));
      const whileStmt = ast.statements[0] as any;
      expect(whileStmt.type).toBe('While');
    });

    it('should parse for-in statements', () => {
      const ast = parseFCS(tokenizeFCS('for i in items { print(i) }'));
      const forStmt = ast.statements[0] as any;
      expect(forStmt.type).toBe('For');
      expect(forStmt.variable).toBe('i');
    });

    it('should parse return statements', () => {
      const ast = parseFCS(tokenizeFCS('func test() { return 42 }'));
      const fn = ast.statements[0] as any;
      const returnStmt = fn.body.statements[0];
      expect(returnStmt.type).toBe('Return');
    });

    it('should parse break statements', () => {
      const ast = parseFCS(tokenizeFCS('while true { break }'));
      const whileStmt = ast.statements[0] as any;
      expect(whileStmt.body.statements[0].type).toBe('Break');
    });

    it('should parse continue statements', () => {
      const ast = parseFCS(tokenizeFCS('while true { continue }'));
      const whileStmt = ast.statements[0] as any;
      expect(whileStmt.body.statements[0].type).toBe('Continue');
    });

    it('should parse try-catch statements', () => {
      const ast = parseFCS(tokenizeFCS('try { foo() } catch (e) { }'));
      const tryStmt = ast.statements[0] as any;
      expect(tryStmt.type).toBe('Try');
      expect(tryStmt.catchClauses.length).toBe(1);
    });

    it('should parse try-catch-finally statements', () => {
      const ast = parseFCS(tokenizeFCS('try { } catch (e) { } finally { }'));
      const tryStmt = ast.statements[0] as any;
      expect(tryStmt.finallyBlock).not.toBeNull();
    });

    it('should parse throw statements', () => {
      const ast = parseFCS(tokenizeFCS('throw "error"'));
      const throwStmt = ast.statements[0] as any;
      expect(throwStmt.type).toBe('Throw');
    });

    it('should parse import statements', () => {
      const ast = parseFCS(tokenizeFCS('import { foo } from "module"'));
      const importStmt = ast.statements[0] as any;
      expect(importStmt.type).toBe('Import');
      expect(importStmt.names).toContain('foo');
    });

    it('should parse namespace imports', () => {
      const ast = parseFCS(tokenizeFCS('import * as utils from "utils"'));
      const importStmt = ast.statements[0] as any;
      expect(importStmt.alias).toBe('utils');
    });

    it('should parse test declarations', () => {
      const ast = parseFCS(tokenizeFCS('test "should work" { assert true }'));
      const testDecl = ast.statements[0] as any;
      expect(testDecl.type).toBe('TestDeclaration');
      expect(testDecl.name).toBe('should work');
    });

    it('should parse assert statements', () => {
      const ast = parseFCS(tokenizeFCS('assert x == 1'));
      const assertStmt = ast.statements[0] as any;
      expect(assertStmt.type).toBe('Assert');
    });
  });

  describe('FCS Parser - Error Handling', () => {
    it('should throw on invalid syntax', () => {
      expect(() => parseFCS(tokenizeFCS('let = 5'))).toThrow();
    });

    it('should throw on mismatched braces', () => {
      expect(() => parseFCS(tokenizeFCS('func test() {'))).toThrow();
    });

    it('should throw on const without initializer', () => {
      expect(() => parseFCS(tokenizeFCS('const x'))).toThrow();
    });
  });
});

// ============================================================================
// Buddy Script Parser Tests
// ============================================================================

describe('Buddy Script Parser', () => {
  let tokenizeBuddy: any;
  let parseBuddy: any;
  let BuddyTokenType: any;

  beforeAll(async () => {
    const lexerModule = await import('../../src/scripting/lexer');
    const parserModule = await import('../../src/scripting/parser');
    const typesModule = await import('../../src/scripting/types');

    tokenizeBuddy = lexerModule.tokenize;
    parseBuddy = parserModule.parse;
    BuddyTokenType = typesModule.TokenType;
  });

  describe('Buddy Script Lexer', () => {
    it('should tokenize basic tokens', () => {
      const tokens = tokenizeBuddy('let x = 42');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.LET)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.IDENTIFIER)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.ASSIGN)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.NUMBER)).toBe(true);
    });

    it('should tokenize strings', () => {
      const tokens = tokenizeBuddy('"hello world"');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.STRING && t.value === 'hello world')).toBe(true);
    });

    it('should tokenize booleans', () => {
      const tokens = tokenizeBuddy('true false');
      expect(tokens.filter((t: any) => t.type === BuddyTokenType.BOOLEAN).length).toBe(2);
    });

    it('should tokenize comparison operators', () => {
      const tokens = tokenizeBuddy('== != < > <= >=');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.EQUALS)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.NOT_EQUALS)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.LESS_THAN)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.GREATER_THAN)).toBe(true);
    });

    it('should tokenize logical operators', () => {
      const tokens = tokenizeBuddy('&& || !');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.AND)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.OR)).toBe(true);
      expect(tokens.some((t: any) => t.type === BuddyTokenType.NOT)).toBe(true);
    });

    it('should tokenize power operator', () => {
      const tokens = tokenizeBuddy('2 ** 3');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.POWER)).toBe(true);
    });

    it('should tokenize arrow', () => {
      const tokens = tokenizeBuddy('=>');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.ARROW)).toBe(true);
    });

    it('should tokenize question mark', () => {
      const tokens = tokenizeBuddy('?');
      expect(tokens.some((t: any) => t.type === BuddyTokenType.QUESTION)).toBe(true);
    });

    it('should skip single-line comments', () => {
      const tokens = tokenizeBuddy('x // comment\ny');
      expect(tokens.filter((t: any) => t.type === BuddyTokenType.IDENTIFIER).length).toBe(2);
    });

    it('should skip multi-line comments', () => {
      const tokens = tokenizeBuddy('x /* comment */ y');
      expect(tokens.filter((t: any) => t.type === BuddyTokenType.IDENTIFIER).length).toBe(2);
    });

    it('should handle escape sequences', () => {
      const tokens = tokenizeBuddy('"hello\\nworld"');
      const str = tokens.find((t: any) => t.type === BuddyTokenType.STRING);
      expect(str?.value).toBe('hello\nworld');
    });

    it('should handle scientific notation', () => {
      const tokens = tokenizeBuddy('1e10 2.5E-3');
      const numbers = tokens.filter((t: any) => t.type === BuddyTokenType.NUMBER);
      expect(numbers.length).toBe(2);
    });

    it('should throw on unterminated string', () => {
      expect(() => tokenizeBuddy('"unterminated')).toThrow();
    });

    it('should throw on unterminated multi-line comment', () => {
      expect(() => tokenizeBuddy('/* unclosed')).toThrow();
    });
  });

  describe('Buddy Script Parser - Expressions', () => {
    it('should parse literals', () => {
      const ast = parseBuddy(tokenizeBuddy('42'));
      expect(ast.body[0]).toMatchObject({
        type: 'ExpressionStatement',
      });
    });

    it('should parse binary expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('1 + 2 * 3'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('BinaryExpression');
    });

    it('should parse logical expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('a && b || c'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('LogicalExpression');
    });

    it('should parse unary expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('!x'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('UnaryExpression');
    });

    it('should parse call expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('foo(a, b)'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('CallExpression');
    });

    it('should parse member expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('obj.prop'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('MemberExpression');
      expect(stmt.expression.computed).toBe(false);
    });

    it('should parse computed member expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('arr[0]'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('MemberExpression');
      expect(stmt.expression.computed).toBe(true);
    });

    it('should parse array expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('[1, 2, 3]'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('ArrayExpression');
    });

    it('should parse object expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('{ a: 1, b: 2 }'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('ObjectExpression');
    });

    it('should parse conditional expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('x ? 1 : 2'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('ConditionalExpression');
    });

    it('should parse assignment expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('x = 5'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('AssignmentExpression');
    });

    it('should parse await expressions', () => {
      const ast = parseBuddy(tokenizeBuddy('await promise'));
      const stmt = ast.body[0] as any;
      expect(stmt.expression.type).toBe('AwaitExpression');
    });
  });

  describe('Buddy Script Parser - Statements', () => {
    it('should parse variable declarations', () => {
      const ast = parseBuddy(tokenizeBuddy('let x = 42'));
      expect(ast.body[0]).toMatchObject({
        type: 'VariableDeclaration',
        kind: 'let',
        name: 'x',
      });
    });

    it('should parse const declarations', () => {
      const ast = parseBuddy(tokenizeBuddy('const x = 42'));
      expect(ast.body[0]).toMatchObject({
        type: 'VariableDeclaration',
        kind: 'const',
      });
    });

    it('should parse function declarations', () => {
      const ast = parseBuddy(tokenizeBuddy('function add(a, b) { return a + b }'));
      expect(ast.body[0]).toMatchObject({
        type: 'FunctionDeclaration',
        name: 'add',
      });
    });

    it('should parse async function declarations', () => {
      const ast = parseBuddy(tokenizeBuddy('async function fetch() { }'));
      const fn = ast.body[0] as any;
      expect(fn.async).toBe(true);
    });

    it('should parse if statements', () => {
      const ast = parseBuddy(tokenizeBuddy('if (x > 0) { y = 1 }'));
      expect(ast.body[0]).toMatchObject({
        type: 'IfStatement',
      });
    });

    it('should parse if-else statements', () => {
      const ast = parseBuddy(tokenizeBuddy('if (x > 0) { y = 1 } else { y = 0 }'));
      const ifStmt = ast.body[0] as any;
      expect(ifStmt.alternate).not.toBeNull();
    });

    it('should parse else-if chains', () => {
      const ast = parseBuddy(tokenizeBuddy('if (x > 0) { } else if (x < 0) { } else { }'));
      const ifStmt = ast.body[0] as any;
      expect(ifStmt.alternate.type).toBe('IfStatement');
    });

    it('should parse while statements', () => {
      const ast = parseBuddy(tokenizeBuddy('while (x > 0) { x = x - 1 }'));
      expect(ast.body[0]).toMatchObject({
        type: 'WhileStatement',
      });
    });

    it('should parse for-in statements', () => {
      const ast = parseBuddy(tokenizeBuddy('for i in items { print(i) }'));
      expect(ast.body[0]).toMatchObject({
        type: 'ForInStatement',
        variable: 'i',
      });
    });

    it('should parse C-style for statements', () => {
      const ast = parseBuddy(tokenizeBuddy('for (let i = 0; i < 10; i = i + 1) { }'));
      expect(ast.body[0]).toMatchObject({
        type: 'ForStatement',
      });
    });

    it('should parse return statements', () => {
      const ast = parseBuddy(tokenizeBuddy('function test() { return 42 }'));
      const fn = ast.body[0] as any;
      expect(fn.body.body[0].type).toBe('ReturnStatement');
    });

    it('should parse break statements', () => {
      const ast = parseBuddy(tokenizeBuddy('while (true) { break }'));
      const whileStmt = ast.body[0] as any;
      expect(whileStmt.body.body[0].type).toBe('BreakStatement');
    });

    it('should parse continue statements', () => {
      const ast = parseBuddy(tokenizeBuddy('while (true) { continue }'));
      const whileStmt = ast.body[0] as any;
      expect(whileStmt.body.body[0].type).toBe('ContinueStatement');
    });

    it('should parse try-catch statements', () => {
      const ast = parseBuddy(tokenizeBuddy('try { foo() } catch (e) { }'));
      expect(ast.body[0]).toMatchObject({
        type: 'TryStatement',
      });
    });

    it('should parse throw statements', () => {
      const ast = parseBuddy(tokenizeBuddy('throw "error"'));
      expect(ast.body[0]).toMatchObject({
        type: 'ThrowStatement',
      });
    });

    it('should parse import statements', () => {
      const ast = parseBuddy(tokenizeBuddy('import fs'));
      expect(ast.body[0]).toMatchObject({
        type: 'ImportStatement',
        module: 'fs',
      });
    });
  });
});

// ============================================================================
// Test Output Parser Tests
// ============================================================================

describe('Test Output Parser', () => {
  let parseTestOutput: any;
  let isLikelyTestOutput: any;
  let createTestResultsData: any;

  beforeAll(async () => {
    const module = await import('../../src/utils/test-output-parser');
    parseTestOutput = module.parseTestOutput;
    isLikelyTestOutput = module.isLikelyTestOutput;
    createTestResultsData = module.createTestResultsData;
  });

  describe('Jest Output Parsing', () => {
    const jestPassingOutput = `
 PASS  src/utils/helper.test.ts
  Helper functions
    ✓ should format date correctly (5ms)
    ✓ should parse JSON safely (2ms)
    ○ skipped should handle edge cases

Test Suites: 1 passed, 1 total
Tests:       2 passed, 1 skipped, 3 total
Time:        1.5s
`;

    const jestFailingOutput = `
 FAIL  src/utils/helper.test.ts
  Helper functions
    ✓ should format date correctly (5ms)
    ✕ should parse JSON safely (10ms)

Test Suites: 1 failed, 1 total
Tests:       1 passed, 1 failed, 2 total
Time:        2.3s
`;

    it('should parse Jest passing output', () => {
      const result = parseTestOutput(jestPassingOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.framework).toBe('jest');
      expect(result.data?.summary.passed).toBe(2);
      expect(result.data?.summary.skipped).toBe(1);
    });

    it('should parse Jest failing output', () => {
      const result = parseTestOutput(jestFailingOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.summary.passed).toBe(1);
      expect(result.data?.summary.failed).toBe(1);
    });

    it('should extract individual test cases', () => {
      const result = parseTestOutput(jestPassingOutput);

      expect(result.data?.tests.length).toBeGreaterThan(0);
    });

    it('should extract test duration', () => {
      const result = parseTestOutput(jestPassingOutput);

      expect(result.data?.duration).toBeDefined();
      expect(result.data?.duration).toBeGreaterThan(0);
    });
  });

  describe('Vitest Output Parsing', () => {
    const vitestOutput = `
 ✓ src/utils/helper.test.ts (2)
   ✓ should work 5ms
   ✓ should also work 3ms

 Tests  2 passed
 Duration  0.5s
`;

    it('should parse Vitest output', () => {
      const result = parseTestOutput(vitestOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.framework).toBe('vitest');
      expect(result.data?.summary.passed).toBe(2);
    });
  });

  describe('Mocha Output Parsing', () => {
    const mochaOutput = `
  Helper functions
    ✓ should format date correctly (5ms)
    ✓ should parse JSON safely

  2 passing (100ms)
`;

    it('should parse Mocha output', () => {
      const result = parseTestOutput(mochaOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.framework).toBe('mocha');
      expect(result.data?.summary.passed).toBe(2);
    });

    it('should parse Mocha with failures', () => {
      const failingOutput = `
  2 passing (100ms)
  1 failing
`;
      const result = parseTestOutput(failingOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.summary.failed).toBe(1);
    });

    it('should parse Mocha with pending tests', () => {
      const pendingOutput = `
  2 passing (100ms)
  1 pending
`;
      const result = parseTestOutput(pendingOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.summary.skipped).toBe(1);
    });
  });

  describe('Pytest Output Parsing', () => {
    const pytestOutput = `
test_helper.py::test_format PASSED
test_helper.py::test_parse PASSED
test_helper.py::test_edge_cases SKIPPED

========================= 2 passed, 1 skipped in 0.5s =========================
`;

    it('should parse pytest output', () => {
      const result = parseTestOutput(pytestOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.framework).toBe('pytest');
      expect(result.data?.summary.passed).toBe(2);
      expect(result.data?.summary.skipped).toBe(1);
    });

    it('should extract test names with suite', () => {
      const result = parseTestOutput(pytestOutput);

      const test = result.data?.tests.find((t: any) => t.name === 'test_format');
      expect(test?.suite).toBe('test_helper.py');
    });

    it('should handle pytest failures', () => {
      const failingOutput = `
test_helper.py::test_format PASSED
test_helper.py::test_parse FAILED

========================= 1 passed, 1 failed in 0.3s =========================
`;
      const result = parseTestOutput(failingOutput);

      expect(result.data?.summary.failed).toBe(1);
    });
  });

  describe('Go Test Output Parsing', () => {
    const goTestOutput = `
--- PASS: TestFormat (0.01s)
--- PASS: TestParse (0.02s)
--- SKIP: TestEdgeCases (0.00s)
ok      mypackage       0.05s
`;

    it('should parse Go test output', () => {
      const result = parseTestOutput(goTestOutput);

      expect(result.isTestOutput).toBe(true);
      expect(result.data?.framework).toBe('go test');
      expect(result.data?.summary.passed).toBe(2);
      expect(result.data?.summary.skipped).toBe(1);
    });

    it('should extract test names', () => {
      const result = parseTestOutput(goTestOutput);

      const test = result.data?.tests.find((t: any) => t.name === 'TestFormat');
      expect(test).toBeDefined();
      expect(test?.status).toBe('passed');
    });

    it('should handle Go test failures', () => {
      const failingOutput = `
--- PASS: TestFormat (0.01s)
--- FAIL: TestParse (0.02s)
FAIL    mypackage       0.05s
`;
      const result = parseTestOutput(failingOutput);

      expect(result.data?.summary.failed).toBe(1);
    });
  });

  describe('isLikelyTestOutput', () => {
    it('should detect Jest-like output', () => {
      expect(isLikelyTestOutput('Tests: 5 passed')).toBe(true);
    });

    it('should detect Mocha-like output', () => {
      expect(isLikelyTestOutput('5 passing')).toBe(true);
    });

    it('should detect pytest-like output', () => {
      expect(isLikelyTestOutput('3 passed')).toBe(true);
    });

    it('should detect Go test output', () => {
      expect(isLikelyTestOutput('--- PASS: TestFoo')).toBe(true);
    });

    it('should detect test symbols', () => {
      expect(isLikelyTestOutput('✓ test passed')).toBe(true);
      expect(isLikelyTestOutput('✕ test failed')).toBe(true);
    });

    it('should return false for non-test output', () => {
      expect(isLikelyTestOutput('Hello World')).toBe(false);
      expect(isLikelyTestOutput('npm install complete')).toBe(false);
    });
  });

  describe('createTestResultsData', () => {
    it('should create valid test results data', () => {
      const data = createTestResultsData({
        passed: 5,
        failed: 2,
        skipped: 1,
      });

      expect(data.type).toBe('test-results');
      expect(data.summary.total).toBe(8);
      expect(data.summary.passed).toBe(5);
      expect(data.summary.failed).toBe(2);
      expect(data.summary.skipped).toBe(1);
    });

    it('should handle optional parameters', () => {
      const data = createTestResultsData({
        passed: 3,
        failed: 0,
      });

      expect(data.summary.skipped).toBe(0);
      expect(data.tests).toEqual([]);
    });

    it('should include test cases and metadata', () => {
      const data = createTestResultsData({
        passed: 1,
        failed: 0,
        tests: [{ name: 'test1', status: 'passed' }],
        framework: 'jest',
        duration: 1000,
      });

      expect(data.tests.length).toBe(1);
      expect(data.framework).toBe('jest');
      expect(data.duration).toBe(1000);
    });
  });

  describe('Non-test output handling', () => {
    it('should return isTestOutput false for random text', () => {
      const result = parseTestOutput('This is just some random text');

      expect(result.isTestOutput).toBe(false);
      expect(result.data).toBeUndefined();
    });

    it('should preserve raw output', () => {
      const output = 'Some random output';
      const result = parseTestOutput(output);

      expect(result.rawOutput).toBe(output);
    });
  });
});
