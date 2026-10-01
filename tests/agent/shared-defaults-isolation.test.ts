import { describe, it, expect, vi } from "vitest";
import { CIWatcher } from "../../src/channels/pro/ci-watcher.js";
import { RepairCoordinator, DEFAULT_REPAIR_CONFIG } from "../../src/agent/execution/repair-coordinator.js";
import { ParallelExecutor } from "../../src/agent/parallel/parallel-executor.js";
import { DEFAULT_PARALLEL_CONFIG } from "../../src/agent/parallel/types.js";

// Mock the CodeBuddyClient so we don't need a real API key
vi.mock("../../src/codebuddy/client.js", () => {
  return {
    CodeBuddyClient: class CodeBuddyClient {
      constructor() {}
      async chat() { return { choices: [] }; }
    },
  };
});

describe("Shared Defaults Isolation", () => {
  it("CIWatcher instances should not share mutedPatterns array", () => {
    const watcher1 = new CIWatcher();
    // Simulate an event to mute
    watcher1["events"].set("event1", {
      id: "event1",
      type: "build-failure",
      provider: "github-actions",
      repo: "my-repo",
      branch: "main",
      title: "Failure",
      details: "details",
      logUrl: "url",
      severity: "error",
      workflow: "ci",
      timestamp: Date.now(),
    });
    watcher1.handleMute("event1");

    const watcher2 = new CIWatcher();
    expect(watcher2.getConfig().mutedPatterns).toEqual([]);
  });

  it("RepairCoordinator instances should not mutate DEFAULT_REPAIR_CONFIG", () => {
    const originalPatternsLength = DEFAULT_REPAIR_CONFIG.patterns.length;
    const coordinator1 = new RepairCoordinator();
    coordinator1.addPattern(/zzz/);

    expect(DEFAULT_REPAIR_CONFIG.patterns.length).toBe(originalPatternsLength);

    const coordinator2 = new RepairCoordinator();
    expect(coordinator2.getPatterns().length).toBe(originalPatternsLength);
  });

  it("ParallelExecutor instances should not share models array in DEFAULT_PARALLEL_CONFIG", () => {
    const executor1 = new ParallelExecutor();
    executor1.addModel({
      id: "model1",
      name: "Model 1",
      provider: "openai",
      model: "gpt-4",
      enabled: true,
      apiKey: "dummy-key",
    });

    expect(DEFAULT_PARALLEL_CONFIG.models).toEqual([]);

    const executor2 = new ParallelExecutor();
    expect(executor2.getConfig().models).toEqual([]);
  });
});
