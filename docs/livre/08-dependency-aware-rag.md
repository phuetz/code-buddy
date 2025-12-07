# Chapitre 8 — Dependency-Aware RAG 🕸️

---

## 🎬 Scène d'ouverture

*Lina a implémenté le RAG basique du chapitre précédent. Les résultats sont meilleurs, mais quelque chose la frustre.*

**Lina** : "Explique la fonction `processPayment`."

*L'agent retourne le code de processPayment — parfait. Mais quand elle pose une question de suivi...*

**Lina** : "Quel est le format du type `PaymentResult` ?"

*L'agent hésite, puis répond avec des informations génériques qui ne correspondent pas à son code.*

**Lina** *(frustrée)* : "Mais PaymentResult est défini juste à côté, dans `types.ts` ! Pourquoi il ne le trouve pas ?"

**Marc** : "Ton RAG trouve le fichier que tu demandes, mais il ne comprend pas les **relations** entre les fichiers. `processPayment` importe `PaymentResult`, mais le RAG ne suit pas cet import."

**Lina** : "Donc il me faut un RAG qui comprend le graphe de dépendances du code ?"

**Marc** : "Exactement. On appelle ça **Dependency-Aware RAG**. Au lieu de chercher des fichiers isolés, on suit les liens : imports, types référencés, fonctions appelées..."

*Lina sort son carnet et commence à dessiner un graphe avec des flèches entre les fichiers.*

---

## 📋 Table des matières

| Section | Titre | Description |
|:-------:|-------|-------------|
| 8.1 | 🚫 Le Problème du Contexte Isolé | Pourquoi le RAG classique échoue |
| 8.2 | 🕸️ Architecture du Graphe | Structure de données et visualisation |
| 8.3 | 🔨 Construction du Graphe | Analyse des imports et types |
| 8.4 | 🔍 Retrieval avec Dépendances | Algorithme d'expansion |
| 8.5 | 🎯 Stratégies d'Expansion | Adapter selon le contexte |
| 8.6 | 🛠️ Implémentation | Le module dans Grok-CLI |
| 8.7 | ⚡ Optimisations | Cache et mise à jour incrémentale |
| 8.8 | 💼 Cas Pratiques | Exemples concrets d'utilisation |

---

## 8.1 🚫 Le Problème du Contexte Isolé

### 8.1.1 Exemple concret

Considérons ce code TypeScript typique :

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

**Le RAG classique retourne uniquement `processor.ts`**. Mais pour vraiment comprendre ce code, il nous faut aussi :

| Fichier | Contenu nécessaire | Pourquoi |
|---------|-------------------|----------|
| `types.ts` | PaymentRequest, PaymentResult | Comprendre les structures de données |
| `stripe.ts` | StripeClient.charge | Comprendre l'implémentation |
| `validation.ts` | validateAmount | Comprendre les règles métier |

### 8.1.2 Impact sur la qualité des réponses

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ⚖️ COMPARAISON RAG                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❓ Question : "Quels champs contient PaymentRequest ?"                 │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════   │
│  ❌ AVEC RAG CLASSIQUE                                                  │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Contexte fourni :                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  processor.ts uniquement                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Réponse LLM :                                                          │
│  "PaymentRequest contient probablement amount, currency..."            │
│  → 😱 HALLUCINATION (invente les champs)                               │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════   │
│  ✅ AVEC DEPENDENCY-AWARE RAG                                           │
│  ═══════════════════════════════════════════════════════════════════   │
│                                                                         │
│  Contexte fourni :                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  processor.ts + types.ts (via import)                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Réponse LLM :                                                          │
│  "D'après types.ts, PaymentRequest contient :                          │
│   - amount: number                                                      │
│   - currency: string                                                    │
│   - customerId: string                                                  │
│   - metadata: Record<string, unknown>"                                 │
│  → ✅ CORRECT (basé sur le vrai code)                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8.2 🕸️ Architecture du Dependency Graph

### 8.2.1 Structure de données

Le graphe de dépendances représente les relations entre les différentes entités du code :

```typescript
// src/context/dependency-graph/types.ts

interface DependencyNode {
  // 🏷️ Identité
  id: string;
  filePath: string;
  type: 'file' | 'function' | 'class' | 'type' | 'variable';
  name: string;

  // ➡️ Relations sortantes (ce que ce nœud UTILISE)
  imports: DependencyEdge[];      // import X from Y
  calls: DependencyEdge[];        // appelle fonction X
  references: DependencyEdge[];   // référence type X

  // ⬅️ Relations entrantes (ce qui UTILISE ce nœud)
  importedBy: DependencyEdge[];   // importé par Y
  calledBy: DependencyEdge[];     // appelé par Y
  referencedBy: DependencyEdge[]; // référencé par Y
}

interface DependencyEdge {
  source: string;  // ID du nœud source
  target: string;  // ID du nœud cible
  type: EdgeType;
  line?: number;   // Ligne où la relation apparaît
}

type EdgeType =
  | 'import'          // import statement
  | 'call'            // function call
  | 'type_reference'  // type annotation
  | 'extends'         // class extends
  | 'implements';     // class implements

interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];

  // 🔍 Méthodes de traversal
  getOutgoing(nodeId: string): DependencyNode[];
  getIncoming(nodeId: string): DependencyNode[];
  getTransitiveDeps(nodeId: string, maxDepth: number): DependencyNode[];
}
```

### 8.2.2 Visualisation du graphe

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      🕸️ DEPENDENCY GRAPH                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                       ┌─────────────────┐                               │
│                       │  processor.ts   │                               │
│                       │ processPayment  │                               │
│                       └────────┬────────┘                               │
│                                │                                        │
│               ┌────────────────┼────────────────┐                       │
│               │                │                │                       │
│               ▼                ▼                ▼                       │
│      ┌────────────┐   ┌────────────┐   ┌────────────────┐              │
│      │  types.ts  │   │ stripe.ts  │   │ validation.ts  │              │
│      ├────────────┤   ├────────────┤   ├────────────────┤              │
│      │PaymentReq  │   │StripeClient│   │ validateAmount │              │
│      │PaymentRes  │   └──────┬─────┘   └────────────────┘              │
│      └────────────┘          │                                          │
│                              │                                          │
│                              ▼                                          │
│                     ┌────────────┐                                      │
│                     │ config.ts  │                                      │
│                     ├────────────┤                                      │
│                     │ STRIPE_KEY │                                      │
│                     └────────────┘                                      │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│  Légende :                                                              │
│                                                                         │
│    ──▶  import (dépendance directe)                                    │
│    ┄┄▶  type_reference (référence de type)                             │
│    ══▶  extends/implements (héritage)                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

| Type de relation | Direction | Exemple | Importance |
|------------------|-----------|---------|:----------:|
| `import` | A → B | `import X from './B'` | ⭐⭐⭐⭐⭐ |
| `type_reference` | A → B | `function f(): TypeFromB` | ⭐⭐⭐⭐ |
| `extends` | A → B | `class A extends B` | ⭐⭐⭐⭐⭐ |
| `implements` | A → B | `class A implements B` | ⭐⭐⭐⭐ |
| `call` | A → B | `B.method()` | ⭐⭐⭐ |
| `calledBy` | B ← A | Inverse de call | ⭐⭐ |

---

## 8.3 🔨 Construction du Graphe

### 8.3.1 Analyse des imports

L'analyse des imports utilise le compilateur TypeScript pour parser l'AST :

```typescript
// src/context/dependency-graph/import-analyzer.ts
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

interface ImportInfo {
  type: 'default' | 'named' | 'namespace';
  name: string;
  alias?: string;
  source: string;
  line: number;
}

export class ImportAnalyzer {
  /**
   * Analyse un fichier et extrait tous ses imports.
   * Supporte : default, named, namespace imports.
   */
  analyzeFile(filePath: string, content: string): ImportInfo[] {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true  // setParentNodes
    );

    const imports: ImportInfo[] = [];

    ts.forEachChild(sourceFile, node => {
      if (ts.isImportDeclaration(node)) {
        const importPath = (node.moduleSpecifier as ts.StringLiteral).text;
        const importClause = node.importClause;
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart()
        ).line + 1;

        if (importClause) {
          // 1️⃣ Default import: import X from './Y'
          if (importClause.name) {
            imports.push({
              type: 'default',
              name: importClause.name.text,
              source: importPath,
              line
            });
          }

          // 2️⃣ Named imports: import { X, Y } from './Z'
          if (importClause.namedBindings) {
            if (ts.isNamedImports(importClause.namedBindings)) {
              for (const element of importClause.namedBindings.elements) {
                imports.push({
                  type: 'named',
                  name: element.name.text,
                  alias: element.propertyName?.text,
                  source: importPath,
                  line
                });
              }
            }

            // 3️⃣ Namespace import: import * as X from './Y'
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              imports.push({
                type: 'namespace',
                name: importClause.namedBindings.name.text,
                source: importPath,
                line
              });
            }
          }
        }
      }
    });

    return imports;
  }

  /**
   * Résout un chemin d'import en chemin absolu de fichier.
   * Gère : chemins relatifs, extensions, index files, aliases.
   */
  resolveImportPath(importPath: string, fromFile: string): string | null {
    // Chemins relatifs (./X ou ../X)
    if (importPath.startsWith('.')) {
      const dir = path.dirname(fromFile);
      let resolved = path.resolve(dir, importPath);

      // Essayer différentes extensions
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js'];
      for (const ext of extensions) {
        const withExt = resolved + ext;
        if (fs.existsSync(withExt)) {
          return withExt;
        }
      }
    }

    // Gestion des aliases tsconfig (ex: @/ → src/)
    return this.resolveAlias(importPath);
  }

  private resolveAlias(importPath: string): string | null {
    // Lire tsconfig.json et résoudre les paths aliases
    // Implementation omise pour la lisibilité
    return null;
  }
}
```

### 8.3.2 Analyse des références de types

```typescript
// src/context/dependency-graph/type-analyzer.ts

interface TypeReference {
  type: 'type_reference' | 'extends' | 'implements';
  name: string;
  line: number;
}

export class TypeAnalyzer {
  /**
   * Analyse un fichier et extrait les références de types :
   * - Type annotations (: SomeType)
   * - Extends clauses
   * - Implements clauses
   */
  analyzeTypeReferences(sourceFile: ts.SourceFile): TypeReference[] {
    const references: TypeReference[] = [];

    const visit = (node: ts.Node) => {
      // Type annotations : function f(): ReturnType
      if (ts.isTypeReferenceNode(node)) {
        const typeName = this.getTypeName(node.typeName);
        references.push({
          type: 'type_reference',
          name: typeName,
          line: this.getLine(sourceFile, node)
        });
      }

      // Extends/Implements : class A extends B implements C
      if (ts.isClassDeclaration(node) && node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          const relationType = clause.token === ts.SyntaxKind.ExtendsKeyword
            ? 'extends'
            : 'implements';

          for (const type of clause.types) {
            references.push({
              type: relationType,
              name: this.getTypeName(type.expression),
              line: this.getLine(sourceFile, node)
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

  private getLine(sourceFile: ts.SourceFile, node: ts.Node): number {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  }
}
```

### 8.3.3 Construction complète du graphe

```typescript
// src/context/dependency-graph/graph-builder.ts

export class DependencyGraphBuilder {
  private importAnalyzer = new ImportAnalyzer();
  private typeAnalyzer = new TypeAnalyzer();

  /**
   * Construit le graphe de dépendances complet pour un projet.
   * Processus en 2 phases :
   * 1. Créer les nœuds (fichiers)
   * 2. Analyser et créer les relations (edges)
   */
  async buildGraph(projectRoot: string): Promise<DependencyGraph> {
    const graph: DependencyGraph = {
      nodes: new Map(),
      edges: [],
      getOutgoing: (id) => this.getOutgoingNodes(graph, id),
      getIncoming: (id) => this.getIncomingNodes(graph, id),
      getTransitiveDeps: (id, depth) => this.getTransitive(graph, id, depth)
    };

    // 📁 Trouver tous les fichiers source
    const files = await glob('**/*.{ts,tsx,js,jsx}', {
      cwd: projectRoot,
      ignore: ['node_modules/**', 'dist/**', 'build/**']
    });

    console.log(`🔍 Analysing ${files.length} files...`);

    // ═══════════════════════════════════════════════════════════
    // PHASE 1 : Créer les nœuds
    // ═══════════════════════════════════════════════════════════
    for (const file of files) {
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

    // ═══════════════════════════════════════════════════════════
    // PHASE 2 : Analyser les relations
    // ═══════════════════════════════════════════════════════════
    for (const file of files) {
      const fullPath = path.join(projectRoot, file);
      const content = await fs.readFile(fullPath, 'utf-8');

      // Analyser les imports
      const imports = this.importAnalyzer.analyzeFile(file, content);
      for (const imp of imports) {
        const targetPath = this.importAnalyzer.resolveImportPath(
          imp.source,
          fullPath
        );

        if (targetPath) {
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
      }

      // Analyser les types (extends, implements, type references)
      const sourceFile = ts.createSourceFile(
        file,
        content,
        ts.ScriptTarget.Latest,
        true
      );
      const typeRefs = this.typeAnalyzer.analyzeTypeReferences(sourceFile);

      for (const ref of typeRefs) {
        // Résoudre le type vers son fichier source
        const targetFile = this.resolveTypeToFile(ref.name, file, graph);
        if (targetFile) {
          const edge: DependencyEdge = {
            source: file,
            target: targetFile,
            type: ref.type,
            line: ref.line
          };

          graph.edges.push(edge);
          graph.nodes.get(file)!.references.push(edge);
          graph.nodes.get(targetFile)!.referencedBy.push(edge);
        }
      }
    }

    console.log(`✅ Graph built: ${graph.nodes.size} nodes, ${graph.edges.length} edges`);
    return graph;
  }

  private getOutgoingNodes(graph: DependencyGraph, nodeId: string): DependencyNode[] {
    const node = graph.nodes.get(nodeId);
    if (!node) return [];

    const targets = new Set<string>();
    [...node.imports, ...node.calls, ...node.references].forEach(e => {
      targets.add(e.target);
    });

    return Array.from(targets)
      .map(id => graph.nodes.get(id))
      .filter((n): n is DependencyNode => n !== undefined);
  }
}
```

---

## 8.4 🔍 Retrieval avec Dépendances

### 8.4.1 Algorithme d'expansion

L'expansion suit les dépendances en **BFS** (Breadth-First Search) avec une profondeur limitée :

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   🔄 ALGORITHME D'EXPANSION                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1️⃣ RETRIEVAL DE BASE                                                   │
│     Query → RAG classique → Top 5 chunks                               │
│                                                                         │
│  2️⃣ INITIALISATION                                                      │
│     Queue = [chunk1, chunk2, chunk3, chunk4, chunk5]                   │
│     Visited = {}                                                        │
│     Results = []                                                        │
│                                                                         │
│  3️⃣ BOUCLE D'EXPANSION (BFS)                                           │
│     ┌────────────────────────────────────────────────────────────┐     │
│     │  WHILE queue not empty AND results < limit:                │     │
│     │                                                            │     │
│     │    chunk = queue.dequeue()                                 │     │
│     │    IF chunk in visited: CONTINUE                           │     │
│     │                                                            │     │
│     │    visited.add(chunk)                                      │     │
│     │    results.add(chunk)                                      │     │
│     │                                                            │     │
│     │    // Suivre les dépendances                               │     │
│     │    FOR dep IN chunk.imports:                               │     │
│     │      dep.score = chunk.score × 0.8  // Décroissance        │     │
│     │      dep.depth = chunk.depth + 1                           │     │
│     │      IF dep.depth < maxDepth:                              │     │
│     │        queue.enqueue(dep)                                  │     │
│     └────────────────────────────────────────────────────────────┘     │
│                                                                         │
│  4️⃣ TRI FINAL                                                           │
│     Results triés par score décroissant                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

```typescript
// src/context/dependency-aware-rag.ts

interface DependencyRetrievalOptions {
  maxDepth?: number;       // Profondeur max d'expansion (défaut: 2)
  maxExpansion?: number;   // Nombre max de chunks ajoutés (défaut: 10)
  includeTypes?: boolean;  // Inclure les définitions de types
  includeCallers?: boolean; // Inclure les appelants (inverse)
}

export class DependencyAwareRAG {
  private baseRetriever: HybridRetriever;
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

    // 1️⃣ Retrieval de base
    const baseResults = await this.baseRetriever.retrieve(query, { topK: 5 });

    // 2️⃣ Expansion BFS
    const expanded = new Set<string>();
    const queue = baseResults.map(r => ({ chunk: r, depth: 0 }));
    const allChunks: RetrievedChunk[] = [...baseResults];

    while (queue.length > 0 && expanded.size < maxExpansion) {
      const { chunk, depth } = queue.shift()!;

      // Skip si déjà visité ou profondeur max atteinte
      if (expanded.has(chunk.id) || depth >= maxDepth) {
        continue;
      }
      expanded.add(chunk.id);

      // Obtenir le nœud dans le graphe
      const node = this.graph.nodes.get(chunk.filePath);
      if (!node) continue;

      // ➡️ Suivre les imports directs
      for (const edge of node.imports) {
        const depChunks = await this.getChunksFromFile(edge.target);
        for (const depChunk of depChunks) {
          if (!expanded.has(depChunk.id)) {
            depChunk.metadata = {
              expansionSource: chunk.id,
              expansionReason: 'import',
              expansionDepth: depth + 1
            };
            depChunk.relevanceScore = chunk.relevanceScore * 0.8;
            allChunks.push(depChunk);
            queue.push({ chunk: depChunk, depth: depth + 1 });
          }
        }
      }

      // 📝 Suivre les références de types
      if (includeTypes) {
        for (const edge of node.references) {
          if (['type_reference', 'extends', 'implements'].includes(edge.type)) {
            const typeChunk = await this.findTypeDefinition(edge.target);
            if (typeChunk && !expanded.has(typeChunk.id)) {
              typeChunk.metadata = {
                expansionSource: chunk.id,
                expansionReason: edge.type
              };
              allChunks.push(typeChunk);
            }
          }
        }
      }

      // ⬅️ Suivre les appelants (relation inverse)
      if (includeCallers) {
        for (const edge of node.calledBy) {
          const callerChunks = await this.getChunksFromFile(edge.source);
          for (const callerChunk of callerChunks) {
            if (!expanded.has(callerChunk.id)) {
              callerChunk.metadata = {
                expansionSource: chunk.id,
                expansionReason: 'calledBy'
              };
              allChunks.push(callerChunk);
            }
          }
        }
      }
    }

    // 3️⃣ Dédupliquer et trier par score
    return this.deduplicateAndSort(allChunks);
  }
}
```

### 8.4.2 Scoring des dépendances

Les dépendances n'ont pas toutes la même importance. Un système de poids permet de prioriser :

```typescript
// src/context/expansion/scoring.ts

const DEPENDENCY_WEIGHTS: Record<string, number> = {
  'import':         0.90,  // Import direct : très pertinent
  'extends':        0.95,  // Héritage : critique pour comprendre
  'implements':     0.90,  // Interface : important
  'type_reference': 0.85,  // Référence de type : souvent nécessaire
  'call':           0.70,  // Appel de fonction : contexte utile
  'calledBy':       0.50   // Appelant : moins pertinent
};

/**
 * Calcule le score d'un chunk après expansion.
 * Le score décroît avec la profondeur et selon le type de relation.
 */
function scoreExpansion(
  baseScore: number,
  depth: number,
  edgeType: string
): number {
  const weight = DEPENDENCY_WEIGHTS[edgeType] ?? 0.5;
  const depthDecay = Math.pow(0.8, depth);  // -20% par niveau

  return baseScore * weight * depthDecay;
}
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    📊 DÉCROISSANCE DU SCORE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Score de base = 1.0                                                    │
│                                                                         │
│  Profondeur 0 (résultat direct) :                                      │
│  ████████████████████████████████████████  1.00                        │
│                                                                         │
│  Profondeur 1 (import direct, weight=0.9) :                            │
│  ████████████████████████████████████░░░░  0.90 × 0.8 = 0.72           │
│                                                                         │
│  Profondeur 2 (import d'import) :                                      │
│  ████████████████████████░░░░░░░░░░░░░░░░  0.72 × 0.8 = 0.58           │
│                                                                         │
│  Profondeur 3 (généralement ignoré) :                                  │
│  ███████████████░░░░░░░░░░░░░░░░░░░░░░░░░  0.58 × 0.8 = 0.46           │
│                                                                         │
│  💡 Au-delà de profondeur 2, le score devient trop faible              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 8.5 🎯 Stratégies d'Expansion

### 8.5.1 Expansion adaptative selon la query

Différents types de questions appellent différentes stratégies :

```typescript
// src/context/expansion/strategies.ts

interface ExpansionStrategy {
  maxDepth: number;
  includeTypes: boolean;
  includeCallers: boolean;
  prioritize: string[];  // Types d'edges à prioriser
}

/**
 * Détermine la meilleure stratégie d'expansion selon la question.
 */
function getExpansionStrategy(query: string): ExpansionStrategy {
  const q = query.toLowerCase();

  // 📝 Questions sur les types/structures
  if (q.match(/type|interface|schema|format|structure|shape/)) {
    return {
      maxDepth: 1,
      includeTypes: true,
      includeCallers: false,
      prioritize: ['type_reference', 'extends', 'implements']
    };
  }

  // 🔄 Questions sur le flux/architecture
  if (q.match(/flow|calls|uses|how.*works|architecture|where.*used/)) {
    return {
      maxDepth: 2,
      includeTypes: true,
      includeCallers: true,  // Important pour comprendre le flux
      prioritize: ['call', 'calledBy', 'import']
    };
  }

  // 🔧 Questions sur l'implémentation
  if (q.match(/implement|code|function|method|how to/)) {
    return {
      maxDepth: 2,
      includeTypes: true,
      includeCallers: false,
      prioritize: ['import', 'call']
    };
  }

  // 🐛 Questions de débogage
  if (q.match(/error|bug|fail|wrong|fix|debug/)) {
    return {
      maxDepth: 2,
      includeTypes: true,
      includeCallers: true,  // Voir d'où vient l'appel
      prioritize: ['import', 'call', 'calledBy']
    };
  }

  // ⚙️ Défaut : expansion modérée
  return {
    maxDepth: 1,
    includeTypes: true,
    includeCallers: false,
    prioritize: ['import', 'type_reference']
  };
}
```

| Type de question | Stratégie | Raison |
|------------------|-----------|--------|
| 📝 Types/Structure | Types only, depth=1 | Besoin des définitions |
| 🔄 Flux/Architecture | Callers + Called, depth=2 | Voir les connexions |
| 🔧 Implémentation | Imports, depth=2 | Code source complet |
| 🐛 Débogage | Full expansion | Tracer l'erreur |

### 8.5.2 Expansion sélective

Ne pas tout inclure — filtrer par pertinence à la query :

```typescript
/**
 * Expansion sélective : n'inclut que les dépendances
 * pertinentes par rapport à la query originale.
 */
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
      const relevance = await computeSemanticSimilarity(
        depChunk.content,
        query
      );

      // Seuil de pertinence : ignorer si trop faible
      if (relevance > 0.3) {
        depChunk.relevanceScore = relevance;
        candidates.push(depChunk);
      }
    }
  }

  // Garder seulement les N plus pertinents
  return candidates
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);
}
```

---

## 8.6 🛠️ Implémentation Grok-CLI

### 8.6.1 Architecture du module

```
┌─────────────────────────────────────────────────────────────────────────┐
│               📁 ARCHITECTURE DEPENDENCY-AWARE RAG                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  src/context/                                                           │
│  │                                                                      │
│  ├── dependency-aware-rag.ts      # 🎯 Point d'entrée principal        │
│  │                                                                      │
│  ├── dependency-graph/                                                 │
│  │   ├── index.ts                 # 📦 Exports                         │
│  │   ├── types.ts                 # 📝 Types et interfaces             │
│  │   ├── graph-builder.ts         # 🔨 Construction du graphe          │
│  │   ├── import-analyzer.ts       # 📥 Analyse des imports             │
│  │   ├── type-analyzer.ts         # 📝 Analyse des types               │
│  │   ├── call-analyzer.ts         # 📞 Analyse des appels              │
│  │   └── graph-store.ts           # 💾 Persistance (cache)             │
│  │                                                                      │
│  └── expansion/                                                        │
│      ├── strategies.ts            # 🎯 Stratégies d'expansion          │
│      └── scoring.ts               # 📊 Scoring des dépendances         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.6.2 Classe principale

```typescript
// src/context/dependency-aware-rag.ts

import { DependencyGraph, DependencyGraphBuilder } from './dependency-graph';
import { HybridRetriever } from './codebase-rag/retriever';
import { getExpansionStrategy, ExpansionStrategy } from './expansion/strategies';

interface RetrievalResult {
  chunks: RetrievedChunk[];
  subgraph: SubGraph;  // Sous-graphe des fichiers inclus
  stats: {
    baseRetrieved: number;
    afterExpansion: number;
    expansionRatio: number;
  };
}

export class DependencyAwareRAG {
  private graph: DependencyGraph | null = null;
  private retriever: HybridRetriever;
  private graphBuilder: DependencyGraphBuilder;
  private initialized = false;

  constructor(retriever: HybridRetriever) {
    this.retriever = retriever;
    this.graphBuilder = new DependencyGraphBuilder();
  }

  /**
   * Initialise le RAG en construisant le graphe de dépendances.
   * À appeler une fois au démarrage du projet.
   */
  async initialize(projectRoot: string): Promise<void> {
    if (this.initialized) return;

    console.log('🔍 Building dependency graph...');
    const start = Date.now();

    this.graph = await this.graphBuilder.buildGraph(projectRoot);

    console.log(`✅ Graph ready in ${Date.now() - start}ms`);
    console.log(`   📊 ${this.graph.nodes.size} nodes`);
    console.log(`   🔗 ${this.graph.edges.length} edges`);

    this.initialized = true;
  }

  /**
   * Retrieval principal avec expansion des dépendances.
   */
  async retrieve(
    query: string,
    options: Partial<RetrievalOptions> = {}
  ): Promise<RetrievalResult> {
    if (!this.graph) {
      throw new Error('DependencyAwareRAG not initialized. Call initialize() first.');
    }

    // 🎯 Déterminer la stratégie d'expansion
    const strategy = options.strategy ?? getExpansionStrategy(query);

    // 🔍 Retrieval de base
    const baseChunks = await this.retriever.retrieve(query, {
      topK: options.baseTopK ?? 5
    });

    // 🔄 Expansion avec dépendances
    const expandedChunks = await this.expandWithDependencies(
      baseChunks,
      strategy,
      query
    );

    // 📊 Stats et résultat
    return {
      chunks: expandedChunks,
      subgraph: this.buildSubgraph(expandedChunks),
      stats: {
        baseRetrieved: baseChunks.length,
        afterExpansion: expandedChunks.length,
        expansionRatio: expandedChunks.length / Math.max(baseChunks.length, 1)
      }
    };
  }

  /**
   * Construit le sous-graphe des fichiers inclus.
   * Utile pour visualiser les relations.
   */
  private buildSubgraph(chunks: RetrievedChunk[]): SubGraph {
    const files = new Set(chunks.map(c => c.filePath));
    const nodes = new Map<string, DependencyNode>();
    const edges: DependencyEdge[] = [];

    for (const file of files) {
      const node = this.graph!.nodes.get(file);
      if (node) {
        nodes.set(file, node);

        // Inclure seulement les edges internes au sous-graphe
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

## 8.7 ⚡ Optimisations

### 8.7.1 Cache du graphe de dépendances

Le graphe ne change que lorsque les fichiers changent :

```typescript
// src/context/dependency-graph/graph-store.ts

export class GraphStore {
  private cacheFile: string;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.cacheFile = path.join(projectRoot, '.grok/cache/dependency-graph.json');
  }

  /**
   * Charge le graphe depuis le cache si valide.
   */
  async load(): Promise<DependencyGraph | null> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const cached = JSON.parse(data);

      // Vérifier si le cache est encore valide
      if (await this.isStale(cached.timestamp)) {
        console.log('📦 Cache stale, rebuilding...');
        return null;
      }

      console.log('📦 Loading graph from cache...');
      return this.deserialize(cached.graph);
    } catch {
      return null;
    }
  }

  /**
   * Sauvegarde le graphe dans le cache.
   */
  async save(graph: DependencyGraph): Promise<void> {
    const data = {
      timestamp: Date.now(),
      version: 1,
      graph: this.serialize(graph)
    };

    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(data, null, 2));
  }

  /**
   * Vérifie si des fichiers ont changé depuis le cache.
   */
  private async isStale(cacheTimestamp: number): Promise<boolean> {
    const files = await glob('**/*.{ts,tsx,js,jsx}', {
      cwd: this.projectRoot,
      ignore: ['node_modules/**', 'dist/**']
    });

    for (const file of files) {
      const fullPath = path.join(this.projectRoot, file);
      const stat = await fs.stat(fullPath);

      if (stat.mtimeMs > cacheTimestamp) {
        return true;  // Un fichier a été modifié
      }
    }

    return false;
  }
}
```

### 8.7.2 Mise à jour incrémentale

```typescript
/**
 * Met à jour le graphe de façon incrémentale.
 * Plus rapide que de tout reconstruire.
 */
async function updateGraphIncremental(
  graph: DependencyGraph,
  changedFiles: string[]
): Promise<DependencyGraph> {
  for (const file of changedFiles) {
    // 1️⃣ Supprimer l'ancien nœud et ses edges
    const oldNode = graph.nodes.get(file);
    if (oldNode) {
      // Retirer les edges sortants
      graph.edges = graph.edges.filter(e =>
        e.source !== file && e.target !== file
      );
      graph.nodes.delete(file);
    }

    // 2️⃣ Réanalyser le fichier s'il existe encore
    const exists = await fs.access(file).then(() => true).catch(() => false);
    if (exists) {
      const content = await fs.readFile(file, 'utf-8');
      const newNode = await analyzeFile(file, content);
      graph.nodes.set(file, newNode);

      // Ajouter les nouveaux edges
      for (const edge of newNode.imports) {
        graph.edges.push(edge);
        // Mettre à jour les relations inverses
        const targetNode = graph.nodes.get(edge.target);
        if (targetNode) {
          targetNode.importedBy.push(edge);
        }
      }
    }
  }

  return graph;
}
```

| Méthode | Temps (100 fichiers) | Temps (1000 fichiers) |
|---------|:--------------------:|:---------------------:|
| Full rebuild | ~2s | ~15s |
| Incrémental (1 fichier) | ~50ms | ~50ms |
| Depuis cache | ~100ms | ~500ms |

---

## 8.8 💼 Cas Pratiques

### Cas 1 : Comprendre une fonction

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ❓ Query : "Explique comment fonctionne createUser"                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ Sans Dependency-Aware RAG :                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Retourne : user-service.ts (createUser)                        │   │
│  │  → LLM doit deviner les types User, CreateUserInput            │   │
│  │  → Peut halluciner sur les validations                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ✅ Avec Dependency-Aware RAG :                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Retourne :                                                      │   │
│  │  ├── user-service.ts (createUser)        ← Résultat direct      │   │
│  │  ├── types/user.ts (User, CreateUserInput) ← via type_reference │   │
│  │  ├── validators/user.ts (validateUser)   ← via call             │   │
│  │  └── database/user-repo.ts (UserRepo)    ← via import           │   │
│  │                                                                  │   │
│  │  → LLM a tout le contexte nécessaire                            │   │
│  │  → Réponse précise et complète                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cas 2 : Analyse d'impact (refactoring)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ❓ Query : "Quels fichiers seront affectés si je change UserRepo ?"    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Strategy : includeCallers = true (suivre les appelants)               │
│                                                                         │
│  Résultat via calledBy :                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │     ┌────────────────────┐                                      │   │
│  │     │  UserRepository    │ ◄── Fichier modifié                  │   │
│  │     └─────────┬──────────┘                                      │   │
│  │               │                                                  │   │
│  │    ┌──────────┼──────────┬─────────────┐                        │   │
│  │    ▼          ▼          ▼             ▼                        │   │
│  │  user-svc  auth-svc  admin-ctrl   user.test                     │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  → Liste complète des fichiers à vérifier/modifier                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Cas 3 : Débogage

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ❓ Query : "Pourquoi createOrder échoue avec 'Invalid payment' ?"      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Expansion automatique (suit le flux de l'erreur) :                    │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  order-service.ts ─────▶ payment-service.ts                     │   │
│  │  (createOrder)           (validatePayment)                      │   │
│  │        │                       │                                │   │
│  │        ▼                       ▼                                │   │
│  │  types/payment.ts        validators/payment.ts                  │   │
│  │  (PaymentMethod)         (isValidMethod)                        │   │
│  │                          └─── 💥 SOURCE DE L'ERREUR            │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Le LLM peut tracer le flux et identifier la cause racine             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📝 Points Clés

| Concept | Point clé |
|---------|-----------|
| 🚫 **Problème** | RAG classique traite les fichiers en isolation |
| 🕸️ **Solution** | Graphe de dépendances + expansion automatique |
| 🔨 **Construction** | Analyse AST : imports, types, appels |
| 🔍 **Algorithme** | BFS avec scoring décroissant par profondeur |
| 🎯 **Stratégies** | Adapter l'expansion au type de question |
| ⚡ **Performance** | Cache + mise à jour incrémentale |

---

## 🏋️ Exercices

### Exercice 1 : Construire un graphe
**Objectif** : Visualiser les dépendances d'un projet

```bash
# 1. Construire le graphe (10 fichiers max)
node scripts/build-graph.js ./my-project

# 2. Exporter en format DOT
node scripts/export-dot.js > graph.dot

# 3. Visualiser avec Graphviz
dot -Tpng graph.dot -o graph.png
```

### Exercice 2 : Comparaison
**Objectif** : Mesurer l'amélioration

| Question | RAG classique | Dependency-Aware | Amélioration |
|----------|:-------------:|:----------------:|:------------:|
| "Explique createUser" | | | |
| "Quels types utilise X" | | | |
| "Qui appelle Y" | | | |

### Exercice 3 : Stratégie custom
**Objectif** : Implémenter une stratégie pour "qui appelle X ?"

```typescript
// Votre implémentation
function getCallersStrategy(): ExpansionStrategy {
  return {
    maxDepth: ???,
    includeTypes: ???,
    includeCallers: ???,
    prioritize: [???]
  };
}
```

### Exercice 4 : Sweet spot de profondeur
**Objectif** : Trouver le meilleur maxDepth

| maxDepth | Chunks retournés | Temps (ms) | Pertinence |
|:--------:|:----------------:|:----------:|:----------:|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## 📚 Références

| Type | Référence |
|------|-----------|
| 📄 Paper | Jimenez, C., et al. (2024). "CodeRAG: Retrieval-Augmented Generation for Code" |
| 📄 Paper | Zhang, Y., et al. (2023). "RepoFusion: Training Code Models to Understand Your Repository" |
| 💻 Code | Grok-CLI : `src/context/dependency-aware-rag.ts` |
| 🔗 Tool | TypeScript Compiler API : AST analysis |

---

## 🌅 Épilogue

*Le lendemain matin. Lina teste son nouveau système.*

**Lina** : "Explique comment fonctionne `processPayment` et son type de retour."

*L'agent récupère non seulement processPayment, mais aussi types.ts avec PaymentResult.*

**Agent** : *"La fonction `processPayment` dans `processor.ts` retourne un `PaymentResult` (défini dans `types.ts` ligne 15) qui contient : `success: boolean`, `transactionId: string`, `amount: number`..."*

**Lina** *(souriant)* : "Il comprend les relations entre les fichiers maintenant !"

*Mais son sourire se fige quand elle regarde les statistiques.*

**Lina** : "Attends... 47 000 tokens de contexte pour une seule question ?"

*Elle vérifie. Le graphe de dépendances a explosé.*

**Marc** *(regardant par-dessus son épaule)* : "Ah. Le problème de transitivité."

**Lina** : "`processPayment` importe de `types.ts`. Qui importe de `common.ts`. Qui importe de `utils.ts`. Qui importe..."

**Marc** : "...de la moitié du codebase. Oui. C'est le revers de la médaille."

*Lina calcule mentalement.*

**Lina** : "À ce rythme, on va exploser les coûts API. Et les limites de contexte."

**Marc** : "Il y a une solution. Au lieu de tout garder, on compresse intelligemment. On garde les parties importantes, on résume le reste."

*Il ouvre un papier de recherche sur son écran.*

**Marc** : "JetBrains a publié quelque chose là-dessus. Leur équipe de Saint-Pétersbourg a trouvé comment réduire le contexte de 70% sans perdre en qualité."

**Lina** *(intriguée)* : "70% ? Comment c'est possible ?"

**Marc** : "En comprenant que tout le contexte n'a pas la même importance. Certaines parties sont critiques, d'autres sont du bruit."

*Il ferme son laptop.*

**Marc** : "Prochaine étape : la compression de contexte. L'art de dire beaucoup avec peu."

---

**À suivre** : *Chapitre 9 — Compression de Contexte*

*47 000 tokens pour une question simple. Comment réduire ce contexte à 8 000 tokens sans perdre l'information critique ? La réponse vient d'une équipe de Saint-Pétersbourg — et d'une découverte sur ce que les LLMs "perdent" vraiment.*

---

<div align="center">

**← [Chapitre 7 : RAG Moderne](07-rag-moderne.md)** | **[Sommaire](README.md)** | **[Chapitre 9 : Compression de Contexte](09-context-compression.md) →**

</div>
