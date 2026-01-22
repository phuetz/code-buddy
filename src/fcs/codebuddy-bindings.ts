/**
 * Grok-CLI Bindings for FCS
 *
 * Provides full integration with code-buddy features:
 * - AI/CodeBuddy API calls
 * - Tool execution (read, edit, search, grep)
 * - Context management
 * - Agent control
 * - MCP integration
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { FCSConfig, FCSValue, FCSFunction } from './types.js';

// Lazy imports to avoid circular dependencies
let codebuddyClientInstance: CodeBuddyClientInterface | null = null;
let mcpManagerInstance: MCPManagerInterface | null = null;

interface CodeBuddyClientInterface {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>;
  complete(prompt: string): Promise<string>;
}

interface MCPManagerInterface {
  callTool(server: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  listServers(): string[];
  listTools(server: string): string[];
}

interface CodeBuddyBindingsConfig extends FCSConfig {
  codebuddyClient?: CodeBuddyClientInterface;
  mcpManager?: MCPManagerInterface;
  conversationHistory?: Array<{ role: string; content: string }>;
  contextFiles?: Set<string>;
}

/**
 * Create code-buddy bindings for FCS
 */
export function createGrokBindings(
  config: CodeBuddyBindingsConfig,
  print: (msg: string) => void
): Record<string, FCSValue> {
  const bindings: Record<string, FCSValue> = {};

  // Store references
  codebuddyClientInstance = config.codebuddyClient || null;
  mcpManagerInstance = config.mcpManager || null;

  // Conversation history for chat
  const conversationHistory: Array<{ role: string; content: string }> =
    config.conversationHistory || [];

  // Context files set
  const contextFiles: Set<string> = config.contextFiles || new Set();

  // ============================================
  // GROK NAMESPACE - AI Integration
  // ============================================

  const grok: Record<string, FCSFunction | FCSValue> = {};

  /**
   * Ask Grok a question (single prompt)
   */
  const askFn = async (prompt: string): Promise<string> => {
    if (!codebuddyClientInstance) {
      print('[grok.ask] No Grok client available - returning mock response');
      return `[Mock AI Response to: ${prompt}]`;
    }

    try {
      const response = await codebuddyClientInstance.complete(prompt);
      return response;
    } catch (error) {
      throw new Error(`CodeBuddy API error: ${(error as Error).message}`);
    }
  };
  grok.ask = askFn;

  /**
   * Chat with Grok (maintains conversation history)
   */
  const chatFn = async (message: string): Promise<string> => {
    conversationHistory.push({ role: 'user', content: message });

    if (!codebuddyClientInstance) {
      const mockResponse = `[Mock Chat Response to: ${message}]`;
      conversationHistory.push({ role: 'assistant', content: mockResponse });
      return mockResponse;
    }

    try {
      const response = await codebuddyClientInstance.chat(conversationHistory);
      conversationHistory.push({ role: 'assistant', content: response });
      return response;
    } catch (error) {
      throw new Error(`Grok chat error: ${(error as Error).message}`);
    }
  };
  grok.chat = chatFn;

  /**
   * Generate code with Grok
   */
  grok.generate = async (prompt: string, language?: string): Promise<string> => {
    const fullPrompt = language
      ? `Generate ${language} code for: ${prompt}\n\nOnly output the code, no explanations.`
      : `Generate code for: ${prompt}\n\nOnly output the code, no explanations.`;

    return askFn(fullPrompt);
  };

  /**
   * Explain code with Grok
   */
  grok.explain = async (code: string): Promise<string> => {
    return askFn(`Explain this code:\n\n${code}`);
  };

  /**
   * Review code with Grok
   */
  grok.review = async (code: string): Promise<string> => {
    return askFn(`Review this code for bugs, security issues, and improvements:\n\n${code}`);
  };

  /**
   * Clear conversation history
   */
  grok.clearHistory = (): void => {
    conversationHistory.length = 0;
    print('Conversation history cleared');
  };

  /**
   * Get conversation history
   */
  grok.history = (): Array<{ role: string; content: string }> => {
    return [...conversationHistory];
  };

  bindings.grok = grok;

  // ============================================
  // TOOL NAMESPACE - File Operations
  // ============================================

  const tool: Record<string, FCSFunction> = {};

  /**
   * Read a file (with optional line range)
   */
  tool.read = (filePath: string, startLine?: number, endLine?: number): string => {
    const fullPath = path.resolve(config.workdir, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    if (startLine !== undefined) {
      const lines = content.split('\n');
      const start = Math.max(0, startLine - 1);
      const end = endLine !== undefined ? endLine : lines.length;
      return lines.slice(start, end).join('\n');
    }

    return content;
  };

  /**
   * Write to a file
   */
  tool.write = (filePath: string, content: string): boolean => {
    if (config.dryRun) {
      print(`[DRY RUN] Would write ${content.length} chars to: ${filePath}`);
      return true;
    }

    const fullPath = path.resolve(config.workdir, filePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
    print(`Written: ${filePath}`);
    return true;
  };

  /**
   * Edit a file (find and replace)
   */
  tool.edit = (filePath: string, oldText: string, newText: string): boolean => {
    const fullPath = path.resolve(config.workdir, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    if (!content.includes(oldText)) {
      throw new Error(`Text not found in ${filePath}`);
    }

    if (config.dryRun) {
      print(`[DRY RUN] Would edit: ${filePath}`);
      print(`  - Old: ${oldText.substring(0, 50)}...`);
      print(`  + New: ${newText.substring(0, 50)}...`);
      return true;
    }

    const newContent = content.replace(oldText, newText);
    fs.writeFileSync(fullPath, newContent);
    print(`Edited: ${filePath}`);
    return true;
  };

  /**
   * Multi-edit a file (multiple replacements)
   */
  tool.multiEdit = (filePath: string, edits: Array<{ old: string; new: string }>): boolean => {
    const fullPath = path.resolve(config.workdir, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let content = fs.readFileSync(fullPath, 'utf-8');

    for (const edit of edits) {
      if (!content.includes(edit.old)) {
        throw new Error(`Text not found in ${filePath}: ${edit.old.substring(0, 30)}...`);
      }
      content = content.replace(edit.old, edit.new);
    }

    if (config.dryRun) {
      print(`[DRY RUN] Would apply ${edits.length} edits to: ${filePath}`);
      return true;
    }

    fs.writeFileSync(fullPath, content);
    print(`Applied ${edits.length} edits to: ${filePath}`);
    return true;
  };

  /**
   * Search for files by glob pattern
   */
  tool.glob = (pattern: string): string[] => {
    // Simple glob implementation using find command
    try {
      const result = execSync(
        `find ${config.workdir} -type f -name "${pattern}" 2>/dev/null | head -100`,
        { encoding: 'utf-8' }
      );
      return result.trim().split('\n').filter(Boolean).map(f =>
        path.relative(config.workdir, f)
      );
    } catch {
      return [];
    }
  };

  /**
   * Search file contents with grep
   */
  tool.grep = (pattern: string, filePattern?: string): Array<{ file: string; line: number; content: string }> => {
    try {
      const globPart = filePattern ? `--include="${filePattern}"` : '';
      const result = execSync(
        `grep -rn ${globPart} "${pattern}" ${config.workdir} 2>/dev/null | head -100`,
        { encoding: 'utf-8' }
      );

      return result.trim().split('\n').filter(Boolean).map(line => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          return {
            file: path.relative(config.workdir, match[1]),
            line: parseInt(match[2], 10),
            content: match[3]
          };
        }
        return { file: '', line: 0, content: line };
      });
    } catch {
      return [];
    }
  };

  /**
   * Search with ripgrep (faster)
   */
  tool.rg = (pattern: string, filePattern?: string): Array<{ file: string; line: number; content: string }> => {
    try {
      const globPart = filePattern ? `-g "${filePattern}"` : '';
      const result = execSync(
        `rg -n ${globPart} "${pattern}" ${config.workdir} 2>/dev/null | head -100`,
        { encoding: 'utf-8' }
      );

      return result.trim().split('\n').filter(Boolean).map(line => {
        const match = line.match(/^(.+?):(\d+):(.*)$/);
        if (match) {
          return {
            file: path.relative(config.workdir, match[1]),
            line: parseInt(match[2], 10),
            content: match[3]
          };
        }
        return { file: '', line: 0, content: line };
      });
    } catch {
      // Fallback to grep if rg not available
      return tool.grep(pattern, filePattern);
    }
  };

  /**
   * List directory contents
   */
  tool.ls = (dirPath?: string): string[] => {
    const fullPath = path.resolve(config.workdir, dirPath || '.');
    return fs.readdirSync(fullPath);
  };

  /**
   * Get file info
   */
  tool.stat = (filePath: string): { size: number; mtime: Date; isDir: boolean } => {
    const fullPath = path.resolve(config.workdir, filePath);
    const stats = fs.statSync(fullPath);
    return {
      size: stats.size,
      mtime: stats.mtime,
      isDir: stats.isDirectory()
    };
  };

  bindings.tool = tool;

  // ============================================
  // CONTEXT NAMESPACE - Context Management
  // ============================================

  const context: Record<string, FCSFunction | FCSValue> = {};

  /**
   * Add files to context
   */
  context.add = (pattern: string): number => {
    const files = tool.glob(pattern);
    let added = 0;

    for (const file of files) {
      if (!contextFiles.has(file)) {
        contextFiles.add(file);
        added++;
      }
    }

    print(`Added ${added} files to context (${contextFiles.size} total)`);
    return added;
  };

  /**
   * Remove files from context
   */
  context.remove = (pattern: string): number => {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let removed = 0;

    for (const file of contextFiles) {
      if (regex.test(file)) {
        contextFiles.delete(file);
        removed++;
      }
    }

    print(`Removed ${removed} files from context`);
    return removed;
  };

  /**
   * Clear all context
   */
  context.clear = (): void => {
    contextFiles.clear();
    print('Context cleared');
  };

  /**
   * List context files
   */
  context.list = (): string[] => {
    return Array.from(contextFiles);
  };

  /**
   * Get context content (all files concatenated)
   */
  context.content = (): string => {
    const parts: string[] = [];

    for (const file of contextFiles) {
      try {
        const content = tool.read(file);
        parts.push(`// === ${file} ===\n${content}`);
      } catch {
        // Skip unreadable files
      }
    }

    return parts.join('\n\n');
  };

  /**
   * Get context size
   */
  context.size = (): number => {
    return contextFiles.size;
  };

  bindings.context = context;

  // ============================================
  // AGENT NAMESPACE - Agent Control
  // ============================================

  const agent: Record<string, FCSFunction> = {};

  /**
   * Run a task with an agent
   */
  const runTaskFn = async (task: string): Promise<string> => {
    print(`[Agent] Running task: ${task}`);

    // Use askFn with agent-style prompt
    const agentPrompt = `You are an autonomous agent. Complete this task step by step:

Task: ${task}

Available tools: read files, edit files, search code, run shell commands.
Think through the problem and execute the necessary steps.`;

    return askFn(agentPrompt);
  };
  agent.run = runTaskFn;

  /**
   * Run multiple tasks in parallel
   */
  agent.parallel = async (tasks: string[]): Promise<string[]> => {
    print(`[Agent] Running ${tasks.length} tasks in parallel`);

    const promises = tasks.map(task => runTaskFn(task));
    return Promise.all(promises);
  };

  /**
   * Run a security review
   */
  agent.securityReview = async (targetPath?: string): Promise<string> => {
    const target = targetPath || '.';
    return askFn(`Perform a security review of the code in ${target}. Check for:
- SQL injection
- XSS vulnerabilities
- Command injection
- Path traversal
- Insecure dependencies
- Authentication issues
- Data exposure`);
  };

  /**
   * Run code review
   */
  agent.codeReview = async (filePath?: string): Promise<string> => {
    let content = '';

    if (filePath) {
      content = tool.read(filePath);
    } else {
      // Get git diff
      try {
        content = execSync('git diff', { cwd: config.workdir, encoding: 'utf-8' });
      } catch {
        content = 'No git diff available';
      }
    }

    return askFn(`Review this code for quality, bugs, and improvements:\n\n${content}`);
  };

  /**
   * Generate tests
   */
  agent.generateTests = async (filePath: string): Promise<string> => {
    const content = tool.read(filePath);
    return askFn(`Generate comprehensive unit tests for this code:\n\n${content}`);
  };

  /**
   * Refactor code
   */
  agent.refactor = async (filePath: string, instructions: string): Promise<string> => {
    const content = tool.read(filePath);
    return askFn(`Refactor this code according to these instructions: ${instructions}\n\nCode:\n${content}`);
  };

  bindings.agent = agent;

  // ============================================
  // MCP NAMESPACE - MCP Integration
  // ============================================

  const mcp: Record<string, FCSFunction | FCSValue> = {};

  /**
   * List available MCP servers
   */
  mcp.servers = (): string[] => {
    if (!mcpManagerInstance) {
      return [];
    }
    return mcpManagerInstance.listServers();
  };

  /**
   * List tools on a server
   */
  mcp.tools = (server: string): string[] => {
    if (!mcpManagerInstance) {
      return [];
    }
    return mcpManagerInstance.listTools(server);
  };

  /**
   * Call an MCP tool
   */
  mcp.call = async (server: string, tool: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    if (!mcpManagerInstance) {
      print(`[MCP] No MCP manager - mock call to ${server}.${tool}`);
      return { mock: true, server, tool, args };
    }

    try {
      return await mcpManagerInstance.callTool(server, tool, args);
    } catch (error) {
      throw new Error(`MCP call failed: ${(error as Error).message}`);
    }
  };

  bindings.mcp = mcp;

  // ============================================
  // GIT NAMESPACE - Git Operations
  // ============================================

  const git: Record<string, FCSFunction> = {};

  /**
   * Get git status
   */
  git.status = (): string => {
    try {
      return execSync('git status --short', { cwd: config.workdir, encoding: 'utf-8' });
    } catch {
      return '';
    }
  };

  /**
   * Get git diff
   */
  git.diff = (file?: string): string => {
    try {
      const cmd = file ? `git diff ${file}` : 'git diff';
      return execSync(cmd, { cwd: config.workdir, encoding: 'utf-8' });
    } catch {
      return '';
    }
  };

  /**
   * Stage files
   */
  git.add = (pattern: string): boolean => {
    if (config.dryRun) {
      print(`[DRY RUN] Would stage: ${pattern}`);
      return true;
    }

    try {
      execSync(`git add ${pattern}`, { cwd: config.workdir });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Create commit
   */
  git.commit = (message: string): boolean => {
    if (config.dryRun) {
      print(`[DRY RUN] Would commit: ${message}`);
      return true;
    }

    try {
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: config.workdir });
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Get recent commits
   */
  git.log = (count = 10): string => {
    try {
      return execSync(`git log --oneline -${count}`, { cwd: config.workdir, encoding: 'utf-8' });
    } catch {
      return '';
    }
  };

  /**
   * Get current branch
   */
  git.branch = (): string => {
    try {
      return execSync('git branch --show-current', { cwd: config.workdir, encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  };

  bindings.git = git;

  // ============================================
  // SESSION NAMESPACE - Session Management
  // ============================================

  const session: Record<string, FCSFunction | FCSValue> = {};

  /**
   * Save current session
   */
  session.save = (name?: string): string => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = name || `session-${timestamp}.json`;
    const sessionData = {
      timestamp,
      history: conversationHistory,
      context: Array.from(contextFiles),
      config: {
        workdir: config.workdir,
        enableAI: config.enableAI,
        enableBash: config.enableBash
      }
    };

    const sessionsDir = path.join(config.workdir, '.codebuddy', 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    const filePath = path.join(sessionsDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
    print(`Session saved: ${filename}`);
    return filePath;
  };

  /**
   * List saved sessions
   */
  session.list = (): string[] => {
    const sessionsDir = path.join(config.workdir, '.codebuddy', 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      return [];
    }
    return fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
  };

  /**
   * Load a session
   */
  session.load = (name: string): boolean => {
    const sessionsDir = path.join(config.workdir, '.codebuddy', 'sessions');
    const filePath = path.join(sessionsDir, name);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${name}`);
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Restore history
    conversationHistory.length = 0;
    conversationHistory.push(...(data.history || []));

    // Restore context
    contextFiles.clear();
    for (const file of (data.context || [])) {
      contextFiles.add(file);
    }

    print(`Session loaded: ${name}`);
    return true;
  };

  bindings.session = session;

  return bindings;
}

/**
 * Set the Grok client instance (called from code-buddy initialization)
 */
export function setCodeBuddyClient(client: CodeBuddyClientInterface): void {
  codebuddyClientInstance = client;
}

/**
 * Set the MCP manager instance
 */
export function setMCPManager(manager: MCPManagerInterface): void {
  mcpManagerInstance = manager;
}
