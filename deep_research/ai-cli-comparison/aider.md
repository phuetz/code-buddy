# Aider

## Overview

Aider is a popular open-source AI pair programming tool that runs in the terminal. It excels at working with large codebases and supports virtually any LLM, including local models.

**Repository:** https://github.com/paul-gauthier/aider
**Stars:** 38.9k | **License:** Apache-2.0
**Primary Language:** Python (80%)
**Weekly Token Usage:** 15 billion tokens
**Pip Installations:** 3.9M+

---

## Key Unique Features

### 1. Comprehensive Codebase Mapping
- Creates maps of entire codebases
- Enables effective work on larger projects
- Context-aware modifications across multiple files

### 2. Exceptional Model Flexibility
- Works with Claude 3.7 Sonnet, DeepSeek R1 & Chat V3, OpenAI o1, o3-mini, GPT-4o
- Almost any LLM including local models
- User brings their own API key

### 3. Thoughtful Git Integration
- Automatic commits with descriptive messages
- Commits pending changes BEFORE making AI edits
- Never lose work when undoing AI changes
- Familiar git tools for managing/diffing/undoing

### 4. Multi-Modal Input Support
- Voice-to-code functionality
- Image attachments
- Web page integration
- Reference documentation support

### 5. Industry-Leading Benchmarks
- Top scores on SWE Bench (real GitHub issues)
- Polyglot benchmark: 225 exercises across 6 languages
- Claude 3.5 Sonnet achieves 99.6% proper formatting
- "88% singularity" - 88% of new code written by Aider itself

---

## Tool Implementations

### Core Capabilities
- Multi-file editing
- Code refactoring
- Bug fixing
- Documentation updates
- Automatic linting on every modification
- Integrated testing execution
- Automated fixes for detected problems

### Input Methods
- Terminal text input
- Voice commands
- Copy/paste from web chat
- Watch mode for IDE monitoring
- Image/URL attachments

---

## Configuration Options

Aider uses CLI flags and configuration files:

```bash
# Model selection
aider --model claude-3-5-sonnet

# Watch mode
aider --watch

# Voice mode
aider --voice

# With images
aider --image screenshot.png
```

### Supported Languages
100+ languages including: Python, JavaScript, Rust, Ruby, Go, C++, PHP, HTML, CSS, and dozens more.

---

## Security Features

| Feature | Description |
|---------|-------------|
| Local execution | Runs entirely in your terminal |
| API key management | User controls their own keys |
| Git safety | Commits before making changes |
| No vendor lock-in | Works with any LLM |

---

## Integration Capabilities

- **IDE Integration**: Use from favorite editor with comment-based requests
- **Git**: Deep version control integration
- **Any LLM Provider**: OpenAI, Anthropic, local models, etc.
- **Voice Input**: Speech-to-code functionality
- **Web Interface**: Copy/paste workflows

---

## UI/UX Patterns

- Terminal-first design
- Watch mode for IDE integration
- Voice command support
- Multi-file diff display
- Clear commit message generation
- Context-aware suggestions

---

## Performance Optimizations

### Token Efficiency
- Non-agentic design uses fewer tokens
- Highly optimized context fetching
- Costs determined by prompt efficiency and model choice
- No hidden overhead or runaway token usage

### Benchmarks
- SWE Bench: Top scores solving real GitHub issues
- Polyglot: 225 exercises across C++, Go, Java, JavaScript, Python, Rust
- Claude 3.5 Sonnet: 99.6% proper formatting rate

---

## Notable Differentiators

1. **Best-in-class token efficiency** - Non-agentic approach minimizes costs
2. **Git-first workflow** - Commits before AI changes for safety
3. **Model agnostic** - Works with any LLM including local models
4. **Legacy code expertise** - Handles complex multi-file refactoring
5. **Voice-to-code** - Speech-based coding requests
6. **Industry benchmarks** - Top SWE Bench and Polyglot scores
7. **Self-improving** - 88% of own code written by Aider

---

## Strengths vs Competitors

| Area | Aider Advantage |
|------|-----------------|
| Cost | Far fewer tokens per session |
| Flexibility | Any LLM, including local |
| Safety | Git commits before changes |
| Legacy Code | Strongest refactoring capability |
| Benchmarks | Top SWE Bench scores |

---

## Sources
- [GitHub Repository](https://github.com/paul-gauthier/aider)
- [Aider LLM Leaderboards](https://aider.chat/docs/leaderboards/)
- [Aider Benchmarks](https://aider.chat/docs/benchmarks.html)
- [Shakudo AI Coding Assistants Comparison](https://www.shakudo.io/blog/best-ai-coding-assistants)
