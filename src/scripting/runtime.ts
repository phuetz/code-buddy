/**
 * Unified Script Runtime
 *
 * Based on FCS runtime (class/test/assert/dict/lambda/interpolation/pipeline/ternary/index)
 * with Buddy Script additions:
 * - Async/await native support
 * - ForCStyle statement execution
 * - AwaitExpression handling
 * - Export statement handling
 * - Timeout enforcement per-statement
 * - ScriptResult with testResults tracking
 *
 * Extensions: .bs (primary), .fcs (backward-compatible alias)
 */

import {
  AstNode,
  Program,
  TokenType,
  RuntimeContext,
  CodeBuddyValue,
  CodeBuddyFunction,
  ScriptResult,
  CodeBuddyScriptConfig,
  DEFAULT_SCRIPT_CONFIG,
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
  TryStmt,
  ThrowStmt,
  ImportStmt,
  ExportStmt,
  TestDeclaration,
  AssertStmt,
} from './types.js';
import { createBuiltins } from './builtins.js';
import { createGrokBindings } from './codebuddy-bindings.js';

// Control flow signals
class ReturnSignal {
  constructor(public value: CodeBuddyValue) {}
}

class BreakSignal {}
class ContinueSignal {}

export class FCSRuntime {
  private config: CodeBuddyScriptConfig;
  private globalContext: RuntimeContext;
  private output: string[] = [];
  private startTime = 0;
  private testResults: { name: string; passed: boolean; error?: string }[] = [];

  constructor(config: Partial<CodeBuddyScriptConfig> = {}) {
    this.config = { ...DEFAULT_SCRIPT_CONFIG, ...config };
    this.globalContext = {
      variables: new Map(),
      functions: new Map(),
    };

    this.initializeBuiltins();
  }

  private initializeBuiltins(): void {
    const printFn = (msg: string) => {
      this.output.push(msg);
    };

    // Load unified builtins (merged FCS + BS)
    const builtins = createBuiltins(this.config, printFn);

    for (const [name, value] of Object.entries(builtins)) {
      this.globalContext.variables.set(name, value as CodeBuddyValue);
      if (typeof value === 'function') {
        this.globalContext.functions.set(name, value as CodeBuddyFunction);
      }
    }

    // Load codebuddy bindings (grok.*, tool.*, context.*, agent.*, mcp.*, git.*, session.*)
    const grokBindings = createGrokBindings(this.config as any, printFn);
    for (const [name, value] of Object.entries(grokBindings)) {
      this.globalContext.variables.set(name, value as CodeBuddyValue);
    }

    // Inject user variables
    if (this.config.variables) {
      for (const [name, value] of Object.entries(this.config.variables)) {
        this.globalContext.variables.set(name, value);
      }
    }
  }

  async execute(program: Program): Promise<ScriptResult> {
    this.startTime = Date.now();
    this.output = [];
    this.testResults = [];

    let returnValue: CodeBuddyValue = null;
    let error: string | undefined;

    try {
      for (const statement of (program.statements || program.body || [])) {
        const result = await this.executeNode(statement, this.globalContext);
        if (result instanceof ReturnSignal) {
          returnValue = result.value;
          break;
        }
      }
    } catch (err) {
      if (err instanceof ReturnSignal) {
        returnValue = err.value;
      } else {
        error = err instanceof Error ? err.message : String(err);
      }
    }

    const failedTests = this.testResults.filter(test => !test.passed);
    if (!error && failedTests.length > 0) {
      error = `${failedTests.length} FCS test(s) failed`;
    }

    return {
      success: !error,
      output: this.output,
      error,
      returnValue,
      duration: Date.now() - this.startTime,
      testResults: this.testResults.length > 0 ? this.testResults : undefined,
    };
  }

  // Normalize old Buddy Script AST nodes to FCS format
  private normalizeNode(node: AstNode): AstNode {
    const n = node as any;
    // Map old BS type names to FCS type names
    const typeMap: Record<string, string> = {
      'VariableDeclaration': 'VarDeclaration',
      'BlockStatement': 'Block',
      'IfStatement': 'If',
      'WhileStatement': 'While',
      'ForInStatement': 'For',
      'ReturnStatement': 'Return',
      'BreakStatement': 'Break',
      'ContinueStatement': 'Continue',
      'TryStatement': 'Try',
      'ThrowStatement': 'Throw',
      'ExpressionStatement': 'ExpressionStmt',
      'BinaryExpression': 'Binary',
      'UnaryExpression': 'Unary',
      'LogicalExpression': 'Binary',
      'AssignmentExpression': 'Assignment',
      'CallExpression': 'Call',
      'MemberExpression': 'Member',
      'ArrayExpression': 'Array',
      'ObjectExpression': 'Dict',
      'ConditionalExpression': 'Ternary',
      'ArrowFunctionExpression': 'Lambda',
      'ArrowFunction': 'Lambda',
      'AwaitExpression': 'Await',
    };
    if (n.type === 'ForStatement') {
      // Detect C-style vs for-in
      n.type = (n.init !== undefined || n.test !== undefined || n.update !== undefined) ? 'ForCStyle' : 'For';
    } else if (typeMap[n.type]) {
      n.type = typeMap[n.type];
    }
    // Map old BS field names to FCS field names
    if (n.type === 'VarDeclaration' && n.init !== undefined && n.initializer === undefined) {
      n.initializer = n.init;
      if (n.kind) n.isConst = n.kind === 'const';
    }
    if (n.type === 'Block' && n.body && !n.statements) {
      n.statements = n.body;
    }
    if (n.type === 'If') {
      if (n.test && !n.condition) n.condition = n.test;
      if (n.consequent && !n.thenBranch) n.thenBranch = n.consequent;
      if (n.alternate !== undefined && n.elseBranch === undefined) n.elseBranch = n.alternate;
      if (n.body && !n.thenBranch) n.thenBranch = n.body;
    }
    if (n.type === 'While' && n.test && !n.condition) {
      n.condition = n.test;
    }
    // Map For (for-in): old BS uses left/right, FCS uses variable/iterable
    if (n.type === 'For') {
      if (n.left && !n.variable) n.variable = typeof n.left === 'object' ? n.left.name : n.left;
      if (n.right && !n.iterable) n.iterable = n.right;
    }
    if (n.type === 'Try') {
      if (n.block && !n.tryBlock) n.tryBlock = n.block;
      if (n.handler && !n.catchClauses) {
        n.catchClauses = [{
          variable: n.handler.param || n.handler.variable,
          body: n.handler.body || n.handler,
        }];
      }
      if (n.finalizer && !n.finallyBlock) n.finallyBlock = n.finalizer;
    }
    if (n.type === 'Ternary') {
      if (n.test && !n.condition) n.condition = n.test;
    }
    if (n.type === 'Lambda' && n.params && !n.parameters) {
      n.parameters = n.params.map((p: any) => typeof p === 'string' ? p : p.name);
    }
    if (n.type === 'Return' && n.argument !== undefined && n.value === undefined) {
      n.value = n.argument;
    }
    if (n.type === 'Throw' && n.argument !== undefined && n.expression === undefined) {
      n.expression = n.argument;
    }
    // Map old-style operators ('+', '-', etc.) to TokenType names ('Plus', 'Minus', etc.)
    if ((n.type === 'Binary' || n.type === 'Unary' || n.type === 'Assignment') && n.operator) {
      const opMap: Record<string, string> = {
        '+': 'Plus', '-': 'Minus', '*': 'Multiply', '/': 'Divide', '%': 'Modulo', '**': 'Power',
        '==': 'Equal', '===': 'Equal', '!=': 'NotEqual', '!==': 'NotEqual', '<': 'Less', '>': 'Greater', '<=': 'LessEqual', '>=': 'GreaterEqual',
        '&&': 'And', '||': 'Or', '!': 'Not',
        '=': 'Assign', '+=': 'PlusAssign', '-=': 'MinusAssign', '*=': 'MultiplyAssign', '/=': 'DivideAssign',
      };
      if (opMap[n.operator]) n.operator = opMap[n.operator];
    }
    // Map Unary: old BS uses 'argument', FCS uses 'operand'
    if (n.type === 'Unary' && n.argument && !n.operand) {
      n.operand = n.argument;
    }
    // Map FunctionDeclaration: old BS uses 'params', FCS uses 'parameters'
    if (n.type === 'FunctionDeclaration' && n.params && !n.parameters) {
      n.parameters = n.params.map((p: any) => {
        if (typeof p === 'string') return { name: p };
        return { name: p.name, defaultValue: p.default || p.defaultValue };
      });
    }
    // Map Assignment fields: old BS uses left/right, FCS uses target/value
    if (n.type === 'Assignment') {
      if (n.left && !n.target) n.target = n.left;
      if (n.right !== undefined && n.value === undefined) n.value = n.right;
    }
    // Call: callee and arguments are the same in both formats
    // Map old 'object'/'property' to FCS 'object'/'member' for MemberExpression
    if (n.type === 'Member' && n.property !== undefined && n.member === undefined) {
      // Old BS property can be an AstNode (e.g., {type: 'Identifier', name: 'foo'}) or a string
      n.member = typeof n.property === 'object' ? (n.property.name || n.property.value) : n.property;
    }
    // Map 'elements' to 'elements' (same for arrays)
    // Map 'properties' to 'elements' Map for objects/dicts
    if (n.type === 'Dict' && n.properties && !(n.elements instanceof Map)) {
      const map = new Map();
      for (const p of n.properties) {
        const key = typeof p.key === 'object' ? (p.key.name || p.key.value) : p.key;
        map.set(String(key), p.value);
      }
      n.elements = map;
    }
    return n;
  }

  async executeNode(
    node: AstNode,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal | BreakSignal | ContinueSignal> {
    // Check timeout
    if (Date.now() - this.startTime > this.config.timeout) {
      throw new Error(`Script timeout after ${this.config.timeout}ms`);
    }

    // Normalize old BS AST format
    node = this.normalizeNode(node);

    switch (node.type) {
      // Declarations
      case 'VarDeclaration':
        return this.executeVarDeclaration(node as VarDeclaration, ctx);

      case 'FunctionDeclaration':
        return this.executeFunctionDeclaration(node as FunctionDeclaration, ctx);

      case 'ClassDeclaration':
        return this.executeClassDeclaration(node as ClassDeclaration, ctx);

      case 'TestDeclaration':
        return this.executeTestDeclaration(node as TestDeclaration, ctx);

      // Statements
      case 'Block':
        return this.executeBlock(node as BlockStmt, ctx);

      case 'ExpressionStmt':
        return this.evaluate((node as ExpressionStmt).expression, ctx);

      case 'If':
        return this.executeIfStatement(node as IfStmt, ctx);

      case 'While':
        return this.executeWhileStatement(node as WhileStmt, ctx);

      case 'For':
        return this.executeForStatement(node as ForStmt, ctx);

      case 'Repeat':
        return this.executeRepeatStatement(node as RepeatStmt, ctx);

      case 'ForCStyle':
        return this.executeForCStyleStatement(node as ForCStyleStmt, ctx);

      case 'Return':
        return this.executeReturnStatement(node as ReturnStmt, ctx);

      case 'Break':
        return new BreakSignal();

      case 'Continue':
        return new ContinueSignal();

      case 'Try':
        return this.executeTryStatement(node as TryStmt, ctx);

      case 'Throw':
        return this.executeThrowStatement(node as ThrowStmt, ctx);

      case 'Import':
        return this.executeImportStatement(node as ImportStmt, ctx);

      case 'Export':
        return this.executeExportStatement(node as ExportStmt, ctx);

      case 'Assert':
        return this.executeAssertStatement(node as AssertStmt, ctx);

      // Expressions (delegated to evaluate)
      default:
        return this.evaluate(node, ctx);
    }
  }

  // ============================================
  // Statement Execution
  // ============================================

  private async executeVarDeclaration(
    node: VarDeclaration,
    ctx: RuntimeContext
  ): Promise<null> {
    const value = node.initializer
      ? await this.evaluate(node.initializer, ctx)
      : null;
    ctx.variables.set(node.name, value);
    return null;
  }

  private async executeFunctionDeclaration(
    node: FunctionDeclaration,
    ctx: RuntimeContext
  ): Promise<null> {
    const fn: CodeBuddyFunction = async (...args: CodeBuddyValue[]) => {
      const localCtx: RuntimeContext = {
        variables: new Map(),
        functions: new Map(ctx.functions),
        parent: ctx,
      };

      // Bind parameters (with named args support)
      const lastArg = args.length > 0 ? args[args.length - 1] : null;
      const hasNamedArgs = lastArg !== null && typeof lastArg === 'object' && lastArg !== null && '__namedArgs' in (lastArg as object);
      const namedArgs = hasNamedArgs
        ? (args.pop() as { __namedArgs: Record<string, CodeBuddyValue> }).__namedArgs
        : {};

      for (let i = 0; i < node.parameters.length; i++) {
        const param = node.parameters[i];
        if (param === undefined) continue;
        let value: CodeBuddyValue;

        const namedValue = namedArgs[param.name];
        const positional = args[i];
        if (namedValue !== undefined) {
          value = namedValue;
        } else if (positional !== undefined) {
          value = positional;
        } else if (param.defaultValue) {
          value = await this.evaluate(param.defaultValue, ctx);
        } else {
          value = null;
        }

        localCtx.variables.set(param.name, value);
      }

      try {
        const result = await this.executeBlock(node.body, localCtx);
        if (result instanceof ReturnSignal) {
          return result.value;
        }
        return null;
      } catch (err) {
        if (err instanceof ReturnSignal) {
          return err.value;
        }
        throw err;
      }
    };

    ctx.functions.set(node.name, fn);
    ctx.variables.set(node.name, fn);
    return null;
  }

  private async executeClassDeclaration(
    node: ClassDeclaration,
    ctx: RuntimeContext
  ): Promise<null> {
    const classConstructor: CodeBuddyFunction = async (...args: CodeBuddyValue[]) => {
      const instance: Record<string, CodeBuddyValue> = {};

      for (const member of node.members) {
        if (member.type === 'VarDeclaration') {
          const varDecl = member as VarDeclaration;
          instance[varDecl.name] = varDecl.initializer
            ? await this.evaluate(varDecl.initializer, ctx)
            : null;
        } else if (member.type === 'FunctionDeclaration') {
          const fnDecl = member as FunctionDeclaration;
          instance[fnDecl.name] = async (...methodArgs: CodeBuddyValue[]) => {
            const methodCtx: RuntimeContext = {
              variables: new Map([['this', instance]]),
              functions: new Map(ctx.functions),
              parent: ctx,
            };

            for (let i = 0; i < fnDecl.parameters.length; i++) {
              const param = fnDecl.parameters[i];
              if (param === undefined) continue;
              methodCtx.variables.set(param.name, methodArgs[i]);
            }

            const result = await this.executeBlock(fnDecl.body, methodCtx);
            if (result instanceof ReturnSignal) {
              return result.value;
            }
            return null;
          };
        }
      }

      if (instance.constructor && typeof instance.constructor === 'function') {
        await instance.constructor(...args);
      }

      return instance;
    };

    ctx.variables.set(node.name, classConstructor);
    return null;
  }

  private async executeTestDeclaration(
    node: TestDeclaration,
    ctx: RuntimeContext
  ): Promise<null> {
    if (!this.config.runTests) {
      return null;
    }

    const localCtx: RuntimeContext = {
      variables: new Map(),
      functions: new Map(ctx.functions),
      parent: ctx,
    };

    try {
      await this.executeBlock(node.body, localCtx);
      this.testResults.push({ name: node.name, passed: true });
      if (this.config.verbose) {
        this.output.push(`PASS ${node.name}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.testResults.push({ name: node.name, passed: false, error: errorMsg });
      if (this.config.verbose) {
        this.output.push(`FAIL ${node.name}: ${errorMsg}`);
      }
    }

    return null;
  }

  private async executeBlock(
    node: BlockStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal | BreakSignal | ContinueSignal> {
    for (const stmt of (node.statements || (node as any).body || [])) {
      const result = await this.executeNode(stmt, ctx);
      if (
        result instanceof ReturnSignal ||
        result instanceof BreakSignal ||
        result instanceof ContinueSignal
      ) {
        return result;
      }
    }
    return null;
  }

  private async executeIfStatement(
    node: IfStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal | BreakSignal | ContinueSignal> {
    const condition = await this.evaluate(node.condition, ctx);

    if (this.isTruthy(condition)) {
      return this.executeNode(node.thenBranch, ctx);
    } else if (node.elseBranch) {
      return this.executeNode(node.elseBranch, ctx);
    }

    return null;
  }

  private async executeWhileStatement(
    node: WhileStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal> {
    let iterations = 0;
    const maxIterations = this.getMaxLoopIterations();
    while (this.isTruthy(await this.evaluate(node.condition, ctx))) {
      iterations++;
      if (iterations > maxIterations) {
        throw new Error(`Loop exceeded maxLoopIterations (${maxIterations})`);
      }

      const result = await this.executeNode(node.body, ctx);
      if (result instanceof ReturnSignal) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) continue;
    }
    return null;
  }

  private async executeForStatement(
    node: ForStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal> {
    const iterable = await this.evaluate(node.iterable, ctx);

    if (!Array.isArray(iterable) && typeof iterable !== 'object') {
      throw new Error('for-in requires an iterable (array or object)');
    }

    const items = Array.isArray(iterable)
      ? iterable
      : Object.entries(iterable as Record<string, CodeBuddyValue>);

    const localCtx: RuntimeContext = {
      variables: new Map(),
      functions: ctx.functions,
      parent: ctx,
    };

    let iterations = 0;
    const maxIterations = this.getMaxLoopIterations();
    for (const item of items) {
      iterations++;
      if (iterations > maxIterations) {
        throw new Error(`Loop exceeded maxLoopIterations (${maxIterations})`);
      }

      localCtx.variables.set(node.variable, item);

      const result = await this.executeNode(node.body, localCtx);
      if (result instanceof ReturnSignal) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) continue;
    }

    return null;
  }

  private async executeRepeatStatement(
    node: RepeatStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal> {
    const rawCount = await this.evaluate(node.count, ctx);
    const count = Math.max(0, Math.floor(Number(rawCount)));
    const maxIterations = this.getMaxLoopIterations();

    if (!Number.isFinite(count)) {
      throw new Error('repeat requires a finite numeric count');
    }

    if (count > maxIterations) {
      throw new Error(`repeat count exceeds maxLoopIterations (${maxIterations})`);
    }

    const localCtx: RuntimeContext = {
      variables: new Map(),
      functions: ctx.functions,
      parent: ctx,
    };

    for (let i = 0; i < count; i++) {
      localCtx.variables.set('i', i);
      localCtx.variables.set('_', i);

      const result = await this.executeNode(node.body, localCtx);
      if (result instanceof ReturnSignal) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) continue;
    }

    return null;
  }

  private async executeForCStyleStatement(
    node: ForCStyleStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal> {
    const localCtx: RuntimeContext = {
      variables: new Map(),
      functions: ctx.functions,
      parent: ctx,
    };

    // Execute init (normalize in case of old BS format)
    if (node.init) {
      const initNode = this.normalizeNode(node.init);
      if (initNode.type === 'VarDeclaration') {
        await this.executeVarDeclaration(initNode as VarDeclaration, localCtx);
      } else {
        await this.evaluate(initNode, localCtx);
      }
    }

    // Loop while test is true
    let iterations = 0;
    const maxIterations = this.getMaxLoopIterations();
    while (node.test === null || this.isTruthy(await this.evaluate(node.test, localCtx))) {
      iterations++;
      if (iterations > maxIterations) {
        throw new Error(`Loop exceeded maxLoopIterations (${maxIterations})`);
      }

      const result = await this.executeNode(node.body, localCtx);
      if (result instanceof ReturnSignal) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) {
        if (node.update) {
          await this.evaluate(node.update, localCtx);
        }
        continue;
      }

      if (node.update) {
        await this.evaluate(node.update, localCtx);
      }
    }

    return null;
  }

  private async executeReturnStatement(
    node: ReturnStmt,
    ctx: RuntimeContext
  ): Promise<ReturnSignal> {
    const value = node.value ? await this.evaluate(node.value, ctx) : null;
    return new ReturnSignal(value);
  }

  private async executeTryStatement(
    node: TryStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal> {
    try {
      return await this.executeBlock(node.tryBlock, ctx);
    } catch (err) {
      for (const clause of node.catchClauses) {
        const localCtx: RuntimeContext = {
          variables: new Map(ctx.variables),
          functions: ctx.functions,
          parent: ctx,
        };

        if (clause.variable) {
          const errorValue =
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : err;
          localCtx.variables.set(clause.variable, errorValue as CodeBuddyValue);
        }

        return this.executeBlock(clause.body, localCtx);
      }
      throw err;
    } finally {
      if (node.finallyBlock) {
        await this.executeBlock(node.finallyBlock, ctx);
      }
    }
  }

  private async executeThrowStatement(
    node: ThrowStmt,
    ctx: RuntimeContext
  ): Promise<never> {
    const value = await this.evaluate(node.expression, ctx);
    if (typeof value === 'string') {
      throw new Error(value);
    }
    throw value;
  }

  private async executeImportStatement(
    _node: ImportStmt,
    _ctx: RuntimeContext
  ): Promise<null> {
    // Imports are handled at initialization or by module system
    return null;
  }

  private async executeExportStatement(
    node: ExportStmt,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue | ReturnSignal | BreakSignal | ContinueSignal> {
    // Execute the declaration normally - exports don't change runtime behavior
    return this.executeNode(node.declaration, ctx);
  }

  private async executeAssertStatement(
    node: AssertStmt,
    ctx: RuntimeContext
  ): Promise<null> {
    const condition = await this.evaluate(node.condition, ctx);

    if (!this.isTruthy(condition)) {
      const message = node.message || 'Assertion failed';
      throw new Error(message);
    }

    return null;
  }

  // ============================================
  // Expression Evaluation
  // ============================================

  private async evaluate(node: AstNode, ctx: RuntimeContext): Promise<CodeBuddyValue> {
    node = this.normalizeNode(node);
    switch (node.type) {
      case 'Literal':
        return (node as LiteralExpr).value as CodeBuddyValue;

      case 'Identifier':
        return this.lookupVariable((node as IdentifierExpr).name, ctx);

      case 'Binary':
        return this.evaluateBinary(node as BinaryExpr, ctx);

      case 'Unary':
        return this.evaluateUnary(node as UnaryExpr, ctx);

      case 'Assignment':
        return this.evaluateAssignment(node as AssignmentExpr, ctx);

      case 'Call':
        return this.evaluateCall(node as CallExpr, ctx);

      case 'Member':
        return this.evaluateMember(node as MemberExpr, ctx);

      case 'Index':
        return this.evaluateIndex(node as IndexExpr, ctx);

      case 'Array':
        return this.evaluateArray(node as ArrayExpr, ctx);

      case 'Dict':
        return this.evaluateDict(node as DictExpr, ctx);

      case 'Lambda':
        return this.evaluateLambda(node as LambdaExpr, ctx);

      case 'Interpolation':
        return this.evaluateInterpolation(node as InterpolationExpr, ctx);

      case 'Ternary':
        return this.evaluateTernary(node as TernaryExpr, ctx);

      case 'Await':
        // Await just evaluates the argument (our runtime is already async)
        return this.evaluate((node as AwaitExpr).argument, ctx);

      default:
        throw new Error(`Unknown expression type: ${node.type}`);
    }
  }

  private lookupVariable(name: string, ctx: RuntimeContext): CodeBuddyValue {
    // Walk up scope chain checking variables first
    let current: RuntimeContext | undefined = ctx;
    while (current) {
      if (current.variables.has(name)) {
        return current.variables.get(name)!;
      }
      current = current.parent;
    }
    // Then check functions (builtins)
    if (ctx.functions.has(name)) {
      return ctx.functions.get(name)!;
    }
    throw new Error(`Undefined variable: ${name}`);
  }

  private setVariable(name: string, value: CodeBuddyValue, ctx: RuntimeContext): void {
    let current: RuntimeContext | undefined = ctx;
    while (current) {
      if (current.variables.has(name)) {
        current.variables.set(name, value);
        return;
      }
      current = current.parent;
    }
    ctx.variables.set(name, value);
  }

  private async evaluateBinary(
    node: BinaryExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    const left = await this.evaluate(node.left, ctx);
    const right = await this.evaluate(node.right, ctx);

    switch (node.operator) {
      case TokenType.Plus:
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right);
        }
        return (left as number) + (right as number);

      case TokenType.Minus:
        return (left as number) - (right as number);

      case TokenType.Multiply:
        if (typeof left === 'string' && typeof right === 'number') {
          return left.repeat(right);
        }
        return (left as number) * (right as number);

      case TokenType.Divide:
        return (left as number) / (right as number);

      case TokenType.Modulo:
        return (left as number) % (right as number);

      case TokenType.Power:
        return Math.pow(left as number, right as number);

      case TokenType.Equal:
        return left === right;

      case TokenType.NotEqual:
        return left !== right;

      case TokenType.Less:
        return (left as number) < (right as number);

      case TokenType.LessEqual:
        return (left as number) <= (right as number);

      case TokenType.Greater:
        return (left as number) > (right as number);

      case TokenType.GreaterEqual:
        return (left as number) >= (right as number);

      case TokenType.And:
        return this.isTruthy(left) && this.isTruthy(right);

      case TokenType.Or:
        return this.isTruthy(left) || this.isTruthy(right);

      default:
        throw new Error(`Unknown binary operator: ${node.operator}`);
    }
  }

  private async evaluateUnary(
    node: UnaryExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    const operand = await this.evaluate(node.operand, ctx);

    switch (node.operator) {
      case TokenType.Minus:
        return -(operand as number);

      case TokenType.Not:
        return !this.isTruthy(operand);

      default:
        throw new Error(`Unknown unary operator: ${node.operator}`);
    }
  }

  private async evaluateAssignment(
    node: AssignmentExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    let value = await this.evaluate(node.value, ctx);

    if (node.operator !== TokenType.Assign) {
      const current = await this.evaluate(node.target, ctx);

      switch (node.operator) {
        case TokenType.PlusAssign:
          if (typeof current === 'string' || typeof value === 'string') {
            value = String(current) + String(value);
          } else {
            value = (current as number) + (value as number);
          }
          break;

        case TokenType.MinusAssign:
          value = (current as number) - (value as number);
          break;

        case TokenType.MultiplyAssign:
          value = (current as number) * (value as number);
          break;

        case TokenType.DivideAssign:
          value = (current as number) / (value as number);
          break;
      }
    }

    if (node.target.type === 'Identifier') {
      this.setVariable((node.target as IdentifierExpr).name, value, ctx);
    } else if (node.target.type === 'Member') {
      const member = node.target as MemberExpr;
      const object = await this.evaluate(member.object, ctx);
      (object as Record<string, CodeBuddyValue>)[member.member] = value;
    } else if (node.target.type === 'Index') {
      const index = node.target as IndexExpr;
      const object = await this.evaluate(index.object, ctx);
      const key = await this.evaluate(index.index, ctx);
      (object as Record<string, CodeBuddyValue>)[key as string | number] = value;
    }

    return value;
  }

  private async evaluateCall(
    node: CallExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    if (
      node.callee.type === 'Identifier' &&
      (node.callee as IdentifierExpr).name === 'defined'
    ) {
      const firstArg = node.arguments[0];
      if (!firstArg || firstArg.type !== 'Literal') {
        throw new Error('defined() requires a string literal variable name');
      }

      return this.isDefined(String((firstArg as LiteralExpr).value), ctx);
    }

    const callee = await this.evaluate(node.callee, ctx);

    if (typeof callee !== 'function') {
      throw new Error(`${JSON.stringify(callee)} is not a function`);
    }

    const args: CodeBuddyValue[] = [];
    for (const arg of node.arguments) {
      args.push(await this.evaluate(arg, ctx));
    }

    // Handle named arguments
    if (node.namedArgs && Object.keys(node.namedArgs).length > 0) {
      const namedValues: Record<string, CodeBuddyValue> = {};
      for (const [name, expr] of Object.entries(node.namedArgs)) {
        namedValues[name] = await this.evaluate(expr, ctx);
      }
      args.push({ __namedArgs: namedValues } as CodeBuddyValue);
    }

    const result = callee(...args);
    return result instanceof Promise ? await result : result;
  }

  private async evaluateMember(
    node: MemberExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    const object = await this.evaluate(node.object, ctx);

    if (object === null || object === undefined) {
      throw new Error('Cannot read property of null or undefined');
    }

    const obj = object as Record<string, CodeBuddyValue>;
    const value = obj[node.member];

    if (typeof value === 'function') {
      return value.bind(obj);
    }

    return value;
  }

  private async evaluateIndex(
    node: IndexExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    const object = await this.evaluate(node.object, ctx);
    const index = await this.evaluate(node.index, ctx);

    if (object === null || object === undefined) {
      throw new Error('Cannot index null or undefined');
    }

    return (object as Record<string | number, CodeBuddyValue>)[index as string | number];
  }

  private async evaluateArray(
    node: ArrayExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue[]> {
    const elements: CodeBuddyValue[] = [];
    for (const element of node.elements) {
      elements.push(await this.evaluate(element, ctx));
    }
    return elements;
  }

  private async evaluateDict(
    node: DictExpr,
    ctx: RuntimeContext
  ): Promise<Record<string, CodeBuddyValue>> {
    const dict: Record<string, CodeBuddyValue> = Object.create(null);
    for (const [key, valueNode] of node.elements) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      dict[key] = await this.evaluate(valueNode, ctx);
    }
    return dict;
  }

  private evaluateLambda(node: LambdaExpr, ctx: RuntimeContext): CodeBuddyFunction {
    return async (...args: CodeBuddyValue[]): Promise<CodeBuddyValue> => {
      const localCtx: RuntimeContext = {
        variables: new Map(),
        functions: ctx.functions,
        parent: ctx,
      };

      for (let i = 0; i < node.parameters.length; i++) {
        const paramName = node.parameters[i];
        if (paramName === undefined) continue;
        localCtx.variables.set(paramName, args[i]);
      }

      if (node.body.type === 'Block') {
        const result = await this.executeBlock(node.body as BlockStmt, localCtx);
        if (result instanceof ReturnSignal) {
          return result.value;
        }
        return null;
      }

      return this.evaluate(node.body, localCtx);
    };
  }

  private async evaluateInterpolation(
    node: InterpolationExpr,
    ctx: RuntimeContext
  ): Promise<string> {
    let result = '';

    for (const part of node.parts) {
      const value = await this.evaluate(part, ctx);
      result += String(value);
    }

    return result;
  }

  private async evaluateTernary(
    node: TernaryExpr,
    ctx: RuntimeContext
  ): Promise<CodeBuddyValue> {
    const condition = await this.evaluate(node.condition, ctx);

    if (this.isTruthy(condition)) {
      return this.evaluate(node.consequent, ctx);
    }

    return this.evaluate(node.alternate, ctx);
  }

  // ============================================
  // Helpers
  // ============================================

  private isTruthy(value: CodeBuddyValue): boolean {
    if (value === null || value === undefined || value === false || value === 0 || value === '') {
      return false;
    }
    return true;
  }

  private isDefined(name: string, ctx: RuntimeContext): boolean {
    let current: RuntimeContext | undefined = ctx;
    while (current) {
      if (current.variables.has(name) || current.functions.has(name)) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private getMaxLoopIterations(): number {
    const configured = Math.floor(Number(this.config.maxLoopIterations));
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_SCRIPT_CONFIG.maxLoopIterations;
  }

  getTestResults(): { name: string; passed: boolean; error?: string }[] {
    return this.testResults;
  }

  getOutput(): string[] {
    return this.output;
  }
}

/** @deprecated Use FCSRuntime instead */
export const Runtime = FCSRuntime;

export function createRuntime(config: Partial<CodeBuddyScriptConfig> = {}): FCSRuntime {
  return new FCSRuntime(config);
}
