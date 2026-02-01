# Frequently Asked Questions (FAQ)

## Installation & Setup

### How do I install Code Buddy?

**npm (recommended):**
```bash
npm install -g @phuetz/buddy
```

**From source:**
```bash
git clone https://github.com/phuetz/buddy.git
cd buddy
npm install
npm run build
npm link
```

### What API key do I need?

Code Buddy uses the Grok API from xAI. You need a `GROK_API_KEY`:

1. Visit [x.ai](https://x.ai) to get an API key
2. Set the environment variable:
   ```bash
   export GROK_API_KEY=your-api-key-here
   ```

### Can I use other AI providers?

Yes! Code Buddy supports any OpenAI-compatible API:

```bash
# For Ollama
export GROK_BASE_URL=http://localhost:11434/v1
export GROK_MODEL=llama2

# For LM Studio
export GROK_BASE_URL=http://localhost:1234/v1

# For Azure OpenAI
export GROK_BASE_URL=https://your-resource.openai.azure.com
```

---

## Usage

### How do I start a session?

```bash
# Interactive mode
buddy

# With initial prompt
buddy "explain this codebase"

# Run a single command
buddy -c "fix the bug in auth.ts"
```

### What are the different modes?

| Mode | Description | Use Case |
|------|-------------|----------|
| `plan` | Read-only planning | Architecture decisions |
| `code` | Full file editing | Implementation work |
| `ask` | Questions only | Learning/exploration |
| `architect` | High-level design | System design |

Switch modes with `/mode <name>` or start with `--mode`:
```bash
buddy --mode plan
```

### What is YOLO mode?

YOLO mode enables full autonomy with higher limits:
- 400 tool rounds (vs 50 normal)
- $100 cost limit (vs $10 normal)
- Auto-approves more operations

Enable with:
```bash
YOLO_MODE=true buddy
# Then type: /yolo on
```

### How do I undo changes?

Code Buddy creates automatic checkpoints:

```bash
/undo              # Undo last change
/restore <id>      # Restore specific checkpoint
/checkpoints       # List all checkpoints
```

---

## Tools & Features

### What tools are available?

Core tools:
- `read_file` - Read file contents
- `write_file` - Write/create files
- `edit_file` - Make targeted edits
- `bash` - Execute shell commands
- `glob` - Find files by pattern
- `grep` - Search file contents
- `list_directory` - List directory contents

Advanced tools:
- `web_search` - Search the web
- `web_fetch` - Fetch URL content
- `morph_edit` - Fast AI-powered edits (requires MORPH_API_KEY)

### How does tool selection work?

Code Buddy uses RAG-based selection to pick relevant tools:
1. Your query is analyzed
2. Only relevant tools are included
3. Tools are cached for the session

This reduces token usage and improves response quality.

### Can I add custom tools?

Yes! Create a tool in `src/tools/` following this pattern:

```typescript
export class MyTool {
  async execute(params: MyParams): Promise<ToolResult> {
    return { success: true, output: 'result' };
  }
}
```

Then register it in `src/codebuddy/tools.ts`.

---

## Security

### What security modes are available?

| Mode | Description |
|------|-------------|
| `suggest` | Confirm all operations |
| `auto-edit` | Auto-approve safe file edits |
| `full-auto` | Minimal confirmations |

Set with:
```bash
buddy --security auto-edit
```

### How are dangerous commands handled?

Code Buddy detects and blocks:
- Fork bombs and infinite loops
- Recursive deletions (`rm -rf /`)
- System modification commands
- Cryptocurrency mining
- Network attacks

The execution policy can be customized in settings.

### Is my code sent to external servers?

Your code is sent to the configured AI API (default: Grok/xAI). Code Buddy:
- Does not store your code on our servers
- Does not share code with third parties
- Supports local models for air-gapped environments

---

## Performance

### How can I reduce costs?

1. **Use model routing** - Smaller models for simple tasks:
   ```bash
   buddy --model grok-2-mini
   ```

2. **Limit context** - Use focused prompts

3. **Set cost limits**:
   ```bash
   export MAX_COST=5  # $5 limit
   ```

4. **Use caching** - Repeated queries use cache

### Why is startup slow?

Code Buddy uses lazy loading. First run may be slower as modules initialize. Subsequent runs are faster.

Improve startup:
```bash
# Pre-compile TypeScript
npm run build

# Use production mode
NODE_ENV=production buddy
```

### How do I check my usage?

```bash
/cost              # Current session cost
/metrics           # Detailed metrics
/roi               # ROI analysis
```

---

## Troubleshooting

### "API key not found" error

Ensure your API key is set:
```bash
echo $GROK_API_KEY  # Should show your key
```

Add to your shell profile:
```bash
# ~/.bashrc or ~/.zshrc
export GROK_API_KEY=your-key-here
```

### "Context limit exceeded" error

The conversation is too long. Options:
1. Start a new session: `/clear`
2. Use context compression (automatic)
3. Fork the conversation: `/fork`

### Tool execution times out

Increase timeout:
```bash
# For specific commands
buddy --timeout 300000  # 5 minutes

# Or set globally
export TOOL_TIMEOUT=300000
```

### Permission denied errors

On Unix systems:
```bash
chmod +x $(which buddy)
```

For file operations, ensure you have write access to the target directory.

### Session recovery after crash

Code Buddy auto-saves sessions. After a crash:
```bash
buddy --resume        # Resume last session
buddy --sessions      # List all sessions
```

---

## Integration

### How do I integrate with VS Code?

1. Install the Code Buddy extension (coming soon)
2. Or use the terminal integration:
   ```bash
   buddy --cwd ${workspaceFolder}
   ```

### How do I use webhooks?

Configure webhooks for external integrations:

```typescript
import { WebhookManager } from 'buddy';

const webhooks = new WebhookManager();
webhooks.register({
  url: 'https://your-server.com/webhook',
  events: ['session.end', 'file.write'],
  secret: 'your-secret'
});
```

### Is there a REST API?

Yes! Start the local API server:

```typescript
import { RestApiServer } from 'buddy';

const server = new RestApiServer({ port: 3000 });
server.start();

// Then use:
// POST /api/prompt - Send prompts
// GET /api/sessions - List sessions
// GET /api/metrics - Get metrics
```

### How do I export metrics to Prometheus?

```typescript
import { PrometheusExporter } from 'buddy';

const exporter = new PrometheusExporter({ port: 9090 });
await exporter.start();

// Metrics available at http://localhost:9090/metrics
```

---

## Development

### How do I run tests?

```bash
npm test                    # All tests
npm test -- file.test.ts    # Single file
npm run test:coverage       # With coverage
```

### How do I contribute?

1. Fork the repository
2. Create a feature branch
3. Run `npm run validate` (lint + typecheck + test)
4. Submit a pull request

See [CONTRIBUTING.md](../CONTRIBUTING.md) for details.

### How do I debug issues?

Enable debug logging:
```bash
DEBUG=codebuddy:* buddy
```

Or check logs:
```bash
cat ~/.codebuddy/logs/debug.log
```

---

## Data & Privacy

### Where is my data stored?

Local data is stored in `~/.codebuddy/`:
- `sessions/` - Conversation history
- `cache/` - Response cache
- `checkpoints/` - File checkpoints
- `metrics.json` - Usage metrics

### How do I clear all data?

```bash
rm -rf ~/.codebuddy
```

Or selectively:
```bash
rm -rf ~/.codebuddy/cache      # Clear cache only
rm -rf ~/.codebuddy/sessions   # Clear history only
```

### Is session data encrypted?

Yes, sensitive session data is encrypted at rest using AES-256-GCM. The encryption key is derived from your machine's unique identifier.

---

## Getting Help

### Where can I get support?

- **Documentation**: [docs/](.)
- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share tips

### How do I report a bug?

1. Check existing issues first
2. Include:
   - Code Buddy version (`buddy --version`)
   - Node.js version (`node --version`)
   - Operating system
   - Steps to reproduce
   - Error messages/logs

### How do I request a feature?

Open a GitHub issue with the "enhancement" label. Include:
- Use case description
- Expected behavior
- Any relevant examples
