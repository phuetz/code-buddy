/**
 * Buddy Script Types
 *
 * Type definitions for the Buddy Script language (.bs files)
 * Inspired by FileCommander Script (FCS)
 */

// ============================================
// Token Types
// ============================================

export enum TokenType {
  // Literals
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  IDENTIFIER = 'IDENTIFIER',

  // Keywords
  LET = 'LET',
  CONST = 'CONST',
  FUNCTION = 'FUNCTION',
  RETURN = 'RETURN',
  IF = 'IF',
  ELSE = 'ELSE',
  WHILE = 'WHILE',
  FOR = 'FOR',
  IN = 'IN',
  BREAK = 'BREAK',
  CONTINUE = 'CONTINUE',
  TRY = 'TRY',
  CATCH = 'CATCH',
  THROW = 'THROW',
  IMPORT = 'IMPORT',
  EXPORT = 'EXPORT',
  ASYNC = 'ASYNC',
  AWAIT = 'AWAIT',

  // Operators
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  MULTIPLY = 'MULTIPLY',
  DIVIDE = 'DIVIDE',
  MODULO = 'MODULO',
  POWER = 'POWER',
  ASSIGN = 'ASSIGN',
  PLUS_ASSIGN = 'PLUS_ASSIGN',
  MINUS_ASSIGN = 'MINUS_ASSIGN',
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  LESS_THAN = 'LESS_THAN',
  GREATER_THAN = 'GREATER_THAN',
  LESS_EQUAL = 'LESS_EQUAL',
  GREATER_EQUAL = 'GREATER_EQUAL',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',

  // Delimiters
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  COMMA = 'COMMA',
  DOT = 'DOT',
  COLON = 'COLON',
  SEMICOLON = 'SEMICOLON',
  ARROW = 'ARROW',
  QUESTION = 'QUESTION',

  // Special
  COMMENT = 'COMMENT',
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  line: number;
  column: number;
}

// ============================================
// AST Node Types
// ============================================

export type ASTNode =
  | ProgramNode
  | StatementNode
  | ExpressionNode;

export interface ProgramNode {
  type: 'Program';
  body: StatementNode[];
}

export type StatementNode =
  | VariableDeclaration
  | FunctionDeclaration
  | ExpressionStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | ForInStatement
  | ReturnStatement
  | BreakStatement
  | ContinueStatement
  | TryStatement
  | ThrowStatement
  | ImportStatement
  | BlockStatement;

export interface VariableDeclaration {
  type: 'VariableDeclaration';
  kind: 'let' | 'const';
  name: string;
  init: ExpressionNode | null;
}

export interface FunctionDeclaration {
  type: 'FunctionDeclaration';
  name: string;
  params: ParameterNode[];
  body: BlockStatement;
  async: boolean;
}

export interface ParameterNode {
  name: string;
  defaultValue?: ExpressionNode;
}

export interface ExpressionStatement {
  type: 'ExpressionStatement';
  expression: ExpressionNode;
}

export interface IfStatement {
  type: 'IfStatement';
  condition: ExpressionNode;
  consequent: BlockStatement;
  alternate: BlockStatement | IfStatement | null;
}

export interface WhileStatement {
  type: 'WhileStatement';
  condition: ExpressionNode;
  body: BlockStatement;
}

export interface ForStatement {
  type: 'ForStatement';
  init: VariableDeclaration | ExpressionNode | null;
  test: ExpressionNode | null;
  update: ExpressionNode | null;
  body: BlockStatement;
}

export interface ForInStatement {
  type: 'ForInStatement';
  variable: string;
  iterable: ExpressionNode;
  body: BlockStatement;
}

export interface ReturnStatement {
  type: 'ReturnStatement';
  argument: ExpressionNode | null;
}

export interface BreakStatement {
  type: 'BreakStatement';
}

export interface ContinueStatement {
  type: 'ContinueStatement';
}

export interface TryStatement {
  type: 'TryStatement';
  block: BlockStatement;
  handler: CatchClause | null;
}

export interface CatchClause {
  param: string;
  body: BlockStatement;
}

export interface ThrowStatement {
  type: 'ThrowStatement';
  argument: ExpressionNode;
}

export interface ImportStatement {
  type: 'ImportStatement';
  module: string;
  alias?: string;
}

export interface BlockStatement {
  type: 'BlockStatement';
  body: StatementNode[];
}

// ============================================
// Expression Types
// ============================================

export type ExpressionNode =
  | Literal
  | Identifier
  | BinaryExpression
  | UnaryExpression
  | LogicalExpression
  | AssignmentExpression
  | CallExpression
  | MemberExpression
  | ArrayExpression
  | ObjectExpression
  | ConditionalExpression
  | ArrowFunction
  | AwaitExpression
  | TemplateLiteral;

export interface Literal {
  type: 'Literal';
  value: string | number | boolean | null;
}

export interface Identifier {
  type: 'Identifier';
  name: string;
}

export interface BinaryExpression {
  type: 'BinaryExpression';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface UnaryExpression {
  type: 'UnaryExpression';
  operator: string;
  argument: ExpressionNode;
  prefix: boolean;
}

export interface LogicalExpression {
  type: 'LogicalExpression';
  operator: '&&' | '||';
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface AssignmentExpression {
  type: 'AssignmentExpression';
  operator: string;
  left: Identifier | MemberExpression;
  right: ExpressionNode;
}

export interface CallExpression {
  type: 'CallExpression';
  callee: ExpressionNode;
  arguments: ExpressionNode[];
}

export interface MemberExpression {
  type: 'MemberExpression';
  object: ExpressionNode;
  property: ExpressionNode;
  computed: boolean;
}

export interface ArrayExpression {
  type: 'ArrayExpression';
  elements: ExpressionNode[];
}

export interface ObjectExpression {
  type: 'ObjectExpression';
  properties: PropertyNode[];
}

export interface PropertyNode {
  key: string | ExpressionNode;
  value: ExpressionNode;
  computed: boolean;
}

export interface ConditionalExpression {
  type: 'ConditionalExpression';
  test: ExpressionNode;
  consequent: ExpressionNode;
  alternate: ExpressionNode;
}

export interface ArrowFunction {
  type: 'ArrowFunction';
  params: ParameterNode[];
  body: ExpressionNode | BlockStatement;
  async: boolean;
}

export interface AwaitExpression {
  type: 'AwaitExpression';
  argument: ExpressionNode;
}

export interface TemplateLiteral {
  type: 'TemplateLiteral';
  parts: (string | ExpressionNode)[];
}

// ============================================
// Runtime Types
// ============================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeBuddyValue = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeBuddyArray = any[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeBuddyObject = Record<string, any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeBuddyFunction = (...args: any[]) => any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CodeBuddyPromise = Promise<any>;

export interface RuntimeContext {
  variables: Map<string, CodeBuddyValue>;
  functions: Map<string, CodeBuddyFunction>;
  parent?: RuntimeContext;
}

export interface ScriptResult {
  success: boolean;
  output: string[];
  error?: string;
  returnValue?: CodeBuddyValue;
  duration: number;
}

// ============================================
// Script Configuration
// ============================================

/** Interface for AI agent used by scripts */
export interface ScriptAgentInterface {
  processUserInput(prompt: string, options?: Record<string, unknown>): Promise<{ content?: string }>;
}

export interface CodeBuddyScriptConfig {
  /** Working directory for file operations */
  workdir: string;
  /** Maximum execution time in ms (default: 300000 = 5 min) */
  timeout: number;
  /** Enable AI interactions */
  enableAI: boolean;
  /** Enable bash commands */
  enableBash: boolean;
  /** Enable file operations */
  enableFileOps: boolean;
  /** Verbose output */
  verbose: boolean;
  /** Dry run mode - don't execute side effects */
  dryRun: boolean;
  /** Variables to inject into script */
  variables?: Record<string, CodeBuddyValue>;
  /** AI agent instance for AI operations */
  agent?: ScriptAgentInterface;
}

export const DEFAULT_SCRIPT_CONFIG: CodeBuddyScriptConfig = {
  workdir: process.cwd(),
  timeout: 300000,
  enableAI: true,
  enableBash: true,
  enableFileOps: true,
  verbose: false,
  dryRun: false,
};
