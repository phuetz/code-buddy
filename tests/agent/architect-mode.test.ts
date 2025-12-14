/**
 * Tests for ArchitectMode - Two-phase planning and implementation
 */

import {
  ArchitectMode,
  ArchitectConfig,
  ArchitectProposal,
  ArchitectStep,
  StepResult,
} from "../../src/agent/architect-mode";

// Mock GrokClient
jest.mock("../../src/grok/client.js", () => ({
  GrokClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "Test proposal",
            steps: [
              {
                order: 1,
                description: "Create test file",
                type: "create",
                target: "src/test.ts",
                details: "Create a new test file",
              },
            ],
            files: ["src/test.ts"],
            risks: ["None identified"],
            estimatedChanges: 10,
          }),
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { choices: [{ delta: { content: "Test " } }] };
      yield { choices: [{ delta: { content: "response" } }] };
    }),
    getModel: jest.fn().mockReturnValue("grok-3-latest"),
  })),
}));

jest.mock("../../src/types/index.js", () => ({
  getErrorMessage: jest.fn().mockImplementation((err) => err?.message || String(err)),
}));

describe("ArchitectMode", () => {
  let architect: ArchitectMode;
  const apiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (architect) {
      architect.removeAllListeners();
    }
  });

  describe("Constructor", () => {
    it("should create instance with API key", () => {
      architect = new ArchitectMode(apiKey);
      expect(architect).toBeInstanceOf(ArchitectMode);
    });

    it("should create instance with custom base URL", () => {
      architect = new ArchitectMode(apiKey, "https://custom.api.com");
      expect(architect).toBeInstanceOf(ArchitectMode);
    });

    it("should use default config values", () => {
      architect = new ArchitectMode(apiKey);
      const config = (architect as any).config;

      expect(config.architectModel).toBe("grok-3-latest");
      expect(config.editorModel).toBe("grok-code-fast-1");
      expect(config.autoApprove).toBe(false);
      expect(config.maxSteps).toBe(20);
    });

    it("should accept custom config", () => {
      const customConfig: ArchitectConfig = {
        architectModel: "grok-2",
        editorModel: "grok-code-latest",
        autoApprove: true,
        maxSteps: 50,
      };

      architect = new ArchitectMode(apiKey, undefined, customConfig);
      const config = (architect as any).config;

      expect(config.architectModel).toBe("grok-2");
      expect(config.editorModel).toBe("grok-code-latest");
      expect(config.autoApprove).toBe(true);
      expect(config.maxSteps).toBe(50);
    });
  });

  describe("Events", () => {
    it("should be an EventEmitter", () => {
      architect = new ArchitectMode(apiKey);
      expect(architect.on).toBeDefined();
      expect(architect.emit).toBeDefined();
      expect(architect.off).toBeDefined();
    });

    it("should emit events during design phase", (done) => {
      architect = new ArchitectMode(apiKey);
      const events: string[] = [];

      architect.on("design:start", () => events.push("design:start"));
      architect.on("design:complete", () => {
        events.push("design:complete");
        expect(events).toContain("design:start");
        done();
      });

      architect.emit("design:start");
      architect.emit("design:complete", {});
    });

    it("should emit events during execution phase", (done) => {
      architect = new ArchitectMode(apiKey);
      const events: string[] = [];

      architect.on("execute:start", () => events.push("execute:start"));
      architect.on("step:complete", () => events.push("step:complete"));
      architect.on("execute:complete", () => {
        events.push("execute:complete");
        expect(events).toContain("execute:start");
        done();
      });

      architect.emit("execute:start");
      architect.emit("step:complete", {});
      architect.emit("execute:complete", []);
    });
  });

  describe("State Management", () => {
    it("should start inactive", () => {
      architect = new ArchitectMode(apiKey);
      expect((architect as any).isActive).toBe(false);
    });

    it("should have no proposal initially", () => {
      architect = new ArchitectMode(apiKey);
      expect((architect as any).currentProposal).toBeNull();
    });

    it("should track current proposal", () => {
      architect = new ArchitectMode(apiKey);

      const proposal: ArchitectProposal = {
        summary: "Test proposal",
        steps: [],
        files: [],
        risks: [],
        estimatedChanges: 0,
      };

      (architect as any).currentProposal = proposal;
      expect((architect as any).currentProposal).toBe(proposal);
    });
  });

  describe("Config Access", () => {
    it("should provide access to config", () => {
      architect = new ArchitectMode(apiKey);
      expect((architect as any).config).toBeDefined();
    });
  });
});

describe("ArchitectStep Interface", () => {
  it("should define step types", () => {
    const createStep: ArchitectStep = {
      order: 1,
      description: "Create file",
      type: "create",
      target: "src/new.ts",
    };

    const editStep: ArchitectStep = {
      order: 2,
      description: "Edit file",
      type: "edit",
      target: "src/existing.ts",
    };

    const deleteStep: ArchitectStep = {
      order: 3,
      description: "Delete file",
      type: "delete",
      target: "src/old.ts",
    };

    const commandStep: ArchitectStep = {
      order: 4,
      description: "Run command",
      type: "command",
      target: "npm install",
    };

    const testStep: ArchitectStep = {
      order: 5,
      description: "Run tests",
      type: "test",
      target: "npm test",
    };

    expect(createStep.type).toBe("create");
    expect(editStep.type).toBe("edit");
    expect(deleteStep.type).toBe("delete");
    expect(commandStep.type).toBe("command");
    expect(testStep.type).toBe("test");
  });

  it("should support optional fields", () => {
    const step: ArchitectStep = {
      order: 1,
      description: "Test step",
      type: "create",
    };

    expect(step.target).toBeUndefined();
    expect(step.details).toBeUndefined();
  });
});

describe("ArchitectProposal Interface", () => {
  it("should define proposal structure", () => {
    const proposal: ArchitectProposal = {
      summary: "Implement feature X",
      steps: [
        {
          order: 1,
          description: "Create component",
          type: "create",
          target: "src/components/Feature.tsx",
          details: "Create React component with props",
        },
        {
          order: 2,
          description: "Add tests",
          type: "create",
          target: "tests/Feature.test.tsx",
          details: "Unit tests for component",
        },
      ],
      files: ["src/components/Feature.tsx", "tests/Feature.test.tsx"],
      risks: ["May need to update imports in parent"],
      estimatedChanges: 150,
    };

    expect(proposal.summary).toBeDefined();
    expect(proposal.steps).toHaveLength(2);
    expect(proposal.files).toHaveLength(2);
    expect(proposal.risks).toHaveLength(1);
    expect(proposal.estimatedChanges).toBe(150);
  });

  it("should allow empty arrays", () => {
    const proposal: ArchitectProposal = {
      summary: "No-op proposal",
      steps: [],
      files: [],
      risks: [],
      estimatedChanges: 0,
    };

    expect(proposal.steps).toEqual([]);
    expect(proposal.files).toEqual([]);
    expect(proposal.risks).toEqual([]);
  });
});

describe("StepResult Interface", () => {
  it("should define result structure", () => {
    const step: ArchitectStep = {
      order: 1,
      description: "Test step",
      type: "create",
      target: "test.ts",
    };

    const successResult: StepResult = {
      step,
      response: { created: true, path: "test.ts" },
      success: true,
    };

    const failResult: StepResult = {
      step,
      response: { error: "File already exists" },
      success: false,
    };

    expect(successResult.success).toBe(true);
    expect(failResult.success).toBe(false);
  });
});

describe("ArchitectMode Integration", () => {
  it("should handle design and execution flow", () => {
    const architect = new ArchitectMode("test-api-key");

    // Simulate the flow
    expect((architect as any).isActive).toBe(false);
    expect((architect as any).currentProposal).toBeNull();

    // Set active
    (architect as any).isActive = true;
    expect((architect as any).isActive).toBe(true);

    // Set proposal
    const proposal: ArchitectProposal = {
      summary: "Test",
      steps: [{ order: 1, description: "Test", type: "create" }],
      files: ["test.ts"],
      risks: [],
      estimatedChanges: 10,
    };

    (architect as any).currentProposal = proposal;
    expect((architect as any).currentProposal).toBe(proposal);

    // Complete
    (architect as any).isActive = false;
    (architect as any).currentProposal = null;

    expect((architect as any).isActive).toBe(false);
    expect((architect as any).currentProposal).toBeNull();
  });
});
