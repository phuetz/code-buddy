/**
 * Codebase Semantic Map
 *
 * Builds and maintains a semantic understanding of a codebase
 * including structure, relationships, and concepts.
 *
 * Features:
 * - Code element extraction
 * - Relationship analysis
 * - Semantic clustering
 * - Impact analysis
 * - Intelligent navigation
 */

import { EventEmitter } from "events";
import {
  CodeElement,
  CodeRelationship,
  RelationshipType,
  SemanticCluster,
  ClusterCategory,
  ArchitecturalLayer,
  CodeConcept,
  SemanticMap,
  MapStatistics,
  SemanticMapConfig,
  SemanticQuery,
  SemanticQueryResult,
  ImpactAnalysis,
  NavigationSuggestion,
  ElementLocation,
  FileReader,
  FileLister,
  DEFAULT_MAP_CONFIG,
} from "./types.js";
import { getErrorMessage } from "../../types/index.js";

/**
 * Language-specific patterns for element extraction
 */
const LANGUAGE_PATTERNS: Record<string, {
  fileExtensions: string[];
  classPattern: RegExp;
  functionPattern: RegExp;
  interfacePattern: RegExp;
  importPattern: RegExp;
  exportPattern: RegExp;
  variablePattern: RegExp;
  typePattern: RegExp;
}> = {
  typescript: {
    fileExtensions: [".ts", ".tsx"],
    classPattern: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g,
    functionPattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/g,
    interfacePattern: /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([^{]+))?/g,
    importPattern: /import\s+(?:(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+)?['"]([^'"]+)['"]/g,
    exportPattern: /export\s+(?:(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+)?(\w+)/g,
    variablePattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*([^=]+))?\s*=/g,
    typePattern: /(?:export\s+)?type\s+(\w+)(?:\s*<[^>]*>)?\s*=/g,
  },
  javascript: {
    fileExtensions: [".js", ".jsx", ".mjs", ".cjs"],
    classPattern: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g,
    functionPattern: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    interfacePattern: /$/g, // No interfaces in JS
    importPattern: /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
    exportPattern: /export\s+(?:default\s+)?(?:class|function|const|let|var)\s+(\w+)/g,
    variablePattern: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g,
    typePattern: /$/g, // No types in JS
  },
  python: {
    fileExtensions: [".py"],
    classPattern: /class\s+(\w+)(?:\(([^)]*)\))?:/g,
    functionPattern: /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/g,
    interfacePattern: /$/g, // No interfaces in Python
    importPattern: /(?:from\s+(\S+)\s+)?import\s+([^#\n]+)/g,
    exportPattern: /$/g, // Python uses __all__
    variablePattern: /^(\w+)\s*(?::\s*([^=]+))?\s*=/gm,
    typePattern: /$/g,
  },
  go: {
    fileExtensions: [".go"],
    classPattern: /type\s+(\w+)\s+struct\s*\{/g,
    functionPattern: /func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*\(?([^{)]+)\)?)?/g,
    interfacePattern: /type\s+(\w+)\s+interface\s*\{/g,
    importPattern: /import\s+(?:\(\s*)?"([^"]+)"(?:\s*\))?/g,
    exportPattern: /$/g, // Go uses capitalization
    variablePattern: /(?:var|const)\s+(\w+)(?:\s+(\w+))?\s*=/g,
    typePattern: /type\s+(\w+)\s+/g,
  },
};

/**
 * Codebase Semantic Map Builder
 */
export class SemanticMapBuilder extends EventEmitter {
  private config: SemanticMapConfig;
  private fileReader?: FileReader;
  private fileLister?: FileLister;
  private map: SemanticMap | null = null;

  constructor(
    config: Partial<SemanticMapConfig> = {},
    fileReader?: FileReader,
    fileLister?: FileLister
  ) {
    super();
    this.config = { ...DEFAULT_MAP_CONFIG, ...config };
    this.fileReader = fileReader;
    this.fileLister = fileLister;
  }

  /**
   * Build the semantic map for a codebase
   */
  async build(rootPath: string): Promise<SemanticMap> {
    this.emit("map:start", { config: this.config });

    const _startTime = Date.now(); // Reserved for performance metrics

    // Initialize map
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
      stats: this.initializeStats(),
      metadata: {},
    };

    try {
      // Step 1: Discover and analyze files
      const files = await this.discoverFiles(rootPath);

      for (const file of files) {
        try {
          await this.analyzeFile(file);
        } catch (error) {
          this.emit("map:error", { error: getErrorMessage(error), path: file });
        }
      }

      // Step 2: Build relationships
      if (this.config.analyzeImports || this.config.analyzeCalls || this.config.analyzeTypes) {
        await this.buildRelationships();
        this.emit("map:relationships", { count: this.map.relationships.size });
      }

      // Step 3: Build clusters
      if (this.config.buildClusters) {
        await this.buildClusters();
        this.emit("map:clusters", { count: this.map.clusters.size });
      }

      // Step 4: Identify architectural layers
      this.identifyLayers();

      // Step 5: Extract concepts
      this.extractConcepts();

      // Update statistics
      this.updateStats();

      this.emit("map:complete", { stats: this.map.stats });

      return this.map;
    } catch (error) {
      this.emit("map:error", { error: getErrorMessage(error) });
      throw error;
    }
  }

  /**
   * Discover all relevant files
   */
  private async discoverFiles(_rootPath: string): Promise<string[]> {
    if (!this.fileLister) {
      return [];
    }

    const allExtensions = Object.values(LANGUAGE_PATTERNS)
      .flatMap((p) => p.fileExtensions);

    const patterns = allExtensions.map((ext) => `**/*${ext}`);
    const files: string[] = [];

    for (const pattern of patterns) {
      try {
        const matches = await this.fileLister(pattern);
        files.push(...matches);
      } catch {
        // Pattern not supported
      }
    }

    // Filter out excluded paths
    return files.filter((f) =>
      !this.config.excludePaths.some((ex) => f.includes(ex))
    );
  }

  /**
   * Analyze a single file
   */
  private async analyzeFile(filePath: string): Promise<void> {
    if (!this.fileReader) return;

    const content = await this.fileReader(filePath);
    const language = this.detectLanguage(filePath);
    const patterns = LANGUAGE_PATTERNS[language];

    if (!patterns) return;

    const elements: CodeElement[] = [];

    // Create file element
    const fileElement: CodeElement = {
      id: this.createId("file"),
      type: "file",
      name: filePath.split("/").pop() || filePath,
      qualifiedName: filePath,
      filePath,
      location: { startLine: 1, endLine: content.split("\n").length },
      language,
      visibility: "public",
      metadata: { size: content.length },
    };
    elements.push(fileElement);

    // Extract classes
    let match;
    const classPattern = new RegExp(patterns.classPattern.source, patterns.classPattern.flags);
    while ((match = classPattern.exec(content)) !== null) {
      const location = this.getLocationFromOffset(content, match.index);
      elements.push({
        id: this.createId("class"),
        type: "class",
        name: match[1],
        qualifiedName: `${filePath}:${match[1]}`,
        filePath,
        location,
        language,
        visibility: content.slice(Math.max(0, match.index - 10), match.index).includes("export") ? "public" : "private",
        metadata: {
          extends: match[2] || undefined,
          implements: match[3]?.split(",").map((s: string) => s.trim()) || [],
        },
      });
    }

    // Extract functions
    const funcPattern = new RegExp(patterns.functionPattern.source, patterns.functionPattern.flags);
    while ((match = funcPattern.exec(content)) !== null) {
      const location = this.getLocationFromOffset(content, match.index);
      const name = language === "go" ? (match[3] || match[1]) : match[1];
      elements.push({
        id: this.createId("function"),
        type: "function",
        name,
        qualifiedName: `${filePath}:${name}`,
        filePath,
        location,
        language,
        visibility: this.inferVisibility(content, match.index, language),
        signature: match[0].split("{")[0].trim(),
        metadata: {
          params: match[2]?.split(",").map((p: string) => p.trim()) || [],
          returnType: match[3]?.trim(),
        },
      });
    }

    // Extract interfaces
    const interfacePattern = new RegExp(patterns.interfacePattern.source, patterns.interfacePattern.flags);
    while ((match = interfacePattern.exec(content)) !== null) {
      const location = this.getLocationFromOffset(content, match.index);
      elements.push({
        id: this.createId("interface"),
        type: "interface",
        name: match[1],
        qualifiedName: `${filePath}:${match[1]}`,
        filePath,
        location,
        language,
        visibility: "public",
        metadata: {
          extends: match[2]?.split(",").map((s: string) => s.trim()) || [],
        },
      });
    }

    // Extract types
    const typePattern = new RegExp(patterns.typePattern.source, patterns.typePattern.flags);
    while ((match = typePattern.exec(content)) !== null) {
      const location = this.getLocationFromOffset(content, match.index);
      elements.push({
        id: this.createId("type"),
        type: "type",
        name: match[1],
        qualifiedName: `${filePath}:${match[1]}`,
        filePath,
        location,
        language,
        visibility: "public",
        metadata: {},
      });
    }

    // Extract imports
    const importPattern = new RegExp(patterns.importPattern.source, patterns.importPattern.flags);
    while ((match = importPattern.exec(content)) !== null) {
      const location = this.getLocationFromOffset(content, match.index);
      const importedItems = (match[1] || match[2] || "").split(",").map((s: string) => s.trim());
      const source = match[3] || match[1];

      elements.push({
        id: this.createId("import"),
        type: "import",
        name: source,
        qualifiedName: `${filePath}:import:${source}`,
        filePath,
        location,
        language,
        visibility: "private",
        metadata: {
          items: importedItems.filter(Boolean),
          source,
        },
      });
    }

    // Extract variables/constants
    const varPattern = new RegExp(patterns.variablePattern.source, patterns.variablePattern.flags);
    while ((match = varPattern.exec(content)) !== null) {
      const location = this.getLocationFromOffset(content, match.index);
      const isConstant = content.slice(Math.max(0, match.index - 10), match.index).includes("const");

      elements.push({
        id: this.createId("variable"),
        type: isConstant ? "constant" : "variable",
        name: match[1],
        qualifiedName: `${filePath}:${match[1]}`,
        filePath,
        location,
        language,
        visibility: this.inferVisibility(content, match.index, language),
        metadata: {
          varType: match[2]?.trim(),
        },
      });
    }

    // Add elements to map
    for (const element of elements) {
      this.map!.elements.set(element.id, element);
    }

    this.emit("map:file", { path: filePath, elements: elements.length });
  }

  /**
   * Build relationships between elements
   */
  private async buildRelationships(): Promise<void> {
    const elements = Array.from(this.map!.elements.values());

    // Build containment relationships
    for (const element of elements) {
      if (element.type === "file") continue;

      const fileElement = elements.find(
        (e) => e.type === "file" && e.filePath === element.filePath
      );
      if (fileElement) {
        this.addRelationship("contains", fileElement.id, element.id);
      }
    }

    // Build import relationships
    if (this.config.analyzeImports) {
      const imports = elements.filter((e) => e.type === "import");
      for (const imp of imports) {
        const source = imp.metadata.source as string;
        if (!source) continue;

        // Find the imported file/module
        const targetFile = elements.find(
          (e) =>
            e.type === "file" &&
            (e.filePath.includes(source) ||
              e.qualifiedName.includes(source))
        );

        if (targetFile) {
          this.addRelationship("imports", imp.id, targetFile.id);
        }

        // Find imported items
        const items = (imp.metadata.items as string[]) || [];
        for (const item of items) {
          const targetElement = elements.find(
            (e) =>
              e.name === item.replace(/\s+as\s+\w+$/, "").trim() &&
              e.type !== "import"
          );
          if (targetElement) {
            this.addRelationship("imports", imp.id, targetElement.id);
          }
        }
      }
    }

    // Build inheritance relationships
    const classes = elements.filter((e) => e.type === "class");
    for (const cls of classes) {
      const extendsClass = cls.metadata.extends as string;
      if (extendsClass) {
        const parent = classes.find((c) => c.name === extendsClass);
        if (parent) {
          this.addRelationship("extends", cls.id, parent.id);
        }
      }

      const implementsInterfaces = cls.metadata.implements as string[];
      if (implementsInterfaces) {
        for (const ifaceName of implementsInterfaces) {
          const iface = elements.find(
            (e) => e.type === "interface" && e.name === ifaceName.trim()
          );
          if (iface) {
            this.addRelationship("implements", cls.id, iface.id);
          }
        }
      }
    }

    // Build interface extension relationships
    const interfaces = elements.filter((e) => e.type === "interface");
    for (const iface of interfaces) {
      const extendsIfaces = iface.metadata.extends as string[];
      if (extendsIfaces) {
        for (const extName of extendsIfaces) {
          const parent = interfaces.find((i) => i.name === extName.trim());
          if (parent) {
            this.addRelationship("extends", iface.id, parent.id);
          }
        }
      }
    }

    // Build type usage relationships (simple heuristic)
    if (this.config.analyzeTypes) {
      const types = elements.filter((e) => e.type === "type" || e.type === "interface");
      const functions = elements.filter((e) => e.type === "function" || e.type === "method");

      for (const func of functions) {
        const signature = func.signature || "";
        for (const type of types) {
          if (signature.includes(type.name)) {
            this.addRelationship("uses", func.id, type.id, 0.5);
          }
        }
      }
    }
  }

  /**
   * Build semantic clusters
   */
  private async buildClusters(): Promise<void> {
    const elements = Array.from(this.map!.elements.values()).filter(
      (e) => e.type !== "import" && e.type !== "file"
    );

    // Group by directory as a starting point
    const directoryGroups = new Map<string, CodeElement[]>();
    for (const element of elements) {
      const dir = element.filePath.split("/").slice(0, -1).join("/");
      const group = directoryGroups.get(dir) || [];
      group.push(element);
      directoryGroups.set(dir, group);
    }

    // Create clusters from directory groups
    for (const [dir, group] of directoryGroups) {
      if (group.length < this.config.minClusterSize) continue;

      const category = this.inferClusterCategory(dir, group);
      const keywords = this.extractKeywords(group);

      const cluster: SemanticCluster = {
        id: this.createId("cluster"),
        name: dir.split("/").pop() || dir,
        description: `Code elements in ${dir}`,
        category,
        elements: group.map((e) => e.id),
        coherence: this.calculateCoherence(group),
        keywords,
      };

      this.map!.clusters.set(cluster.id, cluster);
    }

    // Merge similar clusters if needed
    this.mergeSimilarClusters();
  }

  /**
   * Identify architectural layers
   */
  private identifyLayers(): void {
    const layers: ArchitecturalLayer[] = [];
    const elements = Array.from(this.map!.elements.values());

    // Common layer patterns
    const layerPatterns: Array<{ pattern: RegExp; name: string; level: number }> = [
      { pattern: /\/ui\/|\/components\/|\/views\/|\/pages\//i, name: "Presentation", level: 1 },
      { pattern: /\/api\/|\/routes\/|\/controllers\//i, name: "API", level: 2 },
      { pattern: /\/services\/|\/business\//i, name: "Business Logic", level: 3 },
      { pattern: /\/data\/|\/models\/|\/entities\//i, name: "Data", level: 4 },
      { pattern: /\/utils\/|\/helpers\/|\/lib\//i, name: "Utilities", level: 5 },
      { pattern: /\/config\/|\/settings\//i, name: "Configuration", level: 6 },
      { pattern: /\/tests?\/|\/spec\//i, name: "Testing", level: 0 },
    ];

    for (const { pattern, name, level } of layerPatterns) {
      const layerElements = elements.filter((e) => pattern.test(e.filePath));
      if (layerElements.length > 0) {
        layers.push({
          id: this.createId("layer"),
          name,
          description: `${name} layer elements`,
          level,
          elements: layerElements.map((e) => e.id),
          dependencies: [],
        });
      }
    }

    // Identify layer dependencies
    for (const layer of layers) {
      for (const elementId of layer.elements) {
        const relationships = Array.from(this.map!.relationships.values()).filter(
          (r) => r.sourceId === elementId && r.type === "imports"
        );

        for (const rel of relationships) {
          const targetElement = this.map!.elements.get(rel.targetId);
          if (!targetElement) continue;

          const targetLayer = layers.find((l) =>
            l.elements.includes(targetElement.id)
          );
          if (targetLayer && targetLayer.id !== layer.id) {
            if (!layer.dependencies.includes(targetLayer.id)) {
              layer.dependencies.push(targetLayer.id);
            }
          }
        }
      }
    }

    this.map!.layers = layers;
  }

  /**
   * Extract concepts from the codebase
   */
  private extractConcepts(): void {
    const elements = Array.from(this.map!.elements.values());

    // Extract concepts from names
    const nameParts = new Map<string, number>();
    for (const element of elements) {
      const parts = this.splitName(element.name);
      for (const part of parts) {
        if (part.length < 3) continue;
        nameParts.set(part.toLowerCase(), (nameParts.get(part.toLowerCase()) || 0) + 1);
      }
    }

    // Create concepts from frequent terms
    const sortedTerms = Array.from(nameParts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    for (const [term, frequency] of sortedTerms) {
      if (frequency < 3) continue;

      const relatedElements = elements
        .filter((e) => e.name.toLowerCase().includes(term))
        .map((e) => e.id);

      const concept: CodeConcept = {
        id: this.createId("concept"),
        name: term,
        description: `Elements related to "${term}"`,
        keywords: [term],
        relatedElements,
        frequency,
        importance: Math.min(1, frequency / 20),
      };

      this.map!.concepts.set(concept.id, concept);
    }
  }

  /**
   * Query the semantic map
   */
  query(query: SemanticQuery): SemanticQueryResult {
    const startTime = Date.now();

    let elements = Array.from(this.map!.elements.values());
    let relationships: CodeRelationship[] = [];
    let clusters: SemanticCluster[] = [];
    let concepts: CodeConcept[] = [];
    const relevanceScores = new Map<string, number>();

    // Filter by element types
    if (query.elementTypes?.length) {
      elements = elements.filter((e) => query.elementTypes!.includes(e.type));
    }

    // Filter by file paths
    if (query.filePaths?.length) {
      elements = elements.filter((e) =>
        query.filePaths!.some((p) => e.filePath.includes(p))
      );
    }

    // Text search
    if (query.text) {
      const searchTerms = query.text.toLowerCase().split(/\s+/);
      elements = elements.filter((e) => {
        const text = `${e.name} ${e.qualifiedName} ${e.description || ""}`.toLowerCase();
        return searchTerms.some((term) => text.includes(term));
      });

      // Calculate relevance scores
      for (const element of elements) {
        const text = `${element.name} ${element.qualifiedName}`.toLowerCase();
        let score = 0;
        for (const term of searchTerms) {
          if (element.name.toLowerCase() === term) score += 1.0;
          else if (element.name.toLowerCase().includes(term)) score += 0.5;
          else if (text.includes(term)) score += 0.2;
        }
        relevanceScores.set(element.id, score);
      }

      // Sort by relevance
      elements.sort(
        (a, b) => (relevanceScores.get(b.id) || 0) - (relevanceScores.get(a.id) || 0)
      );
    }

    // Filter by clusters
    if (query.clusters?.length) {
      const clusterElementIds = new Set<string>();
      for (const clusterId of query.clusters) {
        const cluster = this.map!.clusters.get(clusterId);
        if (cluster) {
          clusters.push(cluster);
          cluster.elements.forEach((id) => clusterElementIds.add(id));
        }
      }
      elements = elements.filter((e) => clusterElementIds.has(e.id));
    }

    // Filter by concepts
    if (query.concepts?.length) {
      const conceptElementIds = new Set<string>();
      for (const conceptId of query.concepts) {
        const concept = this.map!.concepts.get(conceptId);
        if (concept) {
          concepts.push(concept);
          concept.relatedElements.forEach((id) => conceptElementIds.add(id));
        }
      }
      elements = elements.filter((e) => conceptElementIds.has(e.id));
    }

    // Include related elements
    if (query.includeRelated) {
      const relatedIds = new Set<string>();
      const depth = query.relatedDepth || 1;

      for (let d = 0; d < depth; d++) {
        const currentIds = d === 0
          ? elements.map((e) => e.id)
          : Array.from(relatedIds);

        for (const id of currentIds) {
          const rels = Array.from(this.map!.relationships.values()).filter(
            (r) => r.sourceId === id || r.targetId === id
          );
          for (const rel of rels) {
            relationships.push(rel);
            relatedIds.add(rel.sourceId);
            relatedIds.add(rel.targetId);
          }
        }
      }

      // Add related elements
      for (const id of relatedIds) {
        const element = this.map!.elements.get(id);
        if (element && !elements.includes(element)) {
          elements.push(element);
        }
      }
    }

    // Apply max results
    if (query.maxResults) {
      elements = elements.slice(0, query.maxResults);
    }

    return {
      elements,
      relationships,
      clusters,
      concepts,
      relevanceScores,
      queryTime: Date.now() - startTime,
    };
  }

  /**
   * Analyze impact of changing an element
   */
  analyzeImpact(elementId: string): ImpactAnalysis | null {
    const element = this.map?.elements.get(elementId);
    if (!element) return null;

    const directlyAffected: CodeElement[] = [];
    const transitivelyAffected: CodeElement[] = [];
    const affectedTests: CodeElement[] = [];

    // Find direct dependencies (elements that depend on this one)
    const directRels = Array.from(this.map!.relationships.values()).filter(
      (r) => r.targetId === elementId
    );

    for (const rel of directRels) {
      const sourceElement = this.map!.elements.get(rel.sourceId);
      if (sourceElement) {
        if (sourceElement.type === "test") {
          affectedTests.push(sourceElement);
        } else {
          directlyAffected.push(sourceElement);
        }
      }
    }

    // Find transitive dependencies (BFS)
    const visited = new Set<string>(directlyAffected.map((e) => e.id));
    const queue = [...directlyAffected.map((e) => e.id)];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const transitiveRels = Array.from(this.map!.relationships.values()).filter(
        (r) => r.targetId === currentId && !visited.has(r.sourceId)
      );

      for (const rel of transitiveRels) {
        const sourceElement = this.map!.elements.get(rel.sourceId);
        if (sourceElement) {
          visited.add(sourceElement.id);
          queue.push(sourceElement.id);
          if (sourceElement.type === "test") {
            affectedTests.push(sourceElement);
          } else {
            transitivelyAffected.push(sourceElement);
          }
        }
      }
    }

    // Calculate risk level
    const totalAffected = directlyAffected.length + transitivelyAffected.length;
    let riskLevel: "low" | "medium" | "high" | "critical" = "low";
    if (totalAffected > 20) riskLevel = "critical";
    else if (totalAffected > 10) riskLevel = "high";
    else if (totalAffected > 3) riskLevel = "medium";

    // Generate recommendations
    const recommendations: string[] = [];
    if (affectedTests.length > 0) {
      recommendations.push(`Run ${affectedTests.length} affected test(s)`);
    }
    if (directlyAffected.length > 5) {
      recommendations.push("Consider breaking change documentation");
    }
    if (riskLevel === "critical") {
      recommendations.push("Consider incremental changes with feature flags");
    }

    return {
      changedElement: element,
      directlyAffected,
      transitivelyAffected,
      affectedTests,
      riskLevel,
      recommendations,
    };
  }

  /**
   * Get navigation suggestions from an element
   */
  getNavigationSuggestions(elementId: string, limit: number = 5): NavigationSuggestion[] {
    const element = this.map?.elements.get(elementId);
    if (!element) return [];

    const suggestions: NavigationSuggestion[] = [];

    // Get related elements through relationships
    const relationships = Array.from(this.map!.relationships.values()).filter(
      (r) => r.sourceId === elementId || r.targetId === elementId
    );

    for (const rel of relationships) {
      const otherId = rel.sourceId === elementId ? rel.targetId : rel.sourceId;
      const otherElement = this.map!.elements.get(otherId);
      if (!otherElement) continue;

      const reason = rel.sourceId === elementId
        ? `${element.name} ${rel.type} ${otherElement.name}`
        : `${otherElement.name} ${rel.type} ${element.name}`;

      suggestions.push({
        from: element,
        to: otherElement,
        reason,
        relevance: rel.strength,
        relationship: rel.type,
      });
    }

    // Sort by relevance and limit
    return suggestions
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  }

  /**
   * Get the current map
   */
  getMap(): SemanticMap | null {
    return this.map;
  }

  /**
   * Helper methods
   */
  private addRelationship(
    type: RelationshipType,
    sourceId: string,
    targetId: string,
    strength: number = 1.0
  ): void {
    const id = `rel-${sourceId}-${type}-${targetId}`;
    this.map!.relationships.set(id, {
      id,
      type,
      sourceId,
      targetId,
      strength,
      metadata: {},
    });
  }

  private detectLanguage(filePath: string): string {
    const ext = "." + (filePath.split(".").pop() || "");
    for (const [lang, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      if (patterns.fileExtensions.includes(ext)) {
        return lang;
      }
    }
    return "unknown";
  }

  private getLocationFromOffset(content: string, offset: number): ElementLocation {
    const lines = content.slice(0, offset).split("\n");
    return {
      startLine: lines.length,
      endLine: lines.length,
      startColumn: lines[lines.length - 1]?.length || 0,
    };
  }

  private inferVisibility(content: string, offset: number, language: string): "public" | "private" | "protected" | "internal" {
    const prefix = content.slice(Math.max(0, offset - 20), offset);

    if (prefix.includes("export")) return "public";
    if (prefix.includes("private")) return "private";
    if (prefix.includes("protected")) return "protected";

    if (language === "go") {
      // Check if name starts with uppercase
      const nameMatch = content.slice(offset).match(/^[a-zA-Z_]\w*/);
      if (nameMatch && /^[A-Z]/.test(nameMatch[0])) {
        return "public";
      }
      return "private";
    }

    return "public";
  }

  private inferClusterCategory(dir: string, _elements: CodeElement[]): ClusterCategory {
    const lowerDir = dir.toLowerCase();

    if (lowerDir.includes("test") || lowerDir.includes("spec")) return "testing";
    if (lowerDir.includes("config") || lowerDir.includes("settings")) return "configuration";
    if (lowerDir.includes("util") || lowerDir.includes("helper") || lowerDir.includes("lib")) return "utility";
    if (lowerDir.includes("model") || lowerDir.includes("type") || lowerDir.includes("entity")) return "data_model";
    if (lowerDir.includes("api") || lowerDir.includes("route") || lowerDir.includes("endpoint")) return "api";
    if (lowerDir.includes("ui") || lowerDir.includes("component") || lowerDir.includes("view")) return "ui";
    if (lowerDir.includes("service") || lowerDir.includes("business")) return "business_logic";

    return "module";
  }

  private extractKeywords(elements: CodeElement[]): string[] {
    const keywords = new Map<string, number>();

    for (const element of elements) {
      const parts = this.splitName(element.name);
      for (const part of parts) {
        if (part.length >= 3) {
          keywords.set(part.toLowerCase(), (keywords.get(part.toLowerCase()) || 0) + 1);
        }
      }
    }

    return Array.from(keywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k]) => k);
  }

  private calculateCoherence(elements: CodeElement[]): number {
    if (elements.length <= 1) return 1;

    // Calculate based on shared keywords
    const allKeywords = elements.flatMap((e) => this.splitName(e.name));
    const uniqueKeywords = new Set(allKeywords);
    const repetitionRatio = allKeywords.length / uniqueKeywords.size;

    return Math.min(1, repetitionRatio / elements.length);
  }

  private mergeSimilarClusters(): void {
    // Simple merge: combine clusters with similar keywords
    const clusters = Array.from(this.map!.clusters.values());

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const similarity = this.calculateClusterSimilarity(clusters[i], clusters[j]);
        if (similarity > this.config.similarityThreshold) {
          // Merge j into i
          clusters[i].elements.push(...clusters[j].elements);
          clusters[i].keywords = [...new Set([...clusters[i].keywords, ...clusters[j].keywords])];
          this.map!.clusters.delete(clusters[j].id);
        }
      }
    }
  }

  private calculateClusterSimilarity(a: SemanticCluster, b: SemanticCluster): number {
    const aKeywords = new Set(a.keywords);
    const bKeywords = new Set(b.keywords);

    const intersection = new Set([...aKeywords].filter((k) => bKeywords.has(k)));
    const union = new Set([...aKeywords, ...bKeywords]);

    return intersection.size / union.size;
  }

  private splitName(name: string): string[] {
    // Split camelCase, PascalCase, snake_case, kebab-case
    return name
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]/g, " ")
      .split(" ")
      .filter(Boolean);
  }

  private initializeStats(): MapStatistics {
    return {
      totalFiles: 0,
      totalElements: 0,
      totalRelationships: 0,
      totalClusters: 0,
      elementsByType: new Map(),
      relationshipsByType: new Map(),
      averageClusterSize: 0,
      coveragePercent: 0,
    };
  }

  private updateStats(): void {
    if (!this.map) return;

    const stats = this.map.stats;
    stats.totalElements = this.map.elements.size;
    stats.totalRelationships = this.map.relationships.size;
    stats.totalClusters = this.map.clusters.size;

    // Count elements by type
    stats.elementsByType = new Map();
    for (const element of this.map.elements.values()) {
      stats.elementsByType.set(
        element.type,
        (stats.elementsByType.get(element.type) || 0) + 1
      );
    }
    stats.totalFiles = stats.elementsByType.get("file") || 0;

    // Count relationships by type
    stats.relationshipsByType = new Map();
    for (const rel of this.map.relationships.values()) {
      stats.relationshipsByType.set(
        rel.type,
        (stats.relationshipsByType.get(rel.type) || 0) + 1
      );
    }

    // Average cluster size
    if (this.map.clusters.size > 0) {
      const totalClusterElements = Array.from(this.map.clusters.values())
        .reduce((sum, c) => sum + c.elements.length, 0);
      stats.averageClusterSize = totalClusterElements / this.map.clusters.size;
    }
  }

  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Dispose and clean up resources
   */
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

  /**
   * Format map for display
   */
  formatMap(): string {
    if (!this.map) return "No map built";

    const lines: string[] = [];

    lines.push("═".repeat(60));
    lines.push("🗺️  CODEBASE SEMANTIC MAP");
    lines.push("═".repeat(60));
    lines.push("");

    lines.push(`Root: ${this.map.rootPath}`);
    lines.push(`Created: ${this.map.createdAt.toISOString()}`);
    lines.push("");

    lines.push("─".repeat(40));
    lines.push("Statistics:");
    lines.push(`  Files: ${this.map.stats.totalFiles}`);
    lines.push(`  Elements: ${this.map.stats.totalElements}`);
    lines.push(`  Relationships: ${this.map.stats.totalRelationships}`);
    lines.push(`  Clusters: ${this.map.stats.totalClusters}`);
    lines.push(`  Concepts: ${this.map.concepts.size}`);
    lines.push(`  Layers: ${this.map.layers.length}`);

    lines.push("");
    lines.push("─".repeat(40));
    lines.push("Elements by Type:");
    for (const [type, count] of this.map.stats.elementsByType) {
      lines.push(`  ${type}: ${count}`);
    }

    if (this.map.layers.length > 0) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("Architectural Layers:");
      for (const layer of this.map.layers.sort((a, b) => a.level - b.level)) {
        lines.push(`  ${layer.level}. ${layer.name} (${layer.elements.length} elements)`);
      }
    }

    if (this.map.clusters.size > 0) {
      lines.push("");
      lines.push("─".repeat(40));
      lines.push("Top Clusters:");
      const topClusters = Array.from(this.map.clusters.values())
        .sort((a, b) => b.elements.length - a.elements.length)
        .slice(0, 10);
      for (const cluster of topClusters) {
        lines.push(`  • ${cluster.name} [${cluster.category}] (${cluster.elements.length} elements)`);
      }
    }

    lines.push("");
    lines.push("═".repeat(60));

    return lines.join("\n");
  }
}

/**
 * Create a semantic map builder
 */
export function createSemanticMapBuilder(
  config?: Partial<SemanticMapConfig>,
  fileReader?: FileReader,
  fileLister?: FileLister
): SemanticMapBuilder {
  return new SemanticMapBuilder(config, fileReader, fileLister);
}

// Singleton instance
let semanticMapBuilderInstance: SemanticMapBuilder | null = null;

export function getSemanticMapBuilder(): SemanticMapBuilder {
  if (!semanticMapBuilderInstance) {
    semanticMapBuilderInstance = createSemanticMapBuilder();
  }
  return semanticMapBuilderInstance;
}

export function resetSemanticMapBuilder(): void {
  if (semanticMapBuilderInstance) {
    semanticMapBuilderInstance.dispose();
  }
  semanticMapBuilderInstance = null;
}
