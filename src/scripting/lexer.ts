/**
 * Grok Script Lexer
 *
 * Tokenizes Grok Script source code into tokens
 */

import { Token, TokenType } from './types.js';

const KEYWORDS: Record<string, TokenType> = {
  'let': TokenType.LET,
  'const': TokenType.CONST,
  'function': TokenType.FUNCTION,
  'return': TokenType.RETURN,
  'if': TokenType.IF,
  'else': TokenType.ELSE,
  'while': TokenType.WHILE,
  'for': TokenType.FOR,
  'in': TokenType.IN,
  'break': TokenType.BREAK,
  'continue': TokenType.CONTINUE,
  'try': TokenType.TRY,
  'catch': TokenType.CATCH,
  'throw': TokenType.THROW,
  'import': TokenType.IMPORT,
  'export': TokenType.EXPORT,
  'async': TokenType.ASYNC,
  'await': TokenType.AWAIT,
  'true': TokenType.BOOLEAN,
  'false': TokenType.BOOLEAN,
  'null': TokenType.NULL,
};

export class Lexer {
  private source: string;
  private tokens: Token[] = [];
  private current = 0;
  private line = 1;
  private column = 1;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.scanToken();
    }

    this.tokens.push({
      type: TokenType.EOF,
      value: null,
      line: this.line,
      column: this.column,
    });

    return this.tokens;
  }

  private scanToken(): void {
    const char = this.advance();

    switch (char) {
      // Single character tokens
      case '(': this.addToken(TokenType.LPAREN, '('); break;
      case ')': this.addToken(TokenType.RPAREN, ')'); break;
      case '{': this.addToken(TokenType.LBRACE, '{'); break;
      case '}': this.addToken(TokenType.RBRACE, '}'); break;
      case '[': this.addToken(TokenType.LBRACKET, '['); break;
      case ']': this.addToken(TokenType.RBRACKET, ']'); break;
      case ',': this.addToken(TokenType.COMMA, ','); break;
      case '.': this.addToken(TokenType.DOT, '.'); break;
      case ':': this.addToken(TokenType.COLON, ':'); break;
      case ';': this.addToken(TokenType.SEMICOLON, ';'); break;
      case '?': this.addToken(TokenType.QUESTION, '?'); break;

      // Operators
      case '+':
        if (this.match('=')) {
          this.addToken(TokenType.PLUS_ASSIGN, '+=');
        } else {
          this.addToken(TokenType.PLUS, '+');
        }
        break;

      case '-':
        if (this.match('=')) {
          this.addToken(TokenType.MINUS_ASSIGN, '-=');
        } else {
          this.addToken(TokenType.MINUS, '-');
        }
        break;

      case '*':
        if (this.match('*')) {
          this.addToken(TokenType.POWER, '**');
        } else {
          this.addToken(TokenType.MULTIPLY, '*');
        }
        break;

      case '/':
        if (this.match('/')) {
          // Single-line comment
          while (this.peek() !== '\n' && !this.isAtEnd()) {
            this.advance();
          }
        } else if (this.match('*')) {
          // Multi-line comment
          this.multiLineComment();
        } else {
          this.addToken(TokenType.DIVIDE, '/');
        }
        break;

      case '%': this.addToken(TokenType.MODULO, '%'); break;

      case '=':
        if (this.match('=')) {
          if (this.match('=')) {
            this.addToken(TokenType.EQUALS, '===');
          } else {
            this.addToken(TokenType.EQUALS, '==');
          }
        } else if (this.match('>')) {
          this.addToken(TokenType.ARROW, '=>');
        } else {
          this.addToken(TokenType.ASSIGN, '=');
        }
        break;

      case '!':
        if (this.match('=')) {
          if (this.match('=')) {
            this.addToken(TokenType.NOT_EQUALS, '!==');
          } else {
            this.addToken(TokenType.NOT_EQUALS, '!=');
          }
        } else {
          this.addToken(TokenType.NOT, '!');
        }
        break;

      case '<':
        if (this.match('=')) {
          this.addToken(TokenType.LESS_EQUAL, '<=');
        } else {
          this.addToken(TokenType.LESS_THAN, '<');
        }
        break;

      case '>':
        if (this.match('=')) {
          this.addToken(TokenType.GREATER_EQUAL, '>=');
        } else {
          this.addToken(TokenType.GREATER_THAN, '>');
        }
        break;

      case '&':
        if (this.match('&')) {
          this.addToken(TokenType.AND, '&&');
        }
        break;

      case '|':
        if (this.match('|')) {
          this.addToken(TokenType.OR, '||');
        }
        break;

      // Whitespace
      case ' ':
      case '\r':
      case '\t':
        // Ignore whitespace
        break;

      case '\n':
        this.line++;
        this.column = 1;
        break;

      // Strings
      case '"':
      case "'":
        this.string(char);
        break;

      case '`':
        this.templateLiteral();
        break;

      default:
        if (this.isDigit(char)) {
          this.number(char);
        } else if (this.isAlpha(char)) {
          this.identifier(char);
        } else {
          throw new Error(`Unexpected character '${char}' at line ${this.line}, column ${this.column}`);
        }
    }
  }

  private string(quote: string): void {
    let value = '';

    while (this.peek() !== quote && !this.isAtEnd()) {
      if (this.peek() === '\n') {
        this.line++;
        this.column = 1;
      }
      if (this.peek() === '\\') {
        this.advance();
        const escaped = this.advance();
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          default: value += escaped;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      throw new Error(`Unterminated string at line ${this.line}`);
    }

    this.advance(); // Closing quote
    this.addToken(TokenType.STRING, value);
  }

  private templateLiteral(): void {
    let value = '`';

    while (this.peek() !== '`' && !this.isAtEnd()) {
      if (this.peek() === '\n') {
        this.line++;
        this.column = 1;
      }
      value += this.advance();
    }

    if (this.isAtEnd()) {
      throw new Error(`Unterminated template literal at line ${this.line}`);
    }

    value += this.advance(); // Closing backtick
    this.addToken(TokenType.STRING, value);
  }

  private number(first: string): void {
    let value = first;

    while (this.isDigit(this.peek())) {
      value += this.advance();
    }

    // Decimal
    if (this.peek() === '.' && this.isDigit(this.peekNext())) {
      value += this.advance(); // .
      while (this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    // Scientific notation
    if (this.peek() === 'e' || this.peek() === 'E') {
      value += this.advance();
      if (this.peek() === '+' || this.peek() === '-') {
        value += this.advance();
      }
      while (this.isDigit(this.peek())) {
        value += this.advance();
      }
    }

    this.addToken(TokenType.NUMBER, parseFloat(value));
  }

  private identifier(first: string): void {
    let value = first;

    while (this.isAlphaNumeric(this.peek())) {
      value += this.advance();
    }

    const keyword = KEYWORDS[value];
    if (keyword) {
      if (keyword === TokenType.BOOLEAN) {
        this.addToken(TokenType.BOOLEAN, value === 'true');
      } else if (keyword === TokenType.NULL) {
        this.addToken(TokenType.NULL, null);
      } else {
        this.addToken(keyword, value);
      }
    } else {
      this.addToken(TokenType.IDENTIFIER, value);
    }
  }

  private multiLineComment(): void {
    while (!this.isAtEnd()) {
      if (this.peek() === '*' && this.peekNext() === '/') {
        this.advance(); // *
        this.advance(); // /
        return;
      }
      if (this.peek() === '\n') {
        this.line++;
        this.column = 1;
      }
      this.advance();
    }

    throw new Error(`Unterminated multi-line comment at line ${this.line}`);
  }

  private advance(): string {
    const char = this.source[this.current];
    this.current++;
    this.column++;
    return char;
  }

  private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source[this.current] !== expected) return false;
    this.current++;
    this.column++;
    return true;
  }

  private peek(): string {
    if (this.isAtEnd()) return '\0';
    return this.source[this.current];
  }

  private peekNext(): string {
    if (this.current + 1 >= this.source.length) return '\0';
    return this.source[this.current + 1];
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length;
  }

  private isDigit(char: string): boolean {
    return char >= '0' && char <= '9';
  }

  private isAlpha(char: string): boolean {
    return (char >= 'a' && char <= 'z') ||
           (char >= 'A' && char <= 'Z') ||
           char === '_' ||
           char === '$';
  }

  private isAlphaNumeric(char: string): boolean {
    return this.isAlpha(char) || this.isDigit(char);
  }

  private addToken(type: TokenType, value: string | number | boolean | null): void {
    this.tokens.push({
      type,
      value,
      line: this.line,
      column: this.column - String(value).length,
    });
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
