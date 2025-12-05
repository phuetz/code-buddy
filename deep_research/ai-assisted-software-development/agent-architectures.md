# Agent Architectures for Code Generation (2023-2025)

Research findings on multi-agent systems, tool use optimization, and planning/reasoning approaches.

---

## 1. Multi-Agent Systems for Coding

### AgentCoder (arXiv 2312.13010)
**Paper:** "AgentCoder: Multi-Agent-based Code Generation with Iterative Testing and Optimisation"
- **Link:** https://arxiv.org/abs/2312.13010
- **Architecture:** Three specialized agents:
  1. **Programmer Agent:** Generates code based on requirements
  2. **Test Designer Agent:** Creates test cases independently (key: doesn't see code)
  3. **Test Executor Agent:** Runs tests and provides feedback
- **Results (GPT-4):**
  - HumanEval: 96.3% pass@1 (vs SOTA 90.2%)
  - MBPP: 91.8% pass@1 (vs SOTA 78.9%)
- **Efficiency:** 56.9K tokens (vs MetaGPT 138.2K, ChatDev 183.7K)
- **Key Insight:** Fewer agents with focused roles outperform larger agent systems

### MapCoder (ACL 2024)
**Paper:** "MapCoder: Multi-Agent Code Generation for Competitive Problem Solving"
- **Link:** https://aclanthology.org/2024.acl-long.269/
- **Architecture:** Four agents replicating human programming cycle:
  1. **Retrieval Agent:** Generates relevant examples
  2. **Planning Agent:** Creates solution plans
  3. **Coding Agent:** Generates code from plans
  4. **Debugging Agent:** Fixes bugs using sample I/O
- **Key Innovations:**
  - Pipeline cascading with in-context learning signals
  - Adaptive agent traversal schema
  - Plan-derived debugging
- **Results:**
  - HumanEval: 93.9%
  - MBPP: 83.1%
  - CodeContests: 28.5%

### MetaGPT (arXiv 2308.00352)
**Paper:** "MetaGPT: Meta Programming for a Multi-Agent Collaborative Framework"
- **Key Innovation:** Agents communicate through documents and diagrams, not dialogue
- **Results:** 85.9% and 87.7% Pass@1 on code generation benchmarks
- **Advantage:** Structured outputs prevent irrelevant or missing content

### ChatDev (arXiv 2307.07924)
**Paper:** "ChatDev: Communicative Agents for Software Development"
- **Architecture:** 7 agents mimicking a software company
- **Phases:** Design -> Coding -> Testing
- **Communication:** Chat chain + communicative dehallucination

---

## 2. Tool Use Optimization

### CodeAct (ICML 2024)
**Paper:** "Executable Code Actions Elicit Better LLM Agents"
- **Link:** https://arxiv.org/abs/2402.01030
- **Core Idea:** Use executable Python code as unified action space instead of JSON/text formats

**Traditional Problems:**
- Constrained action space (pre-defined tools only)
- Restricted flexibility (cannot compose tools)
- More steps required

**CodeAct Benefits:**
- Leverages existing Python packages
- Expanded action space without hand-crafted tools
- **30% fewer steps than JSON (30% cheaper)**
- Up to 20% higher success rate

```python
# Traditional JSON action
{"tool": "search", "query": "python async"}

# CodeAct approach
import search_tool
results = search_tool.search("python async")
filtered = [r for r in results if "asyncio" in r.content]
```

### AVATAR (NeurIPS 2024)
- Actor LLM: Generates actions using tools
- Comparator LLM: Evaluates and optimizes
- Contrastive reasoning for tool selection

### ToolLLM (ICLR 2024)
- Facilitates LLMs to master 16,000+ real-world APIs
- Comprehensive tool use learning

---

## 3. Planning and Reasoning (Tree-of-Thought & MCTS)

### ReAct Framework (Foundational)
**Paper:** "ReAct: Synergizing Reasoning and Acting in Language Models"
- **Link:** https://arxiv.org/abs/2210.03629

**Core Pattern:**
```
Thought -> Action -> Observation -> Thought -> ...
```

**Components:**
1. **Thought** - Reasoning step identifying approach
2. **Action** - External task from allowed set
3. **Observation** - Result from action
4. **Loop** - Continue until answer found

**Benefits:**
- Access to external information
- Reduces hallucination
- Error correction through observation
- Improved interpretability

### RethinkMCTS (2024)
**Paper:** "RethinkMCTS: Refining Erroneous Thoughts in Monte Carlo Tree Search"
- **Link:** https://arxiv.org/html/2409.09584v1
- Integrates MCTS into code generation
- Uses environment feedback to correct reasoning errors
- Improves search tree quality

### ReST-MCTS* (NeurIPS 2024)
**Paper:** "LLM Self-Training via Process Reward Guided Tree Search"
- **Link:** https://arxiv.org/abs/2406.03816
- Reinforced self-training with process reward guidance
- Higher accuracy than Best-of-N and Tree-of-Thought
- Same search budget, better outcomes

### SRA-MCTS (Self-driven Reasoning Augmentation)
**Paper Link:** https://arxiv.org/html/2411.11053
- Model autonomously generates high-quality reasoning paths
- Generates "thinking" steps used as prompts for code generation
- No additional supervision required

### LATS (Language Agent Tree Search)
**Paper:** "Language Agent Tree Search Unifies Reasoning, Acting, and Planning"
- **Link:** https://arxiv.org/abs/2310.04406
- First framework combining reasoning, acting, and planning
- LM-powered value functions
- Self-reflections for exploration

---

## 4. Autonomous Software Engineering Agents

### SWE-agent (NeurIPS 2024)
**Paper:** "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering"
- **Link:** https://arxiv.org/abs/2405.15793

**Key Concept:** Agent-Computer Interface (ACI)

**ACI Design Principles:**
1. **Compact Actions** - Efficient, consolidated operations
2. **Limited Output** - Prevent context overflow (max 50 results)
3. **Specialized Commands** - `find_file`, `search_file`, `search_dir`

**Results:**
- SWE-bench: 12.5% pass@1 (vs 3.8% prior SOTA)
- HumanEvalFix: 87.7% pass@1
- SWE-agent 1.0 + Claude 3.7 achieved SOTA on SWE-bench full

### AutoCodeRover (ISSTA 2024)
**Paper:** "AutoCodeRover: Autonomous Program Improvement"
- **Link:** https://arxiv.org/abs/2404.05427
- Works on AST representation, not just files
- Two stages: Context Retrieval + Patch Generation
- SWE-bench-lite: 19% (higher than SWE-agent)
- Average cost: $0.43 USD per issue

### RepairAgent (ICSE 2025)
**Paper:** "RepairAgent: An Autonomous, LLM-Based Agent for Program Repair"
- **Link:** https://arxiv.org/abs/2403.17134
- First autonomous agent-based approach to program repair
- FSM guiding tool usage
- Fixed 164 bugs on Defects4J (39 new)
- Cost: ~$0.14 per bug with GPT-3.5

---

## 5. Implementation Patterns

### Multi-Agent Architecture
```typescript
interface Agent {
  name: string;
  role: string;
  systemPrompt: string;
  tools: Tool[];
  process(input: AgentInput): Promise<AgentOutput>;
}

// Specialized agents for coding
const agents = {
  retriever: new Agent({
    role: 'Find relevant examples and context',
    tools: [searchTool, ragTool]
  }),
  planner: new Agent({
    role: 'Create step-by-step plan',
    tools: []  // Pure reasoning
  }),
  coder: new Agent({
    role: 'Generate code from plan',
    tools: [fileReadTool, fileWriteTool]
  }),
  tester: new Agent({
    role: 'Design and run tests',
    tools: [testRunnerTool, bashTool]
  }),
  debugger: new Agent({
    role: 'Fix failing tests',
    tools: [fileEditTool, searchTool]
  })
};
```

### ReAct Loop Implementation
```typescript
const MAX_ITERATIONS = 10;

async function reactAgent(query: string): Promise<string> {
  let context = { query, history: [] };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Generate thought
    const thought = await llm.complete(`
      Query: ${context.query}
      History: ${formatHistory(context.history)}
      Think step by step. Thought:
    `);

    // Determine and execute action
    const action = await llm.selectAction(thought, tools);
    const observation = await executeAction(action);

    context.history.push({ thought, action, observation });

    if (observation.includes('FINAL_ANSWER:')) {
      return extractFinalAnswer(observation);
    }
  }
  return synthesizeBestAnswer(context.history);
}
```

### MCTS for Code Generation
```typescript
interface MCTSNode {
  state: CodeState;
  parent: MCTSNode | null;
  children: MCTSNode[];
  visits: number;
  value: number;  // Based on test results
}

class CodeMCTS {
  select(node: MCTSNode): MCTSNode {
    // UCB1 selection
    return node.children.reduce((best, child) =>
      ucb1(child) > ucb1(best) ? child : best
    );
  }

  expand(node: MCTSNode): MCTSNode[] {
    // Generate multiple code variations
    const variations = await llm.generateVariations(node.state);
    return variations.map(v => new MCTSNode(v, node));
  }

  simulate(node: MCTSNode): number {
    // Run tests to get reward
    const testResults = await runTests(node.state.code);
    return testResults.passRate;
  }

  backpropagate(node: MCTSNode, value: number) {
    while (node) {
      node.visits++;
      node.value += value;
      node = node.parent;
    }
  }
}
```

### FSM for Tool Flow (RepairAgent Pattern)
```
START -> GATHER_INFO -> GATHER_INGREDIENTS -> VALIDATE_FIX
           |                  |                    |
           v                  v                    v
    Read bug info      Find code patterns     Run tests
           |                  |                    |
           +------------------+--------------------+
                              |
                              v
                      GENERATE_PATCH
                              |
                              v
                    Test passed? -----> DONE
                              |
                              No -> REFINE_PATCH
```

---

## 6. Security Considerations

### IMBIA Attack Analysis (arXiv 2511.18467)
- **Attack Success Rates:**
  - ChatDev: 93% (MU-BA), 71% (BU-MA)
  - MetaGPT: 45% (MU-BA), 84% (BU-MA)
- **Implication:** Security must be considered in multi-agent design
- Validate agent outputs before execution
- Implement sandboxing for code execution
- Monitor for prompt injection in multi-agent flows

---

## Sources

- [MapCoder - ACL 2024](https://aclanthology.org/2024.acl-long.269/)
- [AgentCoder](https://arxiv.org/abs/2312.13010)
- [CodeAct - ICML 2024](https://arxiv.org/abs/2402.01030)
- [AVATAR - NeurIPS 2024](https://papers.nips.cc/paper_files/paper/2024/)
- [ReAct Framework](https://arxiv.org/abs/2210.03629)
- [RethinkMCTS](https://arxiv.org/html/2409.09584v1)
- [ReST-MCTS* - NeurIPS 2024](https://arxiv.org/abs/2406.03816)
- [SRA-MCTS](https://arxiv.org/html/2411.11053)
- [SWE-agent - NeurIPS 2024](https://arxiv.org/abs/2405.15793)
- [RepairAgent - ICSE 2025](https://arxiv.org/abs/2403.17134)
- [AutoCodeRover - ISSTA 2024](https://arxiv.org/abs/2404.05427)
