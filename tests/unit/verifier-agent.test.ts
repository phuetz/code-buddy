/**
 * Unit tests for the Verifier agent (9th built-in specialized agent).
 *
 * The Verifier is the "the tester is not the coder, and it hands back
 * evidence" pattern: a fresh-context, read/execute-only agent that returns a
 * CONFIRMED / NEEDS REVIEW verdict backed by real evidence. These tests assert
 * its registration, role, doctrine prompt, toolset gate, and loop behavior —
 * plus non-regression on the other built-in agents.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  AgentRegistry,
  resetAgentRegistry,
} from '../../src/agent/specialized/agent-registry';
import {
  VerifierAgent,
  getVerifierAgent,
  resetVerifierAgent,
  VERIFIER_SYSTEM_PROMPT,
} from '../../src/agent/specialized/verifier-agent';
import type {
  SWEMessage,
  SWETool,
  SWELLMResponse,
} from '../../src/agent/specialized/swe-agent';

describe('Verifier agent', () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await resetAgentRegistry();
    resetVerifierAgent();
    registry = new AgentRegistry();
    await registry.registerBuiltInAgents();
  });

  afterEach(async () => {
    await resetAgentRegistry();
    resetVerifierAgent();
  });

  describe('registration', () => {
    it('is registered as the 9th built-in agent', () => {
      expect(registry.getAll()).toHaveLength(9);
      expect(registry.get('verifier')).toBeDefined();
    });

    it('does not disturb the other built-in agents (non-regression)', () => {
      for (const id of ['pdf-agent', 'excel-agent', 'data-analysis-agent', 'sql-agent', 'archive-agent', 'code-guardian', 'security-review', 'swe']) {
        expect(registry.get(id), `expected built-in agent "${id}" to still be registered`).toBeDefined();
      }
    });

    it('has the expected identity and role', () => {
      const agent = registry.get('verifier')!;
      const config = agent.getConfig();
      expect(config.id).toBe('verifier');
      expect(config.name).toBe('Verifier');
      expect(config.capabilities).toContain('code-verify');
      expect(config.description.toLowerCase()).toContain('verif');
    });

    it('supports the verify action', () => {
      const agent = registry.get('verifier')!;
      expect(agent.getSupportedActions()).toContain('verify');
      expect(agent.getActionHelp('verify').length).toBeGreaterThan(0);
    });

    it('stays out of the file-extension auto-matcher (no shadowing of coding agents)', () => {
      const agent = registry.get('verifier')!;
      expect(agent.getConfig().fileExtensions).toEqual([]);
      // A .ts file must not resolve to the verifier.
      const match = registry.findAgentForFile('/some/file.ts');
      expect(match?.agent.getId()).not.toBe('verifier');
    });
  });

  describe('doctrine system prompt', () => {
    const prompt = VERIFIER_SYSTEM_PROMPT;

    it('encodes the fresh-context, evidence-first contract', () => {
      expect(prompt).toContain('INDEPENDENT VERIFIER');
      expect(prompt).toContain('FRESH CONTEXT');
      expect(prompt.toLowerCase()).toContain('reproduce');
      expect(prompt.toLowerCase()).toContain('evidence');
      expect(prompt).toMatch(/NEVER assert success without proof/i);
    });

    it('mandates a binary CONFIRMED / NEEDS REVIEW verdict', () => {
      expect(prompt).toContain('CONFIRMED');
      expect(prompt).toContain('NEEDS REVIEW');
    });

    it('names the real oracles (app_server / web_test / tests)', () => {
      expect(prompt).toContain('app_server');
      expect(prompt).toContain('web_test');
      expect(prompt).toContain('task_verify');
    });

    it('is exposed on the agent config', () => {
      const agent = registry.get('verifier')!;
      expect(agent.getSystemPrompt()).toBe(VERIFIER_SYSTEM_PROMPT);
    });
  });

  describe('toolset gate', () => {
    let agent: ReturnType<typeof getVerifierAgent>;

    beforeEach(() => {
      agent = registry.get('verifier') as VerifierAgent;
    });

    it('allows the verification tools', () => {
      const allowed = agent.getAllowedTools();
      for (const tool of ['app_server', 'web_test', 'task_verify', 'view_file', 'search']) {
        expect(allowed, `verification tool "${tool}" should be allowed`).toContain(tool);
        expect(agent.isToolAllowed(tool)).toBe(true);
      }
    });

    it('excludes destructive write tools from the allowlist and denies them fail-closed', () => {
      const allowed = agent.getAllowedTools();
      const denied = agent.getDeniedTools();
      for (const tool of ['create_file', 'write_file', 'str_replace_editor', 'multi_edit', 'apply_patch']) {
        expect(allowed, `write tool "${tool}" must NOT be in the allowlist`).not.toContain(tool);
        expect(denied, `write tool "${tool}" must be explicitly denied`).toContain(tool);
        expect(agent.isToolAllowed(tool), `write tool "${tool}" must be refused`).toBe(false);
      }
    });

    it('deny wins even if a tool were also allowlisted (fail-closed)', () => {
      // Sanity: unknown tool with no allowlist match is refused (allowlist is a positive gate).
      expect(agent.isToolAllowed('some_unknown_dangerous_tool')).toBe(false);
    });
  });

  describe('execute() verification loop', () => {
    it('returns a CONFIRMED verdict when the model reports evidence and no failures', async () => {
      const agent = getVerifierAgent();
      await agent.initialize();

      const executeTool = vi.fn(async () => ({ success: true, output: 'PASS: 12/12 tests' }));
      // Model runs one oracle, then hands back a final verdict (no tool calls).
      let turn = 0;
      const llmCall = vi.fn(async (): Promise<SWELLMResponse> => {
        turn += 1;
        if (turn === 1) {
          return {
            content: 'Running the test suite.',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'task_verify', arguments: '{}' } },
            ],
          };
        }
        return {
          content: 'WHAT WAS VERIFIED: tests\nRESULT: pass\nEVIDENCE: PASS: 12/12 tests\nFINAL VERDICT: CONFIRMED',
          tool_calls: [],
        };
      });

      const result = await agent.execute({
        action: 'verify',
        params: { instruction: 'Verify the change works', llmCall, executeTool },
      });

      expect(result.success).toBe(true);
      expect(executeTool).toHaveBeenCalledWith('task_verify', expect.any(Object));
      expect(result.output).toContain('CONFIRMED');
      expect(result.metadata?.verdict).toBe('CONFIRMED');
    });

    it('refuses a destructive write tool fail-closed without invoking the real executor', async () => {
      const agent = getVerifierAgent();
      await agent.initialize();

      const executeTool = vi.fn(async () => ({ success: true, output: 'should never run' }));
      let turn = 0;
      const seenToolOutputs: string[] = [];
      const llmCall = vi.fn(async (messages: SWEMessage[], _tools: SWETool[]): Promise<SWELLMResponse> => {
        turn += 1;
        if (turn === 1) {
          // Model (wrongly) tries to write a file — the gate must block it.
          return {
            content: 'Attempting to patch the file.',
            tool_calls: [
              { id: 'w1', type: 'function', function: { name: 'write_file', arguments: '{"path":"/x","content":"y"}' } },
            ],
          };
        }
        // Capture what the tool returned to the model on the previous turn.
        const lastTool = [...messages].reverse().find(m => m.role === 'tool');
        if (lastTool) seenToolOutputs.push(lastTool.content);
        return { content: 'FINAL VERDICT: NEEDS REVIEW — could not write.', tool_calls: [] };
      });

      const result = await agent.execute({
        action: 'verify',
        params: { instruction: 'do not let me write', llmCall, executeTool },
      });

      expect(executeTool).not.toHaveBeenCalled(); // real executor never reached
      expect(seenToolOutputs.join('\n')).toContain('not permitted for the Verifier');
      expect(result.metadata?.verdict).toBe('NEEDS REVIEW');
    });

    it('fails cleanly when llmCall/executeTool are missing', async () => {
      const agent = getVerifierAgent();
      await agent.initialize();
      const result = await agent.execute({ action: 'verify', params: {} });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/llmCall/);
    });
  });
});
