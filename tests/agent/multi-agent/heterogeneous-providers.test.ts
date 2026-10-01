/**
 * Fleet P1 — verify per-agent provider override works so a single
 * MultiAgentSystem can fan out N sub-agents to N different providers
 * (Claude / Codex / Gemini / Ollama) in parallel via Promise.all.
 *
 * The CodeBuddyClient is mocked so we only assert the constructor
 * received the right (apiKey, model, baseURL) tuple per agent — the
 * real LLM calls are out of scope.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

interface ClientArgs {
  apiKey: string;
  model: string;
  baseURL?: string;
}

// Hoist the shared array AND the fake class so vi.mock (which gets
// pulled to the very top of the file by the test runner) can reach
// them without TDZ errors.
const { constructorCalls, FakeCodeBuddyClient } = vi.hoisted(() => {
  const calls: ClientArgs[] = [];
  class FakeClient {
    apiKey: string;
    model: string;
    baseURL?: string;
    constructor(apiKey: string, model: string, baseURL?: string) {
      this.apiKey = apiKey;
      this.model = model;
      this.baseURL = baseURL;
      calls.push({ apiKey, model, baseURL });
    }
    async chat() {
      return { content: "ok", role: "assistant" as const };
    }
    async *chatStream() {
      yield { type: "content" as const, content: "ok" };
      yield { type: "done" as const };
    }
  }
  return { constructorCalls: calls, FakeCodeBuddyClient: FakeClient };
});

vi.mock("../../../src/codebuddy/client.js", () => ({
  CodeBuddyClient: FakeCodeBuddyClient,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { OrchestratorAgent } from "../../../src/agent/multi-agent/agents/orchestrator-agent";
import type { AgentConfig } from "../../../src/agent/multi-agent/types";

describe("Per-agent provider override (Fleet P1)", () => {
  beforeEach(() => {
    constructorCalls.length = 0;
  });

  it("falls back to system-wide (apiKey, baseURL) when no override is set", () => {
    new OrchestratorAgent("system-key", "https://system.example");
    expect(constructorCalls).toHaveLength(1);
    expect(constructorCalls[0]).toMatchObject({
      apiKey: "system-key",
      baseURL: "https://system.example",
    });
  });

  it("applies override.apiKey while keeping system baseURL when override.baseURL absent", () => {
    new OrchestratorAgent("system-key", "https://system.example", {
      providerOverride: { apiKey: "agent-key" },
    });
    expect(constructorCalls[0]).toMatchObject({
      apiKey: "agent-key",
      baseURL: "https://system.example",
    });
  });

  it("applies full override (apiKey + baseURL + model)", () => {
    new OrchestratorAgent("system-key", "https://system.example", {
      providerOverride: {
        apiKey: "claude-key",
        baseURL: "https://api.anthropic.com",
        model: "claude-opus-4",
      },
    });
    expect(constructorCalls[0]).toMatchObject({
      apiKey: "claude-key",
      baseURL: "https://api.anthropic.com",
      model: "claude-opus-4",
    });
  });

  it("override.model takes precedence over config.model", () => {
    new OrchestratorAgent("k", "u", {
      model: "grok-3-latest",
      providerOverride: { model: "qwen3.6:35b" },
    });
    expect(constructorCalls[0].model).toBe("qwen3.6:35b");
  });

  it("config.model still wins when override.model is absent", () => {
    new OrchestratorAgent("k", "u", {
      model: "claude-haiku-4",
      providerOverride: { apiKey: "k2" },
    });
    expect(constructorCalls[0].model).toBe("claude-haiku-4");
  });

  it("ORCHESTRATOR_CONFIG default model wins when both override.model and overrides.model absent", () => {
    vi.stubEnv("GROK_MODEL", "fixture-system-default");
    try {
      new OrchestratorAgent("k");
      expect(constructorCalls[0].model).toBe("fixture-system-default");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it(
    "spawn 4 heterogeneous agents in parallel — one per provider — without conflict",
    async () => {
      const providers: Array<{
        name: string;
        override: NonNullable<AgentConfig["providerOverride"]>;
      }> = [
        {
          name: "claude",
          override: {
            apiKey: "ant-key",
            baseURL: "https://api.anthropic.com",
            model: "claude-opus-4",
          },
        },
        {
          name: "codex",
          override: {
            apiKey: "openai-key",
            baseURL: "https://api.openai.com/v1",
            model: "gpt-5-codex",
          },
        },
        {
          name: "gemini",
          override: {
            apiKey: "gemini-key",
            baseURL: "https://generativelanguage.googleapis.com",
            model: "gemini-2.5-pro",
          },
        },
        {
          name: "ollama",
          override: {
            apiKey: "",
            baseURL: "http://127.0.0.1:11434",
            model: "qwen3.6:35b-a3b-q4_K_M",
          },
        },
      ];

      // Spawn in parallel — same pattern as MultiAgentSystem.executeParallel.
      const agents = await Promise.all(
        providers.map(
          (p) =>
            new OrchestratorAgent("fallback-key", undefined, {
              name: p.name,
              providerOverride: p.override,
            }),
        ),
      );

      expect(agents).toHaveLength(4);
      expect(constructorCalls).toHaveLength(4);
      // Each agent saw its own provider config — no leakage.
      expect(constructorCalls.map((c) => c.model).sort()).toEqual([
        "claude-opus-4",
        "gemini-2.5-pro",
        "gpt-5-codex",
        "qwen3.6:35b-a3b-q4_K_M",
      ]);
      expect(
        constructorCalls.find((c) => c.model === "claude-opus-4")?.apiKey,
      ).toBe("ant-key");
      expect(
        constructorCalls.find((c) => c.model === "qwen3.6:35b-a3b-q4_K_M")?.baseURL,
      ).toBe("http://127.0.0.1:11434");
    },
  );
});
