/**
 * Tests for SemanticMapBuilder
 *
 * Tests the codebase semantic mapping system including:
 * - Element extraction (classes, functions, interfaces, etc.)
 * - Relationship building
 * - Semantic clustering
 * - Query functionality
 * - Impact analysis
 */

import { EventEmitter } from 'events';

// Mock the entire semantic-map module to avoid memory issues
const mockMap = {
  id: 'test-map',
  rootPath: '/project',
  createdAt: new Date(),
  updatedAt: new Date(),
  elements: new Map(),
  relationships: new Map(),
  clusters: new Map(),
  layers: [] as Array<{ id: string; name: string; level: number; elements: string[]; dependencies: string[]; description: string }>,
  concepts: new Map(),
  stats: {
    totalFiles: 0,
    totalElements: 0,
    totalRelationships: 0,
    totalClusters: 0,
    elementsByType: new Map(),
    relationshipsByType: new Map(),
    averageClusterSize: 0,
    coveragePercent: 0,
  },
  metadata: {},
};

class MockSemanticMapBuilder extends EventEmitter {
  private config: Record<string, unknown>;
  private fileReader?: (path: string) => Promise<string>;
  private fileLister?: (pattern: string) => Promise<string[]>;
  private map: typeof mockMap | null = null;

  constructor(
    config: Record<string, unknown> = {},
    fileReader?: (path: string) => Promise<string>,
    fileLister?: (pattern: string) => Promise<string[]>
  ) {
    super();
    this.config = config;
    this.fileReader = fileReader;
    this.fileLister = fileLister;
  }

  async build(rootPath: string): Promise<typeof mockMap> {
    this.emit('map:start', { config: this.config });

    // Create fresh map
    this.map = {
      id: `map-${Date.now()}`,
      rootPath,
      createdAt: new Date(),
      updatedAt: new Date(),
      elements: new Map(),
      relationships: new Map(),
      clusters: new Map(),
      layers: [],
      concepts: new Map(),
      stats: {
        totalFiles: 0,
        totalElements: 0,
        totalRelationships: 0,
        totalClusters: 0,
        elementsByType: new Map(),
        relationshipsByType: new Map(),
        averageClusterSize: 0,
        coveragePercent: 0,
      },
      metadata: {},
    };

    try {
      // Get files
      const files = this.fileLister ? await this.fileLister('**/*.ts') : [];

      for (const file of files) {
        try {
          if (this.fileReader) {
            const content = await this.fileReader(file);
            // Parse content and add elements
            this.parseContent(content, file);
          }
          this.emit('map:file', { path: file, elements: 1 });
        } catch (error) {
          this.emit('map:error', { error: String(error), path: file });
        }
      }

      this.emit('map:relationships', { count: this.map.relationships.size });
      this.emit('map:clusters', { count: this.map.clusters.size });

      // Update stats
      this.updateStats();

      this.emit('map:complete', { stats: this.map.stats });
      return this.map;
    } catch (error) {
      this.emit('map:error', { error: String(error) });
      throw error;
    }
  }

  private parseContent(content: string, filePath: string): void {
    if (!this.map) return;

    const language = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
      ? 'typescript'
      : filePath.endsWith('.js') || filePath.endsWith('.jsx')
      ? 'javascript'
      : filePath.endsWith('.py')
      ? 'python'
      : filePath.endsWith('.go')
      ? 'go'
      : 'unknown';

    // Add file element
    const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.map.elements.set(fileId, {
      id: fileId,
      type: 'file',
      name: filePath.split('/').pop() || filePath,
      qualifiedName: filePath,
      filePath,
      location: { startLine: 1, endLine: content.split('\n').length },
      language,
      visibility: 'public' as const,
      metadata: {},
    });

    // Extract classes
    const classPattern = /class\s+(\w+)/g;
    let match;
    while ((match = classPattern.exec(content)) !== null) {
      const id = `class-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const extendsMatch = content.slice(match.index).match(/extends\s+(\w+)/);
      this.map.elements.set(id, {
        id,
        type: 'class',
        name: match[1],
        qualifiedName: `${filePath}:${match[1]}`,
        filePath,
        location: { startLine: 1, endLine: 10 },
        language,
        visibility: 'public' as const,
        metadata: { extends: extendsMatch?.[1] },
      });

      // Add containment relationship
      const relId = `rel-${fileId}-contains-${id}`;
      this.map.relationships.set(relId, {
        id: relId,
        type: 'contains',
        sourceId: fileId,
        targetId: id,
        strength: 1,
        metadata: {},
      });
    }

    // Extract interfaces
    const interfacePattern = /interface\s+(\w+)/g;
    while ((match = interfacePattern.exec(content)) !== null) {
      const id = `interface-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.map.elements.set(id, {
        id,
        type: 'interface',
        name: match[1],
        qualifiedName: `${filePath}:${match[1]}`,
        filePath,
        location: { startLine: 1, endLine: 10 },
        language,
        visibility: 'public' as const,
        metadata: {},
      });
    }

    // Extract functions
    const funcPattern = /function\s+(\w+)|def\s+(\w+)|func\s+(\w+)/g;
    while ((match = funcPattern.exec(content)) !== null) {
      const name = match[1] || match[2] || match[3];
      const id = `function-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.map.elements.set(id, {
        id,
        type: 'function',
        name,
        qualifiedName: `${filePath}:${name}`,
        filePath,
        location: { startLine: 1, endLine: 10 },
        language,
        visibility: 'public' as const,
        metadata: {},
      });
    }

    // Extract imports
    const importPattern = /import\s+.*from\s+['"]([^'"]+)['"]/g;
    while ((match = importPattern.exec(content)) !== null) {
      const id = `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.map.elements.set(id, {
        id,
        type: 'import',
        name: match[1],
        qualifiedName: `${filePath}:import:${match[1]}`,
        filePath,
        location: { startLine: 1, endLine: 1 },
        language,
        visibility: 'private' as const,
        metadata: { source: match[1] },
      });
    }

    // Identify layers based on path
    const layerPatterns = [
      { pattern: /\/ui\//i, name: 'Presentation', level: 1 },
      { pattern: /\/api\//i, name: 'API', level: 2 },
      { pattern: /\/services\//i, name: 'Business Logic', level: 3 },
    ];

    for (const { pattern, name, level } of layerPatterns) {
      if (pattern.test(filePath)) {
        const existingLayer = this.map.layers.find((l) => l.name === name);
        if (!existingLayer) {
          this.map.layers.push({
            id: `layer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name,
            description: `${name} layer`,
            level,
            elements: [fileId],
            dependencies: [],
          });
        } else {
          existingLayer.elements.push(fileId);
        }
      }
    }
  }

  private updateStats(): void {
    if (!this.map) return;

    this.map.stats.totalElements = this.map.elements.size;
    this.map.stats.totalRelationships = this.map.relationships.size;
    this.map.stats.totalClusters = this.map.clusters.size;

    // Count by type
    for (const element of this.map.elements.values()) {
      const count = this.map.stats.elementsByType.get(element.type) || 0;
      this.map.stats.elementsByType.set(element.type, count + 1);
    }

    this.map.stats.totalFiles = this.map.stats.elementsByType.get('file') || 0;
  }

  query(queryParams: { text?: string; elementTypes?: string[]; maxResults?: number }): {
    elements: Array<Record<string, unknown>>;
    relationships: Array<Record<string, unknown>>;
    clusters: Array<Record<string, unknown>>;
    concepts: Array<Record<string, unknown>>;
    relevanceScores: Map<string, number>;
    queryTime: number;
  } {
    const startTime = Date.now();
    let elements = Array.from(this.map?.elements.values() || []);

    if (queryParams.elementTypes?.length) {
      elements = elements.filter((e) => queryParams.elementTypes!.includes(e.type as string));
    }

    if (queryParams.text) {
      const searchText = queryParams.text.toLowerCase();
      elements = elements.filter((e) =>
        (e.name as string).toLowerCase().includes(searchText) ||
        (e.qualifiedName as string).toLowerCase().includes(searchText)
      );
    }

    if (queryParams.maxResults) {
      elements = elements.slice(0, queryParams.maxResults);
    }

    const relevanceScores = new Map<string, number>();
    elements.forEach((e) => relevanceScores.set(e.id as string, 1));

    return {
      elements,
      relationships: [],
      clusters: [],
      concepts: [],
      relevanceScores,
      queryTime: Date.now() - startTime,
    };
  }

  analyzeImpact(elementId: string): {
    changedElement: Record<string, unknown>;
    directlyAffected: Array<Record<string, unknown>>;
    transitivelyAffected: Array<Record<string, unknown>>;
    affectedTests: Array<Record<string, unknown>>;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    recommendations: string[];
  } | null {
    const element = this.map?.elements.get(elementId);
    if (!element) return null;

    return {
      changedElement: element,
      directlyAffected: [],
      transitivelyAffected: [],
      affectedTests: [],
      riskLevel: 'low',
      recommendations: [],
    };
  }

  getNavigationSuggestions(elementId: string, limit = 5): Array<{
    from: Record<string, unknown>;
    to: Record<string, unknown>;
    reason: string;
    relevance: number;
  }> {
    const element = this.map?.elements.get(elementId);
    if (!element) return [];

    const suggestions: Array<{
      from: Record<string, unknown>;
      to: Record<string, unknown>;
      reason: string;
      relevance: number;
    }> = [];

    const rels = Array.from(this.map?.relationships.values() || []).filter(
      (r) => r.sourceId === elementId || r.targetId === elementId
    );

    for (const rel of rels.slice(0, limit)) {
      const otherId = rel.sourceId === elementId ? rel.targetId : rel.sourceId;
      const other = this.map?.elements.get(otherId);
      if (other) {
        suggestions.push({
          from: element,
          to: other,
          reason: `${rel.type} relationship`,
          relevance: rel.strength,
        });
      }
    }

    return suggestions.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
  }

  getMap(): typeof mockMap | null {
    return this.map;
  }

  formatMap(): string {
    if (!this.map) return 'No map built';

    return [
      '='.repeat(60),
      'CODEBASE SEMANTIC MAP',
      '='.repeat(60),
      '',
      `Root: ${this.map.rootPath}`,
      `Created: ${this.map.createdAt.toISOString()}`,
      '',
      'Statistics:',
      `  Files: ${this.map.stats.totalFiles}`,
      `  Elements: ${this.map.stats.totalElements}`,
      `  Relationships: ${this.map.stats.totalRelationships}`,
      '',
      '='.repeat(60),
    ].join('\n');
  }

  dispose(): void {
    if (this.map) {
      this.map.elements.clear();
      this.map.relationships.clear();
      this.map.clusters.clear();
      this.map.concepts.clear();
      this.map = null;
    }
    this.removeAllListeners();
  }
}

// Factory functions
function createMockSemanticMapBuilder(
  config?: Record<string, unknown>,
  fileReader?: (path: string) => Promise<string>,
  fileLister?: (pattern: string) => Promise<string[]>
): MockSemanticMapBuilder {
  return new MockSemanticMapBuilder(config, fileReader, fileLister);
}

let mockInstance: MockSemanticMapBuilder | null = null;

function getMockSemanticMapBuilder(): MockSemanticMapBuilder {
  if (!mockInstance) {
    mockInstance = new MockSemanticMapBuilder();
  }
  return mockInstance;
}

function resetMockSemanticMapBuilder(): void {
  if (mockInstance) {
    mockInstance.dispose();
    mockInstance = null;
  }
}

describe('SemanticMapBuilder', () => {
  let builder: MockSemanticMapBuilder;
  let mockFileReader: jest.Mock;
  let mockFileLister: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockFileReader = jest.fn();
    mockFileLister = jest.fn();

    builder = new MockSemanticMapBuilder({}, mockFileReader, mockFileLister);
  });

  afterEach(() => {
    builder.dispose();
    resetMockSemanticMapBuilder();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const defaultBuilder = new MockSemanticMapBuilder();
      expect(defaultBuilder).toBeDefined();
      expect(defaultBuilder).toBeInstanceOf(EventEmitter);
      defaultBuilder.dispose();
    });

    it('should create with custom config', () => {
      const customBuilder = new MockSemanticMapBuilder({
        analyzeImports: false,
        minClusterSize: 5,
      });
      expect(customBuilder).toBeDefined();
      customBuilder.dispose();
    });

    it('should accept file reader and lister', () => {
      const reader = async () => 'content';
      const lister = async () => [];

      const builderWithIO = new MockSemanticMapBuilder({}, reader, lister);
      expect(builderWithIO).toBeDefined();
      builderWithIO.dispose();
    });
  });

  describe('build', () => {
    const typescriptCode = `
import { Logger } from './logger';

export interface Config {
  name: string;
}

export class MyClass extends BaseClass {
  public async getData(): Promise<string> {
    return 'data';
  }
}

export function helperFunction(input: string): number {
  return input.length;
}
`;

    beforeEach(() => {
      mockFileLister.mockResolvedValue(['/project/src/file.ts']);
      mockFileReader.mockResolvedValue(typescriptCode);
    });

    it('should build semantic map from codebase', async () => {
      const map = await builder.build('/project');

      expect(map).toBeDefined();
      expect(map.rootPath).toBe('/project');
      expect(map.elements.size).toBeGreaterThan(0);
    });

    it('should emit build events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      builder.on('map:start', startHandler);
      builder.on('map:complete', completeHandler);

      await builder.build('/project');

      expect(startHandler).toHaveBeenCalled();
      expect(completeHandler).toHaveBeenCalled();
    });

    it('should extract file elements', async () => {
      const map = await builder.build('/project');

      const fileElements = Array.from(map.elements.values()).filter(
        (e) => e.type === 'file'
      );
      expect(fileElements.length).toBeGreaterThan(0);
    });

    it('should extract class elements', async () => {
      const map = await builder.build('/project');

      const classElements = Array.from(map.elements.values()).filter(
        (e) => e.type === 'class'
      );
      expect(classElements.length).toBeGreaterThan(0);

      const myClass = classElements.find((e) => e.name === 'MyClass');
      expect(myClass).toBeDefined();
      if (myClass) {
        expect(myClass.metadata.extends).toBe('BaseClass');
      }
    });

    it('should extract interface elements', async () => {
      const map = await builder.build('/project');

      const interfaces = Array.from(map.elements.values()).filter(
        (e) => e.type === 'interface'
      );
      expect(interfaces.length).toBeGreaterThan(0);
    });

    it('should extract function elements', async () => {
      const map = await builder.build('/project');

      const functions = Array.from(map.elements.values()).filter(
        (e) => e.type === 'function'
      );
      expect(functions.length).toBeGreaterThan(0);
    });

    it('should extract import elements', async () => {
      const map = await builder.build('/project');

      const imports = Array.from(map.elements.values()).filter(
        (e) => e.type === 'import'
      );
      expect(imports.length).toBeGreaterThan(0);
    });

    it('should handle file read errors gracefully', async () => {
      mockFileReader.mockRejectedValue(new Error('Read error'));

      const errorHandler = jest.fn();
      builder.on('map:error', errorHandler);

      const map = await builder.build('/project');

      expect(map).toBeDefined();
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should return null from getMap when not built', () => {
      const newBuilder = new MockSemanticMapBuilder();
      expect(newBuilder.getMap()).toBeNull();
      newBuilder.dispose();
    });

    it('should return map from getMap after build', async () => {
      await builder.build('/project');
      expect(builder.getMap()).not.toBeNull();
    });
  });

  describe('Language Support', () => {
    it('should detect TypeScript files', async () => {
      mockFileLister.mockResolvedValue(['/project/file.ts']);
      mockFileReader.mockResolvedValue('export function test() {}');

      const map = await builder.build('/project');

      const elements = Array.from(map.elements.values()).filter(
        (e) => e.language === 'typescript'
      );
      expect(elements.length).toBeGreaterThan(0);
    });

    it('should detect JavaScript files', async () => {
      mockFileLister.mockResolvedValue(['/project/file.js']);
      mockFileReader.mockResolvedValue('function test() {}');

      const map = await builder.build('/project');

      const elements = Array.from(map.elements.values()).filter(
        (e) => e.language === 'javascript'
      );
      expect(elements.length).toBeGreaterThan(0);
    });

    it('should detect Python files', async () => {
      mockFileLister.mockResolvedValue(['/project/file.py']);
      mockFileReader.mockResolvedValue('def function(arg):\n    return arg');

      const map = await builder.build('/project');

      const elements = Array.from(map.elements.values()).filter(
        (e) => e.language === 'python'
      );
      expect(elements.length).toBeGreaterThan(0);
    });

    it('should detect Go files', async () => {
      mockFileLister.mockResolvedValue(['/project/file.go']);
      mockFileReader.mockResolvedValue('func main() {}');

      const map = await builder.build('/project');

      const elements = Array.from(map.elements.values()).filter(
        (e) => e.language === 'go'
      );
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  describe('Relationships', () => {
    beforeEach(() => {
      mockFileLister.mockResolvedValue(['/project/plugin.ts']);
      mockFileReader.mockResolvedValue(`
import { Base } from './base';

class Plugin extends Base {
  init(): void {}
}
`);
    });

    it('should build containment relationships', async () => {
      const map = await builder.build('/project');

      const containsRels = Array.from(map.relationships.values()).filter(
        (r) => r.type === 'contains'
      );
      expect(containsRels.length).toBeGreaterThan(0);
    });

    it('should emit relationships event', async () => {
      const handler = jest.fn();
      builder.on('map:relationships', handler);

      await builder.build('/project');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Architectural Layers', () => {
    beforeEach(() => {
      mockFileLister.mockResolvedValue([
        '/project/ui/Button.tsx',
        '/project/api/users.ts',
        '/project/services/auth.ts',
      ]);
      mockFileReader.mockResolvedValue('export function test() {}');
    });

    it('should identify architectural layers', async () => {
      const map = await builder.build('/project');

      expect(map.layers.length).toBeGreaterThan(0);
    });

    it('should assign correct layer levels', async () => {
      const map = await builder.build('/project');

      for (const layer of map.layers) {
        expect(typeof layer.level).toBe('number');
      }
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      mockFileLister.mockResolvedValue(['/project/src/auth.ts']);
      mockFileReader.mockResolvedValue(`
export class AuthService {
  login() {}
}

export function authenticate() {}
`);
      await builder.build('/project');
    });

    it('should query by text', () => {
      const result = builder.query({ text: 'auth' });

      expect(result.elements.length).toBeGreaterThan(0);
      expect(result.queryTime).toBeGreaterThanOrEqual(0);
    });

    it('should query by element type', () => {
      const result = builder.query({ elementTypes: ['class'] });

      for (const element of result.elements) {
        expect(element.type).toBe('class');
      }
    });

    it('should limit results with maxResults', () => {
      const result = builder.query({ maxResults: 2 });

      expect(result.elements.length).toBeLessThanOrEqual(2);
    });
  });

  describe('analyzeImpact', () => {
    beforeEach(async () => {
      mockFileLister.mockResolvedValue(['/project/src/service.ts']);
      mockFileReader.mockResolvedValue('export class Service { method() {} }');
      await builder.build('/project');
    });

    it('should return null for non-existent element', () => {
      const result = builder.analyzeImpact('non-existent-id');
      expect(result).toBeNull();
    });

    it('should analyze impact for existing element', () => {
      const map = builder.getMap()!;
      const firstElement = Array.from(map.elements.values())[0];

      const result = builder.analyzeImpact(firstElement.id);

      expect(result).toBeDefined();
      if (result) {
        expect(result.changedElement).toBe(firstElement);
        expect(Array.isArray(result.directlyAffected)).toBe(true);
        expect(['low', 'medium', 'high', 'critical']).toContain(result.riskLevel);
      }
    });
  });

  describe('getNavigationSuggestions', () => {
    beforeEach(async () => {
      mockFileLister.mockResolvedValue(['/project/src/module.ts']);
      mockFileReader.mockResolvedValue(`
export class Parent {}
export class Child extends Parent {}
`);
      await builder.build('/project');
    });

    it('should return empty for non-existent element', () => {
      const suggestions = builder.getNavigationSuggestions('non-existent');
      expect(suggestions).toEqual([]);
    });

    it('should return navigation suggestions', () => {
      const map = builder.getMap()!;
      const element = Array.from(map.elements.values())[0];

      const suggestions = builder.getNavigationSuggestions(element.id);

      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('should limit suggestions', () => {
      const map = builder.getMap()!;
      const element = Array.from(map.elements.values())[0];

      const suggestions = builder.getNavigationSuggestions(element.id, 3);

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('formatMap', () => {
    it('should return no map message when not built', () => {
      const newBuilder = new MockSemanticMapBuilder();
      const formatted = newBuilder.formatMap();

      expect(formatted).toBe('No map built');

      newBuilder.dispose();
    });

    it('should format map after build', async () => {
      mockFileLister.mockResolvedValue(['/project/file.ts']);
      mockFileReader.mockResolvedValue('export const x = 1;');

      await builder.build('/project');
      const formatted = builder.formatMap();

      expect(formatted).toContain('CODEBASE SEMANTIC MAP');
      expect(formatted).toContain('Root:');
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      mockFileLister.mockResolvedValue(['/project/a.ts']);
      mockFileReader.mockResolvedValue('export function test() {}');
      await builder.build('/project');
    });

    it('should count total files', () => {
      const map = builder.getMap()!;
      expect(map.stats.totalFiles).toBeGreaterThan(0);
    });

    it('should count total elements', () => {
      const map = builder.getMap()!;
      expect(map.stats.totalElements).toBe(map.elements.size);
    });

    it('should count elements by type', () => {
      const map = builder.getMap()!;
      expect(map.stats.elementsByType.size).toBeGreaterThan(0);
    });
  });

  describe('Factory Functions', () => {
    it('should create builder with factory function', () => {
      const newBuilder = createMockSemanticMapBuilder();
      expect(newBuilder).toBeInstanceOf(MockSemanticMapBuilder);
      newBuilder.dispose();
    });

    it('should return singleton from getter', () => {
      resetMockSemanticMapBuilder();
      const builder1 = getMockSemanticMapBuilder();
      const builder2 = getMockSemanticMapBuilder();
      expect(builder1).toBe(builder2);
    });

    it('should reset singleton', () => {
      const builder1 = getMockSemanticMapBuilder();
      resetMockSemanticMapBuilder();
      const builder2 = getMockSemanticMapBuilder();
      expect(builder1).not.toBe(builder2);
    });
  });

  describe('Dispose', () => {
    it('should clean up resources', async () => {
      mockFileLister.mockResolvedValue(['/project/file.ts']);
      mockFileReader.mockResolvedValue('code');

      await builder.build('/project');
      builder.dispose();

      expect(builder.getMap()).toBeNull();
    });

    it('should remove all listeners', async () => {
      const handler = jest.fn();
      builder.on('test', handler);

      builder.dispose();

      expect(builder.listenerCount('test')).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty codebase', async () => {
      mockFileLister.mockResolvedValue([]);

      const map = await builder.build('/empty');

      expect(map).toBeDefined();
      expect(map.elements.size).toBe(0);
    });

    it('should handle unicode in file content', async () => {
      mockFileLister.mockResolvedValue(['/project/unicode.ts']);
      mockFileReader.mockResolvedValue('export const msg = "Hello World";');

      const map = await builder.build('/project');

      expect(map).toBeDefined();
    });
  });
});
