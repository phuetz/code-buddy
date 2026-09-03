import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('GK35 MCP / Code Explorer docs', () => {
  it('documents CODEBUDDY_MCP_INIT_TIMEOUT_MS in CLAUDE.md', () => {
    const text = readFileSync(new URL('../../CLAUDE.md', import.meta.url), 'utf8');
    expect(text).toMatch(/CODEBUDDY_MCP_INIT_TIMEOUT_MS/);
    expect(text).toMatch(/background/i);
  });

  it('tells users to enable code-explorer on PATH, not a private gitnexus path', () => {
    const text = readFileSync(
      new URL('../../docs/code-explorer-integration.md', import.meta.url),
      'utf8',
    );
    expect(text).toMatch(/buddy mcp test code-explorer/);
    expect(text).toMatch(/"command": "code-explorer"/);
    expect(text).not.toMatch(/\/home\/patrice\/DEV\/gitnexus-rs/);
  });

  it('keeps the committed mcp.json code-explorer entry portable', () => {
    const raw = readFileSync(new URL('../../.codebuddy/mcp.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { command?: string }>;
    };
    expect(parsed.mcpServers['code-explorer']?.command).toBe('code-explorer');
    expect(raw).not.toMatch(/\/home\/patrice\/DEV\/gitnexus-rs/);
    expect(raw).not.toMatch(/\/home\/patrice\/code-buddy/);
  });
});
