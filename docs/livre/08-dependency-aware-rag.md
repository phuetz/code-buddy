# Chapitre 8 — Dependency-Aware RAG

---

> **Scène**
>
> *Lina a implémenté le RAG basique. Ça marche mieux qu'avant, mais quelque chose cloche.*
>
> *"Explique la fonction processPayment," demande-t-elle à son agent.*
>
> *L'agent retourne le code de processPayment, parfait. Mais quand elle pose une question de suivi — "Quel est le format du PaymentResult ?" — l'agent est perdu. Le type PaymentResult est défini dans un autre fichier, et le RAG ne l'a pas récupéré.*
>
> *"Le RAG trouve le fichier demandé, mais pas ses dépendances," réalise-t-elle. "Pour comprendre processPayment, il faut aussi comprendre PaymentRequest, PaymentResult, et le service Stripe."*
>
> *Elle a besoin d'un RAG qui comprend le graphe de dépendances.*

---

## Introduction

Le RAG classique traite chaque fichier comme une unité isolée. Mais le code n'est pas isolé — il forme un réseau de dépendances. **Dependency-Aware RAG** enrichit le retrieval en suivant automatiquement les imports, les types référencés, et les fonctions appelées.

---

## 8.1 Le Problème du Contexte Isolé

### 8.1.1 Exemple concret

```typescript
// src/payments/processor.ts
import { PaymentRequest, PaymentResult } from './types';
import { StripeClient } from '../services/stripe';
import { validateAmount } from '../utils/validation';

export async function processPayment(request: PaymentRequest): Promise<PaymentResult> {
  validateAmount(request.amount);
  const stripe = new StripeClient();
  return stripe.charge(request);
}
```

**RAG classique** : Retourne uniquement `processor.ts`

**Problème** : Pour comprendre ce code, il faut aussi :
- `types.ts` (PaymentRequest, PaymentResult)
- `stripe.ts` (StripeClient.charge)
- `validation.ts` (validateAmount)

### 8.1.2 Impact sur la qualité

```
Question : "Quels champs contient PaymentRequest ?"

Avec RAG classique :
─────────────────────
Contexte : processor.ts uniquement
Réponse LLM : "PaymentRequest contient probablement amount, currency..."
→ HALLUCINATION (invente les champs)

Avec Dependency-Aware RAG :
───────────────────────────
Contexte : processor.ts + types.ts
Réponse LLM : "PaymentRequest contient amount (number), currency (string),
              customerId (string), metadata (Record<string, unknown>)"
→ CORRECT (basé sur le vrai code)
```

---

## 8.2 Architecture du Dependency Graph

### 8.2.1 Structure de données

```typescript
interface DependencyNode {
  id: string;
  filePath: string;
  type: 'file' | 'function' | 'class' | 'type' | 'variable';
  name: string;

  // Relations sortantes (ce que ce nœud utilise)
  imports: DependencyEdge[];
  calls: DependencyEdge[];
  references: DependencyEdge[];

  // Relations entrantes (ce qui utilise ce nœud)
  importedBy: DependencyEdge[];
  calledBy: DependencyEdge[];
  referencedBy: DependencyEdge[];
}

interface DependencyEdge {
  source: string;  // ID du nœud source
  target: string;  // ID du nœud cible
  type: 'import' | 'call' | 'type_reference' | 'extends' | 'implements';
  line?: number;   // Ligne où la relation apparaît
}

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];

  // Méthodes de traversal
  getOutgoing(nodeId: string): DependencyNode[];
  getIncoming(nodeId: string): DependencyNode[];
  getTransitiveDeps(nodeId: string, maxDepth: number): DependencyNode[];
}
```

### 8.2.2 Visualisation

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DEPENDENCY GRAPH                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│                      ┌─────────────────┐                            │
│                      │  processor.ts   │                            │
│                      │ processPayment  │                            │
│                      └────────┬────────┘                            │
│                               │                                      │
│              ┌────────────────┼────────────────┐                    │
│              │                │                │                     │
│              ▼                ▼                ▼                     │
│     ┌────────────┐   ┌────────────┐   ┌────────────┐               │
│     │  types.ts  │   │ stripe.ts  │   │validation.ts│               │
│     │ PaymentReq │   │StripeClient│   │validateAmount│              │
│     │ PaymentRes │   └────────────┘   └────────────┘               │
│     └────────────┘          │                                        │
│                             │                                        │
│                             ▼                                        │
│                    ┌────────────┐                                   │
│                    │ config.ts  │                                   │
│                    │ STRIPE_KEY │                                   │
│                    └────────────┘                                   │
│                                                                      │
│   Légende :                                                         │
│   ──▶ import/dépendance                                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8.3 Construction du Graphe

### 8.3.1 Analyse des imports

```typescript
// src/context/dependency-graph/import-analyzer.ts
import * as ts from 'typescript';

export class ImportAnalyzer {
  analyzeFile(filePath: string, content: string): ImportInfo[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );

    const imports: ImportInfo[] = [];

    ts.forEachChild(sourceFile, node => {
      if (ts.isImportDeclaration(node)) {
        const importPath = (node.moduleSpecifier as ts.StringLiteral).text;
        const importClause = node.importClause;

        if (importClause) {
          // Default import
          if (importClause.name) {
            imports.push({
              type: 'default',
              name: importClause.name.text,
              source: importPath,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
            });
          }

          // Named imports
          if (importClause.namedBindings) {
            if (ts.isNamedImports(importClause.namedBindings)) {
              for (const element of importClause.namedBindings.elements) {
                imports.push({
                  type: 'named',
                  name: element.name.text,
                  alias: element.propertyName?.text,
                  source: importPath,
                  line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
                });
              }
            }

            // Namespace import (import * as X)
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              imports.push({
                type: 'namespace',
                name: importClause.namedBindings.name.text,
                source: importPath,
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
              });
            }
          }
        }
      }
    });

    return imports;
  }

  resolveImportPath(importPath: string, fromFile: string): string {
    // Gestion des chemins relatifs
    if (importPath.startsWith('.')) {
      const dir = path.dirname(fromFile);
      let resolved = path.resolve(dir, importPath);

      // Ajouter l'extension si nécessaire
      for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) {
          return withExt;
        }
      }
    }

    // Gestion des alias (tsconfig paths)
    return this.resolveAlias(importPath);
  }
}
```

### 8.3.2 Analyse des références de types

```typescript
// src/context/dependency-graph/type-analyzer.ts
export class TypeAnalyzer {
  analyzeTypeReferences(sourceFile: ts.SourceFile): TypeReference[] {
    const references: TypeReference[] = [];

    const visit = (node: ts.Node) => {
      // Type annotations
      if (ts.isTypeReferenceNode(node)) {
        const typeName = this.getTypeName(node.typeName);
        references.push({
          type: 'type_reference',
          name: typeName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
        });
      }

      // Extends/implements
      if (ts.isClassDeclaration(node) && node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          const keyword = clause.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements';
          for (const type of clause.types) {
            references.push({
              type: keyword,
              name: this.getTypeName(type.expression),
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return references;
  }

  private getTypeName(node: ts.Node): string {
    if (ts.isIdentifier(node)) {
      return node.text;
    }
    if (ts.isQualifiedName(node)) {
      return `${this.getTypeName(node.left)}.${node.right.text}`;
    }
    return 'unknown';
  }
}
```

### 8.3.3 Construction complète du graphe

```typescript
// src/context/dependency-graph/graph-builder.ts
export class DependencyGraphBuilder {
  private importAnalyzer = new ImportAnalyzer();
  private typeAnalyzer = new TypeAnalyzer();

  async buildGraph(projectRoot: string): Promise<DependencyGraph> {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: []
    };

    // Trouver tous les fichiers source
    const files = await glob('**/*.{ts,tsx,js,jsx}', {
      cwd: projectRoot,
      ignore: ['node_modules/**', 'dist/**']
    });

    // Phase 1 : Créer les nœuds (fichiers)
    for (const file of files) {
      const fullPath = path.join(projectRoot, file);
      const content = await fs.readFile(fullPath, 'utf-8');

      const node: DependencyNode = {
        id: file,
        filePath: file,
        type: 'file',
        name: path.basename(file),
        imports: [],
        calls: [],
        references: [],
        importedBy: [],
        calledBy: [],
        referencedBy: []
      };

      graph.nodes.set(file, node);
    }

    // Phase 2 : Analyser les relations
    for (const file of files) {
      const fullPath = path.join(projectRoot, file);
      const content = await fs.readFile(fullPath, 'utf-8');

      // Imports
      const imports = this.importAnalyzer.analyzeFile(file, content);
      for (const imp of imports) {
        const targetPath = this.importAnalyzer.resolveImportPath(imp.source, fullPath);
        const relativePath = path.relative(projectRoot, targetPath);

        if (graph.nodes.has(relativePath)) {
          const edge: DependencyEdge = {
            source: file,
            target: relativePath,
            type: 'import',
            line: imp.line
          };

          graph.edges.push(edge);
          graph.nodes.get(file)!.imports.push(edge);
          graph.nodes.get(relativePath)!.importedBy.push(edge);
        }
      }

      // Types
      const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      const typeRefs = this.typeAnalyzer.analyzeTypeReferences(sourceFile);
      // ... ajouter les edges pour les références de types
    }

    return graph;
  }
}
```

---

## 8.4 Retrieval avec Dépendances

### 8.4.1 Algorithme d'expansion

```typescript
// src/context/dependency-aware-rag.ts
export class DependencyAwareRAG {
  private baseRetriever: CodebaseRetriever;
  private graph: DependencyGraph;

  async retrieve(
    query: string,
    options: DependencyRetrievalOptions = {}
  ): Promise<RetrievedChunk[]> {
    const {
      maxDepth = 2,
      maxExpansion = 10,
      includeTypes = true,
      includeCallers = false
    } = options;

    // 1. Retrieval de base
    const baseResults = await this.baseRetriever.retrieve(query, {
      topK: 5
    });

    // 2. Expansion par dépendances
    const expanded = new Set<string>();
    const toExpand = baseResults.map(r => ({ chunk: r, depth: 0 }));
    const allChunks: RetrievedChunk[] = [...baseResults];

    while (toExpand.length > 0 && expanded.size < maxExpansion) {
      const { chunk, depth } = toExpand.shift()!;

      if (expanded.has(chunk.id) || depth >= maxDepth) {
        continue;
      }
      expanded.add(chunk.id);

      // Obtenir les dépendances
      const node = this.graph.nodes.get(chunk.filePath);
      if (!node) continue;

      // Imports directs
      for (const edge of node.imports) {
        const depChunks = await this.getChunksFromFile(edge.target);
        for (const depChunk of depChunks) {
          if (!expanded.has(depChunk.id)) {
            depChunk.expansionSource = chunk.id;
            depChunk.expansionReason = 'import';
            depChunk.relevanceScore = chunk.relevanceScore * 0.8; // Décroissance
            allChunks.push(depChunk);
            toExpand.push({ chunk: depChunk, depth: depth + 1 });
          }
        }
      }

      // Types référencés (si demandé)
      if (includeTypes) {
        for (const edge of node.references.filter(e => e.type === 'type_reference')) {
          const typeChunk = await this.findTypeDefinition(edge.target);
          if (typeChunk && !expanded.has(typeChunk.id)) {
            typeChunk.expansionSource = chunk.id;
            typeChunk.expansionReason = 'type';
            allChunks.push(typeChunk);
          }
        }
      }

      // Appelants (si demandé)
      if (includeCallers) {
        for (const edge of node.calledBy) {
          const callerChunks = await this.getChunksFromFile(edge.source);
          for (const callerChunk of callerChunks) {
            if (!expanded.has(callerChunk.id)) {
              callerChunk.expansionSource = chunk.id;
              callerChunk.expansionReason = 'caller';
              allChunks.push(callerChunk);
            }
          }
        }
      }
    }

    // 3. Dédupliquer et trier
    return this.deduplicateAndSort(allChunks);
  }

  private deduplicateAndSort(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const seen = new Map<string, RetrievedChunk>();

    for (const chunk of chunks) {
      const existing = seen.get(chunk.id);
      if (!existing || chunk.relevanceScore > existing.relevanceScore) {
        seen.set(chunk.id, chunk);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }
}
```

### 8.4.2 Scoring des dépendances

Les dépendances ne sont pas toutes égales :

```typescript
interface DependencyWeight {
  type: string;
  weight: number;
}

const DEPENDENCY_WEIGHTS: DependencyWeight[] = [
  { type: 'import', weight: 0.9 },        // Import direct très pertinent
  { type: 'type_reference', weight: 0.85 }, // Types souvent critiques
  { type: 'extends', weight: 0.95 },      // Héritage très important
  { type: 'implements', weight: 0.9 },    // Interface implémentée
  { type: 'call', weight: 0.7 },          // Appel de fonction
  { type: 'calledBy', weight: 0.5 }       // Appelant (moins pertinent)
];

function scoreExpansion(
  baseScore: number,
  depth: number,
  edgeType: string
): number {
  const weight = DEPENDENCY_WEIGHTS.find(w => w.type === edgeType)?.weight ?? 0.5;
  const depthDecay = Math.pow(0.8, depth);  // Décroissance exponentielle

  return baseScore * weight * depthDecay;
}
```

---

## 8.5 Stratégies d'Expansion

### 8.5.1 Expansion sélective

Ne pas tout inclure — sélectionner intelligemment :

```typescript
async function selectiveExpand(
  chunk: RetrievedChunk,
  query: string,
  graph: DependencyGraph
): Promise<RetrievedChunk[]> {
  const node = graph.nodes.get(chunk.filePath);
  if (!node) return [];

  const candidates: RetrievedChunk[] = [];

  for (const edge of node.imports) {
    const depChunks = await getChunksFromFile(edge.target);

    for (const depChunk of depChunks) {
      // Calculer la pertinence par rapport à la query
      const relevance = await computeRelevance(depChunk.content, query);

      if (relevance > 0.3) {  // Seuil de pertinence
        depChunk.relevanceScore = relevance;
        candidates.push(depChunk);
      }
    }
  }

  // Garder les N plus pertinents
  return candidates
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
}
```

### 8.5.2 Expansion par type de query

Adapter l'expansion selon le type de question :

```typescript
function getExpansionStrategy(query: string): ExpansionStrategy {
  const queryLower = query.toLowerCase();

  // Questions sur les types → inclure types et interfaces
  if (queryLower.match(/type|interface|schema|format|structure/)) {
    return {
      maxDepth: 1,
      includeTypes: true,
      includeCallers: false,
      prioritize: ['type_reference', 'extends', 'implements']
    };
  }

  // Questions sur le flux → inclure appelants et appelés
  if (queryLower.match(/flow|calls|uses|how.*works|architecture/)) {
    return {
      maxDepth: 2,
      includeTypes: true,
      includeCallers: true,
      prioritize: ['call', 'calledBy']
    };
  }

  // Questions sur l'implémentation → focus sur les imports
  if (queryLower.match(/implement|code|function|method/)) {
    return {
      maxDepth: 2,
      includeTypes: true,
      includeCallers: false,
      prioritize: ['import']
    };
  }

  // Défaut
  return {
    maxDepth: 1,
    includeTypes: true,
    includeCallers: false,
    prioritize: ['import', 'type_reference']
  };
}
```

---

## 8.6 Implémentation Grok-CLI

### 8.6.1 Architecture

```
src/context/
├── dependency-aware-rag.ts     # RAG principal
├── dependency-graph/
│   ├── index.ts                # Point d'entrée
│   ├── graph-builder.ts        # Construction du graphe
│   ├── import-analyzer.ts      # Analyse des imports
│   ├── type-analyzer.ts        # Analyse des types
│   ├── call-analyzer.ts        # Analyse des appels
│   └── graph-store.ts          # Persistance du graphe
└── expansion/
    ├── strategies.ts           # Stratégies d'expansion
    └── scoring.ts              # Scoring des dépendances
```

### 8.6.2 Classe principale

```typescript
// src/context/dependency-aware-rag.ts
import { DependencyGraph, DependencyGraphBuilder } from './dependency-graph';
import { HybridRetriever } from './codebase-rag/retriever';
import { ExpansionStrategy, getExpansionStrategy } from './expansion/strategies';

export class DependencyAwareRAG {
  private graph: DependencyGraph | null = null;
  private retriever: HybridRetriever;
  private graphBuilder: DependencyGraphBuilder;
  private initialized = false;

  constructor(retriever: HybridRetriever) {
    this.retriever = retriever;
    this.graphBuilder = new DependencyGraphBuilder();
  }

  async initialize(projectRoot: string): Promise<void> {
    if (this.initialized) return;

    console.log('Building dependency graph...');
    const start = Date.now();

    this.graph = await this.graphBuilder.buildGraph(projectRoot);

    console.log(`Graph built in ${Date.now() - start}ms`);
    console.log(`  Nodes: ${this.graph.nodes.size}`);
    console.log(`  Edges: ${this.graph.edges.length}`);

    this.initialized = true;
  }

  async retrieve(
    query: string,
    options: Partial<RetrievalOptions> = {}
  ): Promise<RetrievalResult> {
    if (!this.graph) {
      throw new Error('DependencyAwareRAG not initialized');
    }

    // Déterminer la stratégie d'expansion
    const strategy = options.strategy ?? getExpansionStrategy(query);

    // Retrieval de base
    const baseChunks = await this.retriever.retrieve(query, {
      topK: options.baseTopK ?? 5
    });

    // Expansion avec dépendances
    const expandedChunks = await this.expandWithDependencies(
      baseChunks,
      strategy,
      query
    );

    // Assembler le résultat
    return {
      chunks: expandedChunks,
      graph: this.buildSubgraph(expandedChunks),
      stats: {
        baseRetrieved: baseChunks.length,
        afterExpansion: expandedChunks.length,
        expansionRatio: expandedChunks.length / baseChunks.length
      }
    };
  }

  private async expandWithDependencies(
    baseChunks: RetrievedChunk[],
    strategy: ExpansionStrategy,
    query: string
  ): Promise<RetrievedChunk[]> {
    const result: RetrievedChunk[] = [...baseChunks];
    const visited = new Set<string>(baseChunks.map(c => c.id));
    const queue = baseChunks.map(c => ({ chunk: c, depth: 0 }));

    while (queue.length > 0) {
      const { chunk, depth } = queue.shift()!;

      if (depth >= strategy.maxDepth) continue;

      const node = this.graph!.nodes.get(chunk.filePath);
      if (!node) continue;

      // Collecter les dépendances selon la stratégie
      const deps = this.collectDependencies(node, strategy);

      for (const { targetFile, edgeType } of deps) {
        if (visited.has(targetFile)) continue;
        visited.add(targetFile);

        // Récupérer les chunks du fichier cible
        const targetChunks = await this.retriever.getChunksByFile(targetFile);

        for (const targetChunk of targetChunks) {
          // Scorer la pertinence
          const score = this.scoreDependency(
            chunk.relevanceScore,
            depth + 1,
            edgeType,
            targetChunk,
            query
          );

          if (score >= 0.3) {  // Seuil minimum
            targetChunk.relevanceScore = score;
            targetChunk.metadata = {
              ...targetChunk.metadata,
              expansionSource: chunk.filePath,
              expansionReason: edgeType,
              expansionDepth: depth + 1
            };

            result.push(targetChunk);
            queue.push({ chunk: targetChunk, depth: depth + 1 });
          }
        }
      }
    }

    return result.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  private collectDependencies(
    node: DependencyNode,
    strategy: ExpansionStrategy
  ): Array<{ targetFile: string; edgeType: string }> {
    const deps: Array<{ targetFile: string; edgeType: string }> = [];

    // Imports
    for (const edge of node.imports) {
      deps.push({ targetFile: edge.target, edgeType: 'import' });
    }

    // Types
    if (strategy.includeTypes) {
      for (const edge of node.references) {
        if (['type_reference', 'extends', 'implements'].includes(edge.type)) {
          deps.push({ targetFile: edge.target, edgeType: edge.type });
        }
      }
    }

    // Callers
    if (strategy.includeCallers) {
      for (const edge of node.calledBy) {
        deps.push({ targetFile: edge.source, edgeType: 'calledBy' });
      }
    }

    // Trier par priorité
    return deps.sort((a, b) => {
      const priorityA = strategy.prioritize.indexOf(a.edgeType);
      const priorityB = strategy.prioritize.indexOf(b.edgeType);
      return (priorityA === -1 ? 999 : priorityA) - (priorityB === -1 ? 999 : priorityB);
    });
  }

  private buildSubgraph(chunks: RetrievedChunk[]): SubGraph {
    const files = new Set(chunks.map(c => c.filePath));
    const nodes = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];

    for (const file of files) {
      const node = this.graph!.nodes.get(file);
      if (node) {
        nodes.set(file, node);

        // Inclure seulement les edges vers d'autres fichiers inclus
        for (const edge of [...node.imports, ...node.references]) {
          if (files.has(edge.target)) {
            edges.push(edge);
          }
        }
      }
    }

    return { nodes, edges };
  }
}
```

---

## 8.7 Optimisations

### 8.7.1 Cache du graphe de dépendances

```typescript
// src/context/dependency-graph/graph-store.ts
export class GraphStore {
  private cacheFile: string;

  constructor(projectRoot: string) {
    this.cacheFile = path.join(projectRoot, '.grok/cache/dependency-graph.json');
  }

  async load(): Promise<DependencyGraph | null> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const cached = JSON.parse(data);

      // Vérifier la fraîcheur
      if (await this.isStale(cached.timestamp)) {
        return null;
      }

      return this.deserialize(cached.graph);
    } catch {
      return null;
    }
  }

  async save(graph: DependencyGraph): Promise<void> {
    const data = {
      timestamp: Date.now(),
      graph: this.serialize(graph)
    };

    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(data));
  }

  private async isStale(timestamp: number): Promise<boolean> {
    // Vérifier si des fichiers ont été modifiés depuis
    const files = await glob('**/*.{ts,tsx,js,jsx}', {
      cwd: this.projectRoot,
      ignore: ['node_modules/**']
    });

    for (const file of files) {
      const stat = await fs.stat(path.join(this.projectRoot, file));
      if (stat.mtimeMs > timestamp) {
        return true;
      }
    }

    return false;
  }
}
```

### 8.7.2 Mise à jour incrémentale

```typescript
async function updateGraphIncremental(
  graph: DependencyGraph,
  changedFiles: string[]
): Promise<DependencyGraph> {
  for (const file of changedFiles) {
    // Supprimer l'ancien nœud et ses edges
    const oldNode = graph.nodes.get(file);
    if (oldNode) {
      graph.edges = graph.edges.filter(e =>
        e.source !== file && e.target !== file
      );
      graph.nodes.delete(file);
    }

    // Réanalyser le fichier
    if (await fs.access(file).then(() => true).catch(() => false)) {
      const content = await fs.readFile(file, 'utf-8');
      const node = await analyzeFile(file, content);
      graph.nodes.set(file, node);

      // Ajouter les nouveaux edges
      for (const edge of node.imports) {
        graph.edges.push(edge);
      }
    }
  }

  // Recalculer les relations inverses
  recalculateInverseRelations(graph);

  return graph;
}
```

### 8.7.3 Expansion lazy

```typescript
class LazyDependencyExpander {
  private expansionCache = new Map<string, RetrievedChunk[]>();

  async expand(
    chunk: RetrievedChunk,
    graph: DependencyGraph
  ): Promise<RetrievedChunk[]> {
    // Vérifier le cache
    const cacheKey = `${chunk.id}:${chunk.relevanceScore}`;
    if (this.expansionCache.has(cacheKey)) {
      return this.expansionCache.get(cacheKey)!;
    }

    // Expansion lazy - seulement si nécessaire
    const expanded = await this.doExpand(chunk, graph);

    this.expansionCache.set(cacheKey, expanded);
    return expanded;
  }

  // Invalider le cache quand un fichier change
  invalidate(filePath: string): void {
    for (const [key, chunks] of this.expansionCache.entries()) {
      if (chunks.some(c => c.filePath === filePath)) {
        this.expansionCache.delete(key);
      }
    }
  }
}
```

---

## 8.8 Cas Pratiques

### 8.8.1 Cas 1 : Comprendre une fonction

```
Query : "Explique comment fonctionne createUser"

Sans Dependency-Aware RAG :
───────────────────────────
Retourne : user-service.ts (createUser)
→ LLM doit deviner les types User, CreateUserInput
→ Peut halluciner sur les validations

Avec Dependency-Aware RAG :
────────────────────────────
Retourne :
├── user-service.ts (createUser)
├── types/user.ts (User, CreateUserInput)  ← via type_reference
├── validators/user.ts (validateUser)      ← via call
└── database/user-repo.ts (UserRepository) ← via import

→ LLM a tout le contexte nécessaire
→ Réponse précise et complète
```

### 8.8.2 Cas 2 : Refactoring

```
Query : "Quels fichiers seront affectés si je change UserRepository ?"

Dependency-Aware RAG (includeCallers = true) :
─────────────────────────────────────────────
Analyse calledBy de UserRepository :
├── user-service.ts
├── auth-service.ts
├── admin-controller.ts
└── tests/user.test.ts

→ Liste complète des fichiers à vérifier/modifier
```

### 8.8.3 Cas 3 : Débogage

```
Query : "Pourquoi createOrder échoue avec 'Invalid payment method' ?"

Expansion :
───────────
├── order-service.ts (createOrder)
├── payment-service.ts (validatePayment)    ← suit l'erreur
├── types/payment.ts (PaymentMethod)        ← type concerné
└── validators/payment.ts (isValidMethod)   ← logique de validation

→ Le LLM peut tracer le flux et trouver la cause
```

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | RAG classique ignore les dépendances |
| **Solution** | Graphe de dépendances + expansion automatique |
| **Construction** | Analyse AST des imports, types, appels |
| **Expansion** | BFS avec scoring décroissant par profondeur |
| **Stratégies** | Adapter l'expansion au type de question |
| **Optimisation** | Cache, mise à jour incrémentale |

---

## Exercices

1. **Graphe** : Construisez le graphe de dépendances d'un petit projet (10 fichiers). Visualisez-le avec un outil comme Graphviz.

2. **Comparaison** : Comparez les résultats RAG vs Dependency-Aware RAG sur 5 questions. Mesurez la pertinence.

3. **Stratégies** : Implémentez une stratégie d'expansion custom pour les questions "qui appelle X ?".

4. **Performance** : Mesurez le temps d'expansion pour différentes profondeurs (1, 2, 3). Trouvez le sweet spot.

---

## Pour aller plus loin

- Jimenez, C., et al. (2024). "CodeRAG: A Retrieval-Augmented Generation Framework for Code"
- Grok-CLI : `src/context/dependency-aware-rag.ts`

---

*Prochainement : Chapitre 9 — Context Compression & Masking*

