/**
 * Buddy Script Parser
 *
 * Parses tokens into an Abstract Syntax Tree (AST)
 */

import type {
  Token,
  ProgramNode,
  StatementNode,
  ExpressionNode,
  VariableDeclaration,
  FunctionDeclaration,
  BlockStatement,
  IfStatement,
  WhileStatement,
  ForStatement,
  ForInStatement,
  ReturnStatement,
  TryStatement,
  ThrowStatement,
  ImportStatement,
  ExpressionStatement,
  ParameterNode,
  Literal,
  Identifier,
  CallExpression,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  ArrowFunction,
} from './types.js';
import { TokenType } from './types.js';
import { createLoopGuard } from '../utils/errors.js';

export class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ProgramNode {
    const body: StatementNode[] = [];

    while (!this.isAtEnd()) {
      const stmt = this.declaration();
      if (stmt) {
        body.push(stmt);
      }
    }

    return { type: 'Program', body };
  }

  private declaration(): StatementNode | null {
    try {
      if (this.match(TokenType.LET, TokenType.CONST)) {
        return this.variableDeclaration();
      }
      if (this.check(TokenType.ASYNC) && this.checkNext(TokenType.FUNCTION)) {
        this.advance(); // async
        return this.functionDeclaration(true);
      }
      if (this.match(TokenType.FUNCTION)) {
        return this.functionDeclaration(false);
      }
      if (this.match(TokenType.IMPORT)) {
        return this.importStatement();
      }
      return this.statement();
    } catch (_error) {
      this.synchronize();
      return null;
    }
  }

  private variableDeclaration(): VariableDeclaration {
    const kind = this.previous().value === 'const' ? 'const' : 'let';
    const name = this.consume(TokenType.IDENTIFIER, 'Expected variable name').value as string;

    let init: ExpressionNode | null = null;
    if (this.match(TokenType.ASSIGN)) {
      init = this.expression();
    }

    this.consumeOptional(TokenType.SEMICOLON);

    return {
      type: 'VariableDeclaration',
      kind,
      name,
      init,
    };
  }

  private functionDeclaration(isAsync: boolean): FunctionDeclaration {
    const name = this.consume(TokenType.IDENTIFIER, 'Expected function name').value as string;
    this.consume(TokenType.LPAREN, "Expected '(' after function name");

    const params: ParameterNode[] = [];
    if (!this.check(TokenType.RPAREN)) {
      do {
        const paramName = this.consume(TokenType.IDENTIFIER, 'Expected parameter name').value as string;
        let defaultValue: ExpressionNode | undefined;

        if (this.match(TokenType.ASSIGN)) {
          defaultValue = this.expression();
        }

        params.push({ name: paramName, defaultValue });
      } while (this.match(TokenType.COMMA));
    }

    this.consume(TokenType.RPAREN, "Expected ')' after parameters");
    this.consume(TokenType.LBRACE, "Expected '{' before function body");

    const body = this.block();

    return {
      type: 'FunctionDeclaration',
      name,
      params,
      body,
      async: isAsync,
    };
  }

  private importStatement(): ImportStatement {
    const module = this.consume(TokenType.IDENTIFIER, 'Expected module name').value as string;

    this.consumeOptional(TokenType.SEMICOLON);

    return {
      type: 'ImportStatement',
      module,
    };
  }

  private statement(): StatementNode {
    if (this.match(TokenType.IF)) return this.ifStatement();
    if (this.match(TokenType.WHILE)) return this.whileStatement();
    if (this.match(TokenType.FOR)) return this.forStatement();
    if (this.match(TokenType.RETURN)) return this.returnStatement();
    if (this.match(TokenType.TRY)) return this.tryStatement();
    if (this.match(TokenType.THROW)) return this.throwStatement();
    if (this.match(TokenType.BREAK)) return this.breakStatement();
    if (this.match(TokenType.CONTINUE)) return this.continueStatement();
    if (this.match(TokenType.LBRACE)) return this.block();

    return this.expressionStatement();
  }

  private ifStatement(): IfStatement {
    this.consume(TokenType.LPAREN, "Expected '(' after 'if'");
    const condition = this.expression();
    this.consume(TokenType.RPAREN, "Expected ')' after condition");

    let consequent: BlockStatement;
    if (this.match(TokenType.LBRACE)) {
      consequent = this.block();
    } else {
      consequent = {
        type: 'BlockStatement',
        body: [this.statement()],
      };
    }

    let alternate: BlockStatement | IfStatement | null = null;
    if (this.match(TokenType.ELSE)) {
      if (this.match(TokenType.IF)) {
        alternate = this.ifStatement();
      } else if (this.match(TokenType.LBRACE)) {
        alternate = this.block();
      } else {
        alternate = {
          type: 'BlockStatement',
          body: [this.statement()],
        };
      }
    }

    return {
      type: 'IfStatement',
      condition,
      consequent,
      alternate,
    };
  }

  private whileStatement(): WhileStatement {
    this.consume(TokenType.LPAREN, "Expected '(' after 'while'");
    const condition = this.expression();
    this.consume(TokenType.RPAREN, "Expected ')' after condition");

    this.consume(TokenType.LBRACE, "Expected '{' before while body");
    const body = this.block();

    return {
      type: 'WhileStatement',
      condition,
      body,
    };
  }

  private forStatement(): ForStatement | ForInStatement {
    // Check if it's a C-style for loop: for (init; test; update) { }
    if (this.match(TokenType.LPAREN)) {
      return this.forCStyleStatement();
    }

    // Otherwise, for-in loop: for x in iterable { }
    const variable = this.consume(TokenType.IDENTIFIER, 'Expected variable name').value as string;
    this.consume(TokenType.IN, "Expected 'in' in for loop");
    const iterable = this.expression();

    this.consume(TokenType.LBRACE, "Expected '{' before for body");
    const body = this.block();

    return {
      type: 'ForInStatement',
      variable,
      iterable,
      body,
    };
  }

  private forCStyleStatement(): ForStatement {
    // Parse C-style for: for (init; test; update) { }

    // Parse init
    let init: VariableDeclaration | ExpressionNode | null = null;
    if (!this.check(TokenType.SEMICOLON)) {
      if (this.match(TokenType.LET) || this.match(TokenType.CONST)) {
        const kind = this.previous().type === TokenType.LET ? 'let' : 'const';
        const name = this.consume(TokenType.IDENTIFIER, 'Expected variable name').value as string;
        let initValue: ExpressionNode | null = null;
        if (this.match(TokenType.ASSIGN)) {
          initValue = this.expression();
        }
        init = {
          type: 'VariableDeclaration',
          kind,
          name,
          init: initValue,
        } as VariableDeclaration;
      } else {
        init = this.expression();
      }
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after for init");

    // Parse test
    let test: ExpressionNode | null = null;
    if (!this.check(TokenType.SEMICOLON)) {
      test = this.expression();
    }
    this.consume(TokenType.SEMICOLON, "Expected ';' after for condition");

    // Parse update
    let update: ExpressionNode | null = null;
    if (!this.check(TokenType.RPAREN)) {
      update = this.expression();
    }
    this.consume(TokenType.RPAREN, "Expected ')' after for clauses");

    // Parse body
    this.consume(TokenType.LBRACE, "Expected '{' before for body");
    const body = this.block();

    return {
      type: 'ForStatement',
      init,
      test,
      update,
      body,
    };
  }

  private returnStatement(): ReturnStatement {
    let argument: ExpressionNode | null = null;

    if (!this.check(TokenType.SEMICOLON) && !this.check(TokenType.RBRACE) && !this.check(TokenType.EOF)) {
      argument = this.expression();
    }

    this.consumeOptional(TokenType.SEMICOLON);

    return {
      type: 'ReturnStatement',
      argument,
    };
  }

  private tryStatement(): TryStatement {
    this.consume(TokenType.LBRACE, "Expected '{' after 'try'");
    const block = this.block();

    let handler = null;
    if (this.match(TokenType.CATCH)) {
      this.consume(TokenType.LPAREN, "Expected '(' after 'catch'");
      const param = this.consume(TokenType.IDENTIFIER, 'Expected error parameter').value as string;
      this.consume(TokenType.RPAREN, "Expected ')' after catch parameter");
      this.consume(TokenType.LBRACE, "Expected '{' before catch body");
      const catchBody = this.block();

      handler = { param, body: catchBody };
    }

    return {
      type: 'TryStatement',
      block,
      handler,
    };
  }

  private throwStatement(): ThrowStatement {
    const argument = this.expression();
    this.consumeOptional(TokenType.SEMICOLON);

    return {
      type: 'ThrowStatement',
      argument,
    };
  }

  private breakStatement(): StatementNode {
    this.consumeOptional(TokenType.SEMICOLON);
    return { type: 'BreakStatement' };
  }

  private continueStatement(): StatementNode {
    this.consumeOptional(TokenType.SEMICOLON);
    return { type: 'ContinueStatement' };
  }

  private block(): BlockStatement {
    const statements: StatementNode[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const decl = this.declaration();
      if (decl) statements.push(decl);
    }

    this.consume(TokenType.RBRACE, "Expected '}' after block");

    return {
      type: 'BlockStatement',
      body: statements,
    };
  }

  private expressionStatement(): ExpressionStatement {
    const expression = this.expression();
    this.consumeOptional(TokenType.SEMICOLON);

    return {
      type: 'ExpressionStatement',
      expression,
    };
  }

  // ============================================
  // Expression Parsing (Precedence Climbing)
  // ============================================

  private expression(): ExpressionNode {
    return this.assignment();
  }

  private assignment(): ExpressionNode {
    const expr = this.ternary();

    if (this.match(TokenType.ASSIGN, TokenType.PLUS_ASSIGN, TokenType.MINUS_ASSIGN)) {
      const operator = this.previous().value as string;
      const value = this.assignment();

      if (expr.type === 'Identifier' || expr.type === 'MemberExpression') {
        return {
          type: 'AssignmentExpression',
          operator,
          left: expr as Identifier | MemberExpression,
          right: value,
        };
      }

      throw new Error('Invalid assignment target');
    }

    return expr;
  }

  private ternary(): ExpressionNode {
    let expr = this.or();

    if (this.match(TokenType.QUESTION)) {
      const consequent = this.expression();
      this.consume(TokenType.COLON, "Expected ':' in ternary expression");
      const alternate = this.ternary();

      return {
        type: 'ConditionalExpression',
        test: expr,
        consequent,
        alternate,
      };
    }

    return expr;
  }

  private or(): ExpressionNode {
    let expr = this.and();

    while (this.match(TokenType.OR)) {
      const right = this.and();
      expr = {
        type: 'LogicalExpression',
        operator: '||',
        left: expr,
        right,
      };
    }

    return expr;
  }

  private and(): ExpressionNode {
    let expr = this.equality();

    while (this.match(TokenType.AND)) {
      const right = this.equality();
      expr = {
        type: 'LogicalExpression',
        operator: '&&',
        left: expr,
        right,
      };
    }

    return expr;
  }

  private equality(): ExpressionNode {
    let expr = this.comparison();

    while (this.match(TokenType.EQUALS, TokenType.NOT_EQUALS)) {
      const operator = this.previous().value as string;
      const right = this.comparison();
      expr = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
    }

    return expr;
  }

  private comparison(): ExpressionNode {
    let expr = this.term();

    while (this.match(TokenType.LESS_THAN, TokenType.LESS_EQUAL, TokenType.GREATER_THAN, TokenType.GREATER_EQUAL)) {
      const operator = this.previous().value as string;
      const right = this.term();
      expr = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
    }

    return expr;
  }

  private term(): ExpressionNode {
    let expr = this.factor();

    while (this.match(TokenType.PLUS, TokenType.MINUS)) {
      const operator = this.previous().value as string;
      const right = this.factor();
      expr = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
    }

    return expr;
  }

  private factor(): ExpressionNode {
    let expr = this.power();

    while (this.match(TokenType.MULTIPLY, TokenType.DIVIDE, TokenType.MODULO)) {
      const operator = this.previous().value as string;
      const right = this.power();
      expr = {
        type: 'BinaryExpression',
        operator,
        left: expr,
        right,
      };
    }

    return expr;
  }

  private power(): ExpressionNode {
    let expr = this.unary();

    if (this.match(TokenType.POWER)) {
      const right = this.power(); // Right associative
      expr = {
        type: 'BinaryExpression',
        operator: '**',
        left: expr,
        right,
      };
    }

    return expr;
  }

  private unary(): ExpressionNode {
    if (this.match(TokenType.NOT, TokenType.MINUS)) {
      const operator = this.previous().value as string;
      const right = this.unary();
      return {
        type: 'UnaryExpression',
        operator,
        argument: right,
        prefix: true,
      };
    }

    if (this.match(TokenType.AWAIT)) {
      const argument = this.unary();
      return {
        type: 'AwaitExpression',
        argument,
      };
    }

    return this.call();
  }

  private call(): ExpressionNode {
    let expr = this.primary();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        expr = this.finishCall(expr);
      } else if (this.match(TokenType.DOT)) {
        const name = this.consume(TokenType.IDENTIFIER, 'Expected property name').value as string;
        expr = {
          type: 'MemberExpression',
          object: expr,
          property: { type: 'Identifier', name },
          computed: false,
        };
      } else if (this.match(TokenType.LBRACKET)) {
        const property = this.expression();
        this.consume(TokenType.RBRACKET, "Expected ']' after index");
        expr = {
          type: 'MemberExpression',
          object: expr,
          property,
          computed: true,
        };
      } else {
        break;
      }
    }

    return expr;
  }

  private finishCall(callee: ExpressionNode): CallExpression {
    const args: ExpressionNode[] = [];

    if (!this.check(TokenType.RPAREN)) {
      do {
        // Handle named arguments: name: value
        if (this.check(TokenType.IDENTIFIER) && this.checkNext(TokenType.COLON)) {
          const name = this.advance().value as string;
          this.advance(); // :
          const value = this.expression();
          args.push({
            type: 'ObjectExpression',
            properties: [{ key: name, value, computed: false }],
          });
        } else {
          args.push(this.expression());
        }
      } while (this.match(TokenType.COMMA));
    }

    this.consume(TokenType.RPAREN, "Expected ')' after arguments");

    return {
      type: 'CallExpression',
      callee,
      arguments: args,
    };
  }

  private primary(): ExpressionNode {
    if (this.match(TokenType.NUMBER, TokenType.STRING, TokenType.BOOLEAN, TokenType.NULL)) {
      return {
        type: 'Literal',
        value: this.previous().value,
      } as Literal;
    }

    if (this.match(TokenType.IDENTIFIER)) {
      return {
        type: 'Identifier',
        name: this.previous().value as string,
      };
    }

    if (this.match(TokenType.LBRACKET)) {
      return this.arrayExpression();
    }

    if (this.match(TokenType.LBRACE)) {
      return this.objectExpression();
    }

    if (this.match(TokenType.LPAREN)) {
      // Could be grouping or arrow function
      const expr = this.expression();
      this.consume(TokenType.RPAREN, "Expected ')' after expression");

      if (this.match(TokenType.ARROW)) {
        return this.arrowFunction([expr]);
      }

      return expr;
    }

    throw new Error(`Unexpected token: ${this.peek().type} at line ${this.peek().line}`);
  }

  private arrayExpression(): ArrayExpression {
    const elements: ExpressionNode[] = [];

    if (!this.check(TokenType.RBRACKET)) {
      do {
        elements.push(this.expression());
      } while (this.match(TokenType.COMMA));
    }

    this.consume(TokenType.RBRACKET, "Expected ']' after array");

    return {
      type: 'ArrayExpression',
      elements,
    };
  }

  private objectExpression(): ObjectExpression {
    const properties: { key: string | ExpressionNode; value: ExpressionNode; computed: boolean }[] = [];

    if (!this.check(TokenType.RBRACE)) {
      do {
        let key: string | ExpressionNode;
        let computed = false;

        if (this.match(TokenType.LBRACKET)) {
          key = this.expression();
          this.consume(TokenType.RBRACKET, "Expected ']' after computed property");
          computed = true;
        } else if (this.check(TokenType.STRING)) {
          key = this.advance().value as string;
        } else {
          key = this.consume(TokenType.IDENTIFIER, 'Expected property name').value as string;
        }

        this.consume(TokenType.COLON, "Expected ':' after property name");
        const value = this.expression();

        properties.push({ key, value, computed });
      } while (this.match(TokenType.COMMA));
    }

    this.consume(TokenType.RBRACE, "Expected '}' after object");

    return {
      type: 'ObjectExpression',
      properties,
    };
  }

  private arrowFunction(params: ExpressionNode[]): ArrowFunction {
    const paramNodes: ParameterNode[] = params.map(p => {
      if (p.type !== 'Identifier') {
        throw new Error('Arrow function parameters must be identifiers');
      }
      return { name: (p as Identifier).name };
    });

    let body: ExpressionNode | BlockStatement;
    if (this.match(TokenType.LBRACE)) {
      body = this.block();
    } else {
      body = this.expression();
    }

    return {
      type: 'ArrowFunction',
      params: paramNodes,
      body,
      async: false,
    };
  }

  // ============================================
  // Utility Methods
  // ============================================

  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private check(type: TokenType): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkNext(type: TokenType): boolean {
    if (this.current + 1 >= this.tokens.length) return false;
    return this.tokens[this.current + 1].type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${message}. Got ${this.peek().type} at line ${this.peek().line}`);
  }

  private consumeOptional(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private synchronize(): void {
    this.advance();

    while (!this.isAtEnd()) {
      if (this.previous().type === TokenType.SEMICOLON) return;

      switch (this.peek().type) {
        case TokenType.FUNCTION:
        case TokenType.LET:
        case TokenType.CONST:
        case TokenType.IF:
        case TokenType.WHILE:
        case TokenType.FOR:
        case TokenType.RETURN:
        case TokenType.TRY:
          return;
      }

      this.advance();
    }
  }
}

export function parse(tokens: Token[]): ProgramNode {
  return new Parser(tokens).parse();
}
