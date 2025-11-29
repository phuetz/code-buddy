/**
 * AST Parser Tool
 *
 * Multi-language Abstract Syntax Tree parser for extracting code structure.
 * Supports TypeScript, JavaScript, Python, and more.
 *
 * Inspired by hurry-mode's AST parsing capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import {
  SupportedLanguage,
  SymbolType,
  SymbolVisibility,
  SymbolScope,
  CodeSymbol,
  ImportInfo,
  ImportSpecifier,
  ExportInfo,
  ASTParseResult,
  ParseError,
  SourceRange,
  SourcePosition,
  ParameterInfo,
} from "./types.js";

/**
 * Language detection by file extension
 */
const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".h": "c",
  ".hpp": "cpp",
};

/**
 * Language-specific parsing patterns
 */
interface LanguagePatterns {
  classPattern: RegExp;
  functionPattern: RegExp;
  methodPattern: RegExp;
  interfacePattern: RegExp;
  typePattern: RegExp;
  enumPattern: RegExp;
  variablePattern: RegExp;
  constantPattern: RegExp;
  importPattern: RegExp;
  exportPattern: RegExp;
  commentPatterns: {
    single: RegExp;
    multiStart: RegExp;
    multiEnd: RegExp;
    docstring?: RegExp;
  };
}

/**
 * TypeScript/JavaScript patterns
 */
const TS_JS_PATTERNS: LanguagePatterns = {
  classPattern:
    /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+)(?:<[^>]*>)?)?(?:\s+implements\s+([^{]+))?/g,
  functionPattern:
    /(?:export\s+)?(?:async\s+)?function\s*(\*?)\s*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{=]+))?/g,
  methodPattern:
    /(?:(?:public|private|protected|static|async|readonly)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^{;]+))?/g,
  interfacePattern:
    /(?:export\s+)?interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([^{]+))?/g,
  typePattern:
    /(?:export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/g,
  enumPattern:
    /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/g,
  variablePattern:
    /(?:export\s+)?(?:const|let|var)\s+(\w+)(?:\s*:\s*([^=]+))?\s*=/g,
  constantPattern:
    /(?:export\s+)?const\s+(\w+)(?:\s*:\s*([^=]+))?\s*=\s*([^;]+)/g,
  importPattern:
    /import\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+(\w+)\s*)?from\s+['"]([^'"]+)['"]/g,
  exportPattern:
    /export\s+(?:default\s+)?(?:(?:type|interface|class|function|const|let|var|enum)\s+)?(\w+)?(?:\s*(?:,\s*\{([^}]*)\}))?(?:\s+from\s+['"]([^'"]+)['"])?/g,
  commentPatterns: {
    single: /\/\/.*/g,
    multiStart: /\/\*/,
    multiEnd: /\*\//,
    docstring: /\/\*\*[\s\S]*?\*\//g,
  },
};

/**
 * Python patterns
 */
const PYTHON_PATTERNS: LanguagePatterns = {
  classPattern:
    /class\s+(\w+)(?:\s*\(([^)]*)\))?:/g,
  functionPattern:
    /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/g,
  methodPattern:
    /(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?:/g,
  interfacePattern: /$/g, // No interfaces in Python
  typePattern:
    /(\w+)(?:\s*:\s*TypeAlias)?\s*=\s*(?:TypeVar|Union|Optional|List|Dict|Tuple|Callable)/g,
  enumPattern:
    /class\s+(\w+)\s*\(\s*(?:Enum|IntEnum|Flag|IntFlag)\s*\)/g,
  variablePattern:
    /^(\w+)(?:\s*:\s*([^=]+))?\s*=/gm,
  constantPattern:
    /^([A-Z][A-Z0-9_]*)\s*(?::\s*([^=]+))?\s*=/gm,
  importPattern:
    /(?:from\s+(\S+)\s+)?import\s+([^#\n]+)/g,
  exportPattern: /$/g, // Python uses __all__
  commentPatterns: {
    single: /#.*/g,
    multiStart: /'''/,
    multiEnd: /'''/,
    docstring: /"""[\s\S]*?"""|'''[\s\S]*?'''/g,
  },
};

/**
 * Go patterns
 */
const GO_PATTERNS: LanguagePatterns = {
  classPattern:
    /type\s+(\w+)\s+struct\s*\{/g,
  functionPattern:
    /func\s+(?:\((\w+)\s+\*?(\w+)\)\s+)?(\w+)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)(?:\s*\(?([^{)]+)\)?)?/g,
  methodPattern:
    /func\s+\((\w+)\s+\*?(\w+)\)\s+(\w+)\s*\(([^)]*)\)(?:\s*\(?([^{)]+)\)?)?/g,
  interfacePattern:
    /type\s+(\w+)\s+interface\s*\{/g,
  typePattern:
    /type\s+(\w+)\s+/g,
  enumPattern: /$/g, // Go uses const blocks
  variablePattern:
    /(?:var|const)\s+(\w+)(?:\s+(\w+))?\s*=/g,
  constantPattern:
    /const\s+(\w+)(?:\s+(\w+))?\s*=/g,
  importPattern:
    /import\s+(?:\(\s*)?"([^"]+)"(?:\s*\))?/g,
  exportPattern: /$/g, // Go uses capitalization
  commentPatterns: {
    single: /\/\/.*/g,
    multiStart: /\/\*/,
    multiEnd: /\*\//,
  },
};

/**
 * Get patterns for a language
 */
function getPatternsForLanguage(language: SupportedLanguage): LanguagePatterns {
  switch (language) {
    case "typescript":
    case "javascript":
      return TS_JS_PATTERNS;
    case "python":
      return PYTHON_PATTERNS;
    case "go":
      return GO_PATTERNS;
    default:
      return TS_JS_PATTERNS;
  }
}

/**
 * AST Parser Tool
 */
export class ASTParser {
  private cache: Map<string, { result: ASTParseResult; mtime: number }> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Parse a file and extract symbols
   */
  async parseFile(filePath: string, useCache = true): Promise<ASTParseResult> {
    const startTime = Date.now();

    // Check cache
    if (useCache) {
      const cached = this.cache.get(filePath);
      if (cached) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs <= cached.mtime && Date.now() - cached.mtime < this.cacheTimeout) {
            return cached.result;
          }
        } catch {
          // File might not exist, continue with parsing
        }
      }
    }

    // Detect language
    const language = this.detectLanguage(filePath);

    // Read file content
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (error: any) {
      return {
        filePath,
        language,
        symbols: [],
        imports: [],
        exports: [],
        errors: [{ message: error.message, severity: "error" }],
        parseTime: Date.now() - startTime,
        metadata: { lineCount: 0, hasErrors: true },
      };
    }

    // Parse content
    const result = this.parseContent(content, filePath, language);
    result.parseTime = Date.now() - startTime;

    // Update cache
    if (useCache) {
      try {
        const stats = fs.statSync(filePath);
        this.cache.set(filePath, { result, mtime: stats.mtimeMs });
      } catch {
        // Ignore cache update errors
      }
    }

    return result;
  }

  /**
   * Parse content string directly
   */
  parseContent(
    content: string,
    filePath: string,
    language?: SupportedLanguage
  ): ASTParseResult {
    const startTime = Date.now();
    const detectedLanguage = language || this.detectLanguage(filePath);
    const patterns = getPatternsForLanguage(detectedLanguage);
    const lines = content.split("\n");

    const symbols: CodeSymbol[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];
    const errors: ParseError[] = [];

    try {
      // Extract symbols based on language
      symbols.push(...this.extractClasses(content, filePath, detectedLanguage, patterns));
      symbols.push(...this.extractFunctions(content, filePath, detectedLanguage, patterns));
      symbols.push(...this.extractInterfaces(content, filePath, detectedLanguage, patterns));
      symbols.push(...this.extractTypes(content, filePath, detectedLanguage, patterns));
      symbols.push(...this.extractEnums(content, filePath, detectedLanguage, patterns));
      symbols.push(...this.extractVariables(content, filePath, detectedLanguage, patterns));

      // Extract imports and exports
      imports.push(...this.extractImports(content, detectedLanguage, patterns));
      exports.push(...this.extractExports(content, detectedLanguage, patterns));

      // Build parent-child relationships
      this.buildSymbolHierarchy(symbols, content);

    } catch (error: any) {
      errors.push({ message: error.message, severity: "error" });
    }

    return {
      filePath,
      language: detectedLanguage,
      symbols,
      imports,
      exports,
      errors,
      parseTime: Date.now() - startTime,
      metadata: {
        lineCount: lines.length,
        hasErrors: errors.length > 0,
        complexity: this.calculateComplexity(content),
      },
    };
  }

  /**
   * Detect language from file extension
   */
  detectLanguage(filePath: string): SupportedLanguage {
    const ext = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[ext] || "unknown";
  }

  /**
   * Extract class symbols
   */
  private extractClasses(
    content: string,
    filePath: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(patterns.classPattern.source, patterns.classPattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);
      const visibility = this.inferVisibility(content, match.index, language);

      symbols.push({
        id: this.createId("class"),
        name: match[1],
        type: "class",
        language,
        filePath,
        range,
        visibility,
        scope: "module",
        signature: match[0].split("{")[0].trim(),
        metadata: {
          extends: match[2] || undefined,
          implements: match[3]?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
        },
      });
    }

    return symbols;
  }

  /**
   * Extract function symbols
   */
  private extractFunctions(
    content: string,
    filePath: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(patterns.functionPattern.source, patterns.functionPattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);
      const visibility = this.inferVisibility(content, match.index, language);

      // Parse parameters
      let name: string;
      let paramsStr: string;
      let returnType: string | undefined;

      if (language === "go") {
        // Go: func (receiver) name(params) returnType
        name = match[3] || match[1];
        paramsStr = match[4] || "";
        returnType = match[5]?.trim();
      } else if (language === "python") {
        // Python: def name(params) -> returnType:
        name = match[1];
        paramsStr = match[2] || "";
        returnType = match[3]?.trim();
      } else {
        // TypeScript/JavaScript: function name(params): returnType
        name = match[2] || match[1];
        paramsStr = match[3] || "";
        returnType = match[4]?.trim();
      }

      const parameters = this.parseParameters(paramsStr, language);

      symbols.push({
        id: this.createId("function"),
        name,
        type: "function",
        language,
        filePath,
        range,
        visibility,
        scope: "module",
        signature: match[0].split("{")[0].split(":")[0].trim(),
        parameters,
        returnType,
        metadata: {
          isAsync: match[0].includes("async"),
          isGenerator: match[0].includes("*") || match[1] === "*",
        },
      });
    }

    return symbols;
  }

  /**
   * Extract interface symbols
   */
  private extractInterfaces(
    content: string,
    filePath: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(patterns.interfacePattern.source, patterns.interfacePattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);

      symbols.push({
        id: this.createId("interface"),
        name: match[1],
        type: "interface",
        language,
        filePath,
        range,
        visibility: "public",
        scope: "module",
        signature: match[0].split("{")[0].trim(),
        metadata: {
          extends: match[2]?.split(",").map((s: string) => s.trim()).filter(Boolean) || [],
        },
      });
    }

    return symbols;
  }

  /**
   * Extract type alias symbols
   */
  private extractTypes(
    content: string,
    filePath: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(patterns.typePattern.source, patterns.typePattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);

      symbols.push({
        id: this.createId("type"),
        name: match[1],
        type: "type",
        language,
        filePath,
        range,
        visibility: this.inferVisibility(content, match.index, language),
        scope: "module",
        metadata: {},
      });
    }

    return symbols;
  }

  /**
   * Extract enum symbols
   */
  private extractEnums(
    content: string,
    filePath: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const regex = new RegExp(patterns.enumPattern.source, patterns.enumPattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);

      symbols.push({
        id: this.createId("enum"),
        name: match[1],
        type: "enum",
        language,
        filePath,
        range,
        visibility: this.inferVisibility(content, match.index, language),
        scope: "module",
        metadata: {},
      });
    }

    return symbols;
  }

  /**
   * Extract variable and constant symbols
   */
  private extractVariables(
    content: string,
    filePath: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];

    // Extract constants
    const constRegex = new RegExp(patterns.constantPattern.source, patterns.constantPattern.flags);
    let match;

    while ((match = constRegex.exec(content)) !== null) {
      // Skip if inside a function/class body (simple heuristic)
      const beforeMatch = content.slice(0, match.index);
      const openBraces = (beforeMatch.match(/\{/g) || []).length;
      const closeBraces = (beforeMatch.match(/\}/g) || []).length;
      if (openBraces > closeBraces) continue;

      const range = this.getRange(content, match.index, match[0].length);

      symbols.push({
        id: this.createId("constant"),
        name: match[1],
        type: "constant",
        language,
        filePath,
        range,
        visibility: this.inferVisibility(content, match.index, language),
        scope: "module",
        metadata: {
          valueType: match[2]?.trim(),
        },
      });
    }

    return symbols;
  }

  /**
   * Extract imports
   */
  private extractImports(
    content: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const regex = new RegExp(patterns.importPattern.source, patterns.importPattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);
      const specifiers: ImportSpecifier[] = [];

      if (language === "python") {
        // Python: from X import a, b, c or import X
        const source = match[1] || match[2]?.split(",")[0]?.trim() || "";
        const items = match[2]?.split(",").map((s: string) => s.trim()) || [];

        for (const item of items) {
          const [name, alias] = item.split(/\s+as\s+/);
          if (name) {
            specifiers.push({
              name: name.trim(),
              alias: alias?.trim(),
              isDefault: false,
              isNamespace: false,
            });
          }
        }

        imports.push({
          source,
          specifiers,
          isTypeOnly: false,
          isDynamic: false,
          range,
        });
      } else if (language === "go") {
        // Go: import "package"
        imports.push({
          source: match[1],
          specifiers: [],
          isTypeOnly: false,
          isDynamic: false,
          range,
        });
      } else {
        // TypeScript/JavaScript
        const source = match[4];
        const isTypeOnly = match[0].includes("import type");

        // Default import
        if (match[1]) {
          specifiers.push({
            name: match[1],
            isDefault: true,
            isNamespace: false,
          });
        }

        // Named imports
        if (match[2]) {
          const named = match[2].split(",");
          for (const item of named) {
            const [name, alias] = item.trim().split(/\s+as\s+/);
            if (name) {
              specifiers.push({
                name: name.trim(),
                alias: alias?.trim(),
                isDefault: false,
                isNamespace: false,
              });
            }
          }
        }

        // Namespace import
        if (match[3]) {
          specifiers.push({
            name: match[3],
            isDefault: false,
            isNamespace: true,
          });
        }

        imports.push({
          source,
          specifiers,
          isTypeOnly,
          isDynamic: false,
          range,
        });
      }
    }

    return imports;
  }

  /**
   * Extract exports
   */
  private extractExports(
    content: string,
    language: SupportedLanguage,
    patterns: LanguagePatterns
  ): ExportInfo[] {
    const exports: ExportInfo[] = [];

    if (language === "python" || language === "go") {
      // Python/Go don't have explicit export syntax
      return exports;
    }

    const regex = new RegExp(patterns.exportPattern.source, patterns.exportPattern.flags);
    let match;

    while ((match = regex.exec(content)) !== null) {
      const range = this.getRange(content, match.index, match[0].length);
      const isDefault = match[0].includes("default");

      if (match[1]) {
        exports.push({
          name: match[1],
          isDefault,
          isReExport: !!match[3],
          source: match[3],
          range,
        });
      }

      // Named exports in braces
      if (match[2]) {
        const named = match[2].split(",");
        for (const item of named) {
          const [name, alias] = item.trim().split(/\s+as\s+/);
          if (name) {
            exports.push({
              name: alias?.trim() || name.trim(),
              localName: name.trim(),
              isDefault: false,
              isReExport: !!match[3],
              source: match[3],
              range,
            });
          }
        }
      }
    }

    return exports;
  }

  /**
   * Parse parameter string into structured info
   */
  private parseParameters(paramsStr: string, language: SupportedLanguage): ParameterInfo[] {
    const params: ParameterInfo[] = [];
    if (!paramsStr.trim()) return params;

    // Simple parsing - split by comma and extract info
    const paramParts = this.splitParameters(paramsStr);

    for (const part of paramParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Skip 'self' in Python
      if (language === "python" && trimmed === "self") continue;

      const isRest = trimmed.startsWith("...");
      const isOptional = trimmed.includes("?") || trimmed.includes("=");

      let name: string;
      let type: string | undefined;
      let defaultValue: string | undefined;

      if (language === "python") {
        // Python: name: type = default
        const [nameType, defVal] = trimmed.split("=");
        const [n, t] = nameType.split(":");
        name = n.trim();
        type = t?.trim();
        defaultValue = defVal?.trim();
      } else if (language === "go") {
        // Go: name type
        const parts = trimmed.split(/\s+/);
        name = parts[0];
        type = parts.slice(1).join(" ");
      } else {
        // TypeScript: name?: type = default
        const cleaned = trimmed.replace("...", "");
        const [nameType, defVal] = cleaned.split("=");
        const [n, t] = nameType.split(":");
        name = n.replace("?", "").trim();
        type = t?.trim();
        defaultValue = defVal?.trim();
      }

      params.push({
        name,
        type,
        defaultValue,
        isOptional,
        isRest,
      });
    }

    return params;
  }

  /**
   * Split parameters handling nested brackets
   */
  private splitParameters(paramsStr: string): string[] {
    const params: string[] = [];
    let current = "";
    let depth = 0;

    for (const char of paramsStr) {
      if (char === "(" || char === "[" || char === "{" || char === "<") {
        depth++;
        current += char;
      } else if (char === ")" || char === "]" || char === "}" || char === ">") {
        depth--;
        current += char;
      } else if (char === "," && depth === 0) {
        params.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      params.push(current);
    }

    return params;
  }

  /**
   * Get source range from offset
   */
  private getRange(content: string, offset: number, length: number): SourceRange {
    const before = content.slice(0, offset);
    const lines = before.split("\n");
    const startLine = lines.length;
    const startColumn = lines[lines.length - 1].length;

    const matchContent = content.slice(offset, offset + length);
    const matchLines = matchContent.split("\n");
    const endLine = startLine + matchLines.length - 1;
    const endColumn = matchLines.length > 1
      ? matchLines[matchLines.length - 1].length
      : startColumn + length;

    return {
      start: { line: startLine, column: startColumn, offset },
      end: { line: endLine, column: endColumn, offset: offset + length },
    };
  }

  /**
   * Infer symbol visibility
   */
  private inferVisibility(
    content: string,
    offset: number,
    language: SupportedLanguage
  ): SymbolVisibility {
    const prefix = content.slice(Math.max(0, offset - 30), offset);

    if (language === "go") {
      // Go uses capitalization
      const nameMatch = content.slice(offset).match(/(?:func\s+(?:\([^)]+\)\s+)?|type\s+|const\s+|var\s+)([A-Za-z])/);
      if (nameMatch && /^[A-Z]/.test(nameMatch[1])) {
        return "public";
      }
      return "private";
    }

    if (language === "python") {
      // Python uses underscore prefix convention
      const nameMatch = content.slice(offset).match(/(?:def\s+|class\s+)(_*\w)/);
      if (nameMatch) {
        if (nameMatch[1].startsWith("__")) return "private";
        if (nameMatch[1].startsWith("_")) return "protected";
      }
      return "public";
    }

    // TypeScript/JavaScript
    if (prefix.includes("private")) return "private";
    if (prefix.includes("protected")) return "protected";
    if (prefix.includes("export")) return "public";

    return "internal";
  }

  /**
   * Build symbol hierarchy (parent-child relationships)
   */
  private buildSymbolHierarchy(symbols: CodeSymbol[], content: string): void {
    // Sort symbols by position
    const sorted = [...symbols].sort(
      (a, b) => (a.range.start.offset || 0) - (b.range.start.offset || 0)
    );

    // Find class/interface bodies and assign children
    for (const symbol of sorted) {
      if (symbol.type === "class" || symbol.type === "interface") {
        // Find the closing brace for this symbol
        const startOffset = symbol.range.start.offset || 0;
        let braceCount = 0;
        let foundOpen = false;
        let endOffset = startOffset;

        for (let i = startOffset; i < content.length; i++) {
          if (content[i] === "{") {
            braceCount++;
            foundOpen = true;
          } else if (content[i] === "}") {
            braceCount--;
            if (foundOpen && braceCount === 0) {
              endOffset = i;
              break;
            }
          }
        }

        // Find symbols within this range
        const children: string[] = [];
        for (const child of sorted) {
          if (child.id === symbol.id) continue;
          const childOffset = child.range.start.offset || 0;
          if (childOffset > startOffset && childOffset < endOffset) {
            children.push(child.id);
            child.parentId = symbol.id;
            child.scope = "class";
            if (child.type === "function") {
              child.type = "method";
            }
          }
        }
        symbol.children = children;
      }
    }
  }

  /**
   * Calculate basic complexity metric
   */
  private calculateComplexity(content: string): number {
    let complexity = 1;

    // Count decision points
    const patterns = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\?.*:/g, // ternary
      /&&/g,
      /\|\|/g,
    ];

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * Create unique ID
   */
  private createId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Create an AST parser instance
 */
export function createASTParser(): ASTParser {
  return new ASTParser();
}

// Singleton instance
let astParserInstance: ASTParser | null = null;

export function getASTParser(): ASTParser {
  if (!astParserInstance) {
    astParserInstance = createASTParser();
  }
  return astParserInstance;
}

export function resetASTParser(): void {
  astParserInstance = null;
}
