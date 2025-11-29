/**
 * Refactoring Assistant Tool
 *
 * Provides safe, automated refactoring operations including:
 * - Rename (symbol, file)
 * - Extract (function, variable, interface)
 * - Inline (function, variable)
 * - Move (to different file)
 *
 * Inspired by hurry-mode's refactoring capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import {
  RefactoringType,
  RefactoringRequest,
  RefactoringResult,
  FileChange,
  TextEdit,
  SafetyAnalysis,
  CodeSymbol,
  SourceRange,
} from "./types.js";
import { ASTParser, getASTParser } from "./ast-parser.js";
import { SymbolSearch, getSymbolSearch } from "./symbol-search.js";

/**
 * Refactoring Assistant
 */
export class RefactoringAssistant {
  private parser: ASTParser;
  private symbolSearch: SymbolSearch;

  constructor(parser?: ASTParser, symbolSearch?: SymbolSearch) {
    this.parser = parser || getASTParser();
    this.symbolSearch = symbolSearch || getSymbolSearch();
  }

  /**
   * Execute a refactoring operation
   */
  async refactor(request: RefactoringRequest): Promise<RefactoringResult> {
    switch (request.type) {
      case "rename":
        return this.rename(request);
      case "extractFunction":
        return this.extractFunction(request);
      case "extractVariable":
        return this.extractVariable(request);
      case "extractInterface":
        return this.extractInterface(request);
      case "inlineFunction":
        return this.inlineFunction(request);
      case "inlineVariable":
        return this.inlineVariable(request);
      case "moveToFile":
        return this.moveToFile(request);
      default:
        return {
          success: false,
          type: request.type,
          changes: [],
          safetyAnalysis: this.createSafetyAnalysis("low", 0, 0),
          error: `Unsupported refactoring type: ${request.type}`,
        };
    }
  }

  /**
   * Preview a refactoring without applying
   */
  async preview(request: RefactoringRequest): Promise<RefactoringResult> {
    const result = await this.refactor(request);
    // Don't apply changes, just return preview
    return {
      ...result,
      preview: this.generatePreview(result.changes),
    };
  }

  /**
   * Rename a symbol across files
   */
  private async rename(request: RefactoringRequest): Promise<RefactoringResult> {
    if (!request.newName) {
      return this.errorResult("rename", "New name is required");
    }

    // Validate new name
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(request.newName)) {
      return this.errorResult("rename", "Invalid identifier name");
    }

    const changes: FileChange[] = [];
    const affectedFiles = new Set<string>();

    try {
      // Find the symbol to rename
      let targetSymbol: CodeSymbol | undefined;

      if (request.symbolId) {
        const searchResults = await this.symbolSearch.search({
          query: request.symbolId,
          maxResults: 1,
        });
        targetSymbol = searchResults[0]?.symbol;
      } else if (request.range && request.filePath) {
        // Find symbol at position
        const parseResult = await this.parser.parseFile(request.filePath);
        targetSymbol = parseResult.symbols.find((s) =>
          this.rangeContains(s.range, request.range!)
        );
      }

      if (!targetSymbol) {
        return this.errorResult("rename", "Symbol not found");
      }

      // Find all usages
      const usages = await this.symbolSearch.findUsages(targetSymbol);

      // Group by file
      const usagesByFile = new Map<string, typeof usages>();
      for (const usage of usages) {
        const fileUsages = usagesByFile.get(usage.filePath) || [];
        fileUsages.push(usage);
        usagesByFile.set(usage.filePath, fileUsages);
        affectedFiles.add(usage.filePath);
      }

      // Generate changes for each file
      for (const [filePath, fileUsages] of usagesByFile) {
        const content = fs.readFileSync(filePath, "utf-8");
        const edits: TextEdit[] = [];

        // Sort usages by position (reverse order for safe replacement)
        const sortedUsages = [...fileUsages].sort(
          (a, b) => (b.range.start.offset || 0) - (a.range.start.offset || 0)
        );

        for (const usage of sortedUsages) {
          edits.push({
            range: usage.range,
            newText: request.newName,
          });
        }

        // Apply edits to generate new content
        const newContent = this.applyEdits(content, edits);

        changes.push({
          filePath,
          type: "modify",
          originalContent: content,
          newContent,
          edits,
        });
      }

      // Safety analysis
      const safetyAnalysis = this.analyzeRenameSafety(
        targetSymbol,
        request.newName,
        affectedFiles.size
      );

      return {
        success: true,
        type: "rename",
        changes,
        safetyAnalysis,
      };
    } catch (error: any) {
      return this.errorResult("rename", error.message);
    }
  }

  /**
   * Extract selected code into a function
   */
  private async extractFunction(request: RefactoringRequest): Promise<RefactoringResult> {
    if (!request.range || !request.filePath || !request.newName) {
      return this.errorResult("extractFunction", "Range, file path, and new name are required");
    }

    try {
      const content = fs.readFileSync(request.filePath, "utf-8");
      const lines = content.split("\n");

      // Extract selected code
      const startLine = request.range.start.line - 1;
      const endLine = request.range.end.line;
      const selectedLines = lines.slice(startLine, endLine);
      const selectedCode = selectedLines.join("\n");

      // Analyze selected code for variables
      const variables = this.findVariablesInCode(selectedCode);
      const usedVariables = variables.filter((v) => v.isUsed && !v.isDeclared);
      const declaredVariables = variables.filter((v) => v.isDeclared);

      // Determine return value
      const returnVariables = declaredVariables.filter((v) => {
        // Check if variable is used after the selection
        const afterCode = lines.slice(endLine).join("\n");
        return new RegExp(`\\b${v.name}\\b`).test(afterCode);
      });

      // Build function signature
      const params = usedVariables.map((v) => v.name).join(", ");
      const returnType = returnVariables.length > 0
        ? returnVariables.length === 1
          ? returnVariables[0].name
          : `{ ${returnVariables.map((v) => v.name).join(", ")} }`
        : "void";

      // Build function body
      let functionBody = selectedCode;
      if (returnVariables.length === 1) {
        functionBody += `\n  return ${returnVariables[0].name};`;
      } else if (returnVariables.length > 1) {
        functionBody += `\n  return { ${returnVariables.map((v) => v.name).join(", ")} };`;
      }

      // Get indentation
      const baseIndent = this.getIndentation(lines[startLine]);

      // Build function
      const functionCode = [
        `${baseIndent}function ${request.newName}(${params}) {`,
        ...functionBody.split("\n").map((l) => `${baseIndent}  ${l.trim()}`),
        `${baseIndent}}`,
      ].join("\n");

      // Build function call
      let functionCall: string;
      if (returnVariables.length === 0) {
        functionCall = `${request.newName}(${params});`;
      } else if (returnVariables.length === 1) {
        functionCall = `const ${returnVariables[0].name} = ${request.newName}(${params});`;
      } else {
        functionCall = `const { ${returnVariables.map((v) => v.name).join(", ")} } = ${request.newName}(${params});`;
      }

      // Build new content
      const newLines = [
        ...lines.slice(0, startLine),
        `${baseIndent}${functionCall}`,
        ...lines.slice(endLine),
      ];

      // Insert function before the containing function/class
      const insertIndex = this.findFunctionInsertIndex(lines, startLine);
      newLines.splice(insertIndex, 0, "", functionCode, "");

      const newContent = newLines.join("\n");

      return {
        success: true,
        type: "extractFunction",
        changes: [
          {
            filePath: request.filePath,
            type: "modify",
            originalContent: content,
            newContent,
          },
        ],
        safetyAnalysis: this.createSafetyAnalysis("medium", 1, 1),
      };
    } catch (error: any) {
      return this.errorResult("extractFunction", error.message);
    }
  }

  /**
   * Extract expression into a variable
   */
  private async extractVariable(request: RefactoringRequest): Promise<RefactoringResult> {
    if (!request.range || !request.filePath || !request.newName) {
      return this.errorResult("extractVariable", "Range, file path, and new name are required");
    }

    try {
      const content = fs.readFileSync(request.filePath, "utf-8");
      const lines = content.split("\n");

      // Extract selected expression
      const startLine = request.range.start.line - 1;
      const startCol = request.range.start.column;
      const endLine = request.range.end.line - 1;
      const endCol = request.range.end.column;

      let selectedExpression: string;
      if (startLine === endLine) {
        selectedExpression = lines[startLine].slice(startCol, endCol);
      } else {
        const firstLine = lines[startLine].slice(startCol);
        const middleLines = lines.slice(startLine + 1, endLine);
        const lastLine = lines[endLine].slice(0, endCol);
        selectedExpression = [firstLine, ...middleLines, lastLine].join("\n");
      }

      // Get indentation
      const baseIndent = this.getIndentation(lines[startLine]);

      // Build variable declaration
      const varDeclaration = `${baseIndent}const ${request.newName} = ${selectedExpression.trim()};`;

      // Replace expression with variable reference
      const newLine = lines[startLine].slice(0, startCol) +
        request.newName +
        lines[endLine].slice(endCol);

      // Build new content
      const newLines = [...lines];

      // Remove original lines if multi-line
      if (startLine !== endLine) {
        newLines.splice(startLine, endLine - startLine + 1, newLine);
      } else {
        newLines[startLine] = newLine;
      }

      // Insert variable declaration before the line
      newLines.splice(startLine, 0, varDeclaration);

      const newContent = newLines.join("\n");

      return {
        success: true,
        type: "extractVariable",
        changes: [
          {
            filePath: request.filePath,
            type: "modify",
            originalContent: content,
            newContent,
          },
        ],
        safetyAnalysis: this.createSafetyAnalysis("low", 1, 1),
      };
    } catch (error: any) {
      return this.errorResult("extractVariable", error.message);
    }
  }

  /**
   * Extract interface from class
   */
  private async extractInterface(request: RefactoringRequest): Promise<RefactoringResult> {
    if (!request.filePath || !request.newName) {
      return this.errorResult("extractInterface", "File path and interface name are required");
    }

    try {
      const parseResult = await this.parser.parseFile(request.filePath);
      const content = fs.readFileSync(request.filePath, "utf-8");

      // Find target class
      let targetClass: CodeSymbol | undefined;
      if (request.symbolId) {
        targetClass = parseResult.symbols.find((s) => s.id === request.symbolId);
      } else {
        targetClass = parseResult.symbols.find((s) => s.type === "class");
      }

      if (!targetClass) {
        return this.errorResult("extractInterface", "Class not found");
      }

      // Find public methods and properties
      const publicMembers = parseResult.symbols.filter(
        (s) =>
          s.parentId === targetClass!.id &&
          s.visibility === "public" &&
          (s.type === "method" || s.type === "property")
      );

      // Build interface
      const interfaceLines = [`export interface ${request.newName} {`];

      for (const member of publicMembers) {
        if (member.type === "method") {
          const params = member.parameters
            ?.map((p) => `${p.name}${p.isOptional ? "?" : ""}: ${p.type || "any"}`)
            .join(", ") || "";
          const returnType = member.returnType || "void";
          interfaceLines.push(`  ${member.name}(${params}): ${returnType};`);
        } else {
          const propType = member.metadata.valueType || "any";
          interfaceLines.push(`  ${member.name}: ${propType};`);
        }
      }

      interfaceLines.push("}");
      const interfaceCode = interfaceLines.join("\n");

      // Find insertion point (before the class)
      const classLine = targetClass.range.start.line - 1;
      const lines = content.split("\n");

      const newLines = [
        ...lines.slice(0, classLine),
        interfaceCode,
        "",
        ...lines.slice(classLine),
      ];

      // Update class to implement interface
      const classLineContent = newLines[classLine + interfaceLines.length + 1];
      const updatedClassLine = classLineContent.includes("implements")
        ? classLineContent.replace(/implements\s+/, `implements ${request.newName}, `)
        : classLineContent.replace(/\{/, `implements ${request.newName} {`);
      newLines[classLine + interfaceLines.length + 1] = updatedClassLine;

      const newContent = newLines.join("\n");

      return {
        success: true,
        type: "extractInterface",
        changes: [
          {
            filePath: request.filePath,
            type: "modify",
            originalContent: content,
            newContent,
          },
        ],
        safetyAnalysis: this.createSafetyAnalysis("low", 1, publicMembers.length + 1),
      };
    } catch (error: any) {
      return this.errorResult("extractInterface", error.message);
    }
  }

  /**
   * Inline a function (replace calls with body)
   */
  private async inlineFunction(request: RefactoringRequest): Promise<RefactoringResult> {
    if (!request.filePath && !request.symbolId) {
      return this.errorResult("inlineFunction", "File path or symbol ID is required");
    }

    try {
      // Find the function
      let targetFunction: CodeSymbol | undefined;

      if (request.symbolId) {
        const searchResults = await this.symbolSearch.search({
          query: request.symbolId,
          types: ["function", "method"],
          maxResults: 1,
        });
        targetFunction = searchResults[0]?.symbol;
      }

      if (!targetFunction) {
        return this.errorResult("inlineFunction", "Function not found");
      }

      // Read function file
      const functionContent = fs.readFileSync(targetFunction.filePath, "utf-8");
      const functionLines = functionContent.split("\n");

      // Extract function body
      const startLine = targetFunction.range.start.line - 1;
      const endLine = targetFunction.range.end.line;
      const functionCode = functionLines.slice(startLine, endLine).join("\n");

      // Extract body (between braces)
      const bodyMatch = functionCode.match(/\{([\s\S]*)\}/);
      if (!bodyMatch) {
        return this.errorResult("inlineFunction", "Could not extract function body");
      }

      let functionBody = bodyMatch[1].trim();

      // Find all usages
      const usages = await this.symbolSearch.findUsages(targetFunction);
      const callUsages = usages.filter((u) => u.type === "call");

      if (callUsages.length === 0) {
        return this.errorResult("inlineFunction", "No function calls found to inline");
      }

      const changes: FileChange[] = [];
      const processedFiles = new Set<string>();

      // Process each file with calls
      for (const usage of callUsages) {
        if (processedFiles.has(usage.filePath)) continue;
        processedFiles.add(usage.filePath);

        const fileContent = fs.readFileSync(usage.filePath, "utf-8");
        const fileLines = fileContent.split("\n");

        // Find and replace calls in this file
        const fileCallUsages = callUsages.filter((u) => u.filePath === usage.filePath);
        let newContent = fileContent;

        // Sort by position (reverse) for safe replacement
        const sortedUsages = [...fileCallUsages].sort(
          (a, b) => (b.range.start.line) - (a.range.start.line)
        );

        for (const callUsage of sortedUsages) {
          const callLine = callUsage.range.start.line - 1;
          const line = fileLines[callLine];

          // Find the full call expression
          const callPattern = new RegExp(
            `${targetFunction.name}\\s*\\([^)]*\\)`,
            "g"
          );
          const match = callPattern.exec(line);

          if (match) {
            // For simple cases, replace call with body
            // (Complex parameter substitution would need more work)
            const indent = this.getIndentation(line);
            const inlinedBody = functionBody
              .split("\n")
              .map((l) => `${indent}${l.trim()}`)
              .join("\n");

            const newLines = newContent.split("\n");
            newLines[callLine] = line.replace(match[0], `(${inlinedBody.trim()})`);
            newContent = newLines.join("\n");
          }
        }

        if (newContent !== fileContent) {
          changes.push({
            filePath: usage.filePath,
            type: "modify",
            originalContent: fileContent,
            newContent,
          });
        }
      }

      return {
        success: true,
        type: "inlineFunction",
        changes,
        safetyAnalysis: this.createSafetyAnalysis(
          "high",
          processedFiles.size,
          callUsages.length
        ),
      };
    } catch (error: any) {
      return this.errorResult("inlineFunction", error.message);
    }
  }

  /**
   * Inline a variable
   */
  private async inlineVariable(request: RefactoringRequest): Promise<RefactoringResult> {
    // Similar to inlineFunction but for variables
    return this.errorResult("inlineVariable", "Not yet implemented");
  }

  /**
   * Move symbol to a different file
   */
  private async moveToFile(request: RefactoringRequest): Promise<RefactoringResult> {
    if (!request.filePath || !request.targetPath || !request.symbolId) {
      return this.errorResult("moveToFile", "Source file, target file, and symbol ID are required");
    }

    try {
      const sourceContent = fs.readFileSync(request.filePath, "utf-8");
      const parseResult = await this.parser.parseFile(request.filePath);

      // Find symbol to move
      const targetSymbol = parseResult.symbols.find((s) => s.id === request.symbolId);
      if (!targetSymbol) {
        return this.errorResult("moveToFile", "Symbol not found");
      }

      // Extract symbol code
      const sourceLines = sourceContent.split("\n");
      const startLine = targetSymbol.range.start.line - 1;
      const endLine = targetSymbol.range.end.line;
      const symbolCode = sourceLines.slice(startLine, endLine).join("\n");

      // Remove from source
      const newSourceLines = [
        ...sourceLines.slice(0, startLine),
        ...sourceLines.slice(endLine),
      ];
      const newSourceContent = newSourceLines.join("\n");

      // Add to target
      let targetContent = "";
      try {
        targetContent = fs.readFileSync(request.targetPath, "utf-8");
      } catch {
        // Target doesn't exist, will be created
      }

      const newTargetContent = targetContent
        ? `${targetContent}\n\n${symbolCode}`
        : symbolCode;

      const changes: FileChange[] = [
        {
          filePath: request.filePath,
          type: "modify",
          originalContent: sourceContent,
          newContent: newSourceContent,
        },
        {
          filePath: request.targetPath,
          type: targetContent ? "modify" : "create",
          originalContent: targetContent || undefined,
          newContent: newTargetContent,
        },
      ];

      return {
        success: true,
        type: "moveToFile",
        changes,
        safetyAnalysis: this.createSafetyAnalysis("high", 2, 1),
      };
    } catch (error: any) {
      return this.errorResult("moveToFile", error.message);
    }
  }

  /**
   * Apply text edits to content
   */
  private applyEdits(content: string, edits: TextEdit[]): string {
    const lines = content.split("\n");

    // Sort edits by position (reverse order)
    const sortedEdits = [...edits].sort(
      (a, b) => b.range.start.line - a.range.start.line ||
        b.range.start.column - a.range.start.column
    );

    for (const edit of sortedEdits) {
      const startLine = edit.range.start.line - 1;
      const endLine = edit.range.end.line - 1;
      const startCol = edit.range.start.column;
      const endCol = edit.range.end.column;

      if (startLine === endLine) {
        const line = lines[startLine];
        lines[startLine] = line.slice(0, startCol) + edit.newText + line.slice(endCol);
      } else {
        const firstLine = lines[startLine].slice(0, startCol) + edit.newText;
        const lastLine = lines[endLine].slice(endCol);
        lines.splice(startLine, endLine - startLine + 1, firstLine + lastLine);
      }
    }

    return lines.join("\n");
  }

  /**
   * Find variables in code
   */
  private findVariablesInCode(code: string): Array<{
    name: string;
    isDeclared: boolean;
    isUsed: boolean;
  }> {
    const variables: Map<string, { isDeclared: boolean; isUsed: boolean }> = new Map();

    // Find declarations
    const declPattern = /(?:const|let|var)\s+(\w+)/g;
    let match;
    while ((match = declPattern.exec(code)) !== null) {
      variables.set(match[1], { isDeclared: true, isUsed: false });
    }

    // Find usages (identifiers)
    const identPattern = /\b([a-zA-Z_]\w*)\b/g;
    while ((match = identPattern.exec(code)) !== null) {
      const name = match[1];
      // Skip keywords
      const keywords = ["const", "let", "var", "function", "if", "else", "for", "while", "return"];
      if (keywords.includes(name)) continue;

      const existing = variables.get(name);
      if (existing) {
        existing.isUsed = true;
      } else {
        variables.set(name, { isDeclared: false, isUsed: true });
      }
    }

    return Array.from(variables.entries()).map(([name, info]) => ({
      name,
      ...info,
    }));
  }

  /**
   * Get indentation of a line
   */
  private getIndentation(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : "";
  }

  /**
   * Find index to insert extracted function
   */
  private findFunctionInsertIndex(lines: string[], currentLine: number): number {
    // Find the start of the containing function/class
    let braceCount = 0;
    for (let i = currentLine; i >= 0; i--) {
      const line = lines[i];
      braceCount += (line.match(/\}/g) || []).length;
      braceCount -= (line.match(/\{/g) || []).length;

      if (braceCount < 0) {
        // Found containing block
        // Look for function/class declaration
        for (let j = i; j >= 0; j--) {
          if (/^\s*(function|class|const|let|var)/.test(lines[j])) {
            return j;
          }
        }
        return i;
      }
    }
    return 0;
  }

  /**
   * Check if range contains position
   */
  private rangeContains(range: SourceRange, position: SourceRange): boolean {
    return (
      position.start.line >= range.start.line &&
      position.end.line <= range.end.line
    );
  }

  /**
   * Analyze safety of rename operation
   */
  private analyzeRenameSafety(
    symbol: CodeSymbol,
    newName: string,
    affectedFiles: number
  ): SafetyAnalysis {
    const warnings: string[] = [];
    const breakingChanges: string[] = [];

    // Check if renaming public API
    if (symbol.visibility === "public") {
      breakingChanges.push("Renaming public symbol may break external consumers");
    }

    // Check if renaming commonly used pattern
    if (["constructor", "render", "toString", "valueOf"].includes(symbol.name)) {
      warnings.push(`Renaming special method '${symbol.name}' may cause issues`);
    }

    // Determine risk level
    let riskLevel: "low" | "medium" | "high" = "low";
    if (breakingChanges.length > 0) riskLevel = "high";
    else if (affectedFiles > 5) riskLevel = "medium";

    return {
      riskLevel,
      affectedFiles,
      affectedSymbols: 1,
      breakingChanges,
      warnings,
      requiresTests: riskLevel !== "low",
    };
  }

  /**
   * Create safety analysis
   */
  private createSafetyAnalysis(
    riskLevel: "low" | "medium" | "high",
    affectedFiles: number,
    affectedSymbols: number
  ): SafetyAnalysis {
    return {
      riskLevel,
      affectedFiles,
      affectedSymbols,
      breakingChanges: [],
      warnings: [],
      requiresTests: riskLevel !== "low",
    };
  }

  /**
   * Generate preview text
   */
  private generatePreview(changes: FileChange[]): string {
    const lines: string[] = [];

    for (const change of changes) {
      lines.push(`=== ${change.filePath} (${change.type}) ===`);

      if (change.edits) {
        for (const edit of change.edits) {
          lines.push(`  Line ${edit.range.start.line}: -> ${edit.newText}`);
        }
      } else if (change.originalContent && change.newContent) {
        lines.push("  [Full file modification]");
      }

      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * Create error result
   */
  private errorResult(type: RefactoringType, message: string): RefactoringResult {
    return {
      success: false,
      type,
      changes: [],
      safetyAnalysis: this.createSafetyAnalysis("low", 0, 0),
      error: message,
    };
  }
}

/**
 * Create a refactoring assistant
 */
export function createRefactoringAssistant(): RefactoringAssistant {
  return new RefactoringAssistant();
}

// Singleton instance
let refactoringAssistantInstance: RefactoringAssistant | null = null;

export function getRefactoringAssistant(): RefactoringAssistant {
  if (!refactoringAssistantInstance) {
    refactoringAssistantInstance = createRefactoringAssistant();
  }
  return refactoringAssistantInstance;
}

export function resetRefactoringAssistant(): void {
  refactoringAssistantInstance = null;
}
