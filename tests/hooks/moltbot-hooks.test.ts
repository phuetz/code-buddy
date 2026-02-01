/**
 * Tests for Moltbot-Inspired Hooks
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  IntroHookManager,
  SessionPersistenceManager,
  CommandLogger,
  MoltbotHooksManager,
  getMoltbotHooksManager,
  resetMoltbotHooksManager,
  DEFAULT_MOLTBOT_CONFIG,
  DEFAULT_INTRO_HOOK_TEMPLATE,
  checkMoltbotSetup,
  setupMoltbotHooks,
  enableMoltbotHooks,
  disableMoltbotHooks,
  getIntroHookContent,
  setIntroHookContent,
  formatSetupStatus,
} from "../../src/hooks/moltbot-hooks.js";

describe("Moltbot Hooks", () => {
  let tempDir: string;
  let testCounter = 0;

  function uniqueId(): string {
    return `${Date.now()}-${++testCounter}`;
  }

  beforeAll(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moltbot-test-"));
  });

  afterAll(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetMoltbotHooksManager();
  });

  describe("IntroHookManager", () => {
    let manager: IntroHookManager;
    let projectDir: string;

    beforeEach(() => {
      projectDir = path.join(tempDir, `project-${uniqueId()}`);
      fs.mkdirSync(projectDir, { recursive: true });
      manager = new IntroHookManager(projectDir);
    });

    it("should return empty content when disabled", async () => {
      manager.updateConfig({ enabled: false });

      const result = await manager.loadIntro();

      expect(result.content).toBe("");
      expect(result.sources).toHaveLength(0);
      expect(result.truncated).toBe(false);
    });

    it("should load inline intro source", async () => {
      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "inline-test",
            type: "inline",
            content: "You are a helpful assistant.",
            priority: 1,
            enabled: true,
          },
        ],
      });

      const result = await manager.loadIntro();

      expect(result.content).toBe("You are a helpful assistant.");
      expect(result.sources).toContain("inline-test");
    });

    it("should load file intro source", async () => {
      const readmePath = path.join(projectDir, ".codebuddy", "README.md");
      fs.mkdirSync(path.dirname(readmePath), { recursive: true });
      fs.writeFileSync(readmePath, "# Project Instructions\n\nFollow these rules.");

      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "project-readme",
            type: "file",
            path: ".codebuddy/README.md",
            priority: 1,
            enabled: true,
          },
        ],
      });

      const result = await manager.loadIntro();

      expect(result.content).toContain("Project Instructions");
      expect(result.content).toContain("Follow these rules");
      expect(result.sources).toContain("project-readme");
    });

    it("should combine multiple sources by priority", async () => {
      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "source-2",
            type: "inline",
            content: "Second content",
            priority: 2,
            enabled: true,
          },
          {
            id: "source-1",
            type: "inline",
            content: "First content",
            priority: 1,
            enabled: true,
          },
        ],
      });

      const result = await manager.loadIntro();

      expect(result.content).toMatch(/First content.*Second content/s);
      expect(result.sources).toEqual(["source-1", "source-2"]);
    });

    it("should skip disabled sources", async () => {
      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "enabled",
            type: "inline",
            content: "Enabled content",
            priority: 1,
            enabled: true,
          },
          {
            id: "disabled",
            type: "inline",
            content: "Disabled content",
            priority: 2,
            enabled: false,
          },
        ],
      });

      const result = await manager.loadIntro();

      expect(result.content).toBe("Enabled content");
      expect(result.sources).not.toContain("disabled");
    });

    it("should truncate content exceeding maxLength", async () => {
      const longContent = "A".repeat(10000);
      manager.updateConfig({
        enabled: true,
        maxLength: 100,
        sources: [
          {
            id: "long",
            type: "inline",
            content: longContent,
            priority: 1,
            enabled: true,
          },
        ],
      });

      const result = await manager.loadIntro();

      expect(result.content.length).toBeLessThan(200);
      expect(result.truncated).toBe(true);
      expect(result.content).toContain("[... truncated ...]");
    });

    it("should cache loaded content", async () => {
      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "cached",
            type: "inline",
            content: "Cached content",
            priority: 1,
            enabled: true,
          },
        ],
      });

      await manager.loadIntro();
      const cached = manager.getCachedIntro();

      expect(cached).toBe("Cached content");
    });

    it("should clear cache on config update", async () => {
      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "test",
            type: "inline",
            content: "Test",
            priority: 1,
            enabled: true,
          },
        ],
      });

      await manager.loadIntro();
      expect(manager.getCachedIntro()).toBe("Test");

      manager.updateConfig({ maxLength: 5000 });
      expect(manager.getCachedIntro()).toBeNull();
    });

    it("should add and remove sources", () => {
      manager.addSource({
        id: "new-source",
        type: "inline",
        content: "New content",
        priority: 1,
        enabled: true,
      });

      const config = manager.getConfig();
      expect(config.sources.some(s => s.id === "new-source")).toBe(true);

      const removed = manager.removeSource("new-source");
      expect(removed).toBe(true);
      expect(manager.getConfig().sources.some(s => s.id === "new-source")).toBe(false);
    });

    it("should emit intro-loaded event", async () => {
      const handler = jest.fn();
      manager.on("intro-loaded", handler);

      manager.updateConfig({
        enabled: true,
        sources: [
          {
            id: "event-test",
            type: "inline",
            content: "Event test",
            priority: 1,
            enabled: true,
          },
        ],
      });

      await manager.loadIntro();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: ["event-test"],
          truncated: false,
        })
      );
    });
  });

  describe("SessionPersistenceManager", () => {
    let manager: SessionPersistenceManager;
    let storageDir: string;

    beforeEach(() => {
      storageDir = path.join(tempDir, `sessions-${uniqueId()}`);
      manager = new SessionPersistenceManager(tempDir, {
        storagePath: storageDir,
        autoSaveInterval: 0, // Disable auto-save for tests
      });
    });

    afterEach(() => {
      manager.dispose();
    });

    it("should create a new session", async () => {
      const session = await manager.startSession();

      expect(session.id).toBeDefined();
      expect(session.projectPath).toBe(tempDir);
      expect(session.messages).toHaveLength(0);
      expect(session.createdAt).toBeDefined();
    });

    it("should save and load session", async () => {
      const session = await manager.startSession("test-session");
      manager.addMessage({ role: "user", content: "Hello" });
      manager.addMessage({ role: "assistant", content: "Hi there!" });
      await manager.saveSession();

      // Create new manager to load
      const newManager = new SessionPersistenceManager(tempDir, {
        storagePath: storageDir,
      });
      const loaded = await newManager.loadSession("test-session");

      expect(loaded).toBeDefined();
      expect(loaded?.messages).toHaveLength(2);
      expect(loaded?.messages[0].content).toBe("Hello");
      expect(loaded?.messages[1].content).toBe("Hi there!");

      newManager.dispose();
    });

    it("should add messages to session", async () => {
      await manager.startSession();

      manager.addMessage({ role: "user", content: "Test message" });
      const session = manager.getCurrentSession();

      expect(session?.messages).toHaveLength(1);
      expect(session?.messages[0].role).toBe("user");
      expect(session?.messages[0].content).toBe("Test message");
      expect(session?.messages[0].id).toBeDefined();
      expect(session?.messages[0].timestamp).toBeDefined();
    });

    it("should add tool calls to last assistant message", async () => {
      await manager.startSession();
      manager.addMessage({ role: "assistant", content: "Let me help" });

      manager.addToolCall({
        name: "read_file",
        arguments: { path: "/test.txt" },
        result: "File contents",
      });

      const session = manager.getCurrentSession();
      expect(session?.messages[0].toolCalls).toHaveLength(1);
      expect(session?.messages[0].toolCalls?.[0].name).toBe("read_file");
    });

    it("should trim messages exceeding limit", async () => {
      manager.updateConfig({ maxMessagesPerSession: 3 });
      await manager.startSession();

      for (let i = 0; i < 5; i++) {
        manager.addMessage({ role: "user", content: `Message ${i}` });
      }
      await manager.saveSession();

      const session = manager.getCurrentSession();
      expect(session?.messages).toHaveLength(3);
      expect(session?.messages[0].content).toBe("Message 2"); // First 2 trimmed
    });

    it("should list sessions for project", async () => {
      await manager.startSession("session-1");
      await manager.saveSession();
      await manager.endSession();

      await manager.startSession("session-2");
      await manager.saveSession();

      const sessions = manager.listSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it("should get most recent session", async () => {
      await manager.startSession("old-session");
      await manager.saveSession();
      await manager.endSession();

      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));

      await manager.startSession("new-session");
      await manager.saveSession();
      await manager.endSession();

      const recent = manager.getMostRecentSession();
      expect(recent?.id).toBe("new-session");
    });

    it("should cleanup old sessions", async () => {
      manager.updateConfig({ maxSessions: 2 });

      for (let i = 0; i < 4; i++) {
        await manager.startSession(`cleanup-session-${i}`);
        await manager.saveSession();
        await manager.endSession();
      }

      const deleted = await manager.cleanupOldSessions();
      expect(deleted).toBe(2);

      const remaining = manager.listSessions();
      expect(remaining.length).toBe(2);
    });

    it("should emit session events", async () => {
      const startHandler = jest.fn();
      const saveHandler = jest.fn();
      const endHandler = jest.fn();

      manager.on("session-started", startHandler);
      manager.on("session-saved", saveHandler);
      manager.on("session-ended", endHandler);

      await manager.startSession("event-session");
      await manager.saveSession();
      await manager.endSession();

      expect(startHandler).toHaveBeenCalled();
      expect(saveHandler).toHaveBeenCalled();
      expect(endHandler).toHaveBeenCalled();
    });

    it("should resume existing session", async () => {
      await manager.startSession("resume-test");
      manager.addMessage({ role: "user", content: "Original message" });
      await manager.saveSession();
      await manager.endSession();

      const resumed = await manager.startSession("resume-test");
      expect(resumed.messages).toHaveLength(1);
      expect(resumed.messages[0].content).toBe("Original message");
    });
  });

  describe("CommandLogger", () => {
    let logger: CommandLogger;
    let logDir: string;

    beforeEach(() => {
      logDir = path.join(tempDir, `logs-${uniqueId()}`);
      logger = new CommandLogger({
        logPath: logDir,
        logLevel: "verbose",
        redactSecrets: true,
        rotateDaily: false,
      });
    });

    afterEach(() => {
      logger.dispose();
    });

    it("should log tool calls", async () => {
      logger.logToolCall(
        "read_file",
        { path: "/test.txt" },
        { success: true, output: "File content" },
        100
      );

      await logger.flush();

      const files = fs.readdirSync(logDir);
      expect(files.some(f => f.includes("commands"))).toBe(true);
    });

    it("should log bash commands", async () => {
      logger.logBashCommand("ls -la", { success: true, output: "file1\nfile2", exitCode: 0 }, 50);

      await logger.flush();

      const logFile = fs.readdirSync(logDir).find(f => f.includes("commands"));
      expect(logFile).toBeDefined();

      const content = fs.readFileSync(path.join(logDir, logFile!), "utf-8");
      expect(content).toContain("ls -la");
    });

    it("should redact secrets from commands", async () => {
      logger.logBashCommand(
        'export API_KEY="sk-secret123456789012345"',
        { success: true, exitCode: 0 }
      );

      await logger.flush();

      const logFile = fs.readdirSync(logDir).find(f => f.includes("commands"));
      const content = fs.readFileSync(path.join(logDir, logFile!), "utf-8");

      expect(content).not.toContain("sk-secret123456789012345");
      expect(content).toContain("[REDACTED]");
    });

    it("should redact secrets from arguments", async () => {
      logger.logToolCall(
        "set_env",
        { name: "password", value: "super-secret" },
        { success: true }
      );

      await logger.flush();

      const logFile = fs.readdirSync(logDir).find(f => f.includes("commands"));
      const content = fs.readFileSync(path.join(logDir, logFile!), "utf-8");

      expect(content).not.toContain("super-secret");
      expect(content).toContain("[REDACTED]");
    });

    it("should include session ID when configured", async () => {
      logger.setSessionId("test-session-123");
      logger.logToolCall("test_tool", {}, { success: true });

      await logger.flush();

      const logFile = fs.readdirSync(logDir).find(f => f.includes("commands"));
      const content = fs.readFileSync(path.join(logDir, logFile!), "utf-8");

      expect(content).toContain("test-session-123");
    });

    it("should skip logging when disabled", async () => {
      logger.updateConfig({ enabled: false });
      logger.logToolCall("test_tool", {}, { success: true });

      await logger.flush();

      // Check for log files specifically (directory may exist but should have no .log files)
      const files = fs.readdirSync(logDir).filter(f => f.endsWith(".log"));
      expect(files.length).toBe(0);
    });

    it("should log file edits", async () => {
      logger.logFileEdit("/path/to/file.ts", "edit", true);

      await logger.flush();

      const logFile = fs.readdirSync(logDir).find(f => f.includes("commands"));
      const content = fs.readFileSync(path.join(logDir, logFile!), "utf-8");

      expect(content).toContain("/path/to/file.ts");
      expect(content).toContain("edit");
    });

    it("should get log statistics", async () => {
      logger.logToolCall("tool1", {}, { success: true });
      logger.logToolCall("tool2", {}, { success: true });
      await logger.flush();

      const stats = logger.getStats();

      expect(stats.totalEntries).toBe(2);
      expect(stats.logSize).toBeGreaterThan(0);
    });

    it("should emit logged event", async () => {
      const handler = jest.fn();
      logger.on("logged", handler);

      logger.logToolCall("event_test", {}, { success: true });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_call",
          action: "event_test",
        })
      );
    });
  });

  describe("MoltbotHooksManager", () => {
    let manager: MoltbotHooksManager;
    let projectDir: string;

    beforeEach(() => {
      projectDir = path.join(tempDir, `project-${uniqueId()}`);
      fs.mkdirSync(projectDir, { recursive: true });

      manager = new MoltbotHooksManager(projectDir, {
        persistence: {
          ...DEFAULT_MOLTBOT_CONFIG.persistence,
          storagePath: path.join(tempDir, `sessions-${uniqueId()}`),
          autoSaveInterval: 0,
        },
        commandLog: {
          ...DEFAULT_MOLTBOT_CONFIG.commandLog,
          logPath: path.join(tempDir, `logs-${uniqueId()}`),
        },
      });
    });

    afterEach(() => {
      manager.dispose();
    });

    it("should initialize session with intro", async () => {
      // Create intro file
      const introPath = path.join(projectDir, ".codebuddy", "README.md");
      fs.mkdirSync(path.dirname(introPath), { recursive: true });
      fs.writeFileSync(introPath, "# Test Instructions");

      manager.getIntroManager().updateConfig({
        enabled: true,
        sources: [
          {
            id: "project-readme",
            type: "file",
            path: ".codebuddy/README.md",
            priority: 1,
            enabled: true,
          },
        ],
      });

      const { intro, session } = await manager.initializeSession();

      expect(intro.content).toContain("Test Instructions");
      expect(session.id).toBeDefined();
    });

    it("should resume last session", async () => {
      // Create first session
      const { session: first } = await manager.initializeSession("first-session");
      manager.getSessionManager().addMessage({ role: "user", content: "Hello" });
      await manager.endSession();

      // Resume
      const { session: resumed } = await manager.resumeLastSession();

      expect(resumed).toBeDefined();
      expect(resumed?.messages).toHaveLength(1);
    });

    it("should provide access to sub-managers", () => {
      expect(manager.getIntroManager()).toBeInstanceOf(IntroHookManager);
      expect(manager.getSessionManager()).toBeInstanceOf(SessionPersistenceManager);
      expect(manager.getCommandLogger()).toBeInstanceOf(CommandLogger);
    });

    it("should save and load configuration", () => {
      const configPath = path.join(projectDir, ".codebuddy", "moltbot-hooks.json");

      manager.getIntroManager().updateConfig({ maxLength: 5000 });
      manager.saveConfig(configPath);

      expect(fs.existsSync(configPath)).toBe(true);

      // Create new manager and load
      const newManager = new MoltbotHooksManager(projectDir);
      newManager.loadConfig(configPath);

      expect(newManager.getConfig().intro.maxLength).toBe(5000);

      newManager.dispose();
    });

    it("should format status", async () => {
      await manager.initializeSession();
      const status = manager.formatStatus();

      expect(status).toContain("Moltbot Hooks Status");
      expect(status).toContain("Intro Hook");
      expect(status).toContain("Session Persistence");
      expect(status).toContain("Command Logging");
    });

    it("should forward events from sub-managers", async () => {
      const sessionStarted = jest.fn();
      const introLoaded = jest.fn();

      manager.on("session-started", sessionStarted);
      manager.on("intro-loaded", introLoaded);

      await manager.initializeSession();

      expect(sessionStarted).toHaveBeenCalled();
      expect(introLoaded).toHaveBeenCalled();
    });
  });

  describe("Singleton", () => {
    it("should return same instance from getMoltbotHooksManager", () => {
      const manager1 = getMoltbotHooksManager(tempDir);
      const manager2 = getMoltbotHooksManager();

      expect(manager1).toBe(manager2);
    });

    it("should create new instance with different directory", () => {
      const manager1 = getMoltbotHooksManager(tempDir);
      const newDir = path.join(tempDir, "different");
      fs.mkdirSync(newDir, { recursive: true });
      const manager2 = getMoltbotHooksManager(newDir);

      expect(manager1).not.toBe(manager2);
    });

    it("should create new instance after reset", () => {
      const manager1 = getMoltbotHooksManager(tempDir);
      resetMoltbotHooksManager();
      const manager2 = getMoltbotHooksManager(tempDir);

      expect(manager1).not.toBe(manager2);
    });
  });

  describe("Setup Utilities (Moltbot-style)", () => {
    let setupDir: string;

    beforeEach(() => {
      setupDir = path.join(tempDir, `setup-${uniqueId()}`);
      fs.mkdirSync(setupDir, { recursive: true });
    });

    describe("checkMoltbotSetup", () => {
      it("should detect no setup when directories are empty", () => {
        const status = checkMoltbotSetup(setupDir);

        expect(status.hasProjectIntro).toBe(false);
        expect(status.hasProjectConfig).toBe(false);
        expect(status.introPath).toBeNull();
        expect(status.configPath).toBeNull();
      });

      it("should detect project intro hook", () => {
        const introDir = path.join(setupDir, ".codebuddy");
        fs.mkdirSync(introDir, { recursive: true });
        fs.writeFileSync(path.join(introDir, "intro_hook.txt"), "Test intro");

        const status = checkMoltbotSetup(setupDir);

        expect(status.hasProjectIntro).toBe(true);
        expect(status.introPath).toContain("intro_hook.txt");
      });

      it("should detect project config", () => {
        const configDir = path.join(setupDir, ".codebuddy");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, "moltbot-hooks.json"), "{}");

        const status = checkMoltbotSetup(setupDir);

        expect(status.hasProjectConfig).toBe(true);
        expect(status.configPath).toContain("moltbot-hooks.json");
      });
    });

    describe("setupMoltbotHooks", () => {
      it("should create intro_hook.txt with default template", () => {
        const result = setupMoltbotHooks(setupDir, {
          enableIntroHook: true,
          enableSessionPersistence: false,
          enableCommandLogging: false,
        });

        expect(result.success).toBe(true);
        expect(result.filesCreated.some(f => f.includes("intro_hook.txt"))).toBe(true);

        const introPath = path.join(setupDir, ".codebuddy", "intro_hook.txt");
        expect(fs.existsSync(introPath)).toBe(true);

        const content = fs.readFileSync(introPath, "utf-8");
        expect(content).toContain("AI Role Configuration");
      });

      it("should create intro_hook.txt with custom content", () => {
        const customContent = "You are a SEO expert.";
        const result = setupMoltbotHooks(setupDir, {
          enableIntroHook: true,
          enableSessionPersistence: false,
          enableCommandLogging: false,
          introContent: customContent,
        });

        expect(result.success).toBe(true);

        const introPath = path.join(setupDir, ".codebuddy", "intro_hook.txt");
        const content = fs.readFileSync(introPath, "utf-8");
        expect(content).toBe(customContent);
      });

      it("should create moltbot-hooks.json config", () => {
        const result = setupMoltbotHooks(setupDir, {
          enableIntroHook: true,
          enableSessionPersistence: true,
          enableCommandLogging: true,
        });

        expect(result.success).toBe(true);
        expect(result.filesCreated.some(f => f.includes("moltbot-hooks.json"))).toBe(true);

        const configPath = path.join(setupDir, ".codebuddy", "moltbot-hooks.json");
        expect(fs.existsSync(configPath)).toBe(true);

        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(config.intro.enabled).toBe(true);
        expect(config.persistence.enabled).toBe(true);
        expect(config.commandLog.enabled).toBe(true);
      });

      it("should disable hooks in config when requested", () => {
        const result = setupMoltbotHooks(setupDir, {
          enableIntroHook: false,
          enableSessionPersistence: false,
          enableCommandLogging: false,
        });

        expect(result.success).toBe(true);

        const configPath = path.join(setupDir, ".codebuddy", "moltbot-hooks.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(config.intro.enabled).toBe(false);
        expect(config.persistence.enabled).toBe(false);
        expect(config.commandLog.enabled).toBe(false);
      });
    });

    describe("enableMoltbotHooks", () => {
      it("should enable all hooks with defaults", () => {
        const result = enableMoltbotHooks(setupDir);

        expect(result.success).toBe(true);
        expect(result.filesCreated.length).toBeGreaterThan(0);

        const status = checkMoltbotSetup(setupDir);
        expect(status.hasProjectIntro).toBe(true);
        expect(status.hasProjectConfig).toBe(true);
      });
    });

    describe("disableMoltbotHooks", () => {
      it("should disable all hooks", () => {
        // First enable
        enableMoltbotHooks(setupDir);

        // Then disable
        disableMoltbotHooks(setupDir);

        const configPath = path.join(setupDir, ".codebuddy", "moltbot-hooks.json");
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        expect(config.intro.enabled).toBe(false);
        expect(config.persistence.enabled).toBe(false);
        expect(config.commandLog.enabled).toBe(false);
      });
    });

    describe("getIntroHookContent / setIntroHookContent", () => {
      it("should return null when no intro exists", () => {
        const content = getIntroHookContent(setupDir);
        expect(content).toBeNull();
      });

      it("should set and get intro content", () => {
        const testContent = "You are a React expert.";
        const filePath = setIntroHookContent(testContent, setupDir);

        expect(filePath).toContain("intro_hook.txt");
        expect(fs.existsSync(filePath)).toBe(true);

        const retrieved = getIntroHookContent(setupDir);
        expect(retrieved).toBe(testContent);
      });
    });

    describe("formatSetupStatus", () => {
      it("should format status with no setup", () => {
        const status = formatSetupStatus(setupDir);

        expect(status).toContain("MOLTBOT HOOKS");
        expect(status).toContain("INTRO HOOK");
        expect(status).toContain("SESSION PERSISTENCE");
        expect(status).toContain("COMMAND LOGGING");
        expect(status).toContain("Not configured");
      });

      it("should show enabled status after setup", () => {
        enableMoltbotHooks(setupDir);
        const status = formatSetupStatus(setupDir);

        expect(status).toContain("✅");
        expect(status).toContain("intro_hook.txt");
      });
    });

    describe("DEFAULT_INTRO_HOOK_TEMPLATE", () => {
      it("should contain role configuration sections", () => {
        expect(DEFAULT_INTRO_HOOK_TEMPLATE).toContain("AI Role Configuration");
        expect(DEFAULT_INTRO_HOOK_TEMPLATE).toContain("Your Role");
        expect(DEFAULT_INTRO_HOOK_TEMPLATE).toContain("Personality");
        expect(DEFAULT_INTRO_HOOK_TEMPLATE).toContain("Rules");
        expect(DEFAULT_INTRO_HOOK_TEMPLATE).toContain("Forbidden Actions");
      });
    });
  });
});
