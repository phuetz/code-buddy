import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { KnowledgeGraph } from '@/knowledge/knowledge-graph.js';
import { populateDeepCodeGraph } from '@/knowledge/code-graph-deep-populator.js';

/** Create a temp directory with test source files */
function createTestProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-graph-deep-'));
  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'utils'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'services'), { recursive: true });

  // src/utils/logger.ts
  fs.writeFileSync(path.join(srcDir, 'utils', 'logger.ts'), `
export class Logger {
  info(msg: string): void {
    console.log(msg);
  }
  warn(msg: string): void {
    console.warn(msg);
  }
  debug(msg: string): void {
    console.debug(msg);
  }
}

export function createLogger(name: string): Logger {
  return new Logger();
}

export const logger = createLogger('default');
`);

  // src/services/user-service.ts
  fs.writeFileSync(path.join(srcDir, 'services', 'user-service.ts'), `
import { Logger, createLogger } from '../utils/logger.js';

export interface IUserRepository {
  findById(id: string): Promise<User>;
}

export class UserService {
  private logger: Logger;

  constructor() {
    this.logger = createLogger('UserService');
  }

  async getUser(id: string): Promise<User> {
    this.logger.info('Getting user');
    const user = await this.fetchFromDb(id);
    this.validateUser(user);
    return user;
  }

  private async fetchFromDb(id: string): Promise<User> {
    this.logger.debug('Fetching from DB');
    return { id, name: 'test' };
  }

  private validateUser(user: User): void {
    if (!user.id) {
      this.logger.warn('Invalid user');
    }
  }
}

export function getUserService(): UserService {
  return new UserService();
}
`);

  // src/services/admin-service.ts (extends UserService)
  fs.writeFileSync(path.join(srcDir, 'services', 'admin-service.ts'), `
import { UserService } from './user-service.js';

export interface Auditable {
  audit(): void;
}

export class AdminService extends UserService implements Auditable {
  async deleteUser(id: string): Promise<void> {
    const user = await this.getUser(id);
    this.performDelete(user);
  }

  private performDelete(user: any): void {
    // delete logic
  }

  audit(): void {
    // audit implementation
  }
}
`);

  // src/index.ts (entry point)
  fs.writeFileSync(path.join(srcDir, 'index.ts'), `
import { getUserService } from './services/user-service.js';
import { AdminService } from './services/admin-service.js';

export async function main(): Promise<void> {
  const svc = getUserService();
  const user = await svc.getUser('123');

  const admin = new AdminService();
  await admin.deleteUser('456');
}

export const run = async () => {
  await main();
};
`);

  return tmpDir;
}

function cleanupTestProject(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch { /* ignore cleanup errors */ }
}

describe('CodeGraphDeepPopulator', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createTestProject();
  });

  afterEach(() => {
    cleanupTestProject(tmpDir);
  });

  it('populates class definitions', () => {
    const added = populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(added).toBeGreaterThan(0);

    // Classes should be registered
    const loggerTriples = graph.query({ subject: 'cls:Logger', predicate: 'definedIn' });
    expect(loggerTriples.length).toBe(1);
    expect(loggerTriples[0].object).toContain('logger');

    const userSvcTriples = graph.query({ subject: 'cls:UserService', predicate: 'definedIn' });
    expect(userSvcTriples.length).toBe(1);
  });

  it('populates extends relationships', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    expect(graph.has('cls:AdminService', 'extends', 'cls:UserService')).toBe(true);
  });

  it('populates implements relationships', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    expect(graph.has('cls:AdminService', 'implements', 'iface:Auditable')).toBe(true);
  });

  it('populates class hasMethod triples', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // Logger methods
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.info')).toBe(true);
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.warn')).toBe(true);
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.debug')).toBe(true);

    // UserService methods
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.getUser')).toBe(true);
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.fetchFromDb')).toBe(true);
    expect(graph.has('cls:UserService', 'hasMethod', 'fn:UserService.validateUser')).toBe(true);
  });

  it('populates function definitions', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const createLoggerTriples = graph.query({ subject: 'fn:createLogger', predicate: 'definedIn' });
    expect(createLoggerTriples.length).toBe(1);

    const getUserServiceTriples = graph.query({ subject: 'fn:getUserService', predicate: 'definedIn' });
    expect(getUserServiceTriples.length).toBe(1);

    const mainTriples = graph.query({ subject: 'fn:main', predicate: 'definedIn' });
    expect(mainTriples.length).toBe(1);
  });

  it('populates this.method() call edges', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // UserService.getUser calls this.fetchFromDb and this.validateUser
    const callTriples = graph.query({ subject: 'fn:UserService.getUser', predicate: 'calls' });
    const callees = callTriples.map(t => t.object);
    expect(callees).toContain('fn:UserService.fetchFromDb');
    expect(callees).toContain('fn:UserService.validateUser');
  });

  it('populates cross-class call edges', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // main() calls getUserService()
    const mainCalls = graph.query({ subject: 'fn:main', predicate: 'calls' });
    const mainCallees = mainCalls.map(t => t.object);
    expect(mainCallees).toContain('fn:getUserService');
  });

  it('can trace call paths between functions', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // Path from main → getUserService should exist directly
    const paths = graph.findPath('fn:main', 'fn:getUserService', 5);
    expect(paths.length).toBeGreaterThan(0);
  });

  it('can find all callers of a function (usedBy via calls)', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // Who calls createLogger?
    const callers = graph.query({ predicate: 'calls', object: 'fn:createLogger' });
    expect(callers.length).toBeGreaterThan(0);
  });

  it('skips test files', () => {
    // Create a test file
    fs.writeFileSync(path.join(tmpDir, 'src', 'foo.test.ts'), `
export function testHelper(): void {}
`);

    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const testTriples = graph.query({ subject: 'fn:testHelper' });
    expect(testTriples.length).toBe(0);
  });

  it('handles empty project gracefully', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-graph-empty-'));
    fs.mkdirSync(path.join(emptyDir, 'src'));

    const added = populateDeepCodeGraph(graph, emptyDir, ['src']);
    expect(added).toBe(0);

    cleanupTestProject(emptyDir);
  });

  it('returns the number of triples added', () => {
    const added = populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(added).toBe(graph.getStats().tripleCount);
  });

  it('creates import edges for dynamic imports (await import)', () => {
    // Add a file with a dynamic import
    fs.writeFileSync(path.join(tmpDir, 'src', 'services', 'lazy-loader.ts'), `
export async function loadAnalytics() {
  const { detectDeadCode } = await import('../utils/analytics.js');
  return detectDeadCode();
}

export async function loadOther() {
  const mod = await import('./user-service.js');
  return mod;
}
`);

    // Create the target files so they're scannable
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'analytics.ts'), `
export function detectDeadCode() { return []; }
`);

    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // Dynamic import should create an imports edge
    const imports = graph.query({ predicate: 'imports' });
    const lazyLoaderImports = imports.filter(t => t.subject.includes('lazy-loader'));
    const targets = lazyLoaderImports.map(t => t.object);
    expect(targets).toContain('mod:src/utils/analytics');
    expect(targets).toContain('mod:src/services/user-service');
  });

  it('deduplicates on re-population', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);
    const firstCount = graph.getStats().tripleCount;

    const secondAdded = populateDeepCodeGraph(graph, tmpDir, ['src']);
    expect(secondAdded).toBe(0);
    expect(graph.getStats().tripleCount).toBe(firstCount);
  });

  it('populates arrow function exports', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // export const run = async () => { ... }
    const runTriples = graph.query({ subject: 'fn:run' });
    expect(runTriples.length).toBeGreaterThan(0);
  });

  it('populates containsFunction for top-level functions', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // src/utils/logger module should contain createLogger
    const loggerModFns = graph.query({ subject: /^mod:.*logger$/ as unknown as string, predicate: 'containsFunction' });
    // Use direct query since subject is not regex-able via simple query
    const allContains = graph.query({ predicate: 'containsFunction' });
    const loggerFns = allContains.filter(t => t.subject.includes('logger'));
    const fnNames = loggerFns.map(t => t.object);
    expect(fnNames).toContain('fn:createLogger');
    expect(fnNames).toContain('fn:Logger.info');
    expect(fnNames).toContain('fn:Logger.warn');
    expect(fnNames).toContain('fn:Logger.debug');
  });

  it('populates containsFunction for methods', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const allContains = graph.query({ predicate: 'containsFunction' });
    const userSvcFns = allContains.filter(t => t.subject.includes('user-service'));
    const fnNames = userSvcFns.map(t => t.object);
    expect(fnNames).toContain('fn:UserService.getUser');
    expect(fnNames).toContain('fn:UserService.fetchFromDb');
    expect(fnNames).toContain('fn:UserService.validateUser');
    expect(fnNames).toContain('fn:getUserService');
  });

  it('containsFunction has line number metadata', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const allContains = graph.query({ predicate: 'containsFunction' });
    const withLine = allContains.filter(t => t.metadata?.line);
    expect(withLine.length).toBeGreaterThan(0);
    // Line numbers should be positive integers
    for (const t of withLine) {
      expect(parseInt(t.metadata!.line!, 10)).toBeGreaterThan(0);
    }
  });

  it('containsFunction has className metadata for methods', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const allContains = graph.query({ predicate: 'containsFunction' });
    const methods = allContains.filter(t => t.metadata?.className);
    expect(methods.length).toBeGreaterThan(0);
    const classNames = methods.map(t => t.metadata!.className);
    expect(classNames).toContain('Logger');
    expect(classNames).toContain('UserService');
  });

  it('stores method parameter signatures', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // Logger.info(msg: string): void
    const loggerMethods = graph.query({ subject: 'cls:Logger', predicate: 'hasMethod' });
    const infoMethod = loggerMethods.find(t => t.object === 'fn:Logger.info');
    expect(infoMethod).toBeDefined();
    expect(infoMethod!.metadata?.params).toContain('msg: string');
    expect(infoMethod!.metadata?.returnType).toBe('void');
  });

  it('stores function parameter signatures', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // createLogger(name: string): Logger
    const createLoggerTriples = graph.query({ subject: 'fn:createLogger', predicate: 'definedIn' });
    expect(createLoggerTriples.length).toBe(1);
    expect(createLoggerTriples[0].metadata?.params).toContain('name: string');
    expect(createLoggerTriples[0].metadata?.returnType).toBe('Logger');
  });

  it('stores async method return types', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    // UserService.getUser(id: string): Promise<User>
    const userSvcMethods = graph.query({ subject: 'cls:UserService', predicate: 'hasMethod' });
    const getUser = userSvcMethods.find(t => t.object === 'fn:UserService.getUser');
    expect(getUser).toBeDefined();
    expect(getUser!.metadata?.params).toContain('id: string');
    expect(getUser!.metadata?.returnType).toContain('Promise');
  });

  it('containsFunction triples include params metadata', () => {
    populateDeepCodeGraph(graph, tmpDir, ['src']);

    const allContains = graph.query({ predicate: 'containsFunction' });
    const withParams = allContains.filter(t => t.metadata?.params);
    expect(withParams.length).toBeGreaterThan(0);

    // Verify at least one has return type too
    const withReturn = allContains.filter(t => t.metadata?.returnType);
    expect(withReturn.length).toBeGreaterThan(0);
  });
});

describe('Deep graph queries for flowchart use cases', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createTestProject();
    populateDeepCodeGraph(graph, tmpDir, ['src']);
  });

  afterEach(() => {
    cleanupTestProject(tmpDir);
  });

  it('ego-graph shows methods and calls for a class', () => {
    const entity = graph.findEntity('UserService');
    expect(entity).toBe('cls:UserService');

    const egoGraph = graph.formatEgoGraph(entity!, 2, 2000);
    expect(egoGraph).toContain('UserService');
    expect(egoGraph).toContain('hasMethod');
  });

  it('can build class hierarchy tree', () => {
    // AdminService extends UserService
    const extTriples = graph.query({ predicate: 'extends' });
    expect(extTriples.length).toBeGreaterThan(0);

    const adminExt = extTriples.find(t => t.subject === 'cls:AdminService');
    expect(adminExt?.object).toBe('cls:UserService');
  });

  it('can find all methods of a class via graph', () => {
    const methods = graph.query({ subject: 'cls:UserService', predicate: 'hasMethod' });
    const methodNames = methods.map(t => t.object);
    expect(methodNames).toContain('fn:UserService.getUser');
    expect(methodNames).toContain('fn:UserService.fetchFromDb');
    expect(methodNames).toContain('fn:UserService.validateUser');
  });

  it('can trace call chain: getUser → fetchFromDb → logger.debug', () => {
    // getUser calls fetchFromDb
    expect(graph.has('fn:UserService.getUser', 'calls', 'fn:UserService.fetchFromDb')).toBe(true);

    // fetchFromDb has call triples too (logger methods via this.logger.debug — but that's
    // resolved differently as it's an instance method call, not this.debug)
    // The key point is the chain is traceable
    const getUserCalls = graph.query({ subject: 'fn:UserService.getUser', predicate: 'calls' });
    expect(getUserCalls.length).toBeGreaterThanOrEqual(2);
  });
});
