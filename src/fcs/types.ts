/**
 * FileCommander Script (FCS) Types
 *
 * 100% compatible with FileCommander Enhanced Script language
 */

// ============================================
// Token Types (matching FCS exactly)
// ============================================

export enum TokenType {
  // Literals
  Number = 'Number',
  String = 'String',
  Boolean = 'Boolean',
  Null = 'Null',
  Regex = 'Regex',

  // Identifiers and Keywords
  Identifier = 'Identifier',
  Keyword = 'Keyword',

  // Operators
  Plus = 'Plus',           // +
  Minus = 'Minus',         // -
  Multiply = 'Multiply',   // *
  Divide = 'Divide',       // /
  Modulo = 'Modulo',       // %
  Power = 'Power',         // **

  // Comparison
  Equal = 'Equal',         // ==
  NotEqual = 'NotEqual',   // !=
  Less = 'Less',           // <
  Greater = 'Greater',     // >
  LessEqual = 'LessEqual', // <=
  GreaterEqual = 'GreaterEqual', // >=

  // Logical
  And = 'And',             // &&
  Or = 'Or',               // ||
  Not = 'Not',             // !

  // Assignment
  Assign = 'Assign',       // =
  PlusAssign = 'PlusAssign',     // +=
  MinusAssign = 'MinusAssign',   // -=
  MultiplyAssign = 'MultiplyAssign', // *=
  DivideAssign = 'DivideAssign', // /=

  // Delimiters
  LeftParen = 'LeftParen',     // (
  RightParen = 'RightParen',   // )
  LeftBrace = 'LeftBrace',     // {
  RightBrace = 'RightBrace',   // }
  LeftBracket = 'LeftBracket', // [
  RightBracket = 'RightBracket', // ]

  // Punctuation
  Semicolon = 'Semicolon', // ;
  Comma = 'Comma',         // ,
  Dot = 'Dot',             // .
  Colon = 'Colon',         // :
  Arrow = 'Arrow',         // =>
  Pipeline = 'Pipeline',   // |>

  // Special
  Comment = 'Comment',
  Newline = 'Newline',
  Indent = 'Indent',
  Dedent = 'Dedent',
  EOF = 'EOF',

  // Decorators
  Decorator = 'Decorator', // @
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  position: number;
  length: number;
}

// ============================================
// FCS Keywords (matching FileCommander exactly)
// ============================================

export const FCS_KEYWORDS = new Set([
  // Control flow
  'if', 'else', 'elif', 'while', 'for', 'break', 'continue', 'return',
  'switch', 'case', 'default', 'do', 'until',

  // Declarations
  'let', 'const', 'var', 'func', 'function', 'class', 'struct', 'enum', 'namespace',

  // Types
  'int', 'float', 'string', 'bool', 'array', 'dict', 'set', 'any', 'void',

  // Values
  'true', 'false', 'null', 'undefined',

  // Operators
  'in', 'is', 'as', 'typeof', 'sizeof', 'new', 'delete',

  // Exception handling
  'try', 'catch', 'finally', 'throw',

  // Async
  'async', 'await', 'promise',

  // Import/Export
  'import', 'export', 'from',

  // Special
  'with', 'using', 'global', 'local', 'static', 'public', 'private', 'protected',

  // FileCommander specific
  'editor', 'file', 'panel', 'command', 'test', 'assert', 'expect',
  'select', 'cursor', 'view', 'window', 'dialog',

  // Note: 'codebuddy', 'ai', 'bash', 'shell', 'git', 'mcp', 'tool', 'context',
  // 'agent', 'session' are NOT keywords - they are builtin namespace objects
  // and should be tokenized as identifiers
]);

// ============================================
// AST Node Types
// ============================================

export interface AstNode {
  type: string;
  line?: number;
  column?: number;
}

// Program
export interface Program extends AstNode {
  type: 'Program';
  statements: AstNode[];
}

// Expressions
export interface LiteralExpr extends AstNode {
  type: 'Literal';
  value: unknown;
  tokenType: TokenType;
}

export interface IdentifierExpr extends AstNode {
  type: 'Identifier';
  name: string;
}

export interface BinaryExpr extends AstNode {
  type: 'Binary';
  left: AstNode;
  operator: TokenType;
  right: AstNode;
}

export interface UnaryExpr extends AstNode {
  type: 'Unary';
  operator: TokenType;
  operand: AstNode;
}

export interface AssignmentExpr extends AstNode {
  type: 'Assignment';
  target: AstNode;
  operator: TokenType;
  value: AstNode;
}

export interface CallExpr extends AstNode {
  type: 'Call';
  callee: AstNode;
  arguments: AstNode[];
  namedArgs?: Record<string, AstNode>;
}

export interface MemberExpr extends AstNode {
  type: 'Member';
  object: AstNode;
  member: string;
  computed: boolean;
}

export interface IndexExpr extends AstNode {
  type: 'Index';
  object: AstNode;
  index: AstNode;
}

export interface ArrayExpr extends AstNode {
  type: 'Array';
  elements: AstNode[];
}

export interface DictExpr extends AstNode {
  type: 'Dict';
  elements: Map<string, AstNode>;
}

export interface LambdaExpr extends AstNode {
  type: 'Lambda';
  parameters: string[];
  body: AstNode;
}

export interface InterpolationExpr extends AstNode {
  type: 'Interpolation';
  parts: AstNode[];
}

export interface PipelineExpr extends AstNode {
  type: 'Pipeline';
  left: AstNode;
  right: AstNode;
}

export interface TernaryExpr extends AstNode {
  type: 'Ternary';
  condition: AstNode;
  consequent: AstNode;
  alternate: AstNode;
}

// Statements
export interface BlockStmt extends AstNode {
  type: 'Block';
  statements: AstNode[];
}

export interface ExpressionStmt extends AstNode {
  type: 'ExpressionStmt';
  expression: AstNode;
}

export interface VarDeclaration extends AstNode {
  type: 'VarDeclaration';
  name: string;
  initializer: AstNode | null;
  isConst: boolean;
  varType?: string;
}

export interface FunctionDeclaration extends AstNode {
  type: 'FunctionDeclaration';
  name: string;
  parameters: Parameter[];
  body: BlockStmt;
  isAsync: boolean;
  returnType?: string;
}

export interface Parameter {
  name: string;
  type?: string;
  defaultValue?: AstNode;
}

export interface ClassDeclaration extends AstNode {
  type: 'ClassDeclaration';
  name: string;
  baseClass?: string;
  members: AstNode[];
}

export interface IfStmt extends AstNode {
  type: 'If';
  condition: AstNode;
  thenBranch: AstNode;
  elseBranch: AstNode | null;
}

export interface WhileStmt extends AstNode {
  type: 'While';
  condition: AstNode;
  body: AstNode;
}

export interface ForStmt extends AstNode {
  type: 'For';
  variable: string;
  iterable: AstNode;
  body: AstNode;
}

export interface ReturnStmt extends AstNode {
  type: 'Return';
  value: AstNode | null;
}

export interface BreakStmt extends AstNode {
  type: 'Break';
}

export interface ContinueStmt extends AstNode {
  type: 'Continue';
}

export interface TryStmt extends AstNode {
  type: 'Try';
  tryBlock: BlockStmt;
  catchClauses: CatchClause[];
  finallyBlock: BlockStmt | null;
}

export interface CatchClause {
  variable?: string;
  type?: string;
  body: BlockStmt;
}

export interface ThrowStmt extends AstNode {
  type: 'Throw';
  expression: AstNode;
}

export interface ImportStmt extends AstNode {
  type: 'Import';
  module: string;
  names: string[];
  alias?: string;
}

// FileCommander specific
export interface TestDeclaration extends AstNode {
  type: 'TestDeclaration';
  name: string;
  body: BlockStmt;
  tags: string[];
}

export interface AssertStmt extends AstNode {
  type: 'Assert';
  condition: AstNode;
  message?: string;
}

export interface EditorCommand extends AstNode {
  type: 'EditorCommand';
  command: string;
  arguments: AstNode[];
}

// ============================================
// Runtime Types
// ============================================

/**
 * Primitive types that can be stored in FCS variables
 */
export type FCSPrimitive = string | number | boolean | null | undefined;

/**
 * Function type for the FCS runtime.
 * Note: Uses flexible typing to support dynamic scripting scenarios.
 * Implementations should validate arguments at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for dynamic scripting runtime
export type FCSFunction = (...args: any[]) => any;

/**
 * Dynamic value type for the FCS runtime.
 * Uses a union of known types for better type safety.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for dynamic scripting where types are determined at runtime
export type FCSValue = FCSPrimitive | FCSFunction | Record<string, any> | any[];

export interface FCSContext {
  variables: Map<string, FCSValue>;
  functions: Map<string, FCSFunction>;
  parent?: FCSContext;
}

export interface FCSResult {
  success: boolean;
  output: string[];
  error?: string;
  returnValue?: FCSValue;
  duration: number;
}

export interface FCSConfig {
  workdir: string;
  timeout: number;
  enableAI: boolean;
  enableBash: boolean;
  enableFileOps: boolean;
  verbose: boolean;
  dryRun: boolean;
  variables?: Record<string, FCSValue>;
}

export const DEFAULT_FCS_CONFIG: FCSConfig = {
  workdir: process.cwd(),
  timeout: 300000,
  enableAI: true,
  enableBash: true,
  enableFileOps: true,
  verbose: false,
  dryRun: false,
};
