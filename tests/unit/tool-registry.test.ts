import { ToolRegistry, getToolRegistry } from "../../src/tools/registry";
import { CodeBuddyTool } from "../../src/codebuddy/client";
import { ToolMetadata } from "../../src/tools/types";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  const mockTool: CodeBuddyTool = {
    type: "function",
    function: {
      name: "test_tool",
      description: "A test tool",
      parameters: { type: "object", properties: {}, required: [] }
    }
  };

  const mockMetadata: ToolMetadata = {
    name: "test_tool",
    category: "utility",
    keywords: ["test"],
    priority: 5,
    description: "A test tool"
  };

  beforeEach(() => {
    registry = getToolRegistry();
    registry.clear();
  });

  it("should be a singleton", () => {
    const instance2 = ToolRegistry.getInstance();
    expect(registry).toBe(instance2);
  });

  it("should register and retrieve a tool", () => {
    registry.registerTool(mockTool, mockMetadata);
    const retrieved = registry.getTool("test_tool");
    expect(retrieved).toBeDefined();
    expect(retrieved?.definition).toEqual(mockTool);
    expect(retrieved?.metadata).toEqual(mockMetadata);
  });

  it("should return enabled tools", () => {
    registry.registerTool(mockTool, mockMetadata, () => true);
    registry.registerTool(
      { ...mockTool, function: { ...mockTool.function, name: "disabled_tool" } },
      { ...mockMetadata, name: "disabled_tool" },
      () => false
    );

    const enabledTools = registry.getEnabledTools();
    expect(enabledTools).toHaveLength(1);
    expect(enabledTools[0].function.name).toBe("test_tool");
  });

  it("should check if a tool is enabled", () => {
    registry.registerTool(mockTool, mockMetadata, () => true);
    expect(registry.isToolEnabled("test_tool")).toBe(true);
    expect(registry.isToolEnabled("non_existent")).toBe(false);
  });

  it("should overwrite existing registration with warning (handled internally)", () => {
    const newMetadata = { ...mockMetadata, priority: 10 };
    registry.registerTool(mockTool, mockMetadata);
    registry.registerTool(mockTool, newMetadata);
    
    expect(registry.getTool("test_tool")?.metadata.priority).toBe(10);
  });
});
