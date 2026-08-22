import fs from "fs-extra";
import * as path from "path";
import axios from "axios";
import { exec } from "child_process";
import { promisify } from "util";
import { getErrorMessage } from "../types/index.js";
import {
  DEFAULT_FILE_MENTION_MAX_BYTES,
  resolveProjectFileMention,
} from '../context/file-mentions.js';

const execAsync = promisify(exec);

export interface MentionContext {
  type: "file" | "url" | "image" | "git" | "symbol" | "search" | "web" | "terminal";
  original: string;
  resolved: string;
  content?: string;
  error?: string;
}

/**
 * Result from the processMentions() convenience function.
 * Provides a cleaned user message and structured context blocks.
 */
export interface MentionResult {
  cleanedMessage: string;
  contextBlocks: { type: string; content: string; source: string }[];
}

export interface ExpandedInput {
  text: string;
  contexts: MentionContext[];
}

export interface ContextMentionParserOptions {
  projectRoot?: string;
  maxFileBytes?: number;
}

export class ContextMentionParser {
  private patterns = {
    file: /@file:([^\s]+)/g,
    url: /@url:([^\s]+)/g,
    image: /@image:([^\s]+)/g,
    git: /@git:(\w+)/g,
    symbol: /@symbol:([^\s]+)/g,
    search: /@search:["']([^"']+)["']/g,
    // New mention types: @web, @git (extended), @terminal
    web: /@web\s+(.+?)(?=\s*@\w|\s*$)/g,
    'git-extended': /@git\s+(log|diff|blame)(?:\s+(.+?))?(?=\s*@\w|\s*$)/g,
    terminal: /@terminal\b/g,
  };

  private projectRoot: string;
  private maxFileSize: number;
  private maxUrlSize = 50 * 1024;    // 50KB max for URL content

  constructor(options: ContextMentionParserOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.maxFileSize = options.maxFileBytes ?? DEFAULT_FILE_MENTION_MAX_BYTES;
  }

  async expandMentions(input: string): Promise<ExpandedInput> {
    const contexts: MentionContext[] = [];
    let expandedText = input;

    // Process new-style @web, @git <subcommand>, @terminal FIRST
    // (before legacy patterns which might partially match)
    expandedText = await this.processNewMentions(expandedText, contexts);

    // Process each legacy mention type
    for (const [type, pattern] of Object.entries(this.patterns)) {
      // Skip new-style patterns handled above
      if (type === 'web' || type === 'git-extended' || type === 'terminal') continue;

      // Reset regex
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(input)) !== null) {
        const original = match[0];
        const value = match[1];
        if (value === undefined) continue;

        try {
          const context = await this.resolveMention(
            type as MentionContext["type"],
            value,
            original
          );
          contexts.push(context);

          // Replace mention with a reference placeholder
          if (context.content) {
            const placeholder = `[${type.toUpperCase()}: ${value}]`;
            expandedText = expandedText.replace(original, placeholder);
          }
        } catch (error: unknown) {
          contexts.push({
            type: type as MentionContext["type"],
            original,
            resolved: value,
            error: getErrorMessage(error),
          });
        }
      }
    }

    return { text: expandedText, contexts };
  }

  /**
   * Process new-style @web, @git <subcommand>, and @terminal mentions.
   * Returns the cleaned text with mentions removed.
   */
  private async processNewMentions(text: string, contexts: MentionContext[]): Promise<string> {
    let cleaned = text;

    // @terminal — capture recent bash tool history
    const terminalPattern = /@terminal\b/g;
    if (terminalPattern.test(cleaned)) {
      try {
        const ctx = await this.resolveTerminal();
        contexts.push(ctx);
      } catch (error: unknown) {
        contexts.push({
          type: 'terminal',
          original: '@terminal',
          resolved: 'terminal',
          error: getErrorMessage(error),
        });
      }
      cleaned = cleaned.replace(/@terminal\b/g, '').trim();
    }

    // @web <query> — web search
    const webPattern = /@web\s+(.+?)(?=\s*@\w|\s*$)/g;
    let webMatch;
    while ((webMatch = webPattern.exec(text)) !== null) {
      const original = webMatch[0];
      const query = (webMatch[1] ?? '').trim();
      try {
        const ctx = await this.resolveWeb(query, original);
        contexts.push(ctx);
      } catch (error: unknown) {
        contexts.push({
          type: 'web',
          original,
          resolved: query,
          error: getErrorMessage(error),
        });
      }
      cleaned = cleaned.replace(original, '').trim();
    }

    // @git log|diff|blame [args] — extended git with arguments
    const gitExtPattern = /@git\s+(log|diff|blame)(?:\s+(.+?))?(?=\s*@\w|\s*$)/g;
    let gitMatch;
    while ((gitMatch = gitExtPattern.exec(text)) !== null) {
      const original = gitMatch[0];
      const subcommand = gitMatch[1];
      if (subcommand === undefined) continue;
      const args = gitMatch[2]?.trim() || '';
      try {
        const ctx = await this.resolveGitExtended(subcommand, args, original);
        contexts.push(ctx);
      } catch (error: unknown) {
        contexts.push({
          type: 'git',
          original,
          resolved: `${subcommand} ${args}`.trim(),
          error: getErrorMessage(error),
        });
      }
      cleaned = cleaned.replace(original, '').trim();
    }

    return cleaned;
  }

  private async resolveMention(
    type: MentionContext["type"],
    value: string,
    original: string
  ): Promise<MentionContext> {
    switch (type) {
      case "file":
        return this.resolveFile(value, original);
      case "url":
        return this.resolveUrl(value, original);
      case "image":
        return this.resolveImage(value, original);
      case "git":
        return this.resolveGit(value, original);
      case "symbol":
        return this.resolveSymbol(value, original);
      case "search":
        return this.resolveSearch(value, original);
      default:
        throw new Error(`Unknown mention type: ${type}`);
    }
  }

  private async resolveFile(filePath: string, original: string): Promise<MentionContext> {
    const result = await resolveProjectFileMention(filePath, {
      projectRoot: this.projectRoot,
      maxFileBytes: this.maxFileSize,
    });

    if (result === null) {
      throw new Error(`File not found: ${filePath}`);
    }

    if (result.status === 'ignored') {
      throw new Error(`File mention refused (${result.reason}): ${result.message}`);
    }

    return {
      type: "file",
      original,
      resolved: result.path,
      content: `File ${result.path}:\n\`\`\`\n${result.content}\n\`\`\``,
    };
  }

  private async resolveUrl(url: string, original: string): Promise<MentionContext> {
    // Ensure URL has protocol
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }

    try {
      const response = await axios.get(url, {
        timeout: 10000,
        maxContentLength: this.maxUrlSize,
        headers: {
          "User-Agent": "Grok-CLI/1.0",
        },
      });

      let content = response.data;

      // Try to extract text from HTML
      if (typeof content === "string" && content.includes("<html")) {
        content = this.extractTextFromHtml(content);
      }

      // Truncate if too long
      if (typeof content === "string" && content.length > this.maxUrlSize) {
        content = content.slice(0, this.maxUrlSize) + "\n... (truncated)";
      }

      return {
        type: "url",
        original,
        resolved: url,
        content: `URL ${url}:\n${content}`,
      };
    } catch (error: unknown) {
      throw new Error(`Failed to fetch URL: ${getErrorMessage(error)}`);
    }
  }

  private extractTextFromHtml(html: string): string {
    // Simple HTML text extraction
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private async resolveImage(imagePath: string, original: string): Promise<MentionContext> {
    const resolvedPath = path.resolve(imagePath);

    if (!(await fs.pathExists(resolvedPath))) {
      throw new Error(`Image not found: ${imagePath}`);
    }

    // Read image and convert to base64
    const imageBuffer = await fs.readFile(resolvedPath);
    const base64 = imageBuffer.toString("base64");
    const ext = path.extname(imagePath).toLowerCase().slice(1);
    const mimeType = this.getMimeType(ext);

    return {
      type: "image",
      original,
      resolved: resolvedPath,
      content: `data:${mimeType};base64,${base64}`,
    };
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  private async resolveGit(command: string, original: string): Promise<MentionContext> {
    const gitCommands: Record<string, string> = {
      status: "git status",
      diff: "git diff",
      "diff-staged": "git diff --cached",
      log: "git log --oneline -10",
      branch: "git branch -a",
      remote: "git remote -v",
      stash: "git stash list",
    };

    const gitCmd = gitCommands[command];
    if (!gitCmd) {
      throw new Error(`Unknown git command: ${command}. Available: ${Object.keys(gitCommands).join(", ")}`);
    }

    try {
      const { stdout, stderr } = await execAsync(gitCmd);
      return {
        type: "git",
        original,
        resolved: command,
        content: `Git ${command}:\n\`\`\`\n${stdout || stderr || "(empty)"}\n\`\`\``,
      };
    } catch (error: unknown) {
      throw new Error(`Git command failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * @web <query> — perform a web search and inject results as context.
   * Uses the web_search tool internally (via bash curl or rg the web).
   */
  private async resolveWeb(query: string, original: string): Promise<MentionContext> {
    try {
      // Try Brave Search if API key available, otherwise fallback to DuckDuckGo HTML
      const braveKey = process.env.BRAVE_API_KEY;
      if (braveKey) {
        const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
          params: { q: query, count: 5 },
          headers: { 'X-Subscription-Token': braveKey, 'Accept': 'application/json' },
          timeout: 10000,
        });
        const results = (response.data?.web?.results || []).slice(0, 5);
        const formatted = results.map((r: { title: string; url: string; description: string }, i: number) =>
          `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`
        ).join('\n\n');
        return {
          type: 'web',
          original,
          resolved: query,
          content: `Web search results for "${query}":\n${formatted || '(no results)'}`,
        };
      }

      // Fallback: use DuckDuckGo instant answer API
      const response = await axios.get('https://api.duckduckgo.com/', {
        params: { q: query, format: 'json', no_html: 1, skip_disambig: 1 },
        timeout: 10000,
      });
      const data = response.data;
      const abstract = data.AbstractText || data.Abstract || '';
      const relatedTopics = (data.RelatedTopics || []).slice(0, 5);
      const topicLines = relatedTopics
        .filter((t: { Text?: string }) => t.Text)
        .map((t: { Text: string; FirstURL?: string }, i: number) => `${i + 1}. ${t.Text}`)
        .join('\n');

      const content = abstract
        ? `Web search for "${query}":\n${abstract}\n\nRelated:\n${topicLines}`
        : `Web search for "${query}":\n${topicLines || '(no results — try a more specific query)'}`;

      return { type: 'web', original, resolved: query, content };
    } catch (error: unknown) {
      throw new Error(`Web search failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * @git log|diff|blame [args] — run git commands with custom arguments.
   */
  private async resolveGitExtended(subcommand: string, args: string, original: string): Promise<MentionContext> {
    // Sanitize: only allow safe git subcommands
    const allowedSubcommands = ['log', 'diff', 'blame'];
    if (!allowedSubcommands.includes(subcommand)) {
      throw new Error(`Unsupported git subcommand: ${subcommand}. Allowed: ${allowedSubcommands.join(', ')}`);
    }

    // Build the command with safe defaults
    let gitCmd = `git ${subcommand}`;
    if (args) {
      // Basic sanitization: disallow shell metacharacters
      const sanitizedArgs = args.replace(/[;&|`$(){}]/g, '');
      gitCmd += ` ${sanitizedArgs}`;
    } else {
      // Sensible defaults per subcommand
      switch (subcommand) {
        case 'log':
          gitCmd = 'git log --oneline -20';
          break;
        case 'diff':
          gitCmd = 'git diff';
          break;
        case 'blame':
          // blame needs a file argument
          throw new Error('@git blame requires a file path argument, e.g. @git blame src/index.ts');
      }
    }

    try {
      const { stdout, stderr } = await execAsync(gitCmd, { maxBuffer: 512 * 1024 });
      const output = (stdout || stderr || '(empty)').slice(0, 50000); // Limit output
      return {
        type: 'git',
        original,
        resolved: `${subcommand} ${args}`.trim(),
        content: `Git ${subcommand}${args ? ' ' + args : ''}:\n\`\`\`\n${output}\n\`\`\``,
      };
    } catch (error: unknown) {
      throw new Error(`Git ${subcommand} failed: ${getErrorMessage(error)}`);
    }
  }

  /**
   * @terminal — capture recent terminal output from bash tool history.
   * Reads the last few commands from .codebuddy/tool-results/ or bash history.
   */
  private async resolveTerminal(): Promise<MentionContext> {
    try {
      // Try to read recent tool results from .codebuddy/tool-results/
      const toolResultsDir = path.join(process.cwd(), '.codebuddy', 'tool-results');
      let output = '';

      if (await fs.pathExists(toolResultsDir)) {
        const files = await fs.readdir(toolResultsDir);
        // Sort by modification time (newest last) and take last 5
        const sortedFiles = files
          .filter(f => f.endsWith('.txt'))
          .sort()
          .slice(-5);

        for (const file of sortedFiles) {
          const content = await fs.readFile(path.join(toolResultsDir, file), 'utf-8');
          const truncated = content.slice(0, 5000);
          output += `--- ${file} ---\n${truncated}\n\n`;
        }
      }

      if (!output) {
        // Fallback: get recent shell history
        try {
          const { stdout } = await execAsync(
            process.platform === 'win32' ? 'doskey /history' : 'history | tail -20',
            { maxBuffer: 64 * 1024 }
          );
          output = stdout || '(no recent terminal output available)';
        } catch {
          output = '(no recent terminal output available)';
        }
      }

      return {
        type: 'terminal',
        original: '@terminal',
        resolved: 'terminal',
        content: `Recent terminal output:\n\`\`\`\n${output.slice(0, 30000)}\n\`\`\``,
      };
    } catch (error: unknown) {
      throw new Error(`Terminal context failed: ${getErrorMessage(error)}`);
    }
  }

  private async resolveSymbol(symbol: string, original: string): Promise<MentionContext> {
    // Search for symbol in codebase using ripgrep
    try {
      const { stdout } = await execAsync(
        `rg -l "\\b(class|function|interface|type|const|let|var|export)\\s+${symbol}\\b" --type-add 'code:*.{ts,tsx,js,jsx,py,go,rs,java}' --type code`,
        { maxBuffer: 1024 * 1024 }
      );

      const files = stdout.trim().split("\n").filter(Boolean);

      // Read the first matching file
      const firstFile = files[0];
      if (firstFile === undefined) {
        throw new Error(`Symbol not found: ${symbol}`);
      }
      const content = await fs.readFile(firstFile, "utf-8");

      // Try to extract the symbol definition
      const symbolContent = this.extractSymbolDefinition(content, symbol);

      return {
        type: "symbol",
        original,
        resolved: symbol,
        content: `Symbol ${symbol} (from ${firstFile}):\n\`\`\`\n${symbolContent}\n\`\`\`\nAlso found in: ${files.slice(1, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5} more)` : ""}`,
      };
    } catch (error: unknown) {
      throw new Error(`Symbol search failed: ${getErrorMessage(error)}`);
    }
  }

  private extractSymbolDefinition(content: string, symbol: string): string {
    const lines = content.split("\n");

    // Find the line with the symbol definition
    let startLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line !== undefined && line.match(new RegExp(`\\b(class|function|interface|type|const|let|var|export)\\s+${symbol}\\b`))) {
        startLine = i;
        break;
      }
    }

    if (startLine === -1) {
      return content.slice(0, 500);
    }

    // Extract the definition (basic brace matching)
    let braceCount = 0;
    let endLine = startLine;
    let started = false;

    for (let i = startLine; i < lines.length && i < startLine + 100; i++) {
      const line = lines[i] ?? '';
      for (const char of line) {
        if (char === "{" || char === "(") {
          braceCount++;
          started = true;
        } else if (char === "}" || char === ")") {
          braceCount--;
        }
      }

      endLine = i;

      if (started && braceCount === 0) {
        break;
      }
    }

    return lines.slice(startLine, endLine + 1).join("\n");
  }

  private async resolveSearch(query: string, original: string): Promise<MentionContext> {
    try {
      const { stdout } = await execAsync(
        `rg -n "${query}" --type-add 'code:*.{ts,tsx,js,jsx,py,go,rs,java,md}' --type code -C 2 | head -50`,
        { maxBuffer: 1024 * 1024 }
      );

      return {
        type: "search",
        original,
        resolved: query,
        content: `Search results for "${query}":\n\`\`\`\n${stdout || "(no matches)"}\n\`\`\``,
      };
    } catch (error: unknown) {
      throw new Error(`Search failed: ${getErrorMessage(error)}`);
    }
  }

  formatContexts(contexts: MentionContext[]): string {
    if (contexts.length === 0) {
      return "";
    }

    let output = "\n--- CONTEXT FROM MENTIONS ---\n";

    for (const ctx of contexts) {
      if (ctx.error) {
        output += `\n⚠️ ${ctx.original}: ${ctx.error}\n`;
      } else if (ctx.content) {
        output += `\n${ctx.content}\n`;
      }
    }

    output += "--- END CONTEXT ---\n";

    return output;
  }

  getHelp(): string {
    return `
@ Mentions - Add rich context to your prompts:

  @file:path/to/file.ts     Include file contents
  @url:example.com/page     Fetch and include URL content
  @image:screenshot.png     Include image (base64)
  @git:status               Include git status
  @git:diff                 Include git diff
  @git:log                  Include recent commits
  @git log [args]           Git log with custom args (e.g. @git log --since=1week)
  @git diff [args]          Git diff with custom args (e.g. @git diff HEAD~3)
  @git blame <file>         Git blame for a specific file
  @web <query>              Search the web and inject results
  @terminal                 Capture recent terminal output as context
  @symbol:MyClass           Find and include symbol definition
  @search:'query here'      Search codebase for pattern

Examples:
  "Fix the bug in @file:src/utils.ts"
  "Implement the design from @url:figma.com/file/xyz"
  "Review @git:diff and suggest improvements"
  "Refactor @symbol:UserService to use dependency injection"
  "How does this compare to @web React Server Components best practices"
  "Based on @terminal output, what went wrong?"
  "@git blame src/index.ts — who wrote this code?"
`;
  }
}

// Singleton instance
let contextMentionParserInstance: ContextMentionParser | null = null;

export function getContextMentionParser(): ContextMentionParser {
  if (!contextMentionParserInstance) {
    contextMentionParserInstance = new ContextMentionParser();
  }
  return contextMentionParserInstance;
}

/**
 * Process all @mentions in a user message.
 *
 * Detects @web, @git, @terminal (and legacy @file:, @url:, etc.) mentions,
 * executes the appropriate tool/command, and returns:
 * - The cleaned message (without the @mentions)
 * - Structured context blocks to inject into the system prompt or user message
 */
export async function processMentions(
  message: string,
  options?: ContextMentionParserOptions,
): Promise<MentionResult> {
  const parser = options ? new ContextMentionParser(options) : getContextMentionParser();
  const expanded = await parser.expandMentions(message);

  const contextBlocks = expanded.contexts
    .filter(ctx => ctx.content && !ctx.error)
    .map(ctx => ({
      type: ctx.type,
      content: ctx.content!,
      source: ctx.resolved,
    }));

  // Also include error blocks so the user knows what failed
  for (const ctx of expanded.contexts) {
    if (ctx.error) {
      contextBlocks.push({
        type: ctx.type,
        content: `Error resolving ${ctx.original}: ${ctx.error}`,
        source: ctx.original,
      });
    }
  }

  return {
    cleanedMessage: expanded.text,
    contextBlocks,
  };
}
