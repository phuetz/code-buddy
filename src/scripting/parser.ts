/**
 * Unified Script Parser
 *
 * Based on FCS parser (superset) with Buddy Script additions:
 * - AwaitExpression in unary parsing
 * - ForCStyle statement (C-style for loops)
 * - Export keyword
 * - Question token for ternary (instead of checking Colon value)
 * - Arrow functions / lambdas
 *
 * Extensions: .bs (primary), .fcs (backward-compatible alias)
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
  PipelineExpr,
  TernaryExpr,
  AwaitExpr,
  BlockStmt,
  ExpressionStmt,
  VarDeclaration,
  FunctionDeclaration,
  ClassDeclaration,
  IfStmt,
  WhileStmt,
  ForStmt,
  RepeatStmt,
  ForCStyleStmt,
  ReturnStmt,
  BreakStmt,
  ContinueStmt,
  TryStmt,
  ThrowStmt,
  ImportStmt,
  ExportStmt,
  TestDeclaration,
  AssertStmt,
  Parameter,
  CatchClause,
} from './types.js';
import { tokenize as lexerTokenize } from './lexer.js';
import { createLoopGuard, LoopTimeoutError } from '../utils/errors.js';

/** Maximum recursion depth for recursive descent parsing */
const MAX_RECURSION_DEPTH = 500;

export class FCSParser {
  private tokens: Token[];
  private current = 0;
  private recursionDepth = 0;

  constructor(tokens: Token[]) {
    // Filter out comments
    this.tokens = tokens.filter(t => t.type !== TokenType.Comment);
  }

  /**
   * Track recursion depth to prevent stack overflow on deeply nested input
   */
  private enterRecursion(context: string): void {
    this.recursionDepth++;
    if (this.recursionDepth > MAX_RECURSION_DEPTH) {
      throw new LoopTimeoutError(
        `Maximum recursion depth exceeded in ${context}. Input may be too deeply nested or malformed.`,
        MAX_RECURSION_DEPTH,
        context
      );
    }
  }

  private exitRecursion(): void {
    this.recursionDepth--;
  }

  parse(): Program {
    const statements: AstNode[] = [];
    const guard = createLoopGuard({
      maxIterations: 100000,
      context: 'program parsing',
    });

    while (!this.isAtEnd()) {
      guard();
      this.skipLayoutTokens();
      if (this.isAtEnd()) break;

      const stmt = this.parseDeclaration();
      if (stmt) {
        statements.push(stmt);
      }

      this.skipLayoutTokens();
    }

    return { type: 'Program', statements, body: statements };
  }

  // ============================================
  // Statement Parsing
  // ============================================

  private parseDeclaration(): AstNode | null {
    this.enterRecursion('parseDeclaration');
    try {
      // Check for decorators
      const decoratorGuard = createLoopGuard({
        maxIterations: 1000,
        context: 'decorator parsing',
      });
      while (this.match(TokenType.Decorator)) {
        decoratorGuard();
        // Decorators stored but not used yet
        void this.previous().value;
      }

      if (this.matchKeyword('def', 'func', 'function') || this.matchKeyword('async')) {
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

      if (this.matchKeyword('export')) {
        return this.parseExportStatement();
      }

      if (this.matchKeyword('test')) {
        return this.parseTestDeclaration();
      }

      return this.parseStatement();
    } catch (error) {
      // Re-throw recursion/loop errors without synchronizing
      if (error instanceof LoopTimeoutError) {
        throw error;
      }
      this.synchronize();
      return null;
    } finally {
      this.exitRecursion();
    }
  }

  private parseStatement(): AstNode {
    if (this.matchKeyword('if')) return this.parseIfStatement();
    if (this.matchKeyword('while')) return this.parseWhileStatement();
    if (this.matchKeyword('for')) return this.parseForStatement();
    if (this.matchKeyword('repeat')) return this.parseRepeatStatement();
    if (this.matchKeyword('return')) return this.parseReturnStatement();
    if (this.matchKeyword('break')) return this.parseBreakStatement();
    if (this.matchKeyword('continue')) return this.parseContinueStatement();
    if (this.matchKeyword('try')) return this.parseTryStatement();
    if (this.matchKeyword('throw')) return this.parseThrowStatement();
    if (this.matchKeyword('assert')) return this.parseAssertStatement();
    if (this.check(TokenType.LeftBrace) && this.isDictLiteralStart()) {
      return this.parseExpressionStatement();
    }

    if (this.match(TokenType.LeftBrace)) return this.parseBlockStatement();

    return this.parseExpressionStatement();
  }

  private parseFunctionDeclaration(): FunctionDeclaration {
    const isAsync = this.previous().value === 'async';
    if (isAsync) {
      this.consumeKeyword('def', 'func', 'function');
    }

    const name = this.consume(TokenType.Identifier, "Expected function name").value;

    this.consume(TokenType.LeftParen, "Expected '(' after function name");
    const parameters = this.parseParameters();
    this.consume(TokenType.RightParen, "Expected ')' after parameters");

    let returnType: string | undefined;
    let body: BlockStmt;
    if (this.match(TokenType.Colon)) {
      if (this.check(TokenType.Identifier)) {
        returnType = this.consume(TokenType.Identifier, "Expected return type").value;
        body = this.parseStatementBody("Expected function body after return type", false) as BlockStmt;
      } else {
        body = this.parseIndentedBlockAfterColon();
      }
    } else {
      body = this.parseStatementBody("Expected '{' or ':' before function body", false) as BlockStmt;
    }

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
    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'class body parsing',
    });
    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      guard();
      this.skipLayoutTokens();
      if (this.check(TokenType.RightBrace)) break;

      if (this.matchKeyword('def', 'func', 'function', 'async')) {
        members.push(this.parseFunctionDeclaration());
      } else if (this.matchKeyword('let', 'const', 'var')) {
        members.push(this.parseVarDeclaration());
      } else {
        // Skip unexpected tokens in class body to prevent infinite loop
        this.advance();
      }

      this.skipLayoutTokens();
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

    const thenBranch = this.parseStatementBody("Expected if body");

    let elseBranch: AstNode | null = null;
    if (this.matchKeyword('elif')) {
      elseBranch = this.parseIfStatement();
    } else if (this.matchKeyword('else')) {
      if (this.matchKeyword('if')) {
        elseBranch = this.parseIfStatement();
      } else {
        elseBranch = this.parseStatementBody("Expected else body");
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

    const body = this.parseStatementBody("Expected while body");

    return {
      type: 'While',
      condition,
      body,
    };
  }

  private parseForStatement(): ForStmt | ForCStyleStmt {
    // Check for C-style for loop: for (init; test; update) { }
    if (this.match(TokenType.LeftParen)) {
      return this.parseForCStyleStatement();
    }

    // For-in loop: for x in iterable { }
    const variable = this.consume(TokenType.Identifier, "Expected variable name").value;
    this.consumeKeyword('in');
    const iterable = this.parseExpression();

    const body = this.parseStatementBody("Expected for body");

    return {
      type: 'For',
      variable,
      iterable,
      body,
    };
  }

  private parseForCStyleStatement(): ForCStyleStmt {
    // Parse init
    let init: AstNode | null = null;
    if (!this.check(TokenType.Semicolon)) {
      if (this.matchKeyword('let', 'const', 'var')) {
        init = this.parseVarDeclaration();
      } else {
        init = this.parseExpression();
        this.consume(TokenType.Semicolon, "Expected ';' after for init");
      }
    } else {
      this.advance(); // skip ;
    }

    // If parseVarDeclaration already consumed the semicolon, skip
    // Parse test
    let test: AstNode | null = null;
    if (!this.check(TokenType.Semicolon)) {
      test = this.parseExpression();
    }
    this.consume(TokenType.Semicolon, "Expected ';' after for condition");

    // Parse update
    let update: AstNode | null = null;
    if (!this.check(TokenType.RightParen)) {
      update = this.parseExpression();
    }
    this.consume(TokenType.RightParen, "Expected ')' after for clauses");

    // Parse body
    const body = this.parseStatementBody("Expected for body");

    return {
      type: 'ForCStyle',
      init,
      test,
      update,
      body,
    };
  }

  private parseRepeatStatement(): RepeatStmt {
    const count = this.parseExpression();
    const body = this.parseStatementBody("Expected repeat body");

    return {
      type: 'Repeat',
      count,
      body,
    };
  }

  private parseBlockStatement(): BlockStmt {
    const statements: AstNode[] = [];
    const guard = createLoopGuard({
      maxIterations: 100000,
      context: 'block statement parsing',
    });

    while (!this.check(TokenType.RightBrace) && !this.isAtEnd()) {
      guard();
      this.skipLayoutTokens();
      if (this.check(TokenType.RightBrace)) break;

      const stmt = this.parseDeclaration();
      if (stmt) {
        statements.push(stmt);
      }

      this.skipLayoutTokens();
    }

    this.consume(TokenType.RightBrace, "Expected '}' after block");

    return { type: 'Block', statements };
  }

  private parseStatementBody(message: string, allowSingleStatement = true): AstNode {
    if (this.match(TokenType.LeftBrace)) {
      return this.parseBlockStatement();
    }

    if (this.match(TokenType.Colon)) {
      return this.parseIndentedBlockAfterColon();
    }

    if (allowSingleStatement) {
      return this.parseStatement();
    }

    throw new Error(`${message} at line ${this.peek().line}`);
  }

  private parseIndentedBlockAfterColon(): BlockStmt {
    this.skipNewlinesOnly();
    const hasIndent = this.match(TokenType.Indent);
    this.skipNewlinesOnly();

    if (!hasIndent && this.check(TokenType.Dedent)) {
      throw new Error(`Expected indented block at line ${this.peek().line}`);
    }

    const statements: AstNode[] = [];
    const guard = createLoopGuard({
      maxIterations: 100000,
      context: 'indented block parsing',
    });

    while (!this.check(TokenType.Dedent) && !this.isAtEnd()) {
      guard();
      this.skipNewlinesOnly();
      if (this.check(TokenType.Dedent) || this.isAtEnd()) break;

      const stmt = this.parseDeclaration();
      if (stmt) {
        statements.push(stmt);
      }

      this.skipNewlinesOnly();
    }

    if (this.check(TokenType.Dedent)) {
      this.advance();
    }

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
    const catchGuard = createLoopGuard({
      maxIterations: 1000,
      context: 'catch clause parsing',
    });
    while (this.matchKeyword('catch')) {
      catchGuard();
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

  private parseExportStatement(): ExportStmt {
    // export let/const/function/class
    const declaration = this.parseDeclaration();
    if (!declaration) {
      throw new Error("Expected declaration after 'export'");
    }
    return {
      type: 'Export',
      declaration,
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

    const body = this.parseStatementBody("Expected '{' or ':' before test body", false) as BlockStmt;

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

  parseExpression(): AstNode {
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

    // Use dedicated Question token
    if (this.match(TokenType.Question)) {
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

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'pipeline expression parsing',
    });
    while (this.match(TokenType.Pipeline)) {
      guard();
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

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'logical OR expression parsing',
    });
    while (this.match(TokenType.Or)) {
      guard();
      const operator = this.previous().type;
      const right = this.parseLogicalAnd();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseLogicalAnd(): AstNode {
    let expr = this.parseEquality();

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'logical AND expression parsing',
    });
    while (this.match(TokenType.And)) {
      guard();
      const operator = this.previous().type;
      const right = this.parseEquality();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseEquality(): AstNode {
    let expr = this.parseComparison();

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'equality expression parsing',
    });
    while (this.match(TokenType.Equal, TokenType.NotEqual)) {
      guard();
      const operator = this.previous().type;
      const right = this.parseComparison();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseComparison(): AstNode {
    let expr = this.parseAddition();

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'comparison expression parsing',
    });
    while (this.match(TokenType.Less, TokenType.Greater, TokenType.LessEqual, TokenType.GreaterEqual)) {
      guard();
      const operator = this.previous().type;
      const right = this.parseAddition();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseAddition(): AstNode {
    let expr = this.parseMultiplication();

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'addition expression parsing',
    });
    while (this.match(TokenType.Plus, TokenType.Minus)) {
      guard();
      const operator = this.previous().type;
      const right = this.parseMultiplication();
      expr = { type: 'Binary', left: expr, operator, right } as BinaryExpr;
    }

    return expr;
  }

  private parseMultiplication(): AstNode {
    let expr = this.parsePower();

    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'multiplication expression parsing',
    });
    while (this.match(TokenType.Multiply, TokenType.Divide, TokenType.Modulo)) {
      guard();
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

    // Await expression (from Buddy Script)
    if (this.matchKeyword('await')) {
      const argument = this.parseUnary();
      return { type: 'Await', argument } as AwaitExpr;
    }

    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    let expr = this.parsePrimary();

    // Guard against infinite loops in postfix parsing
    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'postfix expression parsing',
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
      // Check for lambda / arrow function
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
    const guard = createLoopGuard({
      maxIterations: 10000,
      context: 'string interpolation parsing',
    });

    while (current < value.length) {
      guard();
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
    const token = this.tokens[Math.min(this.current, this.tokens.length - 1)];
    if (token === undefined) {
      throw new Error("Unexpected end of token stream");
    }
    return token;
  }

  private previous(): Token {
    const token = this.tokens[this.current - 1];
    if (token === undefined) {
      throw new Error("No previous token available");
    }
    return token;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkNext(type: TokenType): boolean {
    const next = this.tokens[this.current + 1];
    if (next === undefined) return false;
    return next.type === type;
  }

  private isDictLiteralStart(): boolean {
    const key = this.tokens[this.current + 1];
    const separator = this.tokens[this.current + 2];
    if (!key || !separator) return false;

    return (
      (key.type === TokenType.Identifier || key.type === TokenType.String) &&
      separator.type === TokenType.Colon
    );
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
    if (this.check(TokenType.RightBrace) || this.check(TokenType.Dedent) || this.checkKeyword('else', 'elif')) {
      return;
    }
  }

  private skipNewlines(): void {
    const guard = createLoopGuard({
      maxIterations: 100000,
      context: 'newline skipping',
    });
    while (this.match(TokenType.Newline)) {
      guard();
      // Skip
    }
  }

  private skipNewlinesOnly(): void {
    this.skipNewlines();
  }

  private skipLayoutTokens(): void {
    const guard = createLoopGuard({
      maxIterations: 100000,
      context: 'layout token skipping',
    });
    while (this.match(TokenType.Newline, TokenType.Indent, TokenType.Dedent)) {
      guard();
      // Skip formatting-only layout tokens outside indentation-sensitive blocks.
    }
  }

  private synchronize(): void {
    this.advance();

    const guard = createLoopGuard({
      maxIterations: 100000,
      context: 'error synchronization',
    });
    while (!this.isAtEnd()) {
      guard();
      if (this.previous().type === TokenType.Semicolon) return;
      if (this.previous().type === TokenType.Newline) return;

      if (this.checkKeyword('if', 'for', 'repeat', 'while', 'let', 'const', 'def', 'func', 'function', 'class', 'test', 'return')) {
        return;
      }

      this.advance();
    }
  }
}

/** @deprecated Use FCSParser instead */
export const Parser = FCSParser;

export function parse(tokens: Token[]): Program {
  return new FCSParser(tokens).parse();
}
