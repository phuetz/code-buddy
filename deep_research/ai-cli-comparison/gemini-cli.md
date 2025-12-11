# Gemini CLI (Google)

## Overview

Gemini CLI is Google's open-source AI agent that brings Gemini directly into the terminal. It provides lightweight access with built-in tools, MCP extensibility, and multimodal input support.

**Repository:** https://github.com/google-gemini/gemini-cli
**Stars:** 86.9k | **License:** Apache-2.0

---

## Key Unique Features

### 1. Google Search Grounding
- Real-time information access via Google Search
- Built-in web fetch capabilities
- Unique advantage over competitors for current information

### 2. Multimodal Input
- Generate apps from PDFs, images, or sketches
- Support for audio content
- Rich multi-part content returns (text, images, audio, binary)

### 3. GEMINI.md Context Files
- Project-specific AI behavior customization
- Custom commands per project
- Shareable context configurations

### 4. Extensions System
- Beyond raw MCP connections
- Intelligent interaction wrappers
- Personalization layer on top of tools

### 5. Generous Free Tier
- OAuth login: 60 req/min, 1,000 req/day
- Access to Gemini 2.5 Pro with 1M token context
- No API key management required

---

## Tool Implementations

### Built-in Tools
- `read_file` - File reading
- `write_file` - File writing
- `web_fetch` - Web content retrieval
- `google_search` - Search grounding

### MCP Integration
- FastMCP for Python server development
- OAuth 2.0 for remote MCP servers (SSE/HTTP)
- Automatic schema processing for API compatibility
- Conflict resolution (first registration wins)
- Rich multi-part content support

---

## Configuration Options

### Config File: `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "github": { ... },
    "slack": { ... },
    "database": { ... }
  }
}
```

### Authentication Options
1. **Google OAuth**: Free tier with no API key needed
2. **Gemini API Key**: 100 req/day free, usage-based billing
3. **Vertex AI**: Enterprise features, higher limits, Google Cloud integration

---

## Security Features

| Feature | Description |
|---------|-------------|
| Sandboxing | Isolated execution environments |
| Trusted folders | Execution policy by directory |
| Enterprise deployment | Corporate environment management |
| Telemetry monitoring | Usage tracking capabilities |
| OAuth for MCP | Secure remote server authentication |

---

## Integration Capabilities

- **VS Code**: Companion extension
- **GitHub Actions**: Automated PR reviews, issue triage
- **MCP Protocol**: Extensive tool integration
- **FastMCP**: Python server development
- **@gemini-cli mentions**: On-demand assistance

### GitHub Action Features
- Automated PR reviews with contextual feedback
- Issue triage with automated labeling
- Custom workflow automation
- @gemini-cli mention responses

---

## UI/UX Patterns

- ReAct (Reason and Act) loop
- Conversation checkpointing
- Real-time streaming for long operations
- `/mcp` command for integration verification
- Output formats: text, JSON, streaming JSON

---

## Performance Optimizations

- Token caching for API usage optimization
- 1M token context window (Gemini 2.5 Pro)
- Configurable context compression
- Release channels: preview, stable, nightly

---

## Installation Methods

```bash
# NPX (no install)
npx https://github.com/google-gemini/gemini-cli

# Global NPM
npm install -g @google/gemini-cli

# Homebrew
brew install gemini-cli
```

**Requirements:** Node.js 20+

---

## Notable Differentiators

1. **Google Search grounding** for real-time information
2. **Largest free tier** (1,000 req/day with OAuth)
3. **1M token context window** with Gemini 2.5 Pro
4. **Extensions system** beyond basic MCP
5. **Multimodal input** (PDFs, images, sketches, audio)
6. **FastMCP integration** for Python development

---

## August 2025 Update (v0.1.20)

- Deep VS Code integration with intelligent suggestions
- Native diff comparison
- Command-line MCP server management
- Multimodal content support
- Root directory support
- Responsive terminal UI
- Configurable context compression

---

## Sources
- [GitHub Repository](https://github.com/google-gemini/gemini-cli)
- [MCP Servers with Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)
- [Gemini CLI Extensions](https://blog.google/technology/developers/gemini-cli-extensions/)
- [FastMCP Integration](https://developers.googleblog.com/en/gemini-cli-fastmcp-simplifying-mcp-server-development/)
