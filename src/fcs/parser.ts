/**
 * FileCommander Script (FCS) Parser
 *
 * 100% compatible AST parser for FCS files
 */

import {
  Token,
  TokenType,
  AstNode,
  Program,
  LiteralExpr,
  IdentifierExpr,
  BinaryExpr,
  UnaryExpr,
  AssignmentExpr,
  CallExpr,
  MemberExpr,
  IndexExpr,
  ArrayExpr,
  DictExpr,
  LambdaExpr,
  InterpolationExpr,
  TernaryExpr,
  BlockStmt,
  ExpressionStmt,
  VarDeclaration,
  FunctionDeclaration,
  ClassDeclaration,
  IfStmt,
  WhileStmt,
  ForStmt,
  ReturnStmt,
  BreakStmt,
  ContinueStmt,
  TryStmt,
  ThrowStmt,
  ImportStmt,
  TestDeclaration,
  AssertStmt,
  Parameter,
  CatchClause,
} from './types.js';
import { tokenize as lexerTokenize } from './lexer.js';
import { createLoopGuard } from '../utils/errors.js';

export class FCSParser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    // Filter out comments
    this.tokens = tokens.filter(t => t.type !== TokenType.Comment);
  }

  parse(): Program {
    const statements: AstNode[] = [];

    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const stmt = this.parseDeclaration();
      if (stmt) {
        statements.push(stmt);
      }

      this.skipNewlines();
    }

    return { type: 'Program', statements };
  }

  // ============================================
  // Statement Parsing
  // ============================================

  private parseDeclaration(): AstNode | null {
    try {
      // Check for decorators
      const decorators: string[] = [];
      while (this.match(TokenType.Decorator)) {
        decorators.push(this.previous().value);
      }

      if (this.matchKeyword('func', 'function') || this.matchKeyword('async')) {
        return this.parseFunctionDeclaration();
      }

      if (this.matchKeyword('class')) {
        return this.parseClassDeclaration();
      }

      if (this.matchKeyword('let', 'const', 'var')) {
        return this.parseVarDeclaration();
      }

      if (this.matchKeyword('import')) {
        return this.parseImportStatement();
      }

      if (this.matchKeyword('test')) {
        return this.parseTestDeclaration();
      }

      return this.parseStatement();
    } catch (_error) {
      this.synchronize();
      return null;
    }
  }

  private parseStatement(): AstNode {
    if (this.matchKeyword('if')) return this.parseIfStatement();
    if (this.matchKeyword('while')) return this.parseWhileStatement();
    if (this.matchKeyword('for')) return this.parseForStatement();
    if (this.matchKeyword('return')) return this.parseReturnStatement();
    if (this.matchKeyword('break')) return this.parseBreakStatement();
    if (this.matchKeyword('continue')) return this.parseContinueStatement();
    if (this.matchKeyword('try')) return this.parseTryStatement();
    if (this.matchKeyword('throw')) return this.parseThrowStatement();
    if (this.matchKeyword('assert')) return this.parseAssertStatement();
    if (this.match(TokenType.LeftBrace)) return this.parseBlockStatement();

    return this.parseExpressionStatement();
  }

  private parseFunctionDeclaration(): FunctionDeclaration {
    const isAsync = this.previous().value === 'async';
    if (isAsync) {
      this.consumeKeyword('func', 'function');
    }

    const name = this.consume(TokenType.Identifier, "Expected function name").value;

    this.consume(TokenType.LeftParen, "Expected '(' after function name");
    const parameters = this.parseParameters();
    this.consume(TokenType.RightParen, "Expected ')' after parameters");

    let returnType: string | undefined;
    if (this.match(TokenType.Colon)) {
      returnType = this.consume(TokenType.Identifier, "Expected return type").value;
    }

    this.consume(TokenType.LeftBrace, "Expected '{' before function body");
    const body = this.parseBlockStatement();

    return {
      type: 'FunctionDeclaration',
      name,
      parameters,
      body,
      isAsync,
      returnType,
    };
  }

  private parseParameters(): Parameter[] {
    const parameters: Parameter[] = [];

    if (!this.check(TokenType.RightParen)) {
      do {
        const name = this.consume(TokenType.Identifier, "Expected parameter name").value;
        let type: string | undefined;
        let defaultValue: AstNode | undefined;

        if (this.match(TokenType.Colon)) {
          type = this.consume(TokenType.Identifier, "Expected parameter type").value;
        }

        if (this.match(TokenType.Assign)) {
          defaultValue = this.parseExpression();
        }

        parameters.push({ name, type, defaultValue });
      } while (this.match(TokenType.Comma));
    }

    return parameters;
  }

  private parseVarDeclaration(): VarDeclaration {
    const keyword = this.previous().value;
    const isConst = keyword === 'const';

    const name = this.consume(TokenType.Identifier, "Expected variable name").value;

    let varType: string | undefined;
    if (this.match(TokenType.Colon)) {
      varType = this.consume(TokenType.Identifier, "Expected type").value;
    }

    let initializer: AstNode | null = null;
    if (this.match(TokenType.Assign)) {
      initializer = this.parseExpression();
    } else if (isConst) {
      throw new Error("Const variable must be initialized");
    }

    this.consumeStatementEnd();

    return {
      type: 'VarDeclaration',
      name,
      initializer,
      isConst,
      varType,
    };
  }

  private parseClassDeclaration(): ClassDeclaration {
    const name = this.consume(TokenType.Identifier, "Expected class name").value;

    let baseClass: string | undefined;
    if (this.match(TokenType.Colon)) {
      baseClass = this.consume(TokenType.Identifier, "Expected base class name").value;
    }

    this.consume(TokenType.LeftBrace, "Expected '{' before class body");

    const members: AstNode[] = [];
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check(TokenType.RightBrace)) break;

      if (this.matchKeyword('func', 'function', 'async')) {
        members.push(this.parseFunctionDeclaration());
      } else if (this.matchKeyword('let', 'const', 'var')) {
        members.push(this.parseVarDeclaration());
      }

      this.skipNewlines();
    }

    this.consume(TokenType.RightBrace, "Expected '}' after class body");

    return {
      type: 'ClassDeclaration',
      name,
      baseClass,
      members,
    };
  }

  private parseIfStatement(): IfStmt {
    // Optional parentheses
    const hasParen = this.match(TokenType.LeftParen);
    const condition = this.parseExpression();
    if (hasParen) {
      this.consume(TokenType.RightParen, "Expected ')' after condition");
    }

    const thenBranch = this.match(TokenType.LeftBrace)
      ? this.parseBlockStatement()
      : this.parseStatement();

    let elseBranch: AstNode | null = null;
    if (this.matchKeyword('else')) {
      if (this.matchKeyword('if')) {
        elseBranch = this.parseIfStatement();
      } else {
        elseBranch = this.match(TokenType.LeftBrace)
          ? this.parseBlockStatement()
          : this.parseStatement();
      }
    }

    return {
      type: 'If',
      condition,
      thenBranch,
      elseBranch,
    };
  }

  private parseWhileStatement(): WhileStmt {
    const hasParen = this.match(TokenType.LeftParen);
    const condition = this.parseExpression();
    if (hasParen) {
      this.consume(TokenType.RightParen, "Expected ')' after condition");
    }

    const body = this.match(TokenType.LeftBrace)
      ? this.parseBlockStatement()
      : this.parseStatement();

    return {
      type: 'While',
      condition,
      body,
    };
  }

  private parseForStatement(): ForStmt {
    const variable = this.consume(TokenType.Identifier, "Expected variable name").value;
    this.consumeKeyword('in');
    const iterable = this.parseExpression();

    const body = this.match(TokenType.LeftBrace)
      ? this.parseBlockStatement()
      : this.parseStatement();

    return {
      type: 'For',
      variable,
      iterable,
      body,
    };
  }

  private parseBlockStatement(): BlockStmt {
    const statements: AstNode[] = [];

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      this.skipNewlines();
      if (this.check(TokenType.RightBrace)) break;

      const stmt = this.parseDeclaration();
      if (stmt) {
        statements.push(stmt);
      }

      this.skipNewlines();
    }

    this.consume(TokenType.RightBrace, "Expected '}' after block");

    return { type: 'Block', statements };
  }

  private parseExpressionStatement(): ExpressionStmt {
    const expression = this.parseExpression();
    this.consumeStatementEnd();
    return { type: 'ExpressionStmt', expression };
  }

  private parseReturnStatement(): ReturnStmt {
    let value: AstNode | null = null;
    if (!this.check(TokenType.Newline) && !this.check(TokenType.Semicolon) && !this.check(TokenType.RightBrace)) {
      value = this.parseExpression();
    }
    this.consumeStatementEnd();
    return { type: 'Return', value };
  }

  private parseBreakStatement(): BreakStmt {
    this.consumeStatementEnd();
    return { type: 'Break' };
  }

  private parseContinueStatement(): ContinueStmt {
    this.consumeStatementEnd();
    return { type: 'Continue' };
  }

  private parseTryStatement(): TryStmt {
    this.consume(TokenType.LeftBrace, "Expected '{' after 'try'");
    const tryBlock = this.parseBlockStatement();

    const catchClauses: CatchClause[] = [];
    while (this.matchKeyword('catch')) {
      let variable: string | undefined;
      let type: string | undefined;

      if (this.match(TokenType.LeftParen)) {
        if (this.match(TokenType.Identifier)) {
          variable = this.previous().value;

          if (this.match(TokenType.Colon)) {
            type = this.consume(TokenType.Identifier, "Expected exception type").value;
          }
        }

        this.consume(TokenType.RightParen, "Expected ')' after catch parameters");
      }

      this.consume(TokenType.LeftBrace, "Expected '{' after catch");
      const body = this.parseBlockStatement();
      catchClauses.push({ variable, type, body });
    }

    let finallyBlock: BlockStmt | null = null;
    if (this.matchKeyword('finally')) {
      this.consume(TokenType.LeftBrace, "Expected '{' after 'finally'");
      finallyBlock = this.parseBlockStatement();
    }

    return {
      type: 'Try',
      tryBlock,
      catchClauses,
      finallyBlock,
    };
  }

  private parseThrowStatement(): ThrowStmt {
    const expression = this.parseExpression();
    this.consumeStatementEnd();
    return { type: 'Throw', expression };
  }

  private parseImportStatement(): ImportStmt {
    const names: string[] = [];
    let module = '';
    let alias: string | undefined;

    if (this.match(TokenType.LeftBrace)) {
      // import { name1, name2 } from "module"
      do {
        names.push(this.consume(TokenType.Identifier, "Expected import name").value);
      } while (this.match(TokenType.Comma));

      this.consume(TokenType.RightBrace, "Expected '}' after import names");
      this.consumeKeyword('from');
      module = this.consume(TokenType.String, "Expected module name").value;
    } else if (this.match(TokenType.Multiply)) {
      // import * as alias from "module"
      this.consumeKeyword('as');
      alias = this.consume(TokenType.Identifier, "Expected alias name").value;
      this.consumeKeyword('from');
      module = this.consume(TokenType.String, "Expected module name").value;
    } else if (this.check(TokenType.String)) {
      // import "module"
      module = this.consume(TokenType.String, "Expected module name").value;
    } else if (this.check(TokenType.Identifier)) {
      // import name OR import name from "module"
      const firstIdent = this.consume(TokenType.Identifier, "Expected import name").value;
      if (this.checkKeyword('from')) {
        names.push(firstIdent);
        this.consumeKeyword('from');
        module = this.consume(TokenType.String, "Expected module name").value;
      } else {
        // Simple import like: import fc
        module = firstIdent;
      }
    }

    this.consumeStatementEnd();

    return {
      type: 'Import',
      module,
      names,
      alias,
    };
  }

  private parseTestDeclaration(): TestDeclaration {
    const name = this.consume(TokenType.String, "Expected test name as string").value;

    const tags: string[] = [];
    if (this.match(TokenType.LeftBracket)) {
      do {
        if (this.match(TokenType.String)) {
          tags.push(this.previous().value);
        }
      } while (this.match(TokenType.Comma));

      this.consume(TokenType.RightBracket, "Expected ']' after tags");
    }

    this.consume(TokenType.LeftBrace, "Expected '{' before test body");
    const body = this.parseBlockStatement();

    return {
      type: 'TestDeclaration',
      name,
      body,
      tags,
    };
  }

  private parseAssertStatement(): AssertStmt {
    const condition = this.parseExpression();

    let message: string | undefined;
    if (this.match(TokenType.Comma)) {
      if (this.match(TokenType.String)) {
        message = this.previous().value;
      }
    }

    this.consumeStatementEnd();

    return {
      type: 'Assert',
      condition,
      message,
    };
  }

  // ============================================
  // Expression Parsing
  // ============================================

  private parseExpression(): AstNode {
    return this.parseAssignment();
  }

  private parseAssignment(): AstNode {
    const expr = this.parseTernary();

    if (this.match(TokenType.Assign, TokenType.PlusAssign, TokenType.MinusAssign, TokenType.MultiplyAssign, TokenType.DivideAssign)) {
      const operator = this.previous().type;
      const value = this.parseAssignment();

      return {
        type: 'Assignment',
        target: expr,
        operator,
        value,
      } as AssignmentExpr;
    }

    return expr;
  }

  private parseTernary(): AstNode {
    let expr = this.parsePipeline();

    // Check for ? token (stored as Colon with value '?')
    if (this.peek().value === '?') {
      this.advance();
      const consequent = this.parseExpression();
      this.consume(TokenType.Colon, "Expected ':' in ternary expression");
      const alternate = this.parseTernary();

      return {
        type: 'Ternary',
        condition: expr,
        consequent,
        alternate,
      } as TernaryExpr;
    }

    return expr;
  }

  private parsePipeline(): AstNode {
    let expr = this.parseLogicalOr();

    while (this.match(TokenType.Pipeline)) {
      const right = this.parseLogicalOr();

      // Transform pipeline: expr |> func => func(expr)
      if (right.type === 'Call') {
        const call = right as CallExpr;
        call.arguments.unshift(expr);
        expr = call;
      } else if (right.type === 'Identifier') {
        expr = {
          type: 'Call',
          callee: right,
          arguments: [expr],
        } as CallExpr;
      } else {
        throw new Error("Invalid pipeline target");
      }
    }

    return expr;
  }

  private parseLogicalOr(): AstNode {
    let expr = this.parseLogicalAnd();

    while (this.match(TokenType.Or)) {
      const operator = this.previous().type;
      const right = this.parseLogicalAnd();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseLogicalAnd(): AstNode {
    let expr = this.parseEquality();

    while (this.match(TokenType.And)) {
      const operator = this.previous().type;
      const right = this.parseEquality();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseEquality(): AstNode {
    let expr = this.parseComparison();

    while (this.match(TokenType.Equal, TokenType.NotEqual)) {
      const operator = this.previous().type;
      const right = this.parseComparison();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseComparison(): AstNode {
    let expr = this.parseAddition();

    while (this.match(TokenType.Less, TokenType.Greater, TokenType.LessEqual, TokenType.GreaterEqual)) {
      const operator = this.previous().type;
      const right = this.parseAddition();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseAddition(): AstNode {
    let expr = this.parseMultiplication();

    while (this.match(TokenType.Plus, TokenType.Minus)) {
      const operator = this.previous().type;
      const right = this.parseMultiplication();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseMultiplication(): AstNode {
    let expr = this.parsePower();

    while (this.match(TokenType.Multiply, TokenType.Divide, TokenType.Modulo)) {
      const operator = this.previous().type;
      const right = this.parsePower();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parsePower(): AstNode {
    let expr = this.parseUnary();

    if (this.match(TokenType.Power)) {
      const right = this.parsePower(); // Right associative
      expr = { type: 'Binary', left: expr, operator: TokenType.Power, right } as BinaryExpr;
    }

    return expr;
  }

  private parseUnary(): AstNode {
    if (this.match(TokenType.Not, TokenType.Minus)) {
      const operator = this.previous().type;
      const operand = this.parseUnary();
      return { type: 'Unary', operator, operand } as UnaryExpr;
    }

    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    let expr = this.parsePrimary();

    // Guard against infinite loops in postfix parsing (deeply nested calls/members)
    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'FCS postfix expression parsing',
    });

    while (true) {
      guard();
      if (this.match(TokenType.LeftParen)) {
        expr = this.parseCall(expr);
      } else if (this.match(TokenType.LeftBracket)) {
        const index = this.parseExpression();
        this.consume(TokenType.RightBracket, "Expected ']' after index");
        expr = { type: 'Index', object: expr, index } as IndexExpr;
      } else if (this.match(TokenType.Dot)) {
        const member = this.consume(TokenType.Identifier, "Expected member name").value;
        expr = { type: 'Member', object: expr, member, computed: false } as MemberExpr;
      } else {
        break;
      }
    }

    return expr;
  }

  private parseCall(callee: AstNode): CallExpr {
    const args: AstNode[] = [];
    const namedArgs: Record<string, AstNode> = {};

    if (!this.check(TokenType.RightParen)) {
      do {
        // Check for named argument: name: value
        if (this.check(TokenType.Identifier) && this.checkNext(TokenType.Colon)) {
          const name = this.advance().value;
          this.advance(); // :
          namedArgs[name] = this.parseExpression();
        } else {
          args.push(this.parseExpression());
        }
      } while (this.match(TokenType.Comma));
    }

    this.consume(TokenType.RightParen, "Expected ')' after arguments");

    const result: CallExpr = {
      type: 'Call',
      callee,
      arguments: args,
    };

    if (Object.keys(namedArgs).length > 0) {
      result.namedArgs = namedArgs;
    }

    return result;
  }

  private parsePrimary(): AstNode {
    if (this.match(TokenType.Boolean)) {
      return {
        type: 'Literal',
        value: this.previous().value === 'true',
        tokenType: TokenType.Boolean,
      } as LiteralExpr;
    }

    if (this.match(TokenType.Null)) {
      return { type: 'Literal', value: null, tokenType: TokenType.Null } as LiteralExpr;
    }

    if (this.match(TokenType.Number)) {
      const value = this.previous().value;
      const num = value.includes('.') ? parseFloat(value) : parseInt(value, 10);
      return { type: 'Literal', value: num, tokenType: TokenType.Number } as LiteralExpr;
    }

    if (this.match(TokenType.String)) {
      const value = this.previous().value;
      // Check for interpolation
      if (value.includes('${')) {
        return this.parseStringInterpolation(value);
      }
      return { type: 'Literal', value, tokenType: TokenType.String } as LiteralExpr;
    }

    if (this.match(TokenType.Identifier)) {
      return { type: 'Identifier', name: this.previous().value } as IdentifierExpr;
    }

    if (this.match(TokenType.LeftParen)) {
      // Check for lambda
      if (this.check(TokenType.Identifier) || this.check(TokenType.RightParen)) {
        const checkpoint = this.current;
        const parameters: string[] = [];

        if (!this.check(TokenType.RightParen)) {
          do {
            if (this.match(TokenType.Identifier)) {
              parameters.push(this.previous().value);
            } else {
              this.current = checkpoint;
              break;
            }
          } while (this.match(TokenType.Comma));
        }

        if (this.current !== checkpoint && this.match(TokenType.RightParen) && this.match(TokenType.Arrow)) {
          const body = this.match(TokenType.LeftBrace)
            ? this.parseBlockStatement()
            : this.parseExpression();
          return { type: 'Lambda', parameters, body } as LambdaExpr;
        }

        this.current = checkpoint;
      }

      const expr = this.parseExpression();
      this.consume(TokenType.RightParen, "Expected ')' after expression");
      return expr;
    }

    if (this.match(TokenType.LeftBracket)) {
      return this.parseArrayLiteral();
    }

    if (this.match(TokenType.LeftBrace)) {
      return this.parseDictLiteral();
    }

    throw new Error(`Unexpected token: ${this.peek().type} (${this.peek().value}) at line ${this.peek().line}`);
  }

  private parseStringInterpolation(value: string): InterpolationExpr {
    const parts: AstNode[] = [];
    let current = 0;

    while (current < value.length) {
      const start = value.indexOf('${', current);
      if (start === -1) {
        if (current < value.length) {
          parts.push({
            type: 'Literal',
            value: value.substring(current),
            tokenType: TokenType.String,
          } as LiteralExpr);
        }
        break;
      }

      if (start > current) {
        parts.push({
          type: 'Literal',
          value: value.substring(current, start),
          tokenType: TokenType.String,
        } as LiteralExpr);
      }

      const end = value.indexOf('}', start + 2);
      if (end === -1) {
        throw new Error("Unterminated string interpolation");
      }

      const exprCode = value.substring(start + 2, end);
      const tokens = lexerTokenize(exprCode);
      const parser = new FCSParser(tokens);
      parts.push(parser.parseExpression());

      current = end + 1;
    }

    return { type: 'Interpolation', parts };
  }

  private parseArrayLiteral(): ArrayExpr {
    const elements: AstNode[] = [];

    if (!this.check(TokenType.RightBracket)) {
      do {
        elements.push(this.parseExpression());
      } while (this.match(TokenType.Comma));
    }

    this.consume(TokenType.RightBracket, "Expected ']' after array elements");

    return { type: 'Array', elements };
  }

  private parseDictLiteral(): DictExpr {
    const elements = new Map<string, AstNode>();

    if (!this.check(TokenType.RightBrace)) {
      do {
        let key: string;
        if (this.match(TokenType.String)) {
          key = this.previous().value;
        } else if (this.match(TokenType.Identifier)) {
          key = this.previous().value;
        } else {
          throw new Error("Expected string or identifier for dict key");
        }

        this.consume(TokenType.Colon, "Expected ':' after dict key");
        const value = this.parseExpression();
        elements.set(key, value);
      } while (this.match(TokenType.Comma));
    }

    this.consume(TokenType.RightBrace, "Expected '}' after dict elements");

    return { type: 'Dict', elements };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[Math.min(this.current, this.tokens.length - 1)];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkNext(type: TokenType): boolean {
    if (this.current + 1 >= this.tokens.length) return false;
    return this.tokens[this.current + 1].type === type;
  }

  private checkKeyword(...keywords: string[]): boolean {
    if (this.peek().type !== TokenType.Keyword) return false;
    return keywords.includes(this.peek().value);
  }

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchKeyword(...keywords: string[]): boolean {
    if (this.checkKeyword(...keywords)) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${message} at line ${this.peek().line}, got ${this.peek().type}`);
  }

  private consumeKeyword(...keywords: string[]): void {
    if (this.checkKeyword(...keywords)) {
      this.advance();
    } else {
      throw new Error(`Expected one of [${keywords.join(', ')}] at line ${this.peek().line}`);
    }
  }

  private consumeStatementEnd(): void {
    if (this.match(TokenType.Semicolon) || this.match(TokenType.Newline)) {
      return;
    }

    if (this.isAtEnd()) return;

    // Allow implicit semicolon before certain tokens
    if (this.check(TokenType.RightBrace) || this.checkKeyword('else')) {
      return;
    }
  }

  private skipNewlines(): void {
    while (this.match(TokenType.Newline)) {
      // Skip
    }
  }

  private synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().type === TokenType.Semicolon) return;
      if (this.previous().type === TokenType.Newline) return;

      if (this.checkKeyword('if', 'for', 'while', 'let', 'const', 'func', 'function', 'class', 'return')) {
        return;
      }

      this.advance();
    }
  }
}

export function parse(tokens: Token[]): Program {
  return new FCSParser(tokens).parse();
}
