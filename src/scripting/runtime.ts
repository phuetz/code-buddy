/**
 * Grok Script Runtime
 *
 * Executes parsed AST nodes
 */

import {
  ProgramNode,
  StatementNode,
  ExpressionNode,
  GrokValue,
  RuntimeContext,
  GrokScriptConfig,
  DEFAULT_SCRIPT_CONFIG,
  GrokFunction,
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
  ExpressionStatement,
  Literal,
  Identifier,
  BinaryExpression,
  UnaryExpression,
  CallExpression,
  MemberExpression,
  ArrayExpression,
  ObjectExpression,
  AssignmentExpression,
  LogicalExpression,
  ConditionalExpression,
  AwaitExpression,
} from './types.js';
import { createBuiltins } from './builtins.js';

// Special return value for control flow
class ReturnValue {
  constructor(public value: GrokValue) {}
}

class BreakSignal {}
class ContinueSignal {}

export class Runtime {
  private config: GrokScriptConfig;
  private globalContext: RuntimeContext;
  private output: string[] = [];
  private startTime: number = 0;

  constructor(config: Partial<GrokScriptConfig> = {}) {
    this.config = { ...DEFAULT_SCRIPT_CONFIG, ...config };
    this.globalContext = {
      variables: new Map(),
      functions: new Map(),
    };

    // Initialize builtins
    this.initializeBuiltins();
  }

  private initializeBuiltins(): void {
    const builtins = createBuiltins(this.config, (msg: string) => {
      this.output.push(msg);
    });

    for (const [name, fn] of Object.entries(builtins)) {
      this.globalContext.functions.set(name, fn as GrokFunction);
    }

    // Inject user variables
    if (this.config.variables) {
      for (const [name, value] of Object.entries(this.config.variables)) {
        this.globalContext.variables.set(name, value);
      }
    }
  }

  async execute(program: ProgramNode): Promise<{ output: string[]; returnValue: GrokValue; duration: number }> {
    this.startTime = Date.now();
    this.output = [];

    let returnValue: GrokValue = null;

    try {
      for (const statement of program.body) {
        const result = await this.executeStatement(statement, this.globalContext);
        if (result instanceof ReturnValue) {
          returnValue = result.value;
          break;
        }
      }
    } catch (error) {
      if (error instanceof ReturnValue) {
        returnValue = error.value;
      } else {
        throw error;
      }
    }

    return {
      output: this.output,
      returnValue,
      duration: Date.now() - this.startTime,
    };
  }

  private async executeStatement(stmt: StatementNode, ctx: RuntimeContext): Promise<GrokValue | ReturnValue | BreakSignal | ContinueSignal> {
    // Check timeout
    if (Date.now() - this.startTime > this.config.timeout) {
      throw new Error(`Script timeout after ${this.config.timeout}ms`);
    }

    switch (stmt.type) {
      case 'VariableDeclaration':
        return this.executeVariableDeclaration(stmt, ctx);

      case 'FunctionDeclaration':
        return this.executeFunctionDeclaration(stmt, ctx);

      case 'ExpressionStatement':
        return this.evaluateExpression(stmt.expression, ctx);

      case 'IfStatement':
        return this.executeIfStatement(stmt, ctx);

      case 'WhileStatement':
        return this.executeWhileStatement(stmt, ctx);

      case 'ForStatement':
        return this.executeForStatement(stmt as ForStatement, ctx);

      case 'ForInStatement':
        return this.executeForInStatement(stmt, ctx);

      case 'ReturnStatement':
        return this.executeReturnStatement(stmt, ctx);

      case 'TryStatement':
        return this.executeTryStatement(stmt, ctx);

      case 'ThrowStatement':
        return this.executeThrowStatement(stmt, ctx);

      case 'BreakStatement':
        return new BreakSignal();

      case 'ContinueStatement':
        return new ContinueSignal();

      case 'BlockStatement':
        return this.executeBlock(stmt, ctx);

      case 'ImportStatement':
        // Imports are handled at initialization
        return null;

      default:
        throw new Error(`Unknown statement type: ${(stmt as StatementNode).type}`);
    }
  }

  private async executeVariableDeclaration(stmt: VariableDeclaration, ctx: RuntimeContext): Promise<null> {
    const value = stmt.init ? await this.evaluateExpression(stmt.init, ctx) : null;
    ctx.variables.set(stmt.name, value);
    return null;
  }

  private async executeFunctionDeclaration(stmt: FunctionDeclaration, ctx: RuntimeContext): Promise<null> {
    const fn: GrokFunction = async (...args: GrokValue[]) => {
      const localCtx: RuntimeContext = {
        variables: new Map(),
        functions: new Map(ctx.functions),
        parent: ctx,
      };

      // Bind parameters
      for (let i = 0; i < stmt.params.length; i++) {
        const param = stmt.params[i];
        const value = args[i] !== undefined ? args[i] : (param.defaultValue ? await this.evaluateExpression(param.defaultValue, ctx) : null);
        localCtx.variables.set(param.name, value);
      }

      try {
        const result = await this.executeBlock(stmt.body, localCtx);
        if (result instanceof ReturnValue) {
          return result.value;
        }
        return null;
      } catch (error) {
        if (error instanceof ReturnValue) {
          return error.value;
        }
        throw error;
      }
    };

    ctx.functions.set(stmt.name, fn);
    ctx.variables.set(stmt.name, fn);
    return null;
  }

  private async executeIfStatement(stmt: IfStatement, ctx: RuntimeContext): Promise<GrokValue | ReturnValue | BreakSignal | ContinueSignal> {
    const condition = await this.evaluateExpression(stmt.condition, ctx);

    if (this.isTruthy(condition)) {
      return this.executeBlock(stmt.consequent, ctx);
    } else if (stmt.alternate) {
      if (stmt.alternate.type === 'IfStatement') {
        return this.executeIfStatement(stmt.alternate, ctx);
      } else {
        return this.executeBlock(stmt.alternate, ctx);
      }
    }

    return null;
  }

  private async executeWhileStatement(stmt: WhileStatement, ctx: RuntimeContext): Promise<GrokValue | ReturnValue> {
    while (this.isTruthy(await this.evaluateExpression(stmt.condition, ctx))) {
      const result = await this.executeBlock(stmt.body, ctx);
      if (result instanceof ReturnValue) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) continue;
    }
    return null;
  }

  private async executeForStatement(stmt: ForStatement, ctx: RuntimeContext): Promise<GrokValue | ReturnValue> {
    // Create local context for loop-scoped variables (like the init var)
    // Use empty map - only loop variables go here, parent lookup for outer vars
    const localCtx: RuntimeContext = {
      variables: new Map(),
      functions: ctx.functions,
      parent: ctx,
    };

    // Execute init
    if (stmt.init) {
      if (stmt.init.type === 'VariableDeclaration') {
        await this.executeVariableDeclaration(stmt.init as VariableDeclaration, localCtx);
      } else {
        await this.evaluateExpression(stmt.init as ExpressionNode, localCtx);
      }
    }

    // Loop while test is true
    while (stmt.test === null || this.isTruthy(await this.evaluateExpression(stmt.test, localCtx))) {
      const result = await this.executeBlock(stmt.body, localCtx);
      if (result instanceof ReturnValue) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) {
        // Still run the update on continue
        if (stmt.update) {
          await this.evaluateExpression(stmt.update, localCtx);
        }
        continue;
      }

      // Execute update
      if (stmt.update) {
        await this.evaluateExpression(stmt.update, localCtx);
      }
    }

    return null;
  }

  private async executeForInStatement(stmt: ForInStatement, ctx: RuntimeContext): Promise<GrokValue | ReturnValue> {
    const iterable = await this.evaluateExpression(stmt.iterable, ctx);

    if (!Array.isArray(iterable) && typeof iterable !== 'object') {
      throw new Error('for-in requires an iterable (array or object)');
    }

    const items = Array.isArray(iterable) ? iterable : Object.entries(iterable as Record<string, GrokValue>);

    // Create local context with only the loop variable - parent lookup for outer vars
    const localCtx: RuntimeContext = {
      variables: new Map(),
      functions: ctx.functions,
      parent: ctx,
    };

    for (const item of items) {
      localCtx.variables.set(stmt.variable, item);

      const result = await this.executeBlock(stmt.body, localCtx);
      if (result instanceof ReturnValue) return result;
      if (result instanceof BreakSignal) break;
      if (result instanceof ContinueSignal) continue;
    }

    return null;
  }

  private async executeReturnStatement(stmt: ReturnStatement, ctx: RuntimeContext): Promise<ReturnValue> {
    const value = stmt.argument ? await this.evaluateExpression(stmt.argument, ctx) : null;
    return new ReturnValue(value);
  }

  private async executeTryStatement(stmt: TryStatement, ctx: RuntimeContext): Promise<GrokValue | ReturnValue> {
    try {
      return await this.executeBlock(stmt.block, ctx);
    } catch (error) {
      if (stmt.handler) {
        const localCtx: RuntimeContext = {
          variables: new Map(ctx.variables),
          functions: ctx.functions,
          parent: ctx,
        };

        const errorValue = error instanceof Error ? {
          message: error.message,
          stack: error.stack,
        } : error;

        localCtx.variables.set(stmt.handler.param, errorValue as GrokValue);
        return this.executeBlock(stmt.handler.body, localCtx);
      }
      throw error;
    }
  }

  private async executeThrowStatement(stmt: ThrowStatement, ctx: RuntimeContext): Promise<never> {
    const value = await this.evaluateExpression(stmt.argument, ctx);
    if (typeof value === 'string') {
      throw new Error(value);
    }
    throw value;
  }

  private async executeBlock(block: BlockStatement, ctx: RuntimeContext): Promise<GrokValue | ReturnValue | BreakSignal | ContinueSignal> {
    // Use the same context - don't create a new scope for blocks
    // New variables declared inside will still be added to this context
    // but assignments to existing variables will propagate up via setVariable
    for (const stmt of block.body) {
      const result = await this.executeStatement(stmt, ctx);
      if (result instanceof ReturnValue || result instanceof BreakSignal || result instanceof ContinueSignal) {
        return result;
      }
    }

    return null;
  }

  // ============================================
  // Expression Evaluation
  // ============================================

  private async evaluateExpression(expr: ExpressionNode, ctx: RuntimeContext): Promise<GrokValue> {
    switch (expr.type) {
      case 'Literal':
        return (expr as Literal).value;

      case 'Identifier':
        return this.lookupVariable((expr as Identifier).name, ctx);

      case 'BinaryExpression':
        return this.evaluateBinaryExpression(expr as BinaryExpression, ctx);

      case 'UnaryExpression':
        return this.evaluateUnaryExpression(expr as UnaryExpression, ctx);

      case 'LogicalExpression':
        return this.evaluateLogicalExpression(expr as LogicalExpression, ctx);

      case 'AssignmentExpression':
        return this.evaluateAssignmentExpression(expr as AssignmentExpression, ctx);

      case 'CallExpression':
        return this.evaluateCallExpression(expr as CallExpression, ctx);

      case 'MemberExpression':
        return this.evaluateMemberExpression(expr as MemberExpression, ctx);

      case 'ArrayExpression':
        return this.evaluateArrayExpression(expr as ArrayExpression, ctx);

      case 'ObjectExpression':
        return this.evaluateObjectExpression(expr as ObjectExpression, ctx);

      case 'ConditionalExpression':
        return this.evaluateConditionalExpression(expr as ConditionalExpression, ctx);

      case 'AwaitExpression':
        return this.evaluateExpression((expr as AwaitExpression).argument, ctx);

      case 'ArrowFunction':
        return this.createArrowFunction(expr, ctx);

      default:
        throw new Error(`Unknown expression type: ${(expr as ExpressionNode).type}`);
    }
  }

  private lookupVariable(name: string, ctx: RuntimeContext): GrokValue {
    if (ctx.variables.has(name)) {
      return ctx.variables.get(name)!;
    }
    if (ctx.functions.has(name)) {
      return ctx.functions.get(name)! as GrokValue;
    }
    if (ctx.parent) {
      return this.lookupVariable(name, ctx.parent);
    }
    throw new Error(`Undefined variable: ${name}`);
  }

  private async evaluateBinaryExpression(expr: BinaryExpression, ctx: RuntimeContext): Promise<GrokValue> {
    const left = await this.evaluateExpression(expr.left, ctx);
    const right = await this.evaluateExpression(expr.right, ctx);

    switch (expr.operator) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left) + String(right);
        }
        return (left as number) + (right as number);
      case '-': return (left as number) - (right as number);
      case '*':
        // Support string repetition: "x" * 3 = "xxx"
        if (typeof left === 'string' && typeof right === 'number') {
          return left.repeat(right);
        }
        return (left as number) * (right as number);
      case '/': return (left as number) / (right as number);
      case '%': return (left as number) % (right as number);
      case '**': return Math.pow(left as number, right as number);
      case '==':
      case '===': return left === right;
      case '!=':
      case '!==': return left !== right;
      case '<': return (left as number) < (right as number);
      case '<=': return (left as number) <= (right as number);
      case '>': return (left as number) > (right as number);
      case '>=': return (left as number) >= (right as number);
      default:
        throw new Error(`Unknown binary operator: ${expr.operator}`);
    }
  }

  private async evaluateUnaryExpression(expr: UnaryExpression, ctx: RuntimeContext): Promise<GrokValue> {
    const argument = await this.evaluateExpression(expr.argument, ctx);

    switch (expr.operator) {
      case '-': return -(argument as number);
      case '!': return !this.isTruthy(argument);
      default:
        throw new Error(`Unknown unary operator: ${expr.operator}`);
    }
  }

  private async evaluateLogicalExpression(expr: LogicalExpression, ctx: RuntimeContext): Promise<GrokValue> {
    const left = await this.evaluateExpression(expr.left, ctx);

    if (expr.operator === '&&') {
      if (!this.isTruthy(left)) return left;
      return this.evaluateExpression(expr.right, ctx);
    } else {
      if (this.isTruthy(left)) return left;
      return this.evaluateExpression(expr.right, ctx);
    }
  }

  private async evaluateAssignmentExpression(expr: AssignmentExpression, ctx: RuntimeContext): Promise<GrokValue> {
    let value = await this.evaluateExpression(expr.right, ctx);

    if (expr.operator === '+=') {
      const current = await this.evaluateExpression(expr.left, ctx);
      if (typeof current === 'string' || typeof value === 'string') {
        value = String(current) + String(value);
      } else {
        value = (current as number) + (value as number);
      }
    } else if (expr.operator === '-=') {
      const current = await this.evaluateExpression(expr.left, ctx);
      value = (current as number) - (value as number);
    }

    if (expr.left.type === 'Identifier') {
      this.setVariable((expr.left as Identifier).name, value, ctx);
    } else if (expr.left.type === 'MemberExpression') {
      const member = expr.left as MemberExpression;
      const object = await this.evaluateExpression(member.object, ctx);
      const property = member.computed
        ? await this.evaluateExpression(member.property, ctx)
        : (member.property as Identifier).name;

      (object as Record<string, GrokValue>)[property as string] = value;
    }

    return value;
  }

  private setVariable(name: string, value: GrokValue, ctx: RuntimeContext): void {
    // Find where the variable is defined
    let current: RuntimeContext | undefined = ctx;
    while (current) {
      if (current.variables.has(name)) {
        current.variables.set(name, value);
        return;
      }
      current = current.parent;
    }
    // If not found, create in current context
    ctx.variables.set(name, value);
  }

  private async evaluateCallExpression(expr: CallExpression, ctx: RuntimeContext): Promise<GrokValue> {
    const callee = await this.evaluateExpression(expr.callee, ctx);

    if (typeof callee !== 'function') {
      throw new Error(`${JSON.stringify(callee)} is not a function`);
    }

    const args: GrokValue[] = [];
    for (const arg of expr.arguments) {
      args.push(await this.evaluateExpression(arg, ctx));
    }

    return callee(...args);
  }

  private async evaluateMemberExpression(expr: MemberExpression, ctx: RuntimeContext): Promise<GrokValue> {
    const object = await this.evaluateExpression(expr.object, ctx);

    if (object === null || object === undefined) {
      throw new Error('Cannot read property of null or undefined');
    }

    const property = expr.computed
      ? await this.evaluateExpression(expr.property, ctx)
      : (expr.property as Identifier).name;

    const obj = object as Record<string, GrokValue>;
    const value = obj[property as string];

    // Bind methods
    if (typeof value === 'function') {
      return value.bind(obj);
    }

    return value;
  }

  private async evaluateArrayExpression(expr: ArrayExpression, ctx: RuntimeContext): Promise<GrokValue[]> {
    const elements: GrokValue[] = [];
    for (const element of expr.elements) {
      elements.push(await this.evaluateExpression(element, ctx));
    }
    return elements;
  }

  private async evaluateObjectExpression(expr: ObjectExpression, ctx: RuntimeContext): Promise<Record<string, GrokValue>> {
    const obj: Record<string, GrokValue> = {};
    for (const prop of expr.properties) {
      const key = typeof prop.key === 'string'
        ? prop.key
        : await this.evaluateExpression(prop.key as ExpressionNode, ctx);
      obj[key as string] = await this.evaluateExpression(prop.value, ctx);
    }
    return obj;
  }

  private async evaluateConditionalExpression(expr: ConditionalExpression, ctx: RuntimeContext): Promise<GrokValue> {
    const test = await this.evaluateExpression(expr.test, ctx);
    if (this.isTruthy(test)) {
      return this.evaluateExpression(expr.consequent, ctx);
    }
    return this.evaluateExpression(expr.alternate, ctx);
  }

  private createArrowFunction(expr: ExpressionNode, ctx: RuntimeContext): GrokFunction {
    const arrow = expr as import('./types.js').ArrowFunction;

    return async (...args: GrokValue[]): Promise<GrokValue> => {
      const localCtx: RuntimeContext = {
        variables: new Map(ctx.variables),
        functions: ctx.functions,
        parent: ctx,
      };

      for (let i = 0; i < arrow.params.length; i++) {
        localCtx.variables.set(arrow.params[i].name, args[i]);
      }

      if (arrow.body.type === 'BlockStatement') {
        const result = await this.executeBlock(arrow.body as BlockStatement, localCtx);
        if (result instanceof ReturnValue) {
          return result.value;
        }
        return null;
      }

      return this.evaluateExpression(arrow.body as ExpressionNode, localCtx);
    };
  }

  private isTruthy(value: GrokValue): boolean {
    if (value === null || value === undefined || value === false || value === 0 || value === '') {
      return false;
    }
    return true;
  }
}
