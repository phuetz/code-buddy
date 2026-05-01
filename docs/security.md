# Security

## Permission Modes

Set via `--permission-mode <mode>` CLI flag. Checked by `ConfirmationService` before every approval prompt.

| Mode | Description |
|:-----|:------------|
| `default` | Standard confirmation flow |
| `plan` | Read-only research mode (restricts to Read/Search/Think/Plan tools) |
| `acceptEdits` | Auto-approve file edits |
| `dontAsk` | Skip confirmation prompts |
| `bypassPermissions` | Skip all permission checks |

Security modes (`suggest`, `auto-edit`, `full-auto`) provide an additional layer of control via `/mode`.

## Guardian Agent (AI-Powered Approval)

An AI-powered automatic approval reviewer (`src/security/guardian-agent.ts`):

- Risk scoring 0-100 for each operation
- **Auto-approves** score < 80
- **Prompts user** score 80-90
- **Denies** score >= 90
- **Always-safe set** (no LLM call needed): `read_file`, `grep`, `glob`, `plan`, `reason`
- **Always-denied patterns**: `rm -rf /`, fork bombs, `drop database`
- 90-second timeout, fail-closed design

## Confirmation Service

Singleton for destructive operations. Check order:
1. Permission mode
2. Declarative rules (gitignore syntax: `Read(~/Documents/*.pdf)`, `Edit(src/**,!src/tests/**)`)
3. Session flags
4. Guardian Agent

## Sandbox Tiers

### OS Sandbox (Native)

Three tiers for native OS-level isolation:

| Mode | Write Access | Use Case |
|:-----|:------------|:---------|
| `read-only` | None | Untrusted analysis |
| `workspace-write` | Git workspace root only | Normal development (default) |
| `danger-full-access` | Unrestricted | Deployment scripts |

`.git`, `.codebuddy`, `.ssh`, `.gnupg`, `.aws` are always read-only. Implemented via bubblewrap (Linux), landlock (Linux 5.13+), seatbelt (macOS).

### Docker Sandbox

Containerized execution with memory limits, network isolation, and timeouts. Auto-sandbox router automatically routes dangerous commands (npm, pip, cargo, make) to Docker when available.

Timezone support via `CODEBUDDY_TZ` env or `timezone` config.

### OpenShell Sandbox

NVIDIA OpenShell-compatible backend with `mirror` (local mount) and `remote` (HTTP API) workspace modes. Pluggable via `SandboxRegistry` (Strategy pattern, priority-ordered).

## SSRF Guard

Protection on all outbound HTTP calls:
- Blocks RFC-1918 private ranges, loopback, link-local
- Blocks IPv4 bypass vectors: octal, hex, short form
- Blocks IPv6 transition addresses: NAT64, 6to4, Teredo, IPv4-mapped
- Async DNS resolution check before every fetch

## Environment Variable Blocklist

Blocks dangerous env vars from sandbox child processes (`src/security/env-blocklist.ts`):
- `LD_PRELOAD`, `_JAVA_OPTIONS`, `GLIBC_TUNABLES`
- `DYLD_*` (macOS)
- `GIT_*`, `NPM_CONFIG_*`

## Secrets Vault

AES-256-GCM encrypted vault with scrypt KDF:

```bash
buddy secrets list               # List stored secrets
buddy secrets set <name> <value> # Store a secret
buddy secrets get <name>         # Retrieve a secret
buddy secrets remove <name>      # Remove a secret
buddy secrets rotate             # Rotate encryption key
buddy secrets audit              # View audit trail
buddy secrets import-env         # Import from environment
```

## Write Policy

`src/security/write-policy.ts` controls file writing behavior:
- `strict` -- forces `apply_patch` format (used by `buddy dev`)
- `confirm` -- confirm each write
- `off` -- no restrictions

## Exec Policy (Prefix Rules)

Token-array prefix matching (safer than regex):

```bash
buddy execpolicy check "git push --force"
buddy execpolicy check-argv git push --force
buddy execpolicy add-prefix git push --action deny
buddy execpolicy dashboard
```

## Policy Amendments

When commands are blocked, the system suggests allow rules. Rules persist to `.codebuddy/rules/allow-rules.json`. Command canonicalization strips shell wrappers (e.g., `/bin/bash -c "npm test"` becomes `npm test`). Banned prefixes (interpreters, shells, `sudo`) are never suggested.

## Secrets Detection

14 regex patterns detect secrets in code: AWS keys, GitHub tokens, Stripe keys, JWTs, private keys, and more. Available via `scan_secrets` tool and `/secrets-scan` command.

## Dependency Vulnerability Scanner

Runs npm/pip/cargo/go audit and parses JSON output. Available via `scan_vulnerabilities` tool and `/vulns` command.

## Loop Detection (3-Tier)

| Tier | Mechanism | Threshold |
|:-----|:----------|:----------|
| 1 | Tool call repetition (hash of name+args) | 5 consecutive identical calls |
| 2 | Content chanting (50-char chunk hashing) | 10 repeats within 250 chars |
| 3 | LLM diagnostic (separate model call) | After 30 turns, every 10 turns |

## Omission Placeholder Detection

Before any file write/edit, content is scanned for patterns like `// ... rest of code`, `// remaining methods ...`. If detected in new content but not in old content, the edit is blocked to prevent silent code deletion.

## Output Sanitizer

Strips model control tokens from responses: GLM-5 (full-width), DeepSeek (`<think>`), ChatML (`<|im_start|>`), LLaMA (`[INST]`, `<<SYS>>`), zero-width characters.

## Ghost Snapshots (Undo/Redo)

Git-based undo via shadow refs (`refs/codebuddy/ghost/`). Auto-commits workspace state before each turn. Max 50 snapshots. Undo restores latest ghost commit.

## Code Safety

| Feature | Description |
|:--------|:------------|
| Generated Code Validator | Pre-write scan for eval, XSS, SQL injection, hardcoded secrets |
| Pre-Write Syntax Validator | Balanced delimiters, template literals, indentation |
| Atomic Rollback | All-or-nothing patch application with file state backup |
| Atomic Transactions | Multi-file edits rolled back on first failure |
| AST Bash Validation | tree-sitter-based command parsing with dangerous pattern checks |
| Bash Checkpoints | Pre-snapshot of files targeted by destructive commands |
| Diff Preview | Shows diffs before approval with magnitude-based re-confirmation |
