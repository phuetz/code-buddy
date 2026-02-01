# External Integrations API

This document describes how external applications (like FileCommander) can integrate with code-buddy using the provided server protocols.

## Overview

code-buddy provides two server modes for external integration:

| Protocol | Use Case | Transport |
|----------|----------|-----------|
| **JSON-RPC** | General purpose IPC | stdin/stdout |
| **MCP** | AI tool ecosystem | stdin/stdout |

Both protocols are designed for **loose coupling** - any client that speaks the protocol can use code-buddy capabilities without tight dependencies.

---

## JSON-RPC Server

### Starting the Server

```bash
buddy --json-rpc [options]
```

Options:
- `--verbose, -v`: Enable verbose logging to stderr
- `--workdir, -d <path>`: Set working directory
- `--api-key <key>`: Override GROK_API_KEY

### Protocol

JSON-RPC 2.0 over stdin/stdout (line-delimited JSON).

### Methods

#### Lifecycle

| Method | Description |
|--------|-------------|
| `initialize` | Initialize connection |
| `shutdown` | Shutdown server |

#### AI Methods

| Method | Description |
|--------|-------------|
| `ai/complete` | Get AI completion |
| `ai/chat` | Conversational chat |
| `ai/clearHistory` | Clear chat history |

#### Tool Methods

| Method | Description |
|--------|-------------|
| `tools/list` | List available tools |
| `tools/call` | Execute a tool |

#### FCS Methods

| Method | Description |
|--------|-------------|
| `fcs/execute` | Execute FCS script |
| `fcs/parse` | Parse FCS script (validate) |

#### Context Methods

| Method | Description |
|--------|-------------|
| `context/add` | Add files to context |
| `context/list` | List context files |
| `context/clear` | Clear context |

#### Git Methods

| Method | Description |
|--------|-------------|
| `git/status` | Get git status |
| `git/diff` | Get git diff |

### Example: Node.js Client

```javascript
const { spawn } = require('child_process');
const readline = require('readline');

class CodeBuddyClient {
  constructor() {
    this.process = spawn('buddy', ['--json-rpc']);
    this.pending = new Map();
    this.nextId = 1;

    const rl = readline.createInterface({ input: this.process.stdout });
    rl.on('line', (line) => {
      const response = JSON.parse(line);
      const resolve = this.pending.get(response.id);
      if (resolve) {
        this.pending.delete(response.id);
        resolve(response);
      }
    });
  }

  async call(method, params) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.process.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      }) + '\n');
    });
  }

  async initialize() {
    return this.call('initialize', {
      clientName: 'my-app',
      clientVersion: '1.0.0'
    });
  }

  async complete(prompt) {
    return this.call('ai/complete', { prompt });
  }

  async executeScript(script) {
    return this.call('fcs/execute', { script });
  }

  close() {
    this.call('shutdown', {});
  }
}

// Usage
const grok = new CodeBuddyClient();
await grok.initialize();
const result = await grok.complete('Explain async/await in JavaScript');
console.log(result);
grok.close();
```

### Example: C# Client (for FileCommander)

```csharp
public class GrokJsonRpcClient : IDisposable
{
    private Process _process;
    private StreamWriter _stdin;
    private StreamReader _stdout;
    private int _nextId = 1;
    private ConcurrentDictionary<int, TaskCompletionSource<JObject>> _pending = new();

    public async Task StartAsync()
    {
        _process = Process.Start(new ProcessStartInfo
        {
            FileName = "grok",
            Arguments = "--json-rpc",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            CreateNoWindow = true
        });

        _stdin = _process.StandardInput;
        _stdout = _process.StandardOutput;

        // Start reading responses
        _ = Task.Run(ReadResponses);

        // Initialize
        await CallAsync("initialize", new
        {
            clientName = "FileCommander",
            clientVersion = "1.0.0"
        });
    }

    public async Task<JObject> CallAsync(string method, object? parameters = null)
    {
        var id = _nextId++;
        var tcs = new TaskCompletionSource<JObject>();
        _pending[id] = tcs;

        var request = new
        {
            jsonrpc = "2.0",
            id,
            method,
            @params = parameters
        };

        await _stdin.WriteLineAsync(JsonConvert.SerializeObject(request));
        await _stdin.FlushAsync();

        return await tcs.Task;
    }

    private async Task ReadResponses()
    {
        while (!_process.HasExited)
        {
            var line = await _stdout.ReadLineAsync();
            if (string.IsNullOrEmpty(line)) continue;

            var response = JObject.Parse(line);
            var id = response["id"]?.Value<int>() ?? 0;

            if (_pending.TryRemove(id, out var tcs))
            {
                tcs.SetResult(response);
            }
        }
    }

    public void Dispose()
    {
        _process?.Kill();
        _process?.Dispose();
    }
}
```

---

## MCP Server

### Starting the Server

```bash
buddy --mcp-server [options]
```

### Configuration for Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "code-buddy": {
      "command": "buddy",
      "args": ["--mcp-server"]
    }
  }
}
```

### Tools Exposed

| Tool | Description |
|------|-------------|
| `grok_ask` | Ask Grok AI a question |
| `grok_complete_code` | Get code completion |
| `fcs_execute` | Execute FCS script |
| `read_file` | Read file contents |
| `write_file` | Write to file |
| `list_directory` | List directory contents |
| `search_content` | Search in files |
| `git_status` | Get git status |
| `execute_shell` | Run shell command |

### Resources Exposed

| URI | Description |
|-----|-------------|
| `grok://cwd` | Current working directory info |
| `grok://git` | Git repository status |
| `grok://system` | System information |

### Prompts Exposed

| Prompt | Description |
|--------|-------------|
| `code_review` | Generate code review |
| `explain_code` | Explain code |
| `generate_tests` | Generate unit tests |
| `fcs_script` | Generate FCS script |

---

## FileCommander Integration Guide

### Recommended Integration Path

1. **Phase 1: JSON-RPC External Process**
   - Spawn code-buddy as subprocess
   - Use JSON-RPC for communication
   - Minimal coupling

2. **Phase 2: MCP Client**
   - Add MCP client to FileCommander
   - Use code-buddy as MCP server
   - Full tool ecosystem access

3. **Phase 3: Bidirectional MCP**
   - FileCommander exposes MCP server
   - code-buddy can call FileCommander tools
   - Full integration

### Minimal Integration Example

```csharp
// ICopilotProvider implementation using JSON-RPC
public class GrokCLIProvider : ICopilotProvider
{
    private GrokJsonRpcClient? _client;

    public string Name => "Code Buddy";
    public CopilotProviderType ProviderType => CopilotProviderType.LocalModel;

    public async Task<bool> InitializeAsync(string? apiKey, CopilotProviderConfig? config, CancellationToken ct)
    {
        _client = new GrokJsonRpcClient();
        await _client.StartAsync();
        return true;
    }

    public async Task<CopilotSuggestion?> GetCompletionAsync(CopilotContext context, CancellationToken ct)
    {
        var result = await _client!.CallAsync("ai/complete", new
        {
            prompt = $"Complete this {context.Language} code:\n{context.PrefixText}",
            context = new
            {
                language = context.Language,
                prefix = context.PrefixText,
                suffix = context.SuffixText
            }
        });

        var text = result["result"]?["text"]?.ToString();
        if (string.IsNullOrEmpty(text)) return null;

        return new CopilotSuggestion
        {
            Text = text,
            Provider = Name,
            Confidence = 0.8
        };
    }

    public void Dispose() => _client?.Dispose();
}
```

---

## Protocol Details

### JSON-RPC Request Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "ai/complete",
  "params": {
    "prompt": "Explain recursion"
  }
}
```

### JSON-RPC Response Format

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "text": "Recursion is...",
    "model": "grok-2"
  }
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error"
  }
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32001 | Not initialized |
| -32002 | Operation cancelled |
| -32003 | Timeout |

---

## Testing Integration

### Test JSON-RPC Server

```bash
# Start server in one terminal
buddy --json-rpc --verbose

# In another terminal, send test request
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientName":"test","clientVersion":"1.0"}}' | buddy --json-rpc
```

### Test MCP Server

```bash
# Use mcp-inspector tool
npx @anthropic/mcp-inspector buddy --mcp-server
```

---

## Version History

| Version | Changes |
|---------|---------|
| 1.0.0 | Initial JSON-RPC and MCP support |

## Future Plans

- WebSocket transport option
- Streaming responses
- FileCommander VFS tools via MCP
- Bidirectional integration
