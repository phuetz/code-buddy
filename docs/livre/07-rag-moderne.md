# Chapitre 7 — RAG Moderne

---

> **Scène**
>
> *Lina demande à son agent : "Explique-moi comment fonctionne la fonction processPayment."*
>
> *L'agent répond avec assurance... en décrivant une fonction qui n'existe pas dans le codebase.*
>
> *"Il ne connaît pas mon code," réalise-t-elle. "Il invente en se basant sur ce qu'il a vu pendant son entraînement."*
>
> *Elle a besoin d'un moyen de connecter le LLM à sa base de code. Pas juste en copiant-collant des fichiers dans le prompt — ça ne scale pas. Elle a besoin d'un système qui retrouve automatiquement les informations pertinentes.*
>
> *"RAG," murmure-t-elle. "Retrieval-Augmented Generation."*

---

## Introduction

Les LLMs ont une connaissance figée à leur date de cutoff et ne connaissent pas votre code. **RAG** (Retrieval-Augmented Generation) résout ce problème en récupérant dynamiquement les informations pertinentes et en les injectant dans le contexte.

Ce chapitre présente les fondamentaux du RAG et son application au code, posant les bases pour les chapitres suivants sur les techniques avancées.

---

## 7.1 Le Problème du Contexte

### 7.1.1 Les limites du LLM seul

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LIMITES DU LLM SEUL                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. CONNAISSANCE FIGÉE                                              │
│     └─ "Quelle est la dernière version de React ?"                  │
│        → Répond avec une version obsolète (date de cutoff)          │
│                                                                      │
│  2. PAS D'ACCÈS AU CODE PRIVÉ                                       │
│     └─ "Comment fonctionne notre AuthService ?"                     │
│        → Invente une réponse plausible mais fausse                  │
│                                                                      │
│  3. FENÊTRE DE CONTEXTE LIMITÉE                                     │
│     └─ Impossible de mettre tout le codebase dans le prompt         │
│        → 100 fichiers × 500 lignes = 50,000 lignes ≈ 200K tokens    │
│                                                                      │
│  4. COÛT PROPORTIONNEL AU CONTEXTE                                  │
│     └─ Plus de tokens = plus cher                                   │
│        → 100K tokens d'input = $0.30 par requête (GPT-4)            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.1.2 La solution RAG

RAG ajoute une étape de récupération avant la génération :

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ARCHITECTURE RAG                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Question utilisateur                                              │
│            │                                                         │
│            ▼                                                         │
│   ┌────────────────────┐                                            │
│   │     RETRIEVER      │ ◄── Cherche dans la base de connaissances  │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │  Documents trouvés │ (Top K les plus pertinents)                │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │   AUGMENTATION     │ ◄── Injecte dans le prompt                 │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│   ┌────────────────────┐                                            │
│   │    GENERATION      │ ◄── LLM génère avec le contexte            │
│   └─────────┬──────────┘                                            │
│             │                                                        │
│             ▼                                                        │
│        Réponse                                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7.2 Embeddings : La Fondation du RAG

### 7.2.1 Qu'est-ce qu'un embedding ?

Un embedding est une représentation vectorielle d'un texte qui capture son sens :

```
Texte : "function calculateTotal(items)"

Embedding (simplifié, 384 dimensions réelles) :
[0.023, -0.156, 0.089, 0.234, -0.067, 0.145, ...]

Propriétés :
- Textes similaires → vecteurs proches
- Textes différents → vecteurs éloignés
```

### 7.2.2 Similarité cosine

Pour comparer deux embeddings, on utilise la similarité cosine :

```
                    A · B
cos(θ) = ────────────────────
          ||A|| × ||B||

Où :
- A · B = produit scalaire
- ||A|| = norme de A

Résultat :
- 1.0 = identiques
- 0.0 = orthogonaux (non liés)
- -1.0 = opposés
```

```typescript
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 7.2.3 Modèles d'embedding

| Modèle | Dimensions | Spécialisation | Coût |
|--------|------------|----------------|------|
| all-MiniLM-L6-v2 | 384 | Général | Gratuit (local) |
| text-embedding-3-small | 1536 | Général | $0.02/1M tokens |
| text-embedding-3-large | 3072 | Haute précision | $0.13/1M tokens |
| CodeBERT | 768 | Code | Gratuit (local) |
| StarCoder-embed | 1024 | Code | Gratuit (local) |

### 7.2.4 Embedding local avec Transformers.js

```typescript
// src/embeddings/local-embedder.ts
import { pipeline } from '@xenova/transformers';

export class LocalEmbedder {
  private model: any;
  private modelName = 'Xenova/all-MiniLM-L6-v2';

  async initialize(): Promise<void> {
    this.model = await pipeline('feature-extraction', this.modelName);
  }

  async embed(text: string): Promise<number[]> {
    const output = await this.model(text, {
      pooling: 'mean',
      normalize: true
    });

    return Array.from(output.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      results.push(await this.embed(text));
    }

    return results;
  }
}
```

---

## 7.3 Pipeline RAG pour le Code

### 7.3.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────┐
│                    PIPELINE RAG CODE                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   PHASE 1 : INDEXATION (offline, une fois)                          │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Codebase                                                    │   │
│   │     │                                                        │   │
│   │     ▼                                                        │   │
│   │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐     │   │
│   │  │  Parse  │──▶│  Chunk  │──▶│  Embed  │──▶│  Store  │     │   │
│   │  │   AST   │   │(fonctions│   │(vectors)│   │(SQLite) │     │   │
│   │  └─────────┘   │ classes)│   └─────────┘   └─────────┘     │   │
│   │                └─────────┘                                   │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   PHASE 2 : RETRIEVAL (online, chaque requête)                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  Query : "Comment fonctionne processPayment ?"               │   │
│   │     │                                                        │   │
│   │     ▼                                                        │   │
│   │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐     │   │
│   │  │  Embed  │──▶│ Search  │──▶│ Rerank  │──▶│ Return  │     │   │
│   │  │  query  │   │ top 20  │   │ top 5   │   │ context │     │   │
│   │  └─────────┘   └─────────┘   └─────────┘   └─────────┘     │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3.2 Chunking du code

Le découpage du code est crucial. Mauvais chunking = mauvais résultats.

**Mauvais : Chunking par lignes**
```
Chunk 1 (lignes 1-50):
  import ...
  export class UserService {
    constructor() {
      // ...
    }

Chunk 2 (lignes 51-100):
      }
    }

    async getUser(id: string) {
      // Fonction coupée en deux !
```

**Bon : Chunking par AST**
```typescript
// src/context/chunker.ts
import * as parser from '@typescript-eslint/parser';

export class ASTChunker {
  chunk(code: string, filePath: string): Chunk[] {
    const ast = parser.parse(code, {
      sourceType: 'module',
      ecmaVersion: 'latest'
    });

    const chunks: Chunk[] = [];

    // Traverser l'AST
    for (const node of ast.body) {
      if (this.isChunkableNode(node)) {
        chunks.push({
          type: this.getNodeType(node),
          name: this.getNodeName(node),
          content: code.slice(node.range[0], node.range[1]),
          filePath,
          startLine: node.loc.start.line,
          endLine: node.loc.end.line
        });
      }
    }

    return chunks;
  }

  private isChunkableNode(node: any): boolean {
    return [
      'FunctionDeclaration',
      'ClassDeclaration',
      'MethodDefinition',
      'ExportNamedDeclaration',
      'ExportDefaultDeclaration'
    ].includes(node.type);
  }

  private getNodeType(node: any): string {
    switch (node.type) {
      case 'FunctionDeclaration': return 'function';
      case 'ClassDeclaration': return 'class';
      case 'MethodDefinition': return 'method';
      default: return 'other';
    }
  }

  private getNodeName(node: any): string {
    if (node.id?.name) return node.id.name;
    if (node.key?.name) return node.key.name;
    if (node.declaration?.id?.name) return node.declaration.id.name;
    return 'anonymous';
  }
}
```

### 7.3.3 Métadonnées enrichies

Chaque chunk stocke des métadonnées pour améliorer le retrieval :

```typescript
interface CodeChunk {
  // Identité
  id: string;
  filePath: string;
  name: string;
  type: 'function' | 'class' | 'method' | 'variable' | 'type';

  // Contenu
  content: string;
  docstring?: string;
  signature?: string;

  // Position
  startLine: number;
  endLine: number;

  // Relations
  imports: string[];
  exports: string[];
  calls: string[];      // Fonctions appelées
  calledBy?: string[];  // Fonctions qui appellent (calculé)

  // Embedding
  embedding: number[];

  // Métriques
  complexity?: number;  // Complexité cyclomatique
  lastModified: Date;
}
```

---

## 7.4 Retrieval Hybride

### 7.4.1 Les limites du retrieval sémantique seul

Le retrieval par embeddings seul a des faiblesses :

```
Query : "getUserById"

Retrieval sémantique pur :
- Trouve "getUser" (similaire sémantiquement) ✓
- Trouve "fetchUserData" (similaire) ✓
- RATE "getUserById" exact si embedding différent ✗

Problème : Les noms exacts de fonctions/variables
           ne sont pas toujours capturés sémantiquement
```

### 7.4.2 Retrieval hybride : sémantique + keywords

```typescript
// src/context/hybrid-retriever.ts
export class HybridRetriever {
  private semanticWeight = 0.7;
  private keywordWeight = 0.3;

  async retrieve(query: string, limit: number = 10): Promise<RetrievedChunk[]> {
    // 1. Retrieval sémantique (embeddings)
    const semanticResults = await this.semanticSearch(query, limit * 2);

    // 2. Retrieval par keywords (TF-IDF ou BM25)
    const keywordResults = await this.keywordSearch(query, limit * 2);

    // 3. Fusion des scores (Reciprocal Rank Fusion)
    const fused = this.fuseResults(semanticResults, keywordResults);

    // 4. Reranking final
    return fused.slice(0, limit);
  }

  private fuseResults(
    semantic: RetrievedChunk[],
    keyword: RetrievedChunk[]
  ): RetrievedChunk[] {
    const scores = new Map<string, number>();

    // RRF : score = Σ 1/(k + rank)
    const k = 60; // Constante RRF standard

    semantic.forEach((chunk, rank) => {
      const current = scores.get(chunk.id) ?? 0;
      scores.set(chunk.id, current + this.semanticWeight / (k + rank));
    });

    keyword.forEach((chunk, rank) => {
      const current = scores.get(chunk.id) ?? 0;
      scores.set(chunk.id, current + this.keywordWeight / (k + rank));
    });

    // Trier par score fusionné
    const allChunks = new Map([...semantic, ...keyword].map(c => [c.id, c]));

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({
        ...allChunks.get(id)!,
        fusedScore: score
      }));
  }

  private async semanticSearch(query: string, limit: number): Promise<RetrievedChunk[]> {
    const queryEmbedding = await this.embedder.embed(query);

    return this.db.query(`
      SELECT *, cosine_similarity(embedding, ?) as score
      FROM code_chunks
      ORDER BY score DESC
      LIMIT ?
    `, [queryEmbedding, limit]);
  }

  private async keywordSearch(query: string, limit: number): Promise<RetrievedChunk[]> {
    // Tokenizer simple pour le code
    const tokens = this.tokenize(query);

    // BM25 search
    return this.db.query(`
      SELECT *, bm25(code_chunks_fts) as score
      FROM code_chunks_fts
      WHERE code_chunks_fts MATCH ?
      ORDER BY score DESC
      LIMIT ?
    `, [tokens.join(' OR '), limit]);
  }

  private tokenize(text: string): string[] {
    return text
      .split(/[\s\.\(\)\{\}\[\]<>:;,]+/)
      .filter(t => t.length > 2)
      .map(t => t.toLowerCase());
  }
}
```

### 7.4.3 Reranking avec Cross-Encoder

Pour affiner les résultats, un cross-encoder compare directement query et documents :

```typescript
// src/context/reranker.ts
export class CrossEncoderReranker {
  private model: any;

  async rerank(
    query: string,
    candidates: RetrievedChunk[],
    topK: number
  ): Promise<RetrievedChunk[]> {
    // Score chaque paire (query, document)
    const scores = await Promise.all(
      candidates.map(async chunk => {
        const score = await this.model.predict(query, chunk.content);
        return { chunk, score };
      })
    );

    // Trier et retourner top K
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => ({ ...s.chunk, rerankScore: s.score }));
  }
}
```

---

## 7.5 Augmentation du Prompt

### 7.5.1 Injection de contexte

Une fois les documents récupérés, il faut les injecter intelligemment :

```typescript
function buildAugmentedPrompt(
  query: string,
  retrievedChunks: RetrievedChunk[]
): string {
  const contextSection = retrievedChunks.map(chunk => `
### ${chunk.filePath} (${chunk.type}: ${chunk.name})
\`\`\`${getLanguage(chunk.filePath)}
${chunk.content}
\`\`\`
`).join('\n');

  return `
Tu es un assistant de développement. Utilise le contexte fourni pour répondre.

## Contexte du codebase

${contextSection}

## Question

${query}

## Instructions
- Base ta réponse UNIQUEMENT sur le contexte fourni
- Si l'information n'est pas dans le contexte, dis-le
- Cite les fichiers et lignes quand tu fais référence au code
`;
}
```

### 7.5.2 Gestion de la limite de tokens

```typescript
function fitToTokenLimit(
  chunks: RetrievedChunk[],
  query: string,
  maxTokens: number
): RetrievedChunk[] {
  const encoder = getTokenEncoder();

  // Réserver des tokens pour la query et le prompt template
  const queryTokens = encoder.encode(query).length;
  const templateTokens = 500; // Overhead du template
  const availableTokens = maxTokens - queryTokens - templateTokens;

  const selected: RetrievedChunk[] = [];
  let totalTokens = 0;

  for (const chunk of chunks) {
    const chunkTokens = encoder.encode(chunk.content).length;

    if (totalTokens + chunkTokens <= availableTokens) {
      selected.push(chunk);
      totalTokens += chunkTokens;
    } else {
      // Tenter de tronquer le chunk si presque plein
      const remaining = availableTokens - totalTokens;
      if (remaining > 100) {
        const truncated = truncateToTokens(chunk.content, remaining);
        selected.push({ ...chunk, content: truncated, truncated: true });
      }
      break;
    }
  }

  return selected;
}
```

---

## 7.6 Implémentation Grok-CLI

### 7.6.1 Architecture du module RAG

```
src/context/
├── codebase-rag/
│   ├── index.ts              # Point d'entrée
│   ├── indexer.ts            # Indexation du codebase
│   ├── chunker.ts            # Découpage AST
│   ├── retriever.ts          # Retrieval hybride
│   └── augmenter.ts          # Augmentation du prompt
├── embeddings/
│   ├── local-embedder.ts     # Embeddings locaux
│   ├── openai-embedder.ts    # Embeddings API
│   └── embedder-factory.ts   # Factory pattern
└── database/
    └── vector-store.ts       # Stockage SQLite + vecteurs
```

### 7.6.2 Indexeur de codebase

```typescript
// src/context/codebase-rag/indexer.ts
export class CodebaseIndexer {
  private chunker: ASTChunker;
  private embedder: Embedder;
  private store: VectorStore;

  async indexDirectory(dirPath: string): Promise<IndexingResult> {
    const stats = { files: 0, chunks: 0, errors: 0 };

    // Trouver tous les fichiers de code
    const files = await glob('**/*.{ts,js,tsx,jsx,py,go,rs}', {
      cwd: dirPath,
      ignore: ['node_modules/**', 'dist/**', '.git/**']
    });

    for (const file of files) {
      try {
        const fullPath = path.join(dirPath, file);
        const content = await fs.readFile(fullPath, 'utf-8');

        // Chunker le fichier
        const chunks = this.chunker.chunk(content, file);

        // Générer les embeddings
        const embeddings = await this.embedder.embedBatch(
          chunks.map(c => this.formatForEmbedding(c))
        );

        // Stocker
        for (let i = 0; i < chunks.length; i++) {
          await this.store.upsert({
            ...chunks[i],
            embedding: embeddings[i]
          });
        }

        stats.files++;
        stats.chunks += chunks.length;
      } catch (error) {
        console.error(`Error indexing ${file}:`, error);
        stats.errors++;
      }
    }

    return stats;
  }

  private formatForEmbedding(chunk: Chunk): string {
    // Inclure le nom et le type pour un meilleur embedding
    return `${chunk.type} ${chunk.name}\n${chunk.docstring ?? ''}\n${chunk.content}`;
  }

  async updateFile(filePath: string): Promise<void> {
    // Supprimer les anciens chunks de ce fichier
    await this.store.deleteByFile(filePath);

    // Réindexer
    const content = await fs.readFile(filePath, 'utf-8');
    const chunks = this.chunker.chunk(content, filePath);
    const embeddings = await this.embedder.embedBatch(
      chunks.map(c => this.formatForEmbedding(c))
    );

    for (let i = 0; i < chunks.length; i++) {
      await this.store.upsert({
        ...chunks[i],
        embedding: embeddings[i]
      });
    }
  }
}
```

### 7.6.3 Retriever complet

```typescript
// src/context/codebase-rag/retriever.ts
export class CodebaseRetriever {
  private store: VectorStore;
  private embedder: Embedder;
  private reranker: CrossEncoderReranker;

  async retrieve(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievedChunk[]> {
    const {
      topK = 5,
      minScore = 0.5,
      fileFilter,
      typeFilter
    } = options;

    // 1. Embed la query
    const queryEmbedding = await this.embedder.embed(query);

    // 2. Recherche hybride
    let candidates = await this.store.hybridSearch({
      embedding: queryEmbedding,
      text: query,
      limit: topK * 3
    });

    // 3. Filtres optionnels
    if (fileFilter) {
      candidates = candidates.filter(c =>
        fileFilter.some(pattern => minimatch(c.filePath, pattern))
      );
    }

    if (typeFilter) {
      candidates = candidates.filter(c => typeFilter.includes(c.type));
    }

    // 4. Reranking
    const reranked = await this.reranker.rerank(query, candidates, topK);

    // 5. Filtrer par score minimum
    return reranked.filter(c => c.rerankScore >= minScore);
  }

  async retrieveWithExpansion(
    query: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievedChunk[]> {
    // Récupérer les chunks principaux
    const mainChunks = await this.retrieve(query, options);

    // Expansion : ajouter les imports/dépendances
    const expandedChunks: RetrievedChunk[] = [...mainChunks];

    for (const chunk of mainChunks) {
      // Récupérer les chunks importés
      for (const importPath of chunk.imports ?? []) {
        const importedChunks = await this.store.getByFile(importPath);
        expandedChunks.push(...importedChunks);
      }
    }

    // Dédupliquer
    return this.deduplicate(expandedChunks);
  }

  private deduplicate(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const seen = new Set<string>();
    return chunks.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }
}
```

---

## 7.7 Évaluation du RAG

### 7.7.1 Métriques clés

| Métrique | Description | Cible |
|----------|-------------|-------|
| **Recall@K** | % de docs pertinents dans top K | > 80% |
| **Precision@K** | % de top K qui sont pertinents | > 60% |
| **MRR** | Rang moyen du premier pertinent | > 0.7 |
| **Latence** | Temps de retrieval | < 100ms |

### 7.7.2 Benchmark maison

```typescript
interface RAGBenchmark {
  queries: Array<{
    query: string;
    relevantChunks: string[];  // IDs des chunks pertinents
  }>;
}

async function evaluateRAG(
  retriever: CodebaseRetriever,
  benchmark: RAGBenchmark,
  k: number = 5
): Promise<RAGMetrics> {
  let totalRecall = 0;
  let totalPrecision = 0;
  let totalMRR = 0;
  let totalLatency = 0;

  for (const { query, relevantChunks } of benchmark.queries) {
    const start = Date.now();
    const retrieved = await retriever.retrieve(query, { topK: k });
    totalLatency += Date.now() - start;

    const retrievedIds = new Set(retrieved.map(r => r.id));
    const relevantSet = new Set(relevantChunks);

    // Recall : combien de pertinents trouvés
    const found = relevantChunks.filter(id => retrievedIds.has(id)).length;
    totalRecall += found / relevantChunks.length;

    // Precision : combien de trouvés sont pertinents
    const relevant = retrieved.filter(r => relevantSet.has(r.id)).length;
    totalPrecision += relevant / k;

    // MRR : rang du premier pertinent
    const firstRelevantRank = retrieved.findIndex(r => relevantSet.has(r.id));
    if (firstRelevantRank >= 0) {
      totalMRR += 1 / (firstRelevantRank + 1);
    }
  }

  const n = benchmark.queries.length;
  return {
    recallAtK: totalRecall / n,
    precisionAtK: totalPrecision / n,
    mrr: totalMRR / n,
    avgLatencyMs: totalLatency / n
  };
}
```

---

## 7.8 Bonnes Pratiques

### 7.8.1 Chunking

| Faire | Ne pas faire |
|-------|--------------|
| Découper par unités logiques (fonctions, classes) | Couper au milieu d'une fonction |
| Inclure les docstrings dans le chunk | Séparer doc et code |
| Garder les signatures complètes | Tronquer les signatures |
| Ajouter le nom du fichier | Perdre le contexte de localisation |

### 7.8.2 Embedding

| Faire | Ne pas faire |
|-------|--------------|
| Utiliser un modèle adapté au code | Utiliser un modèle texte général |
| Batch les embeddings | Embed un par un (lent) |
| Cache les embeddings | Recalculer à chaque requête |
| Mettre à jour incrémentalement | Réindexer tout à chaque changement |

### 7.8.3 Retrieval

| Faire | Ne pas faire |
|-------|--------------|
| Combiner sémantique + keywords | Se fier uniquement aux embeddings |
| Utiliser un reranker | Prendre les premiers résultats bruts |
| Filtrer par type si pertinent | Toujours chercher partout |
| Ajuster K selon la tâche | Utiliser un K fixe |

---

## Résumé

Dans ce chapitre, nous avons vu :

| Concept | Point clé |
|---------|-----------|
| **Problème** | LLM ne connaît pas votre code |
| **Solution RAG** | Retrieve → Augment → Generate |
| **Embeddings** | Représentation vectorielle du sens |
| **Chunking** | Découper par unités logiques (AST) |
| **Hybride** | Sémantique + keywords = meilleurs résultats |
| **Reranking** | Affiner avec cross-encoder |

---

## Exercices

1. **Indexation** : Indexez votre projet et mesurez le temps et l'espace disque.

2. **Comparaison** : Comparez les résultats avec chunking par lignes vs par AST.

3. **Hybride** : Testez différents ratios sémantique/keyword (0.8/0.2, 0.5/0.5, etc.).

4. **Benchmark** : Créez un benchmark de 20 queries et mesurez votre Recall@5.

---

## Pour aller plus loin

- Lewis, P., et al. (2020). "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks"
- Gao, L., et al. (2023). "Retrieval-Augmented Generation for Large Language Models: A Survey"
- Grok-CLI : `src/context/codebase-rag/`

---

*Prochainement : Chapitre 8 — Dependency-Aware RAG*

