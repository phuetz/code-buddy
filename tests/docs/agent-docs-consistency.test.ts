import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent docs consistency', () => {
  const claudeMdPath = path.resolve(__dirname, '../../CLAUDE.md');
  const agentsMdPath = path.resolve(__dirname, '../../AGENTS.md');

  const claudeMdContent = fs.readFileSync(claudeMdPath, 'utf8');
  const agentsMdContent = fs.readFileSync(agentsMdPath, 'utf8');

  it('should list 9 built-in agents in AGENTS.md', () => {
    expect(agentsMdContent).toContain('9 built-in agents');
    expect(agentsMdContent).not.toContain('8 built-in agents');
  });

  it('should not include Guardian Agent in Confirmation service order', () => {
    expect(claudeMdContent).not.toContain('→ Guardian Agent');
    expect(agentsMdContent).not.toContain('→ Guardian Agent');
  });

  it('should describe the real tool execution process instead of CodeBuddyAgent.executeTool()', () => {
    expect(claudeMdContent).not.toContain('CodeBuddyAgent.executeTool()');
    expect(agentsMdContent).not.toContain('CodeBuddyAgent.executeTool()');

    // We expect some mention of the tool handler or registry
    expect(claudeMdContent).toContain('ToolHandler');
    expect(agentsMdContent).toContain('ToolHandler');
  });

  it('should mention AgyCliProvider in codebuddy/client.ts strategies', () => {
    expect(claudeMdContent).toContain('AgyCliProvider');
    expect(agentsMdContent).toContain('AgyCliProvider');
  });

  it('should describe CODEBUDDY_COMPANION_CORE as inert since it is unused in prod', () => {
    expect(claudeMdContent).not.toContain('loads the `@phuetz/companion-core` workspace package for the relational layer');
    expect(claudeMdContent).toContain('inert');

    expect(agentsMdContent).not.toContain('loads `@phuetz/companion-core` for the relational layer');
    expect(agentsMdContent).toContain('inert');
  });
});
