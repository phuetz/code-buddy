/**
 * Unified Script Types
 *
 * Merged from FileCommander Script (FCS) and Buddy Script
 * FCS lexer/parser types as the superset, plus Buddy Script runtime types
 *
 * Extensions: .bs (primary), .fcs (backward-compatible alias)
 */

// ============================================
// Token Types (FCS superset)
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
  Question = 'Question',   // ? (from Buddy Script - separate from Colon)
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
// Keywords (FCS superset + Buddy Script additions)
// ============================================

export const FCS_KEYWORDS = new Set([
  // Control flow
  'if', 'else', 'elif', 'while', 'for', 'break', 'continue', 'return',
  'switch', 'case', 'default', 'do', 'until',

  // Declarations
  'let', 'const', 'var', 'def', 'func', 'function', 'class', 'struct', 'enum', 'namespace',

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
  'editor', 'file', 'panel', 'command', 'test', 'assert', 'expect', 'repeat',
  'select', 'cursor', 'view', 'window', 'dialog',
]);

// ============================================
// AST Node Types (FCS superset + BS additions)
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
  /** @deprecated Use statements instead */
  body?: AstNode[];
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

// From Buddy Script: AwaitExpression
export interface AwaitExpr extends AstNode {
  type: 'Await';
  argument: AstNode;
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

export interface RepeatStmt extends AstNode {
  type: 'Repeat';
  count: AstNode;
  body: AstNode;
}

// From Buddy Script: C-style for loop
export interface ForCStyleStmt extends AstNode {
  type: 'ForCStyle';
  init: AstNode | null;
  test: AstNode | null;
  update: AstNode | null;
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

// From Buddy Script: export keyword
export interface ExportStmt extends AstNode {
  type: 'Export';
  declaration: AstNode;
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
// Runtime Types (unified)
// ============================================

/**
 * Primitive types that can be stored in script variables
 */
export type CodeBuddyPrimitive = string | number | boolean | null | undefined;

/**
 * Function type for the scripting runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for dynamic scripting runtime
export type CodeBuddyFunction = (...args: CodeBuddyValue[]) => CodeBuddyValue | Promise<CodeBuddyValue> | any;

/**
 * Object type for scripting runtime values
 */
export type CodeBuddyObject = { [key: string]: CodeBuddyValue };

/**
 * Array type for scripting runtime values
 */
export type CodeBuddyArray = CodeBuddyValue[];

/**
 * Dynamic value type for the scripting runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for dynamic scripting where types are determined at runtime
export type CodeBuddyValue = CodeBuddyPrimitive | CodeBuddyFunction | CodeBuddyObject | CodeBuddyArray | any;

/**
 * Promise wrapping a scripting value
 */
export type CodeBuddyPromise = Promise<CodeBuddyValue>;

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
  testResults?: { name: string; passed: boolean; error?: string }[];
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
  /** Execute test blocks. Defaults to true for FCS suite automation. */
  runTests: boolean;
  /** Maximum iterations for loops/range expansion. Defaults to 10000. */
  maxLoopIterations: number;
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
  runTests: true,
  maxLoopIterations: 10000,
};

// ============================================
// Backward-compatible aliases for FCS
// ============================================

/** @deprecated Use CodeBuddyScriptConfig instead */
export type FCSConfig = CodeBuddyScriptConfig;
/** @deprecated Use CodeBuddyValue instead */
export type FCSValue = CodeBuddyValue;
/** @deprecated Use CodeBuddyFunction instead */
export type FCSFunction = CodeBuddyFunction;
/** @deprecated Use CodeBuddyPrimitive instead */
export type FCSPrimitive = CodeBuddyPrimitive;
/** @deprecated Use CodeBuddyObject instead */
export type FCSObject = CodeBuddyObject;
/** @deprecated Use CodeBuddyArray instead */
export type FCSArray = CodeBuddyArray;
/** @deprecated Use RuntimeContext instead */
export type FCSContext = RuntimeContext;
/** @deprecated Use ScriptResult instead */
export type FCSResult = ScriptResult;
/** @deprecated Use DEFAULT_SCRIPT_CONFIG instead */
export const DEFAULT_FCS_CONFIG = DEFAULT_SCRIPT_CONFIG;

// Backward-compatible aliases for Buddy Script types
// (for tests that use the old BS AST names)

/** @deprecated Use Program instead */
export type ProgramNode = Program;

// Backward-compatible aliases for old Buddy Script AST names
/** @deprecated Use BlockStmt instead */
export type BlockStatement = BlockStmt;
/** @deprecated Use VarDeclaration instead */
export type VariableDeclaration = VarDeclaration;
/** @deprecated Use IfStmt instead */
export type IfStatement = IfStmt;
/** @deprecated Use WhileStmt instead */
export type WhileStatement = WhileStmt;
/** @deprecated Use ForStmt instead */
export type ForStatement = ForStmt;
/** @deprecated Use ForStmt instead */
export type ForInStatement = ForStmt;
/** @deprecated Use ReturnStmt instead */
export type ReturnStatement = ReturnStmt;
/** @deprecated Use TryStmt instead */
export type TryStatement = TryStmt;
/** @deprecated Use ThrowStmt instead */
export type ThrowStatement = ThrowStmt;
/** @deprecated Use ExpressionStmt instead */
export type ExpressionStatement = ExpressionStmt;
/** @deprecated Use LiteralExpr instead */
export type Literal = LiteralExpr;
/** @deprecated Use IdentifierExpr instead */
export type Identifier = IdentifierExpr;
/** @deprecated Use BinaryExpr instead */
export type BinaryExpression = BinaryExpr;
/** @deprecated Use UnaryExpr instead */
export type UnaryExpression = UnaryExpr;
/** @deprecated Use AssignmentExpr instead */
export type AssignmentExpression = AssignmentExpr;
/** @deprecated Use CallExpr instead */
export type CallExpression = CallExpr;
/** @deprecated Use MemberExpr instead */
export type MemberExpression = MemberExpr;
/** @deprecated Use ArrayExpr instead */
export type ArrayExpression = ArrayExpr;
/** @deprecated Use DictExpr instead */
export type ObjectExpression = DictExpr;
/** @deprecated Use TernaryExpr instead */
export type ConditionalExpression = TernaryExpr;
/** @deprecated Use LambdaExpr instead */
export type ArrowFunction = LambdaExpr;
/** @deprecated Use AssignmentExpr instead */
export type LogicalExpression = AssignmentExpr;
/** @deprecated Use AwaitExpr instead */
export type AwaitExpression = AwaitExpr;
