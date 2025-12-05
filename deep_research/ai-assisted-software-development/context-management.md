# Context Management: RAG, Compression, and Dependency-Aware Retrieval (2023-2025)

## 1. RAG for Code (Retrieval-Augmented Generation)

### 1.1 CodeRAG-Bench (NAACL 2024)

**Benchmark Overview:**
- Comprehensive evaluation benchmark for RAG in code generation
- Three categories: basic programming, open-domain, repository-level problems
- Five document sources: competition solutions, tutorials, library docs, StackOverflow, GitHub repos

**Key Findings:**
- Retrieving external documents greatly benefits code generation
- Current retrieval models struggle to find useful documents
- Generation models have limited context capacity and RAG abilities
- Both issues lead to suboptimal results

**Document Types for Code RAG:**
1. API documentation
2. Code examples/snippets
3. Stack Overflow Q&A
4. Library source code
5. Project-specific documentation

### 1.2 CodeRAG: Dual-Graph Architecture

**Architecture:**
1. **Requirement Graph** - Models requirements and their relationships
2. **DS-Code Graph** - Models code structure and dependencies

**Retrieval Targets:**
- APIs (predefined functions/classes in repository)
- Semantically similar code snippets
- Indirectly related source code

**Key Innovation:**
- Deep correlations between requirements and code
- Dynamic reasoning tools for enhanced retrieval

### 1.3 Repository-Level Code Generation (RLCG)

**Challenges:**
- Long-range dependencies
- Global semantic consistency
- Coherent code across multiple files/modules

**Retrieval Approaches:**

| Approach | Strengths | Weaknesses |
|----------|-----------|------------|
| Vector-based | Efficient, flexible | Lacks structural understanding |
| Graph-based | Captures architecture, dependencies | More complex setup |
| Hybrid | Best of both | Implementation complexity |

## 2. Repository Mapping (RepoMap)

### 2.1 Aider's RepoMap Implementation

**Core Concept:**
- Send concise repository map to LLM with each request
- Shows files and key symbols defined in each file
- Critical lines of code for each definition

**How It Works:**
1. Parse all source files with tree-sitter
2. Extract symbol definitions (functions, classes, variables)
3. Build dependency graph (nodes = files, edges = dependencies)
4. Rank using graph algorithm
5. Select most important parts within token budget

**Technical Details:**
```
Default token budget: 1024 tokens
Adjustable via --map-tokens flag
Uses py-tree-sitter-languages for parsing
```

### 2.2 Tree-sitter Integration

**Capabilities:**
- Parse source code into AST
- Identify function definitions, class declarations, variable scopes
- Extract full function signatures and type information
- Build dependency graphs
- Rank code importance by reference frequency

**Benefits over ctags:**
- Richer map with full function signatures
- Language-agnostic support
- No external tool installation required
- Better syntax understanding

**Linting Integration:**
- Uses tree-sitter AST for error context
- Shows linting errors within containing functions/classes
- ERROR nodes identify syntax issues
- Helps LLM understand problems in context

## 3. Context Compression Techniques

### 3.1 JetBrains Research Findings

**Two Main Approaches:**

**1. LLM Summarization**
- AI model generates short summaries
- Compresses trajectory into compact form
- Reduces resolution of all turn elements
- Good for long conversation histories

**2. Observation Masking**
- Targets environment observation only
- Preserves action and reasoning history in full
- Agent retains past reasoning and decisions
- Removes verbose text from earlier turns
- Most effective for SE agents (observation-heavy turns)

**Results:**
- ~7% cost reduction
- +2.6% success rate improvement

### 3.2 In-Context Autoencoder (ICAE) - ICLR 2024

**Technical Approach:**
- Learned with pretraining and fine-tuning
- Produces memory slots with 4x context compression
- Based on Llama architecture

**Benefits:**
- Express more information with same context length
- OR represent same content with shorter context
- Improved latency
- Reduced memory cost during inference

### 3.3 Instruction-Aware Contextual Compression (IACC)

**Approach:**
- Combines ranking and generative methods
- Filters out irrelevant content from input context

**Results:**
- 50% reduction in context-related costs
- 5% decrease in inference memory usage
- 2.2x increase in inference speed

## 4. Dependency-Aware Retrieval

### 4.1 Long-Range Dependency Challenges

**Research Findings:**
- Performance degrades up to 2x when function references another defined later
- Sliding window attention struggles with references beyond window size
- Multi-step key retrieval tasks reveal model limitations

**Simple Prompt Modifications:**
- Using call graph information improves retrieval up to 3x
- Reordering code by dependency order helps
- Including dependency context in prompts

### 4.2 Code Graph Databases

**Architecture:**
- Nodes: Code symbols (functions, classes, variables)
- Edges: Relationships (CONTAINS, INHERITS, USES)
- Query: Graph query language for complex conditions

**Benefits:**
- Enhanced code structure comprehension
- Global analysis capability
- Multi-hop reasoning for dependencies
- Cross-file relationship understanding

### 4.3 Contextually-Guided RAG (CGRAG)

**Two-Pass Approach:**
1. First LLM call: Identify concepts needed to answer question
2. Second LLM call: Generate answer with retrieved context

**Benefits:**
- More accurate context selection
- Reduces irrelevant information
- Works well for large codebases

## 5. Implementation Recommendations

### 5.1 Repository Map Building

```typescript
// Recommended approach
interface RepoMapEntry {
  filePath: string;
  symbols: Symbol[];
  dependencies: string[];  // files this depends on
  dependents: string[];    // files depending on this
}

interface Symbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'type';
  signature: string;
  lineNumber: number;
  references: number;  // for ranking
}

// Build steps:
// 1. Parse files with tree-sitter
// 2. Extract symbols and their references
// 3. Build dependency graph
// 4. Rank by PageRank-style algorithm
// 5. Select top symbols within token budget
```

### 5.2 Context Compression Strategy

**Priority-Based Retention:**
1. **High Priority** (always keep)
   - Current file being edited
   - Direct imports/dependencies
   - Error context (if fixing bugs)

2. **Medium Priority** (keep if space)
   - Files with similar patterns
   - Recently accessed files
   - High-reference symbols

3. **Low Priority** (compress/summarize)
   - Distant dependencies
   - Documentation
   - Test files (unless relevant)

### 5.3 Observation Masking Implementation

```typescript
// Mask tool outputs based on relevance
function maskObservation(
  toolOutput: string,
  query: string,
  threshold: number = 0.5
): string {
  const lines = toolOutput.split('\n');
  const relevantLines = lines.filter(line =>
    computeRelevance(line, query) > threshold
  );

  if (relevantLines.length < lines.length * 0.3) {
    // If less than 30% relevant, return summary
    return summarizeOutput(relevantLines);
  }

  return relevantLines.join('\n');
}
```

### 5.4 Dependency-Aware Context Selection

```typescript
// Include dependencies in context
async function getContextWithDependencies(
  targetFile: string,
  maxDepth: number = 2
): Promise<string[]> {
  const context: string[] = [targetFile];
  const visited = new Set<string>();

  async function addDeps(file: string, depth: number) {
    if (depth > maxDepth || visited.has(file)) return;
    visited.add(file);

    const deps = await getImports(file);
    for (const dep of deps) {
      context.push(dep);
      await addDeps(dep, depth + 1);
    }
  }

  await addDeps(targetFile, 0);
  return context;
}
```

## 6. Token Budget Optimization

### 6.1 Dynamic Budget Allocation

| Component | Suggested Budget % |
|-----------|-------------------|
| System prompt | 10-15% |
| Repository map | 10-20% |
| Current file context | 30-40% |
| Related files | 20-30% |
| Conversation history | 10-20% |

### 6.2 Compression Triggers

- Context > 70% of max tokens: Apply light compression
- Context > 85% of max tokens: Apply aggressive compression
- Context > 95% of max tokens: Summarize and reset

## Sources

- [CodeRAG-Bench](https://arxiv.org/abs/2406.14497)
- [CodeRAG: Supportive Code Retrieval](https://arxiv.org/html/2504.10046v1)
- [RAG Survey - Repository-Level](https://arxiv.org/abs/2510.04905)
- [Aider RepoMap](https://aider.chat/docs/repomap.html)
- [Tree-sitter for Linting](https://aider.chat/2024/05/22/linting.html)
- [JetBrains Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [ICAE - ICLR 2024](https://proceedings.iclr.cc/paper_files/paper/2024/file/0b276510ec2d3f6613a8b60c41ff0438-Paper-Conference.pdf)
- [Long-Range Dependencies](https://arxiv.org/abs/2407.21049)
- [Code Graph Databases](https://arxiv.org/html/2408.03910v1)
