import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { KnowledgeGraph } from '@/knowledge/knowledge-graph.js';
import { populateDeepCodeGraph } from '@/knowledge/code-graph-deep-populator.js';
import { generateCallFlowchart, generateClassHierarchy, generateModuleDependencies } from '@/knowledge/mermaid-generator.js';
import { analyzeImpact } from '@/knowledge/impact-analyzer.js';
import { updateGraphForFile } from '@/knowledge/graph-updater.js';
import { buildCodeGraphContext, trackRecentFile, clearRecentFiles } from '@/knowledge/code-graph-context-provider.js';

/** Create a temp TS project for testing */
function createTestProject(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-graph-tools-'));
  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(path.join(srcDir, 'utils'), { recursive: true });
  fs.mkdirSync(path.join(srcDir, 'services'), { recursive: true });

  fs.writeFileSync(path.join(srcDir, 'utils', 'logger.ts'), `
export class Logger {
  info(msg: string): void { console.log(msg); }
  warn(msg: string): void { console.warn(msg); }
}

export function createLogger(name: string): Logger {
  return new Logger();
}
`);

  fs.writeFileSync(path.join(srcDir, 'services', 'user-service.ts'), `
import { Logger, createLogger } from '../utils/logger.js';

export class UserService {
  private logger: Logger;
  constructor() { this.logger = createLogger('UserService'); }

  async getUser(id: string): Promise<User> {
    this.logger.info('Getting user');
    return this.fetchFromDb(id);
  }

  private fetchFromDb(id: string): Promise<User> {
    return { id, name: 'test' };
  }
}

export function getUserService(): UserService {
  return new UserService();
}
`);

  fs.writeFileSync(path.join(srcDir, 'services', 'admin-service.ts'), `
import { UserService } from './user-service.js';

export class AdminService extends UserService {
  async deleteUser(id: string): Promise<void> {
    const user = await this.getUser(id);
  }
}
`);

  fs.writeFileSync(path.join(srcDir, 'index.ts'), `
import { getUserService } from './services/user-service.js';
import { AdminService } from './services/admin-service.js';

export async function main(): Promise<void> {
  const svc = getUserService();
  await svc.getUser('123');
  const admin = new AdminService();
  await admin.deleteUser('456');
}
`);

  return tmpDir;
}

function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore expected error */ }
}

// ============================================================================
// Mermaid Generator Tests
// ============================================================================

describe('Mermaid Generator', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createTestProject();
    populateDeepCodeGraph(graph, tmpDir, ['src']);
  });

  afterEach(() => cleanup(tmpDir));

  it('generates call flowchart', () => {
    const mermaid = generateCallFlowchart(graph, 'fn:UserService.getUser', 2);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('getUser');
    expect(mermaid).toContain('fetchFromDb');
    expect(mermaid).toContain('-->');
  });

  it('highlights focal node in flowchart', () => {
    const mermaid = generateCallFlowchart(graph, 'fn:UserService.getUser', 1);
    expect(mermaid).toContain('style');
    expect(mermaid).toContain('fill:#f9f');
  });

  it('generates class hierarchy', () => {
    const mermaid = generateClassHierarchy(graph, 'cls:AdminService');
    expect(mermaid).toContain('graph BT');
    expect(mermaid).toContain('AdminService');
    expect(mermaid).toContain('UserService');
    expect(mermaid).toContain('extends');
  });

  it('returns empty string for no relationships', () => {
    KnowledgeGraph.resetInstance();
    const emptyGraph = KnowledgeGraph.getInstance();
    const mermaid = generateCallFlowchart(emptyGraph, 'fn:nonexistent', 2);
    expect(mermaid).toBe('');
  });
});

// ============================================================================
// Impact Analyzer Tests
// ============================================================================

describe('Impact Analyzer', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createTestProject();
    populateDeepCodeGraph(graph, tmpDir, ['src']);
  });

  afterEach(() => cleanup(tmpDir));

  it('finds direct callers', () => {
    const result = analyzeImpact(graph, 'fn:UserService.fetchFromDb');
    expect(result.directCallers).toContain('fn:UserService.getUser');
    expect(result.totalAffected).toBeGreaterThan(0);
  });

  it('finds indirect callers transitively', () => {
    const result = analyzeImpact(graph, 'fn:UserService.fetchFromDb', 5);
    // getUser calls fetchFromDb, and main calls getUser (via getUserService)
    const allCallers = [...result.directCallers, ...result.indirectCallers];
    expect(allCallers).toContain('fn:UserService.getUser');
  });

  it('lists affected files', () => {
    const result = analyzeImpact(graph, 'fn:UserService.fetchFromDb');
    expect(result.affectedFiles.length).toBeGreaterThan(0);
  });

  it('produces formatted output', () => {
    const result = analyzeImpact(graph, 'fn:UserService.fetchFromDb');
    expect(result.formatted).toContain('Impact Analysis');
    expect(result.formatted).toContain('Direct callers');
  });

  it('handles entity with no callers', () => {
    const result = analyzeImpact(graph, 'fn:nonexistent');
    expect(result.directCallers.length).toBe(0);
    expect(result.formatted).toContain('Total affected: 0');
  });
});

// ============================================================================
// Graph Updater Tests (Incremental)
// ============================================================================

describe('Graph Updater', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createTestProject();
    populateDeepCodeGraph(graph, tmpDir, ['src']);
  });

  afterEach(() => cleanup(tmpDir));

  it('re-scans a modified file', () => {
    const filePath = path.join(tmpDir, 'src', 'utils', 'logger.ts');

    // Add a new method
    fs.writeFileSync(filePath, `
export class Logger {
  info(msg: string): void { console.log(msg); }
  warn(msg: string): void { console.warn(msg); }
  error(msg: string): void { console.error(msg); }
}

export function createLogger(name: string): Logger {
  return new Logger();
}
`);

    updateGraphForFile(graph, filePath, tmpDir);

    // New method should appear
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.error')).toBe(true);
    // Old methods should still be there
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.info')).toBe(true);
  });

  it('removes triples for deleted file', () => {
    const filePath = path.join(tmpDir, 'src', 'utils', 'logger.ts');

    // Verify triples exist before
    expect(graph.has('cls:Logger', 'hasMethod', 'fn:Logger.info')).toBe(true);

    // Delete the file
    fs.unlinkSync(filePath);
    updateGraphForFile(graph, filePath, tmpDir);

    // Logger triples should be gone (definedIn removed)
    const loggerDef = graph.query({ subject: 'cls:Logger', predicate: 'definedIn' });
    expect(loggerDef.length).toBe(0);
  });

  it('handles non-existent file gracefully', () => {
    const fakePath = path.join(tmpDir, 'src', 'nonexistent.ts');
    const result = updateGraphForFile(graph, fakePath, tmpDir);
    expect(result).toBe(0);
  });
});

// ============================================================================
// Enhanced Context Provider Tests
// ============================================================================

describe('Enhanced Context Provider', () => {
  let graph: KnowledgeGraph;
  let tmpDir: string;

  beforeEach(() => {
    clearRecentFiles();
    KnowledgeGraph.resetInstance();
    graph = KnowledgeGraph.getInstance();
    tmpDir = createTestProject();
    populateDeepCodeGraph(graph, tmpDir, ['src']);
  });

  afterEach(() => cleanup(tmpDir));

  it('matches PascalCase class names', () => {
    const ctx = buildCodeGraphContext(graph, 'Can you explain the UserService class?');
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('UserService');
  });

  it('matches kebab-case module names', () => {
    const ctx = buildCodeGraphContext(graph, 'Look at user-service');
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('user-service');
  });

  it('uses tracked recent files', () => {
    // Track a file that wouldn't be mentioned in the message
    trackRecentFile('src/utils/logger.ts');

    // Message doesn't mention logger at all
    const ctx = buildCodeGraphContext(graph, 'What should I do next?');
    // Should pick up logger from recent files
    expect(ctx).not.toBeNull();
    expect(ctx).toContain('Logger');
  });

  it('extracts from error stack traces', () => {
    const errorMsg = 'Error: at UserService.getUser (src/services/user-service.ts:8)';
    const ctx = buildCodeGraphContext(graph, errorMsg);
    expect(ctx).not.toBeNull();
  });

  it('returns null for empty graph', () => {
    KnowledgeGraph.resetInstance();
    const emptyGraph = KnowledgeGraph.getInstance();
    const ctx = buildCodeGraphContext(emptyGraph, 'Tell me about UserService');
    expect(ctx).toBeNull();
  });

  it('returns null for unrecognized entities', () => {
    const ctx = buildCodeGraphContext(graph, 'hello how are you');
    expect(ctx).toBeNull();
  });
});
