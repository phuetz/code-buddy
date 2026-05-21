/**
 * Unified Script Lexer
 *
 * Based on FCS lexer (superset) with Buddy Script additions:
 * - Question token type for ternary (separate from Colon)
 * - Pipeline |> operator
 * - Decorators @
 * - Indent/Dedent tracking
 * - Shebang handling
 * - Template strings, hex/binary/scientific numbers
 *
 * Extensions: .bs (primary), .fcs (backward-compatible alias)
 */

import { Token, TokenType, FCS_KEYWORDS } from './types.js';

export class FCSLexer {
  private source: string;
  private position = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];
  private indentStack: number[] = [0];

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    this.tokens = [];
    this.position = 0;
    this.line = 1;
    this.column = 1;

    // Handle shebang
    if (this.source.startsWith('#!')) {
      while (!this.isAtEnd() && this.peek() !== '\n') {
        this.advance();
      }
      if (!this.isAtEnd()) this.advance(); // Skip newline
    }

    // Handle initial indentation
    this.handleIndentation();

    while (!this.isAtEnd()) {
      this.skipWhitespaceNotNewline();
      if (this.isAtEnd()) break;

      const token = this.nextToken();
      if (token && token.type !== TokenType.Comment) {
        this.tokens.push(token);
      }
    }

    // Add remaining dedents
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.addToken(TokenType.Dedent, '');
    }

    this.addToken(TokenType.EOF, '');
    return this.tokens;
  }

  private nextToken(): Token | null {
    const startPos = this.position;
    const startLine = this.line;
    const startColumn = this.column;
    const ch = this.advance();

    // Comments
    if (ch === '/' && this.peek() === '/') {
      return this.scanLineComment();
    }
    if (ch === '/' && this.peek() === '*') {
      return this.scanBlockComment();
    }
    if (ch === '#' && this.column > 1) {
      return this.scanLineComment();
    }

    // Strings
    if (ch === '"') return this.scanString('"', startPos, startLine, startColumn);
    if (ch === "'") return this.scanString("'", startPos, startLine, startColumn);
    if (ch === '`') return this.scanTemplateString(startPos, startLine, startColumn);

    // Numbers
    if (this.isDigit(ch)) {
      return this.scanNumber(startPos, startLine, startColumn);
    }

    // Identifiers and keywords
    if (this.isAlpha(ch)) {
      return this.scanIdentifier(startPos, startLine, startColumn);
    }

    // Decorators
    if (ch === '@') return this.scanDecorator(startPos, startLine, startColumn);

    // Operators and punctuation
    switch (ch) {
      case '+':
        if (this.match('=')) return this.createToken(TokenType.PlusAssign, '+=', startPos, startLine, startColumn);
        if (this.match('+')) return this.createToken(TokenType.Plus, '++', startPos, startLine, startColumn);
        return this.createToken(TokenType.Plus, '+', startPos, startLine, startColumn);

      case '-':
        if (this.match('=')) return this.createToken(TokenType.MinusAssign, '-=', startPos, startLine, startColumn);
        if (this.match('-')) return this.createToken(TokenType.Minus, '--', startPos, startLine, startColumn);
        if (this.match('>')) return this.createToken(TokenType.Arrow, '->', startPos, startLine, startColumn);
        return this.createToken(TokenType.Minus, '-', startPos, startLine, startColumn);

      case '*':
        if (this.match('*')) return this.createToken(TokenType.Power, '**', startPos, startLine, startColumn);
        if (this.match('=')) return this.createToken(TokenType.MultiplyAssign, '*=', startPos, startLine, startColumn);
        return this.createToken(TokenType.Multiply, '*', startPos, startLine, startColumn);

      case '/':
        if (this.match('=')) return this.createToken(TokenType.DivideAssign, '/=', startPos, startLine, startColumn);
        return this.createToken(TokenType.Divide, '/', startPos, startLine, startColumn);

      case '%':
        return this.createToken(TokenType.Modulo, '%', startPos, startLine, startColumn);

      case '=':
        if (this.match('=')) return this.createToken(TokenType.Equal, '==', startPos, startLine, startColumn);
        if (this.match('>')) return this.createToken(TokenType.Arrow, '=>', startPos, startLine, startColumn);
        return this.createToken(TokenType.Assign, '=', startPos, startLine, startColumn);

      case '!':
        if (this.match('=')) return this.createToken(TokenType.NotEqual, '!=', startPos, startLine, startColumn);
        return this.createToken(TokenType.Not, '!', startPos, startLine, startColumn);

      case '<':
        if (this.match('=')) return this.createToken(TokenType.LessEqual, '<=', startPos, startLine, startColumn);
        return this.createToken(TokenType.Less, '<', startPos, startLine, startColumn);

      case '>':
        if (this.match('=')) return this.createToken(TokenType.GreaterEqual, '>=', startPos, startLine, startColumn);
        return this.createToken(TokenType.Greater, '>', startPos, startLine, startColumn);

      case '&':
        if (this.match('&')) return this.createToken(TokenType.And, '&&', startPos, startLine, startColumn);
        return null;

      case '|':
        if (this.match('|')) return this.createToken(TokenType.Or, '||', startPos, startLine, startColumn);
        if (this.match('>')) return this.createToken(TokenType.Pipeline, '|>', startPos, startLine, startColumn);
        return null;

      // Delimiters
      case '(':
        return this.createToken(TokenType.LeftParen, '(', startPos, startLine, startColumn);
      case ')':
        return this.createToken(TokenType.RightParen, ')', startPos, startLine, startColumn);
      case '{':
        return this.createToken(TokenType.LeftBrace, '{', startPos, startLine, startColumn);
      case '}':
        return this.createToken(TokenType.RightBrace, '}', startPos, startLine, startColumn);
      case '[':
        return this.createToken(TokenType.LeftBracket, '[', startPos, startLine, startColumn);
      case ']':
        return this.createToken(TokenType.RightBracket, ']', startPos, startLine, startColumn);

      // Punctuation
      case ';':
        return this.createToken(TokenType.Semicolon, ';', startPos, startLine, startColumn);
      case ',':
        return this.createToken(TokenType.Comma, ',', startPos, startLine, startColumn);
      case '.':
        return this.createToken(TokenType.Dot, '.', startPos, startLine, startColumn);
      case ':':
        return this.createToken(TokenType.Colon, ':', startPos, startLine, startColumn);
      case '?':
        // Use dedicated Question token type for ternary
        return this.createToken(TokenType.Question, '?', startPos, startLine, startColumn);

      // Newline
      case '\n':
        return this.handleNewline(startPos, startLine, startColumn);

      default:
        throw new Error(`Unexpected character '${ch}' at ${startLine}:${startColumn}`);
    }
  }

  private scanString(quote: string, startPos: number, startLine: number, startColumn: number): Token {
    let value = '';

    while (!this.isAtEnd() && this.peek() !== quote) {
      if (this.peek() === '\\') {
        this.advance(); // Skip backslash
        if (!this.isAtEnd()) {
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
        }
      } else if (this.peek() === '$' && this.peekNext() === '{') {
        // String interpolation - keep as-is for parser
        value += '${';
        this.advance(); // $
        this.advance(); // {
        let braceCount = 1;
        while (!this.isAtEnd() && braceCount > 0) {
          const ch = this.advance();
          value += ch;
          if (ch === '{') braceCount++;
          else if (ch === '}') braceCount--;
        }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      throw new Error(`Unterminated string at ${startLine}:${startColumn}`);
    }

    this.advance(); // Closing quote
    return this.createToken(TokenType.String, value, startPos, startLine, startColumn);
  }

  private scanTemplateString(startPos: number, startLine: number, startColumn: number): Token {
    let value = '';

    while (!this.isAtEnd() && this.peek() !== '`') {
      if (this.peek() === '$' && this.peekNext() === '{') {
        value += '${';
        this.advance(); // $
        this.advance(); // {
        let braceCount = 1;
        while (!this.isAtEnd() && braceCount > 0) {
          const ch = this.advance();
          value += ch;
          if (ch === '{') braceCount++;
          else if (ch === '}') braceCount--;
        }
      } else {
        const ch = this.advance();
        value += ch;
        if (ch === '\n') {
          this.line++;
          this.column = 1;
        }
      }
    }

    if (!this.isAtEnd()) this.advance(); // Closing backtick
    return this.createToken(TokenType.String, value, startPos, startLine, startColumn);
  }

  private scanNumber(startPos: number, startLine: number, startColumn: number): Token {
    let value = this.source[startPos];

    // Hex number
    if (value === '0' && (this.peek() === 'x' || this.peek() === 'X')) {
      value += this.advance(); // x
      while (this.isHexDigit(this.peek())) {
        value += this.advance();
      }
    }
    // Binary number
    else if (value === '0' && (this.peek() === 'b' || this.peek() === 'B')) {
      value += this.advance(); // b
      while (this.peek() === '0' || this.peek() === '1') {
        value += this.advance();
      }
    }
    // Decimal number
    else {
      while (this.isDigit(this.peek())) {
        value += this.advance();
      }

      // Decimal part
      if (this.peek() === '.' && this.isDigit(this.peekNext())) {
        value += this.advance(); // .
        while (this.isDigit(this.peek())) {
          value += this.advance();
        }
      }

      // Exponent
      if (this.peek() === 'e' || this.peek() === 'E') {
        value += this.advance(); // e
        if (this.peek() === '+' || this.peek() === '-') {
          value += this.advance();
        }
        while (this.isDigit(this.peek())) {
          value += this.advance();
        }
      }
    }

    return this.createToken(TokenType.Number, value, startPos, startLine, startColumn);
  }

  private scanIdentifier(startPos: number, startLine: number, startColumn: number): Token {
    let value = this.source[startPos];

    while (this.isAlphaNumeric(this.peek())) {
      value += this.advance();
    }

    // Check for keywords
    if (FCS_KEYWORDS.has(value)) {
      if (value === 'true' || value === 'false') {
        return this.createToken(TokenType.Boolean, value, startPos, startLine, startColumn);
      }
      if (value === 'null') {
        return this.createToken(TokenType.Null, value, startPos, startLine, startColumn);
      }
      return this.createToken(TokenType.Keyword, value, startPos, startLine, startColumn);
    }

    return this.createToken(TokenType.Identifier, value, startPos, startLine, startColumn);
  }

  private scanDecorator(startPos: number, startLine: number, startColumn: number): Token {
    let value = '@';

    while (this.isAlphaNumeric(this.peek())) {
      value += this.advance();
    }

    return this.createToken(TokenType.Decorator, value, startPos, startLine, startColumn);
  }

  private scanLineComment(): Token | null {
    while (!this.isAtEnd() && this.peek() !== '\n') {
      this.advance();
    }
    return null; // Comments are skipped
  }

  private scanBlockComment(): Token | null {
    this.advance(); // Skip *

    while (!this.isAtEnd() && !(this.peek() === '*' && this.peekNext() === '/')) {
      const ch = this.advance();
      if (ch === '\n') {
        this.line++;
        this.column = 1;
      }
    }

    if (this.isAtEnd()) {
      throw new Error('Unterminated block comment');
    }

    this.advance(); // *
    this.advance(); // /

    return null; // Comments are skipped
  }

  private handleNewline(startPos: number, startLine: number, startColumn: number): Token | null {
    // Count indentation on next line
    let indentLevel = 0;
    while (this.peek() === ' ' || this.peek() === '\t') {
      if (this.advance() === '\t') {
        indentLevel += 4;
      } else {
        indentLevel++;
      }
    }

    // Skip blank lines
    if (this.peek() === '\n' || this.peek() === '#' || (this.peek() === '/' && this.peekNext() === '/')) {
      return this.createToken(TokenType.Newline, '\n', startPos, startLine, startColumn);
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1];

    if (indentLevel > currentIndent) {
      this.indentStack.push(indentLevel);
      this.addToken(TokenType.Indent, '');
    } else if (indentLevel < currentIndent) {
      while (this.indentStack.length > 1 && this.indentStack[this.indentStack.length - 1] > indentLevel) {
        this.indentStack.pop();
        this.addToken(TokenType.Dedent, '');
      }
    }

    return this.createToken(TokenType.Newline, '\n', startPos, startLine, startColumn);
  }

  private handleIndentation(): void {
    let indentLevel = 0;
    while (this.position < this.source.length && (this.source[this.position] === ' ' || this.source[this.position] === '\t')) {
      if (this.source[this.position] === '\t') {
        indentLevel += 4;
      } else {
        indentLevel++;
      }
      this.position++;
      this.column++;
    }

    if (indentLevel > 0) {
      this.indentStack.push(indentLevel);
      this.addToken(TokenType.Indent, '');
    }
  }

  // Helper methods
  private isAtEnd(): boolean {
    return this.position >= this.source.length;
  }

  private advance(): string {
    if (this.isAtEnd()) return '\0';
    const ch = this.source[this.position++];
    this.column++;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    }
    return ch;
  }

  private peek(): string {
    return this.isAtEnd() ? '\0' : this.source[this.position];
  }

  private peekNext(): string {
    return this.position + 1 >= this.source.length ? '\0' : this.source[this.position + 1];
  }

  private match(expected: string): boolean {
    if (this.isAtEnd() || this.source[this.position] !== expected) {
      return false;
    }
    this.position++;
    this.column++;
    return true;
  }

  private skipWhitespaceNotNewline(): void {
    while (!this.isAtEnd()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\r' || ch === '\t') {
        this.advance();
      } else {
        break;
      }
    }
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isAlpha(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
  }

  private isAlphaNumeric(ch: string): boolean {
    return this.isDigit(ch) || this.isAlpha(ch);
  }

  private isHexDigit(ch: string): boolean {
    return this.isDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
  }

  private createToken(type: TokenType, value: string, pos: number, line: number, col: number): Token {
    return {
      type,
      value,
      position: pos,
      line,
      column: col,
      length: this.position - pos,
    };
  }

  private addToken(type: TokenType, value: string): void {
    this.tokens.push({
      type,
      value,
      position: this.position,
      line: this.line,
      column: this.column,
      length: 0,
    });
  }
}

/** @deprecated Use FCSLexer instead */
export const Lexer = FCSLexer;

export function tokenize(source: string): Token[] {
  return new FCSLexer(source).tokenize();
}
