// @ts-nocheck
/**
 * Path Engine
 * Core execution engine for path building and workflow branching
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type { UnknownRecord } from '../../type-mocks';
import type {
  PathBuilderConfig,
  PathNode,
  PathConnection,
  Variable,
  Condition,
  Action,
  SwitchCase,
  RetryConfig,
  NodeMetrics,
  ValidationState,
  ValidationError,
  ValidationWarning,
  ExecutionState,
  TestScenario,
  SimulationResult,
  Assertion,
  AssertionResult,
  PathCoverage,
} from './types';

export class PathEngine extends EventEmitter {
  private nodes: Map<string, PathNode> = new Map();
  private connections: Map<string, PathConnection> = new Map();
  private variables: Map<string, Variable> = new Map();
  private executionContext: Map<string, unknown> = new Map();
  private executionStack: string[] = [];
  private metrics: Map<string, NodeMetrics> = new Map();

  constructor(private config: PathBuilderConfig) {
    super();
    this.initialize();
  }

  private initialize(): void {
    this.config.nodes.forEach(node => this.nodes.set(node.id, node));
    this.config.connections.forEach(conn => this.connections.set(conn.id, conn));
    this.config.variables.forEach(variable => this.variables.set(variable.name, variable));
  }

  // ============================================================================
  // EXECUTION
  // ============================================================================

  public async execute(input: UnknownRecord): Promise<unknown> {
    this.executionContext.clear();
    this.executionStack = [];

    this.setVariable('$input', input);
    this.setVariable('$timestamp', new Date());

    const startNodes = this.findStartNodes();
    if (startNodes.length === 0) {
      throw new Error('No start nodes found');
    }

    const results = await Promise.all(
      startNodes.map(node => this.executeNode(node.id, input))
    );

    return this.mergeResults(results);
  }

  private async executeNode(nodeId: string, input: unknown): Promise<unknown> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    if (this.executionStack.includes(nodeId)) {
      throw new Error(`Circular dependency detected at node ${nodeId}`);
    }

    this.executionStack.push(nodeId);
    this.emit('nodeExecutionStart', { nodeId, input });

    try {
      let result: unknown;

      switch (node.type) {
        case 'condition':
          result = await this.executeCondition(node, input);
          break;
        case 'action':
          result = await this.executeAction(node, input);
          break;
        case 'merge':
          result = await this.executeMerge(node, input);
          break;
        case 'split':
          result = await this.executeSplit(node, input);
          break;
        case 'loop':
          result = await this.executeLoop(node, input);
          break;
        case 'switch':
          result = await this.executeSwitch(node, input);
          break;
        default:
          throw new Error(`Unknown node type: ${node.type}`);
      }

      this.updateMetrics(nodeId, true);

      const nextConnections = this.getOutgoingConnections(nodeId);
      if (nextConnections.length > 0) {
        const nextResults = await Promise.all(
          nextConnections.map(conn => this.executeNode(conn.target, result))
        );
        result = this.mergeResults(nextResults);
      }

      this.executionStack.pop();
      this.emit('nodeExecutionComplete', { nodeId, result });

      return result;
    } catch (error) {
      this.updateMetrics(nodeId, false);
      this.executionStack.pop();
      this.emit('nodeExecutionError', { nodeId, error });

      const errorHandling = node.data.errorHandling;
      if (errorHandling) {
        return this.handleError(node, error as Error, input);
      }

      throw error;
    }
  }

  private async executeCondition(node: PathNode, input: unknown): Promise<unknown> {
    const conditions = node.data.conditions || [];
    const result = this.evaluateConditions(conditions, input);

    const connections = this.getOutgoingConnections(node.id);
    const targetConnection = connections.find(conn =>
      conn.type === (result ? 'success' : 'error')
    );

    if (targetConnection) {
      return this.executeNode(targetConnection.target, input);
    }

    return input;
  }

  public evaluateConditions(conditions: Condition[], data: unknown): boolean {
    if (conditions.length === 0) return true;

    const groups = this.groupConditions(conditions);

    return Object.entries(groups).every(([_groupId, groupConditions]) => {
      const logic = groupConditions[0].logic || 'and';

      if (logic === 'and') {
        return groupConditions.every(cond => this.evaluateCondition(cond, data));
      } else {
        return groupConditions.some(cond => this.evaluateCondition(cond, data));
      }
    });
  }

  private groupConditions(conditions: Condition[]): Record<string, Condition[]> {
    const groups: Record<string, Condition[]> = {};

    conditions.forEach(condition => {
      const groupId = condition.group || 'default';
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(condition);
    });

    return groups;
  }

  public evaluateCondition(condition: Condition, data: unknown): boolean {
    const value = this.getValueByPath(data, condition.field);
    const expected = condition.value;
    let result = false;

    switch (condition.operator) {
      case 'equals':
        result = value === expected;
        break;
      case 'not_equals':
        result = value !== expected;
        break;
      case 'contains':
        result = String(value).includes(String(expected));
        break;
      case 'not_contains':
        result = !String(value).includes(String(expected));
        break;
      case 'starts_with':
        result = String(value).startsWith(String(expected));
        break;
      case 'ends_with':
        result = String(value).endsWith(String(expected));
        break;
      case 'greater_than':
        result = Number(value) > Number(expected);
        break;
      case 'less_than':
        result = Number(value) < Number(expected);
        break;
      case 'greater_or_equal':
        result = Number(value) >= Number(expected);
        break;
      case 'less_or_equal':
        result = Number(value) <= Number(expected);
        break;
      case 'between': {
        const expectedArray = Array.isArray(expected) ? expected : [expected];
        const [min, max] = expectedArray;
        result = Number(value) >= Number(min) && Number(value) <= Number(max);
        break;
      }
      case 'in':
        result = Array.isArray(expected) && expected.includes(value);
        break;
      case 'not_in':
        result = Array.isArray(expected) && !expected.includes(value);
        break;
      case 'is_empty':
        result = !value || (Array.isArray(value) && value.length === 0) ||
          (typeof value === 'object' && value !== null && Object.keys(value).length === 0);
        break;
      case 'is_not_empty':
        result = !!value && (!Array.isArray(value) || value.length > 0) &&
          (typeof value !== 'object' || (value !== null && Object.keys(value).length > 0));
        break;
      case 'is_null':
        result = value === null || value === undefined;
        break;
      case 'is_not_null':
        result = value !== null && value !== undefined;
        break;
      case 'matches_regex':
        result = new RegExp(String(expected)).test(String(value));
        break;
      case 'is_true':
        result = value === true;
        break;
      case 'is_false':
        result = value === false;
        break;
      case 'before':
        result = new Date(value as string | number | Date) < new Date(expected as string | number | Date);
        break;
      case 'after':
        result = new Date(value as string | number | Date) > new Date(expected as string | number | Date);
        break;
      default:
        result = false;
    }

    return condition.negate ? !result : result;
  }

  private async executeAction(node: PathNode, input: unknown): Promise<unknown> {
    const actions = node.data.actions || [];
    let result = input;

    for (const action of actions) {
      try {
        result = await this.performAction(action, result);

        if (action.outputVariable) {
          this.setVariable(action.outputVariable, result);
        }
      } catch (error) {
        if (!action.continueOnError) {
          throw error;
        }
      }
    }

    return result;
  }

  private async performAction(action: Action, input: unknown): Promise<unknown> {
    switch (action.type) {
      case 'set_variable':
        return this.actionSetVariable(action.config, input);
      case 'transform_data':
        return this.actionTransformData(action.config, input);
      case 'api_call':
        return this.actionApiCall(action.config, input);
      case 'delay':
        return this.actionDelay(action.config, input);
      case 'run_script':
        return this.actionRunScript(action.config, input);
      default:
        return input;
    }
  }

  private actionSetVariable(config: Record<string, unknown>, input: unknown): unknown {
    const { name, value, expression } = config as { name: string; value?: unknown; expression?: string };

    if (expression) {
      const evaluatedValue = this.evaluateExpression(expression, input);
      this.setVariable(name, evaluatedValue);
      return evaluatedValue;
    }

    this.setVariable(name, value);
    return value;
  }

  private actionTransformData(config: Record<string, unknown>, input: unknown): unknown {
    const { mapping } = config as { mapping?: Record<string, string> };

    if (mapping) {
      const result: Record<string, unknown> = {};
      for (const [key, path] of Object.entries(mapping)) {
        result[key] = this.getValueByPath(input, path);
      }
      return result;
    }

    return input;
  }

  private async actionApiCall(_config: Record<string, unknown>, input: unknown): Promise<unknown> {
    // Simulated API call
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({ success: true, data: input });
      }, 100);
    });
  }

  private async actionDelay(config: Record<string, unknown>, input: unknown): Promise<unknown> {
    const { duration } = config as { duration: number };

    return new Promise(resolve => {
      setTimeout(() => resolve(input), duration);
    });
  }

  private actionRunScript(_config: Record<string, unknown>, input: unknown): unknown {
    // Safe script execution would go here
    return input;
  }

  private async executeMerge(node: PathNode, input: unknown): Promise<unknown> {
    const strategy = node.data.mergeStrategy || { type: 'wait_all' };
    const incomingConnections = this.getIncomingConnections(node.id);

    if (incomingConnections.length === 0) {
      return input;
    }

    switch (strategy.type) {
      case 'wait_all':
      case 'wait_any':
      case 'wait_n':
      default:
        return input;
    }
  }

  private async executeSplit(node: PathNode, input: unknown): Promise<unknown> {
    const strategy = node.data.splitStrategy || { type: 'parallel' };
    const outgoingConnections = this.getOutgoingConnections(node.id);

    if (outgoingConnections.length === 0) {
      return input;
    }

    switch (strategy.type) {
      case 'parallel': {
        const results = await Promise.all(
          outgoingConnections.map(conn => this.executeNode(conn.target, input))
        );
        return this.mergeResults(results);
      }

      case 'sequential': {
        let result = input;
        for (const conn of outgoingConnections) {
          result = await this.executeNode(conn.target, result);
        }
        return result;
      }

      case 'conditional': {
        for (const conn of outgoingConnections) {
          if (conn.condition && this.evaluateCondition(conn.condition, input)) {
            return this.executeNode(conn.target, input);
          }
        }
        return input;
      }

      default:
        return input;
    }
  }

  private async executeLoop(node: PathNode, input: unknown): Promise<unknown> {
    const config = node.data.loopConfig || { type: 'for_each' };
    const results: unknown[] = [];

    switch (config.type) {
      case 'for_each': {
        const items = this.getValueByPath(input, config.source || '');
        if (Array.isArray(items)) {
          for (let i = 0; i < items.length; i++) {
            if (config.maxIterations && i >= config.maxIterations) break;

            this.setVariable(config.iteratorVariable || '$item', items[i]);
            this.setVariable('$index', i);

            const result = await this.executeLoopBody(node, items[i]);
            results.push(result);

            if (config.breakCondition &&
              this.evaluateCondition(config.breakCondition, result)) {
              break;
            }
          }
        }
        break;
      }

      case 'while': {
        let iteration = 0;
        while (config.condition &&
          this.evaluateCondition(config.condition, input) &&
          (!config.maxIterations || iteration < config.maxIterations)) {
          const result = await this.executeLoopBody(node, input);
          results.push(result);
          iteration++;
        }
        break;
      }

      case 'for': {
        const max = config.maxIterations || 10;
        for (let i = 0; i < max; i++) {
          this.setVariable(config.iteratorVariable || '$i', i);
          const result = await this.executeLoopBody(node, input);
          results.push(result);
        }
        break;
      }
    }

    return results;
  }

  private async executeLoopBody(node: PathNode, input: unknown): Promise<unknown> {
    const connections = this.getOutgoingConnections(node.id);
    if (connections.length > 0) {
      return this.executeNode(connections[0].target, input);
    }
    return input;
  }

  private async executeSwitch(node: PathNode, input: unknown): Promise<unknown> {
    const config = node.data.switchConfig;
    if (!config) return input;

    const expression = this.evaluateExpression(config.expression, input);

    for (const switchCase of config.cases) {
      if (this.matchSwitchCase(expression, switchCase)) {
        return this.executeNode(switchCase.path.id, input);
      }
    }

    if (config.defaultCase) {
      return this.executeNode(config.defaultCase.id, input);
    }

    return input;
  }

  private matchSwitchCase(value: unknown, switchCase: SwitchCase): boolean {
    const condition: Condition = {
      id: crypto.randomBytes(16).toString('hex'),
      field: '',
      operator: switchCase.operator || 'equals',
      value: switchCase.value,
      dataType: 'any'
    };

    return this.evaluateCondition(condition, value);
  }

  private async handleError(
    node: PathNode,
    error: Error,
    input: unknown
  ): Promise<unknown> {
    const errorHandling = node.data.errorHandling;
    if (!errorHandling) throw error;

    switch (errorHandling.strategy) {
      case 'retry':
        return this.retryExecution(node, input, errorHandling.retryConfig);

      case 'fallback':
        if (errorHandling.fallbackPath) {
          return this.executeNode(errorHandling.fallbackPath, input);
        }
        return null;

      case 'skip':
        return input;

      case 'compensate':
        if (errorHandling.compensationPath) {
          await this.executeNode(errorHandling.compensationPath, input);
        }
        throw error;

      default:
        throw error;
    }
  }

  private async retryExecution(
    node: PathNode,
    input: unknown,
    config?: RetryConfig
  ): Promise<unknown> {
    const maxAttempts = config?.maxAttempts || 3;
    const delay = config?.delay || 1000;
    const backoffMultiplier = config?.backoffMultiplier || 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.executeNode(node.id, input);
      } catch (error) {
        if (attempt === maxAttempts) throw error;

        const waitTime = delay * Math.pow(backoffMultiplier, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    throw new Error('Max retry attempts exceeded');
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private findStartNodes(): PathNode[] {
    const targetNodeIds = new Set(
      Array.from(this.connections.values()).map(conn => conn.target)
    );

    return Array.from(this.nodes.values()).filter(
      node => !targetNodeIds.has(node.id)
    );
  }

  public getOutgoingConnections(nodeId: string): PathConnection[] {
    return Array.from(this.connections.values()).filter(
      conn => conn.source === nodeId
    );
  }

  public getIncomingConnections(nodeId: string): PathConnection[] {
    return Array.from(this.connections.values()).filter(
      conn => conn.target === nodeId
    );
  }

  public getValueByPath(obj: unknown, path: string): unknown {
    if (!path) return obj;

    return path.split('.').reduce((current: unknown, part: string) => {
      if (current === null || current === undefined) return undefined;

      if (part.includes('[') && part.includes(']')) {
        const arrayPart = part.substring(0, part.indexOf('['));
        const index = parseInt(part.substring(part.indexOf('[') + 1, part.indexOf(']')));
        return (current as Record<string, unknown[]>)?.[arrayPart]?.[index];
      }
      return (current as Record<string, unknown>)?.[part];
    }, obj);
  }

  private setVariable(name: string, value: unknown): void {
    const variable = this.variables.get(name) || {
      name,
      type: 'any' as const,
      value,
      scope: 'local' as const
    };

    variable.value = value;
    this.variables.set(name, variable);
    this.executionContext.set(name, value);
  }

  private evaluateExpression(expression: string, _context: unknown): unknown {
    // Safe expression evaluation
    return expression;
  }

  private mergeResults(results: unknown[]): unknown {
    if (results.length === 0) return null;
    if (results.length === 1) return results[0];

    if (results.every(r => Array.isArray(r))) {
      return (results as unknown[][]).flat();
    }

    if (results.every(r => typeof r === 'object' && r !== null)) {
      return Object.assign({}, ...results);
    }

    return results;
  }

  private updateMetrics(nodeId: string, success: boolean): void {
    let metrics = this.metrics.get(nodeId);
    if (!metrics) {
      metrics = {
        executions: 0,
        successRate: 0,
        averageTime: 0,
        errors: 0
      };
      this.metrics.set(nodeId, metrics);
    }

    metrics.executions++;
    if (success) {
      metrics.successRate = ((metrics.successRate * (metrics.executions - 1)) + 1) / metrics.executions;
    } else {
      metrics.errors++;
      metrics.successRate = (metrics.successRate * (metrics.executions - 1)) / metrics.executions;
    }

    metrics.lastExecutionTime = new Date();
  }

  // ============================================================================
  // TESTING & VALIDATION
  // ============================================================================

  public async test(scenario: TestScenario): Promise<SimulationResult> {
    const startTime = Date.now();
    const nodeResults = new Map<string, ExecutionState>();
    const executedNodes = new Set<string>();
    const executedConnections = new Set<string>();

    try {
      const actualOutput = await this.execute(scenario.input);
      const actualPath = this.executionStack.slice();

      const assertionResults = scenario.assertions?.map(assertion =>
        this.evaluateAssertion(assertion, actualOutput)
      ) || [];

      const coverage: PathCoverage = {
        nodes: executedNodes,
        connections: executedConnections,
        conditions: new Set(),
        percentage: (executedNodes.size / this.nodes.size) * 100
      };

      return {
        scenario,
        success: assertionResults.every(r => r.passed),
        actualOutput,
        actualPath,
        executionTime: Date.now() - startTime,
        nodeResults,
        assertionResults,
        coverage
      };
    } catch (_error) {
      return {
        scenario,
        success: false,
        actualOutput: null,
        actualPath: this.executionStack.slice(),
        executionTime: Date.now() - startTime,
        nodeResults,
        assertionResults: [],
        coverage: {
          nodes: executedNodes,
          connections: executedConnections,
          conditions: new Set(),
          percentage: 0
        }
      };
    }
  }

  private evaluateAssertion(assertion: Assertion, output: unknown): AssertionResult {
    const actual = this.getValueByPath(output, assertion.path);
    let passed = false;

    switch (assertion.type) {
      case 'equals':
        passed = actual === assertion.expected;
        break;
      case 'contains':
        passed = String(actual).includes(String(assertion.expected));
        break;
      case 'exists':
        passed = actual !== undefined && actual !== null;
        break;
      default:
        passed = false;
    }

    return {
      assertion,
      passed,
      actual,
      error: passed ? undefined : `Expected ${assertion.expected}, got ${actual}`
    };
  }

  public validate(): ValidationState {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Check for orphaned nodes
    this.nodes.forEach(node => {
      const incoming = this.getIncomingConnections(node.id);
      const outgoing = this.getOutgoingConnections(node.id);

      if (incoming.length === 0 && outgoing.length === 0) {
        warnings.push({
          field: `node.${node.id}`,
          message: `Node "${node.name}" is not connected`,
          code: 'ORPHANED_NODE'
        });
      }
    });

    // Check for circular dependencies
    const visited = new Set<string>();
    const stack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (stack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      stack.add(nodeId);

      const connections = this.getOutgoingConnections(nodeId);
      for (const conn of connections) {
        if (hasCycle(conn.target)) return true;
      }

      stack.delete(nodeId);
      return false;
    };

    this.nodes.forEach(node => {
      if (hasCycle(node.id)) {
        errors.push({
          field: `node.${node.id}`,
          message: `Circular dependency detected at node "${node.name}"`,
          code: 'CIRCULAR_DEPENDENCY'
        });
      }
    });

    // Validate node configurations
    this.nodes.forEach(node => {
      const nodeErrors = this.validateNode(node);
      errors.push(...nodeErrors);
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  private validateNode(node: PathNode): ValidationError[] {
    const errors: ValidationError[] = [];

    switch (node.type) {
      case 'condition':
        if (!node.data.conditions || node.data.conditions.length === 0) {
          errors.push({
            field: `node.${node.id}.conditions`,
            message: `Condition node "${node.name}" has no conditions defined`,
            code: 'MISSING_CONDITIONS'
          });
        }
        break;

      case 'action':
        if (!node.data.actions || node.data.actions.length === 0) {
          errors.push({
            field: `node.${node.id}.actions`,
            message: `Action node "${node.name}" has no actions defined`,
            code: 'MISSING_ACTIONS'
          });
        }
        break;

      case 'loop':
        if (!node.data.loopConfig) {
          errors.push({
            field: `node.${node.id}.loopConfig`,
            message: `Loop node "${node.name}" has no configuration`,
            code: 'MISSING_LOOP_CONFIG'
          });
        }
        break;

      case 'switch':
        if (!node.data.switchConfig || !node.data.switchConfig.cases ||
          node.data.switchConfig.cases.length === 0) {
          errors.push({
            field: `node.${node.id}.switchConfig`,
            message: `Switch node "${node.name}" has no cases defined`,
            code: 'MISSING_SWITCH_CASES'
          });
        }
        break;
    }

    return errors;
  }
}
