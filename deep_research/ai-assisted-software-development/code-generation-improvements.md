# Code Generation Improvements (2023-2025)

Research findings on prompting strategies, context window optimization, and code repair techniques.

---

## 1. Code Repair Techniques

### ChatRepair (ISSTA 2024)
**Paper:** "Automated Program Repair via Conversation: Fixing 162 out of 337 Bugs for $0.42 Each using ChatGPT"
- **Link:** https://dl.acm.org/doi/10.1145/3650212.3680323
- **Key Innovation:** First work leveraging detailed feedback (including test code and error messages) for conversational APR
- **Results:** 114 and 48 correct fixes on Defects4J 1.2 and 2.0 respectively
- **Cost:** $0.42 per bug fix
- **Mechanism:** Iteratively refines repair by enriching context with failing test information

### RepairAgent (arXiv 2403.17134)
**Paper:** "RepairAgent: An Autonomous, LLM-Based Agent for Program Repair"
- **Link:** https://arxiv.org/abs/2403.17134
- **Key Innovation:** First autonomous agent-based approach treating LLM as capable of planning and executing repair actions
- **Results:** 164 bugs fixed on Defects4J, including 39 bugs not fixed by prior techniques
- **Token Cost:** 270,000 tokens per bug (~$0.14 USD with GPT-3.5)
- **Architecture:** Freely interleaves gathering bug information, repair ingredients, and validating fixes

### LANTERN (Cross-Language Repair)
**Paper:** "Unlocking LLM Repair Capabilities Through Cross-Language Translation and Multi-Agent Refinement"
- **Link:** https://arxiv.org/html/2503.22512
- **Key Innovation:** Translates buggy code to languages where LLM has stronger repair capabilities
- **Mechanism:** Multi-agent iterative refinement with historical experience feedback

### APRMCTS (2025)
**Paper:** "APRMCTS: Improving LLM-based Automated Program Repair with Iterative Tree Search"
- **Link:** https://arxiv.org/html/2507.01827
- **Key Innovation:** Applies Monte Carlo Tree Search to guide repair process

---

## 2. Prompting Strategies

### Self-Planning Code Generation
**Paper:** "Self-planning Code Generation with Large Language Models"
- **Link:** https://arxiv.org/html/2303.06689v5
- **Key Finding:** Having LLMs plan before generating code improves correctness, readability, and robustness
- **Result:** Outperforms direct generation by a large margin on multiple datasets
- **Note:** Self-planning is an emergent ability in larger models

### Prompt Specificity Impact (PartialOrderEval)
**Paper:** "More Than a Score: Probing the Impact of Prompt Specificity on LLM Code Generation"
- **Link:** https://arxiv.org/html/2508.03678
- **Key Findings:**
  - Explicit I/O specifications improve results
  - Edge-case handling in prompts helps
  - Stepwise breakdowns are key drivers of improvement
- **Tool:** PartialOrderEval - augments benchmarks with prompts from minimal to maximally detailed

### Multi-Turn Strategies
**Paper:** "Show and Tell: Prompt Strategies for Style Control in Multi-Turn LLM Code Generation"
- **Link:** https://arxiv.org/abs/2511.13972
- **Approaches:**
  - Instruction-based prompts (abstract directives)
  - Example-based prompts (concrete code demonstrations)
  - Combined approaches produce distinct patterns

### Secure Code Generation
**Paper:** "Prompting Techniques for Secure Code Generation: A Systematic Investigation"
- **Link:** https://arxiv.org/abs/2407.07064
- **Key Finding:** Recursive Criticism and Improvement (RCI) reduces security weaknesses
- **Evaluation:** GPT-3, GPT-3.5, GPT-4 on 150 security-relevant prompts

### Chain-of-Thought for Code
- **Key Insight:** CoT enables step-by-step reasoning for solution plans
- **Limitation:** Smaller models struggle with CoT due to reasoning constraints
- **Solution:** Knowledge distillation from larger models (https://arxiv.org/html/2403.13271)

---

## 3. Context Window Optimization

### Current State (2024-2025)
- **Gemini 1.5 Pro:** 2 million tokens (largest production model)
- **GPT-4o:** 128,000 tokens
- **IBM Granite 3B/8B:** Extended to 128,000 tokens

### LongRoPE (arXiv 2402.13753)
**Paper:** "LongRoPE: Extending LLM Context Window Beyond 2 Million Tokens"
- **Link:** https://arxiv.org/html/2402.13753v1
- **Achievement:** 2048k token context with only 1k fine-tuning steps
- **Training:** Up to 256k training lengths

### Practical Considerations
- **Reality Check:** Models claiming 200k tokens often become unreliable around 130k
- **Performance:** Sudden drops rather than gradual degradation
- **Cost:** Higher computational and financial cost with larger contexts

### Optimization Techniques
1. **Sliding Window:** Process text in overlapping segments
2. **Prompt Compression:** IBM's synthetic longform instruction compression
3. **Attention Mechanisms:** Focus on crucial information within window

---

## 4. Iterative Refinement Approaches

### CoCoGen (ACL 2024)
**Paper:** "Iterative Refinement of Project-Level Code Context for Precise Code Generation with Compiler Feedback"
- **Link:** https://aclanthology.org/2024.findings-acl.138/
- **Mechanism:** Uses static analysis to identify mismatches, then iteratively aligns using repo information
- **Result:** 80% improvement over vanilla LLMs for project-dependent code

### LLMLOOP
**Paper:** "LLMLOOP: Improving LLM-Generated Code"
- **Link:** https://valerio-terragni.github.io/assets/pdf/ravi-icsme-2025.pdf
- **Results:** 80.85% pass@1, 90.24% pass@10
- **Improvement:** 9.2% increase at pass@1, 14.02% peak difference at pass@10
- **Mechanism:** Multiple feedback types with dedicated prompts for each

### Self-Refine Framework
**Paper:** "SELF-REFINE: Iterative Refinement with Self-Feedback"
- **Link:** https://openreview.net/pdf?id=S37hOerQLB
- **Key Finding:** No additional training required
- **Result:** Up to 13% absolute improvement on code generation (CODEX)
- **Process:** Initial output -> Feedback -> Refinement (3-step cycle)

---

## Applications to CLI Tools

### Recommendations for Grok CLI

1. **Implement ChatRepair-style feedback loop:**
   - Include test code and error messages in repair context
   - Iteratively refine based on test failures
   - Track repair history for learning

2. **Use Self-Planning:**
   - Generate plan before code implementation
   - Break complex tasks into steps
   - Validate each step before proceeding

3. **Prompt Engineering:**
   - Include explicit I/O specifications
   - Add edge-case handling guidance
   - Use stepwise breakdowns for complex tasks

4. **Context Management:**
   - Implement sliding window for large codebases
   - Use prompt compression for long contexts
   - Focus attention on most relevant code sections

5. **Iterative Refinement:**
   - Leverage compiler feedback (CoCoGen approach)
   - Implement multiple feedback channels (tests, linting, type checking)
   - Generate dedicated prompts for each feedback type
