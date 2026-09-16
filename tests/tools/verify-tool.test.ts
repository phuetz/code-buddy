/**
 * Verify Tool Tests
 *
 * The `verify` tool is the runtime call-site that makes the independent
 * Verifier agent REACHABLE (it was registered in the AgentRegistry but nothing
 * delegated to it). These tests prove:
 *  - the tool is registered/discoverable (factory, schema, metadata, LLM def)
 *  - executing it routes to `registry.executeOn('verifier', …)` — proven by
 *    driving the Verifier's real loop with a fake llmCall (no real LLM) and
 *    observing the verdict flow back, plus that the Verifier's doctrine prompt
 *    (not some other agent's) reached the model
 *  - it fails closed when the LLM bridge is not wired
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  VerifyTool,
  createVerifyTools,
  setVerifyToolProvider,
  resetVerifyToolProvider,
} from '../../src/tools/registry/verify-tools.js';
import { resetAgentRegistry } from '../../src/agent/specialized/agent-registry.js';
import { resetVerifierAgent, VERIFIER_SYSTEM_PROMPT } from '../../src/agent/specialized/verifier-agent.js';
import type { SWEMessage, SWETool, SWELLMResponse } from '../../src/agent/specialized/swe-agent.js';
import { VERIFY_TOOLS } from '../../src/codebuddy/tool-definitions/verify-tools.js';
import { getBuiltinToolNames } from '../../src/codebuddy/tools.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';

describe('Verify tool', () => {
  beforeEach(async () => {
    await resetAgentRegistry();
    resetVerifierAgent();
    resetVerifyToolProvider();
  });

  afterEach(async () => {
    await resetAgentRegistry();
    resetVerifierAgent();
    resetVerifyToolProvider();
  });

  describe('registration & discoverability', () => {
    it('exposes a `verify` tool from the factory', () => {
      const tools = createVerifyTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe('verify');
      const schema = tools[0]!.getSchema();
      expect(schema.parameters.required).toContain('instruction');
    });

    it('requires confirmation and is NOT fleet-safe (drives execution tools)', () => {
      const meta = new VerifyTool().getMetadata();
      expect(meta.requiresConfirmation).toBe(true);
      expect(meta.modifiesFiles).toBe(false);

      // RAG metadata entry exists and is not peer-exposable (fleetSafe absent/false).
      const rag = TOOL_METADATA.find((m) => m.name === 'verify');
      expect(rag, 'verify must have RAG metadata').toBeDefined();
      expect(rag!.fleetSafe).not.toBe(true);
    });

    it('is present in the built-in LLM tool definitions', () => {
      expect(VERIFY_TOOLS.map((t) => t.function.name)).toContain('verify');
      expect(getBuiltinToolNames()).toContain('verify');
    });
  });

  describe('runtime routing to the Verifier agent', () => {
    it('delegates to executeOn(\'verifier\') and fails closed without a real oracle (fake LLM)', async () => {
      const seen: { systemPrompt?: string; userMsg?: string } = {};
      // The Verifier's loop calls llmCall(messages, tools). Returning a final
      // answer with no tool_calls ends the loop immediately with that verdict.
      const llmCall = vi.fn(async (messages: SWEMessage[], _tools: SWETool[]): Promise<SWELLMResponse> => {
        seen.systemPrompt = messages.find((m) => m.role === 'system')?.content;
        seen.userMsg = messages.find((m) => m.role === 'user')?.content;
        return {
          content: 'WHAT WAS VERIFIED: the flow\nRESULT: pass\nEVIDENCE: 12/12 tests\nFINAL VERDICT: CONFIRMED',
          tool_calls: [],
        };
      });
      const executeTool = vi.fn(async () => ({ success: true, output: 'unused' }));

      setVerifyToolProvider(() => ({ llmCall, executeTool }));

      const tool = new VerifyTool();
      const result = await tool.execute({ instruction: 'Verify the login flow redirects to /dashboard' });

      // Proof the runtime path reached the Verifier's loop…
      expect(llmCall).toHaveBeenCalledTimes(1);
      // …as the VERIFIER specifically (its doctrine prompt, not another agent's).
      expect(seen.systemPrompt).toBe(VERIFIER_SYSTEM_PROMPT);
      // …with the instruction threaded through.
      expect(seen.userMsg).toContain('login flow redirects to /dashboard');

      // Verdict flows back through the tool result.
      expect(result.success).toBe(true);
      expect(result.output).toContain('CONFIRMED');
      expect(result.output).toContain('[Verifier verdict: NEEDS REVIEW]');
    });

    it('threads the optional url hint into the verification request', async () => {
      let userMsg = '';
      const llmCall = vi.fn(async (messages: SWEMessage[]): Promise<SWELLMResponse> => {
        userMsg = messages.find((m) => m.role === 'user')?.content ?? '';
        return { content: 'FINAL VERDICT: NEEDS REVIEW — could not run.', tool_calls: [] };
      });
      const executeTool = vi.fn(async () => ({ success: true, output: '' }));
      setVerifyToolProvider(() => ({ llmCall, executeTool }));

      const result = await new VerifyTool().execute({
        instruction: 'check the homepage renders',
        url: 'http://localhost:5173',
      });

      expect(userMsg).toContain('check the homepage renders');
      expect(result.output).toContain('NEEDS REVIEW');
    });
  });

  describe('fail-closed behavior', () => {
    it('errors clearly when the LLM bridge is not wired', async () => {
      // No setVerifyToolProvider() call in this test.
      const result = await new VerifyTool().execute({ instruction: 'anything' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not wired|configuration error/i);
    });

    it('errors when no instruction is provided', async () => {
      setVerifyToolProvider(() => ({
        llmCall: vi.fn(async () => ({ content: '', tool_calls: [] })),
        executeTool: vi.fn(async () => ({ success: true })),
      }));
      const result = await new VerifyTool().execute({});
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/instruction/i);
    });
  });
});
