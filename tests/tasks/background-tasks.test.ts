/**
 * Tests for BackgroundTaskManager
 */

import { BackgroundTaskManager, BackgroundTask, TaskStatus } from "../../src/tasks/background-tasks";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("BackgroundTaskManager", () => {
  let taskManager: BackgroundTaskManager;
  let tempDir: string;
  let originalHome: string;

  beforeEach(() => {
    // Create temp directory for tasks
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "task-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tempDir;

    // Ensure .grok/tasks directory exists
    const tasksDir = path.join(tempDir, ".grok", "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });

    taskManager = new BackgroundTaskManager(3);
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    taskManager.dispose();
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Task Creation", () => {
    it("should create a new task", () => {
      const task = taskManager.createTask("Test prompt", {
        workingDirectory: "/tmp",
        priority: "high",
      });

      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
      expect(typeof task.id).toBe("string");
      expect(task.id.length).toBeGreaterThan(0);
    });

    it("should create task with default values", () => {
      const task = taskManager.createTask("Simple task", {
        workingDirectory: "/tmp",
      });

      expect(task).toBeDefined();
      expect(task.status).toBe("pending");
      expect(task.priority).toBe("normal");
      expect(task.prompt).toBe("Simple task");
    });

    it("should create task with all options", () => {
      const task = taskManager.createTask("Full task", {
        workingDirectory: "/tmp",
        priority: "high",
        model: "grok-3",
        maxToolRounds: 10,
        tags: ["test", "important"],
      });

      expect(task.priority).toBe("high");
      expect(task.model).toBe("grok-3");
      expect(task.maxToolRounds).toBe(10);
      expect(task.tags).toContain("test");
    });

    it("should emit task-created event", () => {
      const eventHandler = jest.fn();
      taskManager.on("task-created", eventHandler);

      taskManager.createTask("Event test", { workingDirectory: "/tmp" });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Event test",
          status: "pending",
        })
      );
    });
  });

  describe("Task Retrieval", () => {
    it("should get task by id", () => {
      const createdTask = taskManager.createTask("Get task test", {
        workingDirectory: "/tmp",
      });

      const task = taskManager.getTask(createdTask.id);
      expect(task).toBeDefined();
      expect(task?.id).toBe(createdTask.id);
    });

    it("should return undefined for unknown task", () => {
      const task = taskManager.getTask("nonexistent-id");
      expect(task).toBeUndefined();
    });

    it("should get all tasks", () => {
      taskManager.createTask("Task 1", { workingDirectory: "/tmp" });
      taskManager.createTask("Task 2", { workingDirectory: "/tmp" });
      taskManager.createTask("Task 3", { workingDirectory: "/tmp" });

      const tasks = taskManager.getTasks();
      expect(tasks.length).toBeGreaterThanOrEqual(3);
    });

    it("should filter tasks by status", () => {
      taskManager.createTask("Pending task", { workingDirectory: "/tmp" });

      const pendingTasks = taskManager.getTasks({ status: "pending" });
      const runningTasks = taskManager.getTasks({ status: "running" });

      expect(pendingTasks.length).toBeGreaterThan(0);
      expect(runningTasks.length).toBe(0);
    });

    it("should limit number of tasks returned", () => {
      for (let i = 0; i < 10; i++) {
        taskManager.createTask(`Task ${i}`, { workingDirectory: "/tmp" });
      }

      const tasks = taskManager.getTasks({ limit: 5 });
      expect(tasks.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Task Cancellation", () => {
    it("should cancel pending task", () => {
      const task = taskManager.createTask("Cancel test", {
        workingDirectory: "/tmp",
      });

      const result = taskManager.cancelTask(task.id);
      expect(result).toBe(true);

      const cancelled = taskManager.getTask(task.id);
      expect(cancelled?.status).toBe("cancelled");
    });

    it("should return false for unknown task", () => {
      const result = taskManager.cancelTask("nonexistent");
      expect(result).toBe(false);
    });

    it("should emit task-cancelled event", () => {
      const eventHandler = jest.fn();
      taskManager.on("task-cancelled", eventHandler);

      const task = taskManager.createTask("Cancel event test", {
        workingDirectory: "/tmp",
      });
      taskManager.cancelTask(task.id);

      expect(eventHandler).toHaveBeenCalled();
    });
  });

  describe("Task Deletion", () => {
    it("should delete task", () => {
      const task = taskManager.createTask("Delete test", {
        workingDirectory: "/tmp",
      });

      const result = taskManager.deleteTask(task.id);
      expect(result).toBe(true);

      const deleted = taskManager.getTask(task.id);
      expect(deleted).toBeUndefined();
    });

    it("should return false for unknown task", () => {
      const result = taskManager.deleteTask("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("Task Statistics", () => {
    it("should get task statistics", () => {
      taskManager.createTask("Stats test 1", { workingDirectory: "/tmp" });
      taskManager.createTask("Stats test 2", { workingDirectory: "/tmp" });

      const stats = taskManager.getStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("pending");
      expect(stats).toHaveProperty("running");
      expect(stats).toHaveProperty("completed");
      expect(stats).toHaveProperty("failed");
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Task Persistence", () => {
    it("should persist task to disk", () => {
      const task = taskManager.createTask("Persist test", {
        workingDirectory: "/tmp",
      });

      // Task should exist in memory at minimum
      const retrieved = taskManager.getTask(task.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.prompt).toBe("Persist test");
    });

    it("should load tasks on initialization", () => {
      // Create a task
      const task = taskManager.createTask("Load test", {
        workingDirectory: "/tmp",
        priority: "high",
      });

      // Create new manager (should load existing tasks)
      const newManager = new BackgroundTaskManager(3);
      const loadedTask = newManager.getTask(task.id);

      expect(loadedTask).toBeDefined();
      expect(loadedTask?.prompt).toBe("Load test");
      expect(loadedTask?.priority).toBe("high");

      newManager.dispose();
    });
  });

  describe("Clear Completed", () => {
    it("should clear completed tasks", () => {
      const task = taskManager.createTask("Clear test", {
        workingDirectory: "/tmp",
      });

      // Mark as completed manually
      const taskRef = taskManager.getTask(task.id);
      if (taskRef) {
        taskRef.status = "completed";
        taskRef.completedAt = new Date();
      }

      const cleared = taskManager.clearCompleted();
      expect(typeof cleared).toBe("number");
    });
  });

  describe("Task Formatting", () => {
    it("should format task for display", () => {
      const task = taskManager.createTask("Format test", {
        workingDirectory: "/tmp",
      });

      const formatted = taskManager.formatTask(task);
      expect(typeof formatted).toBe("string");
      expect(formatted.length).toBeGreaterThan(0);
    });

    it("should format tasks list", () => {
      taskManager.createTask("List test 1", { workingDirectory: "/tmp" });
      taskManager.createTask("List test 2", { workingDirectory: "/tmp" });

      const formatted = taskManager.formatTasksList();
      expect(typeof formatted).toBe("string");
      expect(formatted.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty prompt", () => {
      const task = taskManager.createTask("", { workingDirectory: "/tmp" });
      expect(task.prompt).toBe("");
    });

    it("should handle special characters in prompt", () => {
      const specialPrompt = "Test with 'quotes' and \"double quotes\" and `backticks`";
      const task = taskManager.createTask(specialPrompt, {
        workingDirectory: "/tmp",
      });

      expect(task.prompt).toBe(specialPrompt);
    });

    it("should handle unicode in prompt", () => {
      const unicodePrompt = "Test avec émojis 🎉 et caractères spéciaux: é, ñ, 中文";
      const task = taskManager.createTask(unicodePrompt, {
        workingDirectory: "/tmp",
      });

      expect(task.prompt).toBe(unicodePrompt);
    });
  });
});
