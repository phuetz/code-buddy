# Codex CLI (OpenAI) - Sandboxing and Approval

## Overview

Codex CLI is OpenAI's coding agent that runs locally, providing autonomous file reading, command execution, patch application, and external tool usage. It emphasizes security through sandboxing and granular approval flows.

## Key Features

### Sandboxing Architecture

Uses OS-level isolation:

| Platform | Technology |
|----------|------------|
| macOS | Seatbelt policies |
| Linux | seccomp + landlock |

**Default Sandbox Restrictions**:
- No network access
- Write permissions limited to active workspace
- Can read any file on system
- Cannot impact overall user security

### Approval Flow System

Three simplified approval modes:

| Mode | Read | Write | Network | Use Case |
|------|------|-------|---------|----------|
| **read-only** | Anywhere | Explicit approval | Approval | Maximum safety |
| **auto** | Anywhere | Workspace auto | Approval | Balanced (default) |
| **full-access** | Anywhere | Anywhere | Allowed | Maximum autonomy |

**Default Behavior** (`auto` mode):
- Read files anywhere
- Edit and run commands in working directory automatically
- Approval needed outside working directory
- Approval needed for network access

### Autonomy Controls

```bash
# Disable all approval prompts
codex --ask-for-approval never

# Or short form
codex -a never
```

Works with all `--sandbox` modes for full autonomy control.

### Configuration Options

| Setting | Purpose |
|---------|---------|
| `approval_policy` | When to prompt for command approval |
| `sandbox` | Sandbox policy for untrusted commands |

**Defaults**: `--ask-for-approval untrusted` and `--sandbox read-only`

### Container/Docker Support

When running in containerized environments:
- Container provides sandbox guarantees
- Run with `--sandbox danger-full-access`
- Or use `--dangerously-bypass-approvals-and-sandbox`

### MCP Integration

- Shell-tool MCP login support
- Explicit capability declaration
- Sandbox awareness
- Published to npm for easy integration

### Model Support

- **GPT-5-Codex**: Optimized for agentic coding
- Trained for real-world software engineering
- Handles quick interactive sessions and long complex tasks

## IDE Integration

Available for:
- VS Code
- Cursor
- Windsurf
- Cloud-based Codex Web at chatgpt.com/codex

## Security Best Practices

### Trust Policies

```typescript
interface TrustPolicy {
  // Commands that always require approval
  sensitiveCommands: string[];

  // File patterns that require approval
  sensitiveFiles: string[];

  // Network operations
  networkPolicy: 'block' | 'ask' | 'allow';

  // Sandbox mode
  sandboxMode: 'read-only' | 'workspace' | 'full';
}
```

### Sandbox Assessment

Aligns approval flows with trust policies:
1. Assess command/operation risk
2. Check against policy
3. Sandbox or approve as needed

## Unique Features for Grok CLI

| Feature | Implementation Priority | Complexity |
|---------|------------------------|------------|
| OS-Level Sandboxing (seccomp/landlock) | High | High |
| Three-Tier Approval Modes | High | Medium |
| Network Isolation | High | Medium |
| Container Bypass Mode | Low | Low |
| Workspace-Limited Writes | High | Medium |
| MCP Sandbox Awareness | Medium | Medium |

## Implementation Recommendations

### Sandboxing Priority Order

1. **Linux seccomp + landlock** (most secure)
2. **macOS Seatbelt** (platform-specific)
3. **Docker/container** (environment-based)
4. **Path-based restrictions** (application-level fallback)

### Approval Flow Implementation

```typescript
interface ApprovalFlow {
  // Check if operation needs approval
  needsApproval(op: Operation): boolean;

  // Request user approval
  requestApproval(op: Operation): Promise<boolean>;

  // Auto-approve based on policy
  canAutoApprove(op: Operation): boolean;

  // Remember approval for session
  rememberApproval(op: Operation, approved: boolean): void;
}
```

## Sources

- [Codex CLI](https://developers.openai.com/codex/cli/)
- [Codex Security Guide](https://developers.openai.com/codex/security/)
- [OpenAI Codex](https://openai.com/codex/)
- [GitHub Releases](https://github.com/openai/codex/releases)
- [NPM Package](https://www.npmjs.com/package/@openai/codex)
