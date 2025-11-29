/**
 * Code Chunker
 *
 * Intelligently chunks code files into semantic units for embedding.
 * Respects code structure (functions, classes, methods) to maintain context.
 *
 * Based on research from:
 * - RAG for Large Scale Code Repos (Qodo)
 * - Code-specific chunking strategies
 */

import {
  CodeChunk,
  ChunkType,
  ChunkMetadata,
  ParseResult,
  SymbolInfo,
  RAGConfig,
  DEFAULT_RAG_CONFIG,
} from "./types.js";

/**
 * Language patterns for code parsing
 */
interface LanguagePatterns {
  function: RegExp;
  class: RegExp;
  method: RegExp;
  interface: RegExp;
  type: RegExp;
  constant: RegExp;
  import: RegExp;
  export: RegExp;
  comment: RegExp;
  docstring: RegExp;
}

/**
 * TypeScript/JavaScript patterns
 */
const TS_PATTERNS: LanguagePatterns = {
  function: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)/m,
  class: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m,
  method: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)/m,
  interface: /^(?:export\s+)?interface\s+(\w+)/m,
  type: /^(?:export\s+)?type\s+(\w+)/m,
  constant: /^(?:export\s+)?(?:const|let|var)\s+(\w+)/m,
  import: /^import\s+(?:{[^}]*}|[^;]+)\s+from\s+['"][^'"]+['"]/m,
  export: /^export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)/m,
  comment: /\/\/.*$|\/\*[\s\S]*?\*\//m,
  docstring: /\/\*\*[\s\S]*?\*\//m,
};

/**
 * Python patterns
 */
const PY_PATTERNS: LanguagePatterns = {
  function: /^(?:async\s+)?def\s+(\w+)\s*\([^)]*\)/m,
  class: /^class\s+(\w+)/m,
  method: /^\s+(?:async\s+)?def\s+(\w+)\s*\([^)]*\)/m,
  interface: /^class\s+(\w+)\s*\(Protocol\)/m,
  type: /^(\w+)(?:\s*:\s*TypeAlias)?\s*=/m,
  constant: /^([A-Z_][A-Z0-9_]*)\s*=/m,
  import: /^(?:from\s+\S+\s+)?import\s+.+/m,
  export: /^__all__\s*=/m,
  comment: /#.*$/m,
  docstring: /^(\s*)(?:'''|""")[\s\S]*?(?:'''|""")/m,
};

/**
 * Go patterns
 */
const GO_PATTERNS: LanguagePatterns = {
  function: /^func\s+(\w+)\s*\([^)]*\)/m,
  class: /^type\s+(\w+)\s+struct\s*{/m,
  method: /^func\s+\([^)]+\)\s+(\w+)\s*\([^)]*\)/m,
  interface: /^type\s+(\w+)\s+interface\s*{/m,
  type: /^type\s+(\w+)\s+/m,
  constant: /^(?:const|var)\s+(\w+)/m,
  import: /^import\s+(?:\([\s\S]*?\)|"[^"]+")/m,
  export: /^func\s+[A-Z]/m, // Go exports are capitalized
  comment: /\/\/.*$/m,
  docstring: /\/\/.*\n(?:\/\/.*\n)*/m,
};

/**
 * Get patterns for a language
 */
function getLanguagePatterns(language: string): LanguagePatterns | null {
  switch (language.toLowerCase()) {
    case "typescript":
    case "javascript":
    case "tsx":
    case "jsx":
      return TS_PATTERNS;
    case "python":
      return PY_PATTERNS;
    case "go":
      return GO_PATTERNS;
    default:
      return TS_PATTERNS; // Default to TS patterns
  }
}

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    pyw: "python",
    go: "go",
    rs: "rust",
    rb: "ruby",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    md: "markdown",
    mdx: "markdown",
  };
  return langMap[ext] || "text";
}

/**
 * Create a unique chunk ID
 */
function createChunkId(filePath: string, startLine: number, type: ChunkType): string {
  const hash = Buffer.from(`${filePath}:${startLine}:${type}`).toString("base64").slice(0, 8);
  return `chunk-${hash}-${Date.now().toString(36)}`;
}

/**
 * Code Chunker class
 */
export class CodeChunker {
  private config: RAGConfig;

  constructor(config: Partial<RAGConfig> = {}) {
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
  }

  /**
   * Chunk a file into semantic code chunks
   */
  chunkFile(content: string, filePath: string): CodeChunk[] {
    const language = detectLanguage(filePath);
    const lines = content.split("\n");

    if (this.config.respectBoundaries) {
      return this.chunkWithBoundaries(content, filePath, language, lines);
    } else {
      return this.chunkBySize(content, filePath, language, lines);
    }
  }

  /**
   * Chunk respecting code boundaries (functions, classes, etc.)
   */
  private chunkWithBoundaries(
    content: string,
    filePath: string,
    language: string,
    lines: string[]
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const patterns = getLanguagePatterns(language);

    if (!patterns) {
      return this.chunkBySize(content, filePath, language, lines);
    }

    // Find all symbols in the file
    const symbols = this.findSymbols(content, lines, patterns);

    // Sort by start line
    symbols.sort((a, b) => a.startLine - b.startLine);

    // Create chunks for each symbol
    let lastEndLine = 0;

    for (const symbol of symbols) {
      // Add any content between symbols as a chunk
      if (symbol.startLine > lastEndLine + 1) {
        const betweenContent = lines.slice(lastEndLine, symbol.startLine - 1).join("\n");
        if (betweenContent.trim()) {
          chunks.push(this.createChunk(
            betweenContent,
            filePath,
            lastEndLine + 1,
            symbol.startLine - 1,
            "code_block",
            language,
            {}
          ));
        }
      }

      // Create chunk for the symbol
      const symbolContent = lines.slice(symbol.startLine - 1, symbol.endLine).join("\n");
      chunks.push(this.createChunk(
        symbolContent,
        filePath,
        symbol.startLine,
        symbol.endLine,
        symbol.type,
        language,
        {
          name: symbol.name,
          signature: symbol.signature,
          docstring: symbol.docstring,
        }
      ));

      lastEndLine = symbol.endLine;
    }

    // Add remaining content
    if (lastEndLine < lines.length) {
      const remainingContent = lines.slice(lastEndLine).join("\n");
      if (remainingContent.trim()) {
        chunks.push(this.createChunk(
          remainingContent,
          filePath,
          lastEndLine + 1,
          lines.length,
          "code_block",
          language,
          {}
        ));
      }
    }

    // If no symbols found, chunk by size
    if (chunks.length === 0) {
      return this.chunkBySize(content, filePath, language, lines);
    }

    // Split large chunks
    return chunks.flatMap(chunk => this.splitLargeChunk(chunk, lines));
  }

  /**
   * Find all symbols in the content
   */
  private findSymbols(
    content: string,
    lines: string[],
    patterns: LanguagePatterns
  ): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];

    // Find classes
    this.findPattern(content, lines, patterns.class, "class", symbols);

    // Find interfaces
    this.findPattern(content, lines, patterns.interface, "interface", symbols);

    // Find types
    this.findPattern(content, lines, patterns.type, "type", symbols);

    // Find functions (not inside classes)
    this.findPattern(content, lines, patterns.function, "function", symbols);

    // Find constants
    this.findPattern(content, lines, patterns.constant, "constant", symbols);

    return symbols;
  }

  /**
   * Find pattern matches and add to symbols
   */
  private findPattern(
    content: string,
    lines: string[],
    pattern: RegExp,
    type: ChunkType,
    symbols: SymbolInfo[]
  ): void {
    const globalPattern = new RegExp(pattern.source, "gm");
    let match;

    while ((match = globalPattern.exec(content)) !== null) {
      const startIndex = match.index;
      const startLine = content.slice(0, startIndex).split("\n").length;

      // Find the end of this symbol
      const endLine = this.findSymbolEnd(lines, startLine - 1, type);

      // Extract name from match
      const name = match[1] || "anonymous";

      // Look for docstring before the symbol
      const docstring = this.findDocstring(lines, startLine - 1);

      symbols.push({
        name,
        type,
        startLine,
        endLine,
        signature: lines[startLine - 1]?.trim(),
        docstring,
      });
    }
  }

  /**
   * Find where a symbol ends (matching braces)
   */
  private findSymbolEnd(lines: string[], startIdx: number, type: ChunkType): number {
    let braceCount = 0;
    let parenCount = 0;
    let started = false;

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === "{") {
          braceCount++;
          started = true;
        } else if (char === "}") {
          braceCount--;
        } else if (char === "(") {
          parenCount++;
        } else if (char === ")") {
          parenCount--;
        }
      }

      // For types/constants without braces, end at semicolon or next non-indented line
      if (type === "type" || type === "constant") {
        if (line.includes(";") || (i > startIdx && !line.startsWith(" ") && !line.startsWith("\t"))) {
          return i + 1;
        }
      }

      // End when we've closed all braces we opened
      if (started && braceCount === 0) {
        return i + 1;
      }

      // Safety: don't go too far
      if (i - startIdx > 500) {
        return i + 1;
      }
    }

    return lines.length;
  }

  /**
   * Find docstring before a symbol
   */
  private findDocstring(lines: string[], symbolIdx: number): string | undefined {
    let docLines: string[] = [];
    let inDoc = false;

    for (let i = symbolIdx - 1; i >= 0 && i >= symbolIdx - 20; i--) {
      const line = lines[i].trim();

      if (line.endsWith("*/")) {
        inDoc = true;
        docLines.unshift(line);
      } else if (inDoc) {
        docLines.unshift(line);
        if (line.startsWith("/**") || line.startsWith("/*")) {
          break;
        }
      } else if (line.startsWith("//")) {
        docLines.unshift(line);
      } else if (line === "") {
        if (docLines.length > 0) break;
      } else {
        break;
      }
    }

    const doc = docLines.join("\n").trim();
    return doc || undefined;
  }

  /**
   * Chunk by size (fallback method)
   */
  private chunkBySize(
    content: string,
    filePath: string,
    language: string,
    lines: string[]
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const targetSize = this.config.chunkSize;
    const overlap = this.config.chunkOverlap;

    let currentChunk: string[] = [];
    let currentTokens = 0;
    let startLine = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineTokens = this.estimateTokens(line);

      if (currentTokens + lineTokens > targetSize && currentChunk.length > 0) {
        // Create chunk
        chunks.push(this.createChunk(
          currentChunk.join("\n"),
          filePath,
          startLine,
          startLine + currentChunk.length - 1,
          "code_block",
          language,
          {}
        ));

        // Start new chunk with overlap
        const overlapLines = Math.min(
          Math.floor(overlap / 10),
          currentChunk.length
        );
        currentChunk = currentChunk.slice(-overlapLines);
        startLine = i + 1 - overlapLines;
        currentTokens = currentChunk.reduce(
          (sum, l) => sum + this.estimateTokens(l),
          0
        );
      }

      currentChunk.push(line);
      currentTokens += lineTokens;
    }

    // Add remaining content
    if (currentChunk.length > 0) {
      chunks.push(this.createChunk(
        currentChunk.join("\n"),
        filePath,
        startLine,
        startLine + currentChunk.length - 1,
        "code_block",
        language,
        {}
      ));
    }

    return chunks;
  }

  /**
   * Split a large chunk into smaller ones
   */
  private splitLargeChunk(chunk: CodeChunk, allLines: string[]): CodeChunk[] {
    const tokens = this.estimateTokens(chunk.content);
    const maxTokens = this.config.chunkSize * 2; // Allow 2x for boundary respect

    if (tokens <= maxTokens) {
      return [chunk];
    }

    // Split the chunk
    const chunkLines = chunk.content.split("\n");
    const subChunks: CodeChunk[] = [];
    let currentLines: string[] = [];
    let currentTokens = 0;
    let subStartLine = chunk.startLine;

    for (let i = 0; i < chunkLines.length; i++) {
      const line = chunkLines[i];
      const lineTokens = this.estimateTokens(line);

      if (currentTokens + lineTokens > this.config.chunkSize && currentLines.length > 0) {
        subChunks.push(this.createChunk(
          currentLines.join("\n"),
          chunk.filePath,
          subStartLine,
          subStartLine + currentLines.length - 1,
          chunk.type,
          chunk.language,
          chunk.metadata
        ));

        subStartLine = chunk.startLine + i;
        currentLines = [];
        currentTokens = 0;
      }

      currentLines.push(line);
      currentTokens += lineTokens;
    }

    if (currentLines.length > 0) {
      subChunks.push(this.createChunk(
        currentLines.join("\n"),
        chunk.filePath,
        subStartLine,
        subStartLine + currentLines.length - 1,
        chunk.type,
        chunk.language,
        chunk.metadata
      ));
    }

    return subChunks;
  }

  /**
   * Create a chunk object
   */
  private createChunk(
    content: string,
    filePath: string,
    startLine: number,
    endLine: number,
    type: ChunkType,
    language: string,
    metadata: Partial<ChunkMetadata>
  ): CodeChunk {
    return {
      id: createChunkId(filePath, startLine, type),
      content,
      filePath,
      startLine,
      endLine,
      type,
      language,
      metadata: {
        ...metadata,
        isPublic: this.isPublic(content, language),
        isAsync: this.isAsync(content),
      },
    };
  }

  /**
   * Check if code is public/exported
   */
  private isPublic(content: string, language: string): boolean {
    const firstLine = content.split("\n")[0] || "";
    if (language === "typescript" || language === "javascript") {
      return firstLine.includes("export");
    }
    if (language === "python") {
      return !firstLine.trim().startsWith("_");
    }
    if (language === "go") {
      const funcMatch = firstLine.match(/func\s+(?:\([^)]+\)\s+)?(\w+)/);
      if (funcMatch) {
        return /^[A-Z]/.test(funcMatch[1]);
      }
    }
    return true;
  }

  /**
   * Check if function is async
   */
  private isAsync(content: string): boolean {
    const firstLine = content.split("\n")[0] || "";
    return firstLine.includes("async ");
  }

  /**
   * Estimate token count for text
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): RAGConfig {
    return { ...this.config };
  }
}

/**
 * Create a chunker instance
 */
export function createChunker(config: Partial<RAGConfig> = {}): CodeChunker {
  return new CodeChunker(config);
}
