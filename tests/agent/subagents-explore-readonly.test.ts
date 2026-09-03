/**
 * Tests for the Explore read-only subagent + disallowedTools field.
 *
 * Implements Phase A + Phase C of the Claude Code subagent audit
 * (`private-handover-repo/propositions/AUDIT-CLAUDE-CODE-SUBAGENT-2026-05-04.md`).
 *
 * Focus:
 * - The new `Explore` entry in PREDEFINED_SUBAGENTS exists and is read-only
 * - The legacy `explorer` alias keeps working (backward compat) with the
 *   same hardened config
 * - The new `disallowedTools` field on SubagentConfig is plumbed through
 *   `Subagent.run()` and filters the outgoing tool list
 *
 * The full Subagent / SubagentManager integration is covered by the
 * existing `tests/agent/subagents.test.ts` (625 lines) — these tests are
 * targeted on the rc.4 additions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared spy: every Subagent we instantiate writes the tools list it
// receives into `invokedToolsCapture` so the test can assert on it.
const invokedToolsCapture = vi.hoisted(() => ({ tools: undefined as unknown }));

vi.mock('@/codebuddy/client.js', async () => {
  const actual = await vi.importActual<typeof import('@/codebuddy/client.js')>('@/codebuddy/client.js');
  return {
    ...actual,
    CodeBuddyClient: class MockCodeBuddyClient {
      // Capture-aware mock: stores the tools array passed to chat() into
      // the hoisted shared object so the test body can read it.
      async chat(_messages: unknown, tools?: unknown) {
        invokedToolsCapture.tools = tools;
        return {
          choices: [{ message: { content: 'mock response', tool_calls: null } }],
          usage: { prompt_tokens: 0, completion_tokens: 0 },
        };
      }
    },
  };
});

import {
  Subagent,
  PREDEFINED_SUBAGENTS,
  type SubagentConfig,
} from '@/agent/subagents.js';
import type { CodeBuddyTool } from '@/codebuddy/client.js';

function makeTool(name: string): CodeBuddyTool {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} tool`,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  };
}

describe('Explore subagent (read-only enforcement)', () => {
  describe('PREDEFINED_SUBAGENTS registry', () => {
    it('contains the new "Explore" entry (capital E, alignment with Claude Code)', () => {
      expect(PREDEFINED_SUBAGENTS.Explore).toBeDefined();
      expect(PREDEFINED_SUBAGENTS.Explore.name).toBe('Explore');
    });

    it('Explore description mentions read-only enforcement', () => {
      const desc = PREDEFINED_SUBAGENTS.Explore.description;
      expect(desc.toLowerCase()).toContain('read-only');
      expect(desc.toLowerCase()).toContain('no-write');
    });

    it('Explore system prompt enforces READ-ONLY MODE prominently', () => {
      const prompt = PREDEFINED_SUBAGENTS.Explore.systemPrompt;
      expect(prompt).toContain('READ-ONLY MODE');
      expect(prompt).toContain('STRICTLY PROHIBITED');
      // Specific actions must be listed
      expect(prompt).toContain('Creating new files');
      expect(prompt).toContain('Modifying existing files');
      expect(prompt).toContain('Deleting files');
    });

    it('Explore whitelist allows ONLY view_file and search (no bash, no edit tools)', () => {
      expect(PREDEFINED_SUBAGENTS.Explore.tools).toEqual(['view_file', 'search']);
    });

    it('Explore disallowedTools blacklists every common write tool', () => {
      const blacklist = PREDEFINED_SUBAGENTS.Explore.disallowedTools ?? [];
      // bash gets blacklisted because it's a generic shell escape — even
      // when missing from the whitelist, the blacklist provides defense-in-depth.
      expect(blacklist).toContain('bash');
      expect(blacklist).toContain('str_replace_editor');
      expect(blacklist).toContain('create_file');
      expect(blacklist).toContain('apply_patch');
      expect(blacklist).toContain('delete_file');
    });

    it('code-reviewer is hardened with disallowedTools (rc.4 follow-up)', () => {
      // Pre-rc.4: code-reviewer had `tools: ["view_file", "search"]` whitelist
      // but no disallowedTools — a custom config that extended `tools` could
      // accidentally allow write tools. rc.4 adds the defense-in-depth blacklist.
      const config = PREDEFINED_SUBAGENTS['code-reviewer'];
      expect(config).toBeDefined();
      expect(config.disallowedTools).toBeDefined();
      const blacklist = config.disallowedTools ?? [];
      expect(blacklist).toContain('bash');
      expect(blacklist).toContain('str_replace_editor');
      expect(blacklist).toContain('create_file');
      expect(blacklist).toContain('apply_patch');
      expect(blacklist).toContain('delete_file');
      // System prompt also reinforced with READ-ONLY MODE statement
      expect(config.systemPrompt).toContain('READ-ONLY MODE');
    });

    it('legacy "explorer" alias has the same hardened config (backward-compat)', () => {
      // Existing callers like `spawn("explorer", ...)` keep working AND
      // benefit from the new restrictions (was a silent loophole pre-rc.4
      // since bash was in the whitelist).
      expect(PREDEFINED_SUBAGENTS.explorer).toBeDefined();
      expect(PREDEFINED_SUBAGENTS.explorer.tools).toEqual(['view_file', 'search']);
      expect(PREDEFINED_SUBAGENTS.explorer.disallowedTools).toContain('bash');
      expect(PREDEFINED_SUBAGENTS.explorer.systemPrompt).toContain('READ-ONLY MODE');
    });
  });

  describe('disallowedTools field on Subagent.run() — the new plumbing', () => {
    beforeEach(() => {
      invokedToolsCapture.tools = undefined;
    });

    function getInvokedToolNames(): string[] {
      const tools = invokedToolsCapture.tools as CodeBuddyTool[] | undefined;
      return (tools ?? []).map(t => t.function.name);
    }

    it('blacklist removes a tool that the whitelist allowed', async () => {
      const config: SubagentConfig = {
        name: 'test-blacklist',
        description: 'Test',
        systemPrompt: 'Test',
        tools: ['view_file', 'search', 'bash'], // whitelist includes bash
        disallowedTools: ['bash'], // but blacklist removes it
      };
      const subagent = new Subagent('fake-key', config);

      const allTools = [makeTool('view_file'), makeTool('search'), makeTool('bash')];
      await subagent.run('test task', undefined, allTools);

      expect(invokedToolsCapture.tools).toBeDefined();
      const names = getInvokedToolNames();
      expect(names).toContain('view_file');
      expect(names).toContain('search');
      expect(names).not.toContain('bash'); // blacklist won
    });

    it('blacklist works even WITHOUT a whitelist (full toolset minus blacklist)', async () => {
      const config: SubagentConfig = {
        name: 'test-blacklist-only',
        description: 'Test',
        systemPrompt: 'Test',
        // no `tools` field → all tools allowed by default
        disallowedTools: ['create_file', 'delete_file'],
      };
      const subagent = new Subagent('fake-key', config);

      const allTools = [
        makeTool('view_file'),
        makeTool('create_file'),
        makeTool('delete_file'),
        makeTool('bash'),
      ];
      await subagent.run('test task', undefined, allTools);

      const names = getInvokedToolNames();
      expect(names).toContain('view_file');
      expect(names).toContain('bash');
      expect(names).not.toContain('create_file');
      expect(names).not.toContain('delete_file');
    });

    it('Explore subagent (used end-to-end) sees only view_file + search', async () => {
      // The realistic case: a caller spawns Explore with the full toolset;
      // whitelist + blacklist combined leaves only view_file + search.
      const exploreConfig = PREDEFINED_SUBAGENTS.Explore;
      const subagent = new Subagent('fake-key', exploreConfig);

      const allTools = [
        makeTool('view_file'),
        makeTool('search'),
        makeTool('bash'),
        makeTool('str_replace_editor'),
        makeTool('create_file'),
        makeTool('apply_patch'),
      ];
      await subagent.run('explore the auth module', undefined, allTools);

      const names = getInvokedToolNames();
      expect(names.sort()).toEqual(['search', 'view_file']);
    });

    it('backward-compat: subagents WITHOUT disallowedTools work exactly as before', async () => {
      const config: SubagentConfig = {
        name: 'pre-rc4-style',
        description: 'Pre-rc.4 subagent (no disallowedTools)',
        systemPrompt: 'Test',
        tools: ['view_file', 'bash'],
        // no disallowedTools field at all
      };
      const subagent = new Subagent('fake-key', config);

      const allTools = [makeTool('view_file'), makeTool('bash'), makeTool('create_file')];
      await subagent.run('test task', undefined, allTools);

      const names = getInvokedToolNames();
      // Whitelist only — original behavior
      expect(names.sort()).toEqual(['bash', 'view_file']);
    });
  });
});
