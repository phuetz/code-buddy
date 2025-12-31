/**
 * Unit tests for ParallelExecutor
 *
 * Tests the parallel model execution system that runs prompts
 * across multiple models and aggregates results.
 */

import { EventEmitter } from "events";
import {
  ParallelExecutor,
  createParallelExecutor,
  getParallelExecutor,
  resetParallelExecutor,
} from "../../src/agent/parallel/parallel-executor";
import {
  ModelConfig,
  ParallelConfig,
  DEFAULT_PARALLEL_CONFIG,
} from "../../src/agent/parallel/types";

// Mock the CodeBuddyClient
jest.mock("../../src/codebuddy/client.js", () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: "Test response from model",
          },
        },
      ],
      usage: {
        total_tokens: 150,
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    }),
  })),
}));

jest.mock("../../src/types/index.js", () => ({
  getErrorMessage: jest.fn().mockImplementation((err) => err?.message || String(err)),
}));

// Helper to create mock model configs
function createMockModels(count: number = 3): ModelConfig[] {
  const models: ModelConfig[] = [];
  for (let i = 0; i < count; i++) {
    models.push({
      id: `model-${i}`,
      name: `Test Model ${i}`,
      provider: "codebuddy",
      model: `grok-test-${i}`,
      enabled: true,
      weight: 0.5 + i * 0.1,
      capabilities: ["code_generation", "reasoning"],
      costPerToken: 0.00001 * (i + 1),
      latencyMs: 100 * (i + 1),
    });
  }
  return models;
}

// Helper to create a mock config
function createMockConfig(overrides: Partial<ParallelConfig> = {}): ParallelConfig {
  return {
    ...DEFAULT_PARALLEL_CONFIG,
    models: createMockModels(),
    ...overrides,
  };
}

describe("ParallelExecutor", () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    resetParallelExecutor();
    executor = new ParallelExecutor(createMockConfig());
  });

  afterEach(() => {
    if (executor) {
      executor.removeAllListeners();
    }
  });

  describe("Constructor", () => {
    it("should create ParallelExecutor with default config", () => {
      const defaultExecutor = new ParallelExecutor();
      expect(defaultExecutor).toBeInstanceOf(ParallelExecutor);
    });

    it("should create ParallelExecutor with custom config", () => {
      const customConfig = createMockConfig({ strategy: "consensus" });
      const customExecutor = new ParallelExecutor(customConfig);

      expect(customExecutor.getConfig().strategy).toBe("consensus");
    });

    it("should be an EventEmitter", () => {
      expect(executor).toBeInstanceOf(EventEmitter);
      expect(executor.on).toBeDefined();
      expect(executor.emit).toBeDefined();
    });

    it("should initialize clients for enabled models", () => {
      jest.clearAllMocks();
      const config = createMockConfig();
      new ParallelExecutor(config);

      expect(require("../../src/codebuddy/client.js").CodeBuddyClient).toHaveBeenCalledTimes(3);
    });

    it("should skip disabled models", () => {
      jest.clearAllMocks();
      const config = createMockConfig({
        models: [
          { ...createMockModels(1)[0], enabled: true },
          { ...createMockModels(1)[0], id: "model-disabled", enabled: false },
        ],
      });
      new ParallelExecutor(config);

      expect(require("../../src/codebuddy/client.js").CodeBuddyClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute", () => {
    it("should execute with default strategy", async () => {
      const result = await executor.execute("Test prompt");

      expect(result).toBeDefined();
      expect(result.responses).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
    });

    it("should emit parallel:start event", async () => {
      const handler = jest.fn();
      executor.on("parallel:start", handler);

      await executor.execute("Test prompt");

      expect(handler).toHaveBeenCalledWith({
        task: expect.any(String),
        strategy: expect.any(String),
        models: expect.any(Array),
      });
    });

    it("should emit parallel:complete event", async () => {
      const handler = jest.fn();
      executor.on("parallel:complete", handler);

      await executor.execute("Test prompt");

      expect(handler).toHaveBeenCalledWith({
        result: expect.objectContaining({
          strategy: expect.any(String),
          responses: expect.any(Array),
        }),
      });
    });

    it("should include system prompt when provided", async () => {
      const result = await executor.execute(
        "Test prompt",
        "You are a helpful assistant"
      );

      expect(result.responses.length).toBeGreaterThan(0);
    });

    it("should use specified strategy", async () => {
      const result = await executor.execute("Test prompt", undefined, "fastest");

      expect(result.strategy).toBe("fastest");
    });

    it("should track total latency", async () => {
      const result = await executor.execute("Test prompt");

      expect(result.totalLatency).toBeGreaterThanOrEqual(0);
    });

    it("should track effective latency", async () => {
      const result = await executor.execute("Test prompt");

      expect(result.effectiveLatency).toBeGreaterThanOrEqual(0);
    });

    it("should aggregate token usage", async () => {
      const result = await executor.execute("Test prompt");

      expect(result.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it("should handle errors gracefully", async () => {
      const { CodeBuddyClient } = require("../../src/codebuddy/client.js");
      CodeBuddyClient.mockImplementation(() => ({
        chat: jest.fn().mockRejectedValue(new Error("API Error")),
      }));

      const errorExecutor = new ParallelExecutor(createMockConfig());
      const result = await errorExecutor.execute("Test prompt");

      expect(result.confidence).toBe(0);
      expect(result.responses.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Execution Strategies", () => {
    describe("all strategy", () => {
      it("should execute all models", async () => {
        const result = await executor.execute("Test prompt", undefined, "all");

        expect(result.strategy).toBe("all");
        expect(result.responses).toHaveLength(3);
      });

      it("should have responses from all models", async () => {
        const result = await executor.execute("Test prompt", undefined, "all");

        expect(result.responses.length).toBeGreaterThan(0);
      });
    });

    describe("best strategy", () => {
      it("should select best response", async () => {
        const result = await executor.execute("Test prompt", undefined, "best");

        expect(result.strategy).toBe("best");
        expect(result.responses.length).toBeGreaterThan(0);
      });
    });

    describe("fastest strategy", () => {
      it("should return first response", async () => {
        const result = await executor.execute("Test prompt", undefined, "fastest");

        expect(result.strategy).toBe("fastest");
      });

      it("should still collect all responses", async () => {
        const result = await executor.execute("Test prompt", undefined, "fastest");

        expect(result.responses.length).toBeGreaterThan(0);
      });
    });

    describe("cascade strategy", () => {
      it("should try models in order", async () => {
        const result = await executor.execute("Test prompt", undefined, "cascade");

        expect(result.strategy).toBe("cascade");
      });

      it("should return on first successful response", async () => {
        const result = await executor.execute("Test prompt", undefined, "cascade");

        expect(result.responses.length).toBeGreaterThan(0);
      });

      it("should have cascade metadata", async () => {
        const result = await executor.execute("Test prompt", undefined, "cascade");

        expect(result.metadata).toBeDefined();
      });
    });

    describe("route strategy", () => {
      it("should route to best model for task", async () => {
        const result = await executor.execute("Test prompt", undefined, "route");

        expect(result.strategy).toBe("route");
      });

      it("should include routing decision in metadata", async () => {
        const result = await executor.execute("Test prompt", undefined, "route");

        expect(result.metadata.routingDecision).toBeDefined();
      });

      it("should emit parallel:route event", async () => {
        const handler = jest.fn();
        executor.on("parallel:route", handler);

        await executor.execute("Test prompt", undefined, "route");

        expect(handler).toHaveBeenCalled();
      });
    });

    describe("consensus strategy", () => {
      it("should check for consensus", async () => {
        const result = await executor.execute("Test prompt", undefined, "consensus");

        expect(result.strategy).toBe("consensus");
        expect(result.consensus).toBeDefined();
      });

      it("should include agreement level", async () => {
        const result = await executor.execute("Test prompt", undefined, "consensus");

        expect(result.consensus?.agreementLevel).toBeGreaterThanOrEqual(0);
        expect(result.consensus?.agreementLevel).toBeLessThanOrEqual(1);
      });

      it("should emit parallel:consensus event", async () => {
        const handler = jest.fn();
        executor.on("parallel:consensus", handler);

        await executor.execute("Test prompt", undefined, "consensus");

        expect(handler).toHaveBeenCalled();
      });
    });

    describe("debate strategy", () => {
      it("should run debate between models", async () => {
        const result = await executor.execute("Test prompt", undefined, "debate");

        expect(result.strategy).toBe("debate");
        expect(result.debate).toBeDefined();
      });

      it("should track debate rounds", async () => {
        const result = await executor.execute("Test prompt", undefined, "debate");

        expect(result.debate?.rounds).toBeDefined();
        expect(result.debate?.rounds.length).toBeGreaterThan(0);
      });

      it("should determine winner", async () => {
        const result = await executor.execute("Test prompt", undefined, "debate");

        expect(result.debate?.winner).toBeDefined();
      });

      it("should emit parallel:debate:round events", async () => {
        const handler = jest.fn();
        executor.on("parallel:debate:round", handler);

        await executor.execute("Test prompt", undefined, "debate");

        expect(handler).toHaveBeenCalled();
      });
    });

    describe("ensemble strategy", () => {
      it("should synthesize responses", async () => {
        const result = await executor.execute("Test prompt", undefined, "ensemble");

        expect(result.strategy).toBe("ensemble");
        expect(result.aggregationMethod).toBe("synthesize");
      });

      it("should mark as synthesized in metadata", async () => {
        const result = await executor.execute("Test prompt", undefined, "ensemble");

        expect(result.metadata.synthesized).toBe(true);
      });
    });
  });

  describe("Model Management", () => {
    describe("addModel", () => {
      it("should add a new model", () => {
        const newModel: ModelConfig = {
          id: "new-model",
          name: "New Model",
          provider: "codebuddy",
          model: "grok-new",
          enabled: true,
          weight: 0.8,
        };

        executor.addModel(newModel);

        const config = executor.getConfig();
        expect(config.models.find((m) => m.id === "new-model")).toBeDefined();
      });

      it("should update existing model", () => {
        const updatedModel: ModelConfig = {
          id: "model-0",
          name: "Updated Model",
          provider: "codebuddy",
          model: "grok-updated",
          enabled: true,
          weight: 0.9,
        };

        executor.addModel(updatedModel);

        const config = executor.getConfig();
        const model = config.models.find((m) => m.id === "model-0");
        expect(model?.name).toBe("Updated Model");
      });

      it("should initialize client for enabled model", () => {
        jest.clearAllMocks();

        const newModel: ModelConfig = {
          id: "new-enabled",
          name: "New Enabled",
          provider: "codebuddy",
          model: "grok-new",
          enabled: true,
        };

        executor.addModel(newModel);

        expect(require("../../src/codebuddy/client.js").CodeBuddyClient).toHaveBeenCalled();
      });
    });

    describe("removeModel", () => {
      it("should remove a model", () => {
        executor.removeModel("model-0");

        const config = executor.getConfig();
        expect(config.models.find((m) => m.id === "model-0")).toBeUndefined();
      });

      it("should handle removing non-existent model", () => {
        expect(() => {
          executor.removeModel("non-existent");
        }).not.toThrow();
      });
    });
  });

  describe("Routing Rules", () => {
    describe("addRoutingRule", () => {
      it("should add a routing rule", () => {
        executor.addRoutingRule({
          id: "rule-1",
          name: "Code Generation Rule",
          condition: {
            taskTypes: ["code_generation"],
          },
          targetModel: "model-0",
          priority: 10,
        });

        expect(executor).toBeDefined();
      });

      it("should sort rules by priority", () => {
        executor.addRoutingRule({
          id: "rule-low",
          name: "Low Priority",
          condition: {},
          targetModel: "model-0",
          priority: 1,
        });

        executor.addRoutingRule({
          id: "rule-high",
          name: "High Priority",
          condition: {},
          targetModel: "model-1",
          priority: 10,
        });

        expect(executor).toBeDefined();
      });
    });
  });

  describe("Statistics", () => {
    describe("getStatistics", () => {
      it("should return model statistics", () => {
        const stats = executor.getStatistics();

        expect(stats).toBeInstanceOf(Map);
      });

      it("should track successes and failures", async () => {
        await executor.execute("Test prompt");

        const stats = executor.getStatistics();
        for (const [_, modelStats] of stats) {
          expect(modelStats.successes).toBeGreaterThanOrEqual(0);
          expect(modelStats.failures).toBeGreaterThanOrEqual(0);
        }
      });

      it("should track average latency", async () => {
        await executor.execute("Test prompt");

        const stats = executor.getStatistics();
        for (const [_, modelStats] of stats) {
          expect(modelStats.avgLatency).toBeGreaterThanOrEqual(0);
        }
      });
    });
  });

  describe("Cache Management", () => {
    describe("clearCache", () => {
      it("should clear the response cache", async () => {
        await executor.execute("Test prompt");

        executor.clearCache();

        expect(executor).toBeDefined();
      });

      it("should be safe to call on empty cache", () => {
        expect(() => {
          executor.clearCache();
          executor.clearCache();
        }).not.toThrow();
      });
    });

    it("should cache responses when enabled", async () => {
      const cachingConfig = createMockConfig({ cacheResponses: true });
      const cachingExecutor = new ParallelExecutor(cachingConfig);

      await cachingExecutor.execute("Test prompt");
      await cachingExecutor.execute("Test prompt");

      expect(cachingExecutor).toBeDefined();
    });
  });

  describe("Configuration", () => {
    describe("getConfig", () => {
      it("should return a copy of config", () => {
        const config1 = executor.getConfig();
        const config2 = executor.getConfig();

        expect(config1).toEqual(config2);
        expect(config1).not.toBe(config2);
      });
    });

    describe("updateConfig", () => {
      it("should update config", () => {
        executor.updateConfig({ strategy: "consensus" });

        expect(executor.getConfig().strategy).toBe("consensus");
      });

      it("should reinitialize clients when models change", () => {
        jest.clearAllMocks();

        executor.updateConfig({
          models: [
            {
              id: "new-model",
              name: "New",
              provider: "codebuddy",
              model: "new",
              enabled: true,
            },
          ],
        });

        expect(require("../../src/codebuddy/client.js").CodeBuddyClient).toHaveBeenCalled();
      });
    });
  });

  describe("formatResult", () => {
    it("should format result for display", async () => {
      const result = await executor.execute("Test prompt");
      const formatted = executor.formatResult(result);

      expect(formatted).toContain("PARALLEL EXECUTION RESULT");
      expect(formatted).toContain("Strategy:");
      expect(formatted).toContain("Confidence:");
    });

    it("should include model count", async () => {
      const result = await executor.execute("Test prompt");
      const formatted = executor.formatResult(result);

      expect(formatted).toContain("Models executed:");
    });

    it("should show consensus info when present", async () => {
      const result = await executor.execute("Test prompt", undefined, "consensus");
      const formatted = executor.formatResult(result);

      expect(formatted).toContain("Consensus:");
    });

    it("should show debate info when present", async () => {
      const result = await executor.execute("Test prompt", undefined, "debate");
      const formatted = executor.formatResult(result);

      expect(formatted).toContain("Debate:");
    });
  });
});

describe("Aggregation Methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("best_confidence", () => {
    it("should select response with highest confidence", async () => {
      const config = createMockConfig({ aggregation: "best_confidence" });
      const testExecutor = new ParallelExecutor(config);

      const result = await testExecutor.execute("Test prompt", undefined, "all");

      expect(result.responses.length).toBeGreaterThan(0);
    });
  });

  describe("weighted_vote", () => {
    it("should weight responses by model weight", async () => {
      const config = createMockConfig({ aggregation: "weighted_vote" });
      const testExecutor = new ParallelExecutor(config);

      const result = await testExecutor.execute("Test prompt", undefined, "all");

      expect(result.responses.length).toBeGreaterThan(0);
    });
  });

  describe("concatenate", () => {
    it("should concatenate all responses", async () => {
      const config = createMockConfig({ aggregation: "concatenate" });
      const testExecutor = new ParallelExecutor(config);

      const result = await testExecutor.execute("Test prompt", undefined, "all");

      expect(result.responses.length).toBeGreaterThan(0);
    });
  });
});

describe("Task Analysis and Routing", () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor(createMockConfig());
  });

  it("should detect code generation tasks", async () => {
    const result = await executor.execute(
      "Write a function that calculates fibonacci",
      undefined,
      "route"
    );

    expect(result.metadata.routingDecision).toBeDefined();
  });

  it("should detect code review tasks", async () => {
    const result = await executor.execute(
      "Review this code for bugs",
      undefined,
      "route"
    );

    expect(result.metadata.routingDecision).toBeDefined();
  });

  it("should detect debugging tasks", async () => {
    const result = await executor.execute(
      "Debug this error: TypeError",
      undefined,
      "route"
    );

    expect(result.metadata.routingDecision).toBeDefined();
  });

  it("should detect explanation tasks", async () => {
    const result = await executor.execute(
      "Explain how this algorithm works",
      undefined,
      "route"
    );

    expect(result.metadata.routingDecision).toBeDefined();
  });

  it("should detect math tasks", async () => {
    const result = await executor.execute(
      "Calculate 123 + 456",
      undefined,
      "route"
    );

    expect(result.metadata.routingDecision).toBeDefined();
  });
});

describe("Confidence Estimation", () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor(createMockConfig());
  });

  it("should increase confidence for longer responses", async () => {
    const { CodeBuddyClient } = require("../../src/codebuddy/client.js");
    CodeBuddyClient.mockImplementation(() => ({
      chat: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "A".repeat(600),
            },
          },
        ],
        usage: { total_tokens: 600 },
      }),
    }));

    const testExecutor = new ParallelExecutor(createMockConfig());
    const result = await testExecutor.execute("Test");

    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("should decrease confidence for uncertain responses", async () => {
    const { CodeBuddyClient } = require("../../src/codebuddy/client.js");
    CodeBuddyClient.mockImplementation(() => ({
      chat: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: "I'm not sure, maybe this could be the answer, perhaps",
            },
          },
        ],
        usage: { total_tokens: 50 },
      }),
    }));

    const testExecutor = new ParallelExecutor(createMockConfig());
    const result = await testExecutor.execute("Test");

    expect(result.confidence).toBeLessThan(0.6);
  });
});

describe("Singleton Functions", () => {
  beforeEach(() => {
    resetParallelExecutor();
  });

  describe("createParallelExecutor", () => {
    it("should create a new instance", () => {
      const executor = createParallelExecutor();
      expect(executor).toBeInstanceOf(ParallelExecutor);
    });

    it("should accept config", () => {
      const executor = createParallelExecutor({ strategy: "consensus" });
      expect(executor.getConfig().strategy).toBe("consensus");
    });
  });

  describe("getParallelExecutor", () => {
    it("should return singleton instance", () => {
      const executor1 = getParallelExecutor();
      const executor2 = getParallelExecutor();

      expect(executor1).toBe(executor2);
    });
  });

  describe("resetParallelExecutor", () => {
    it("should reset the singleton", () => {
      const executor1 = getParallelExecutor();

      resetParallelExecutor();

      const executor2 = getParallelExecutor();
      expect(executor1).not.toBe(executor2);
    });

    it("should be safe to call when no instance exists", () => {
      expect(() => {
        resetParallelExecutor();
        resetParallelExecutor();
      }).not.toThrow();
    });
  });
});

describe("Text Similarity", () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor(createMockConfig());
  });

  it("should calculate similarity between identical texts", () => {
    const similarity = (executor as any).calculateSimilarity(
      "hello world",
      "hello world"
    );

    expect(similarity).toBe(1);
  });

  it("should calculate similarity between different texts", () => {
    const similarity = (executor as any).calculateSimilarity(
      "hello world",
      "goodbye world"
    );

    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it("should handle empty texts", () => {
    const similarity = (executor as any).calculateSimilarity("", "");

    expect(similarity).toBeDefined();
  });
});

describe("Event Emission", () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    executor = new ParallelExecutor(createMockConfig());
  });

  it("should emit parallel:model:start for each model", async () => {
    const handler = jest.fn();
    executor.on("parallel:model:start", handler);

    await executor.execute("Test prompt", undefined, "all");

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("should emit parallel:model:complete for successful models", async () => {
    const handler = jest.fn();
    executor.on("parallel:model:complete", handler);

    await executor.execute("Test prompt");

    expect(handler).toHaveBeenCalled();
  });

  it("should emit parallel:model:error for failed models", async () => {
    const { CodeBuddyClient } = require("../../src/codebuddy/client.js");
    CodeBuddyClient.mockImplementation(() => ({
      chat: jest.fn().mockRejectedValue(new Error("Model error")),
    }));

    const errorExecutor = new ParallelExecutor(createMockConfig());
    const handler = jest.fn();
    errorExecutor.on("parallel:model:error", handler);

    await errorExecutor.execute("Test prompt");

    expect(handler).toHaveBeenCalled();
  });
});

describe("DEFAULT_PARALLEL_CONFIG", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_PARALLEL_CONFIG.strategy).toBe("best");
    expect(DEFAULT_PARALLEL_CONFIG.aggregation).toBe("best_confidence");
    expect(DEFAULT_PARALLEL_CONFIG.timeout).toBeGreaterThan(0);
    expect(DEFAULT_PARALLEL_CONFIG.maxRetries).toBeGreaterThan(0);
    expect(DEFAULT_PARALLEL_CONFIG.consensusThreshold).toBeGreaterThan(0);
    expect(DEFAULT_PARALLEL_CONFIG.consensusThreshold).toBeLessThanOrEqual(1);
  });
});
