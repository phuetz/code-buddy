# Code Generation Quality: Best Practices and Techniques (2023-2025)

## 1. Prompting Best Practices

### 1.1 Prompt Engineering Strategies

**Meta-Prompting**
- Embedding instructions within prompts to help models understand how to approach tasks
- Example: "You are an expert Python developer. Think step by step before writing code."

**Prompt Chaining**
- Output of one prompt serves as input to another
- Useful for complex multi-step code generation tasks
- Reduces cognitive load on single prompt

**Pseudocode-Style Prompts**
- Research shows modifying prompts to resemble pseudocode is most successful for coding tasks
- Structure requirements in logical steps rather than natural language paragraphs

**Context and Structure Impact**
- Studies broadly agree that "context" and "structure" of prompts significantly impact output quality
- Include relevant code context, function signatures, and type information

### 1.2 Chat-Oriented Programming (CHOP)

Coined by Steve Yegge in mid-2024, CHOP refers to interactive conversation-driven code production:
- Developers specify requirements through dialogue
- Iterative refinement through prompts
- Natural feedback loop for improvement

### 1.3 Prompt Taxonomy (From Systematic Literature Review)

Five categories of prompt patterns identified:
1. **Role-based prompts** - Assigning expert personas
2. **Task decomposition** - Breaking complex tasks into subtasks
3. **Example-driven** - Few-shot learning with code examples
4. **Constraint specification** - Explicit requirements and limitations
5. **Feedback integration** - Error messages and test results

## 2. Multi-Turn Conversation Strategies

### 2.1 Iterative Refinement Framework

**muCode Framework**
- Expert iteration approach with local search
- Process: Roll out code generator -> Collect interaction data with execution feedback -> Train verifier -> Guide local search expert -> Fine-tune generator

**CodeSteer Approach**
- Integration of textual reasoning and code execution feedback
- Multi-turn code refinement with CoT (Chain-of-Thought) enhancement
- Demonstrated improvements across six different models

### 2.2 Common Pitfalls in Multi-Turn Conversations

Research identifies four causes for models "getting lost" (39% average performance drop):

1. **Premature Full Answers** - LLMs propose complete solutions too early, making assumptions
2. **Over-reliance on Previous Attempts** - Sticking to incorrect approaches
3. **Loss-of-Middle-Turns** - Overly adjusting based on first and last turn only
4. **Verbose Responses** - Producing unnecessarily long outputs

**Mitigation Strategies:**
- Keep conversation history concise
- Explicitly reference relevant previous context
- Use structured feedback formats
- Summarize intermediate results

### 2.3 Review-Instruct Framework

"Ask-Respond-Review" pipeline using three agents:
1. **Candidate Agent** - Generates initial solution
2. **Reviewer Agents** - Multiple reviewers provide structured feedback
3. **Chairman Agent** - Synthesizes feedback and guides refinement

## 3. Code Repair and Iterative Refinement

### 3.1 ChatRepair (ISSTA 2024)

**Key Innovation**: First fully automated conversation-driven APR (Automated Program Repair) approach.

**Mechanism:**
1. Feed LLM with relevant test failure information initially
2. Learn from both failures AND successes of earlier patching attempts
3. For failed patches: Combine incorrect patches with test failure info -> Generate next patch
4. For successful patches: Generate alternative variations to build on success

**Results:**
- Fixed 162 out of 337 bugs
- Cost: $0.42 per bug
- State-of-the-art on Defects4J (114 fixes on v1.2, 48 on v2.0)

**Implementation Details:**
```
Prompt Structure:
1. Bug location and context
2. Failing test information
3. Previous patch attempts (if any)
4. Request for new patch
```

### 3.2 RepairAgent (ICSE 2025)

**Key Innovation**: First autonomous agent-based approach to program repair.

**Architecture:**
- LLM as autonomous agent with planning capabilities
- Tool invocation based on gathered information
- Finite state machine guiding tool usage

**Available Tools:**
- Information gathering about bugs
- Repair ingredient collection
- Fix validation

**Results:**
- Fixed 164 bugs on Defects4J
- 39 bugs not fixed by prior techniques
- Average cost: 270,000 tokens per bug (~$0.14 USD with GPT-3.5)
- Median time: 920 seconds per bug

### 3.3 APRMCTS: Tree Search for Repair

Combines MCTS (Monte Carlo Tree Search) with iterative repair:
- Each node represents a repair state
- Actions are repair operations
- Rewards based on test pass rates
- Enables exploration of multiple repair paths

## 4. Multi-Agent Code Generation

### 4.1 AgentCoder Framework

**Architecture:** Three specialized agents:
1. **Programmer Agent** - Code generation and refinement
2. **Test Designer Agent** - Generates test cases (independently, without seeing code)
3. **Test Executor Agent** - Runs tests and provides feedback

**Key Design Decisions:**
- Test generation is independent from code generation (avoids bias)
- Separation ensures objective testing
- Iterative feedback loop for refinement

**Results:**
- GPT-4: 96.3% pass@1 on HumanEval, 91.8% on MBPP
- Single agent achieves only 71.3% vs multi-agent's 79.9%
- Test accuracy: 87.8-89.9%

### 4.2 SWE-agent (NeurIPS 2024)

**Key Concept:** Agent-Computer Interface (ACI)

**ACI Design Principles:**
1. Actions should be compact and efficient
2. Important operations consolidated into few actions
3. Output limited to prevent context overflow (e.g., max 50 search hits)

**Custom Commands:**
- `find_file` - Locate files
- `search_file` - Search within file
- `search_dir` - Directory-wide search
- Context-limited outputs to preserve token budget

**Results:**
- 12.5% pass@1 on SWE-bench (vs 3.8% prior SOTA)
- 87.7% on HumanEvalFix
- SWE-agent 1.0 + Claude 3.7 achieved SOTA on SWE-Bench full

## 5. Security Considerations

### 5.1 Vulnerability Patterns

- Early research (Pearce et al.): ~40% of Copilot-generated programs contain vulnerabilities
- C code particularly vulnerable (~50% rate)
- Security degradation observed in iterative generation

### 5.2 Prompt-Specific Vulnerability Patterns

- **Efficiency-focused prompts**: Most severe security issues
- **Feature-focused prompts**: Different vulnerability patterns
- Recommendation: Include security requirements explicitly in prompts

## 6. Implementation Recommendations

### For CLI Coding Assistants:

1. **Structured Prompt Templates**
   - Include role, context, constraints, and output format
   - Use pseudocode-style task descriptions

2. **Conversation State Management**
   - Maintain concise history with relevant context
   - Summarize previous attempts to avoid "loss-of-middle-turns"

3. **Test-Driven Feedback Loop**
   - Execute tests after each code generation
   - Include failure information in follow-up prompts
   - Generate test cases independently from code

4. **Tool Design (ACI Principles)**
   - Limit output size to prevent context overflow
   - Consolidate related operations
   - Provide structured, parseable outputs

5. **Multi-Agent Separation**
   - Consider separate roles for generation, testing, review
   - Independent test generation avoids bias

## Sources

- [Prompting AI for Code Generation - SwitchLabs](https://www.switchlabs.dev/post/prompting-ai-for-code-generation-best-practices-and-model-insights-2025)
- [Ten Simple Rules for AI-Assisted Coding](https://arxiv.org/html/2510.22254v1)
- [ChatRepair - ISSTA 2024](https://dl.acm.org/doi/10.1145/3650212.3680323)
- [Multi-Turn Code Generation](https://arxiv.org/html/2502.20380v1)
- [LLMs Get Lost in Multi-Turn Conversation](https://arxiv.org/pdf/2505.06120)
- [SWE-agent - NeurIPS 2024](https://arxiv.org/abs/2405.15793)
- [AgentCoder](https://arxiv.org/abs/2312.13010)
- [RepairAgent - ICSE 2025](https://arxiv.org/abs/2403.17134)
- [AI Code Enterprise Adoption - DX](https://getdx.com/blog/ai-code-enterprise-adoption/)
