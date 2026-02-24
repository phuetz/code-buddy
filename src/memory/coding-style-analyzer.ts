/**
 * Coding Style Analyzer
 *
 * Analyzes source files to extract coding conventions using
 * regex-based heuristics (no AST parsing for speed).
 * Stores results in enhanced memory for system prompt injection.
 */

import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface CodingStyleProfile {
  namingConventions: NamingPattern[];
  importStyle: ImportPattern;
  errorHandlingPattern: 'try-catch' | 'promise-catch' | 'result-type' | 'mixed';
  testingPattern: 'describe-it' | 'test-only' | 'mixed';
  quoteStyle: 'single' | 'double';
  semicolons: boolean;
  indentation: '2-spaces' | '4-spaces' | 'tabs';
  typeAnnotationDensity: 'minimal' | 'moderate' | 'strict';
}

export interface NamingPattern {
  scope: 'variable' | 'function' | 'class' | 'file' | 'constant';
  convention: 'camelCase' | 'snake_case' | 'PascalCase' | 'SCREAMING_SNAKE' | 'kebab-case';
  confidence: number; // 0-1
}

export interface ImportPattern {
  style: 'named' | 'default' | 'mixed';
  usesBarrelFiles: boolean;
  extensionsInImports: boolean;
}

export class CodingStyleAnalyzer {
  /**
   * Analyze a single file's content using regex heuristics.
   */
  analyzeContent(content: string, filePath: string): Partial<CodingStyleProfile> {
    if (!content || content.trim().length === 0) {
      return {};
    }

    const result: Partial<CodingStyleProfile> = {};
    const lines = content.split('\n');

    result.quoteStyle = this.detectQuoteStyle(content);
    result.semicolons = this.detectSemicolons(lines);
    result.indentation = this.detectIndentation(lines);
    result.importStyle = this.detectImportStyle(content);
    result.errorHandlingPattern = this.detectErrorHandling(content);
    result.namingConventions = this.detectNamingConventions(content);
    result.typeAnnotationDensity = this.detectTypeAnnotationDensity(content);

    const ext = path.extname(filePath);
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      result.testingPattern = this.detectTestingPattern(content);
    }

    return result;
  }

  /**
   * Analyze multiple files and merge into a unified profile by majority voting.
   */
  async analyzeFiles(filePaths: string[]): Promise<CodingStyleProfile> {
    const partials: Partial<CodingStyleProfile>[] = [];

    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const partial = this.analyzeContent(content, filePath);
        partials.push(partial);
      } catch (err) {
        logger.debug(`Failed to read file for style analysis: ${filePath}`);
      }
    }

    return this.mergeProfiles(partials);
  }

  /**
   * Find all matching files recursively and analyze them.
   */
  async analyzeDirectory(
    dirPath: string,
    extensions: string[] = ['.ts', '.tsx', '.js', '.jsx']
  ): Promise<CodingStyleProfile> {
    const files = this.findFilesRecursively(dirPath, extensions);
    return this.analyzeFiles(files);
  }

  /**
   * Build a human-readable prompt snippet from a profile.
   */
  buildPromptSnippet(profile: CodingStyleProfile): string {
    const lines: string[] = [
      '<coding_style>',
      'Project coding conventions (auto-detected):',
    ];

    lines.push(`- Quotes: ${profile.quoteStyle} quotes`);
    lines.push(`- Semicolons: ${profile.semicolons ? 'yes' : 'no'}`);
    lines.push(`- Indentation: ${this.formatIndentation(profile.indentation)}`);
    lines.push(`- Imports: ${this.formatImportStyle(profile.importStyle)}`);
    lines.push(`- Naming: ${this.formatNamingConventions(profile.namingConventions)}`);
    lines.push(`- Error handling: ${this.formatErrorHandling(profile.errorHandlingPattern)}`);
    lines.push(`- Testing: ${this.formatTestingPattern(profile.testingPattern)}`);

    lines.push('</coding_style>');
    return lines.join('\n');
  }

  /**
   * Store the profile in enhanced memory.
   */
  async persistToMemory(profile: CodingStyleProfile, projectPath: string): Promise<void> {
    try {
      const { getEnhancedMemory } = await import('./enhanced-memory.js');
      const memory = getEnhancedMemory();
      const snippet = this.buildPromptSnippet(profile);

      await memory.store({
        type: 'pattern',
        content: snippet,
        summary: `Auto-detected coding style for ${path.basename(projectPath)}`,
        importance: 0.8,
        tags: ['coding-style', 'auto-captured'],
        metadata: {
          projectPath,
          profile,
          analyzedAt: new Date().toISOString(),
        },
      });

      logger.debug(`Persisted coding style profile for ${projectPath}`);
    } catch (err) {
      logger.debug(`Failed to persist coding style profile: ${err}`);
    }
  }

  // ============================================================================
  // Detection Methods
  // ============================================================================

  private detectQuoteStyle(content: string): 'single' | 'double' {
    // Remove template literals to avoid counting backtick content
    const noTemplates = content.replace(/`[^`]*`/gs, '');

    const singleCount = (noTemplates.match(/'/g) || []).length;
    const doubleCount = (noTemplates.match(/"/g) || []).length;

    const total = singleCount + doubleCount;
    if (total === 0) return 'single';

    return singleCount / total > 0.7 ? 'single' : 'double';
  }

  private detectSemicolons(lines: string[]): boolean {
    let withSemicolon = 0;
    let withoutSemicolon = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, comments, and non-statement lines
      if (
        !trimmed ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed === '{' ||
        trimmed === '}' ||
        trimmed === ')' ||
        trimmed.startsWith('import ') ||
        trimmed.startsWith('export ') ||
        trimmed.startsWith('if ') ||
        trimmed.startsWith('else') ||
        trimmed.startsWith('for ') ||
        trimmed.startsWith('while ') ||
        trimmed.startsWith('switch ') ||
        trimmed.startsWith('case ') ||
        trimmed.startsWith('default:')
      ) {
        continue;
      }

      if (trimmed.endsWith(';')) {
        withSemicolon++;
      } else if (
        trimmed.length > 3 &&
        !trimmed.endsWith('{') &&
        !trimmed.endsWith('}') &&
        !trimmed.endsWith('(') &&
        !trimmed.endsWith(',') &&
        !trimmed.endsWith(':')
      ) {
        withoutSemicolon++;
      }
    }

    const total = withSemicolon + withoutSemicolon;
    if (total === 0) return true;

    return withSemicolon / total > 0.6;
  }

  private detectIndentation(lines: string[]): '2-spaces' | '4-spaces' | 'tabs' {
    let twoSpaces = 0;
    let fourSpaces = 0;
    let tabs = 0;

    const linesToCheck = lines.slice(0, 50);

    for (const line of linesToCheck) {
      if (!line || line.trim().length === 0) continue;

      const match = line.match(/^(\s+)/);
      if (!match) continue;

      const whitespace = match[1];

      if (whitespace.includes('\t')) {
        tabs++;
      } else {
        const spaceCount = whitespace.length;
        if (spaceCount % 4 === 0 && spaceCount % 2 === 0) {
          // Could be either; check the minimum indent level
          if (spaceCount === 2) {
            twoSpaces++;
          } else if (spaceCount === 4) {
            fourSpaces++;
          } else {
            // For larger indents, check if it divides evenly by 2 but not cleanly by 4
            twoSpaces++;
          }
        } else if (spaceCount % 2 === 0) {
          twoSpaces++;
        } else if (spaceCount % 4 === 0) {
          fourSpaces++;
        }
      }
    }

    if (tabs > twoSpaces && tabs > fourSpaces) return 'tabs';
    if (fourSpaces > twoSpaces) return '4-spaces';
    return '2-spaces';
  }

  private detectImportStyle(content: string): ImportPattern {
    const namedImports = (content.match(/import\s*\{[^}]+\}\s*from/g) || []).length;
    const defaultImports = (content.match(/import\s+[A-Za-z_$][A-Za-z0-9_$]*\s+from/g) || []).length;
    const total = namedImports + defaultImports;

    let style: ImportPattern['style'] = 'mixed';
    if (total > 0) {
      if (namedImports / total > 0.7) {
        style = 'named';
      } else if (defaultImports / total > 0.7) {
        style = 'default';
      }
    }

    const extensionsInImports = /from\s+['"][^'"]+\.js['"]/.test(content);
    const usesBarrelFiles = /from\s+['"][^'"]*\/index['"]/.test(content) ||
      /from\s+['"]\.\/['"]/.test(content);

    return { style, usesBarrelFiles, extensionsInImports };
  }

  private detectErrorHandling(
    content: string
  ): 'try-catch' | 'promise-catch' | 'result-type' | 'mixed' {
    const tryCatch = (content.match(/try\s*\{/g) || []).length;
    const promiseCatch = (content.match(/\.catch\s*\(/g) || []).length;
    const resultType = (content.match(/Result\s*</g) || []).length;

    const total = tryCatch + promiseCatch + resultType;
    if (total === 0) return 'try-catch';

    if (tryCatch / total > 0.6) return 'try-catch';
    if (promiseCatch / total > 0.6) return 'promise-catch';
    if (resultType / total > 0.6) return 'result-type';
    return 'mixed';
  }

  private detectTestingPattern(content: string): 'describe-it' | 'test-only' | 'mixed' {
    const describeCount = (content.match(/describe\s*\(/g) || []).length;
    const standaloneTest = (content.match(/(?<!describe\s*\([^)]*\)\s*,\s*\(\)\s*=>\s*\{[^}]*)test\s*\(/g) || []).length;
    const itCount = (content.match(/\bit\s*\(/g) || []).length;

    if (describeCount > 0 && (itCount > 0 || standaloneTest > 0)) {
      return 'describe-it';
    }
    if (standaloneTest > 0 && describeCount === 0) {
      return 'test-only';
    }
    if (describeCount > 0 && standaloneTest > 0) {
      return 'mixed';
    }
    return 'describe-it';
  }

  private detectNamingConventions(content: string): NamingPattern[] {
    const patterns: NamingPattern[] = [];

    // Variables
    const varNames = this.extractNames(content, /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g);
    const constants = varNames.filter((n) => /^[A-Z][A-Z0-9_]+$/.test(n));
    const regularVars = varNames.filter((n) => !/^[A-Z][A-Z0-9_]+$/.test(n));

    if (regularVars.length > 0) {
      const varConvention = this.classifyNames(regularVars);
      if (varConvention) {
        patterns.push({
          scope: 'variable',
          convention: varConvention.convention,
          confidence: varConvention.confidence,
        });
      }
    }

    if (constants.length > 0) {
      patterns.push({
        scope: 'constant',
        convention: 'SCREAMING_SNAKE',
        confidence: 1.0,
      });
    }

    // Functions
    const funcNames = this.extractNames(
      content,
      /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g
    );
    const arrowFuncNames = this.extractNames(
      content,
      /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\(/g
    );
    const allFuncNames = [...funcNames, ...arrowFuncNames].filter(
      (n) => !/^[A-Z][A-Z0-9_]+$/.test(n)
    );

    if (allFuncNames.length > 0) {
      const funcConvention = this.classifyNames(allFuncNames);
      if (funcConvention) {
        patterns.push({
          scope: 'function',
          convention: funcConvention.convention,
          confidence: funcConvention.confidence,
        });
      }
    }

    // Classes
    const classNames = this.extractNames(content, /class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
    if (classNames.length > 0) {
      const classConvention = this.classifyNames(classNames);
      if (classConvention) {
        patterns.push({
          scope: 'class',
          convention: classConvention.convention,
          confidence: classConvention.confidence,
        });
      }
    }

    return patterns;
  }

  private detectTypeAnnotationDensity(
    content: string
  ): 'minimal' | 'moderate' | 'strict' {
    const declarations = (
      content.match(/(?:const|let|var|function)\s+[a-zA-Z_$]/g) || []
    ).length;
    const annotations = (
      content.match(/:\s*(?:[A-Z][a-zA-Z0-9<>\[\]|&]*|string|number|boolean|void|any|unknown|never)/g) || []
    ).length;

    if (declarations === 0) return 'moderate';

    const ratio = annotations / declarations;
    if (ratio < 0.3) return 'minimal';
    if (ratio < 0.7) return 'moderate';
    return 'strict';
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private extractNames(content: string, regex: RegExp): string[] {
    const names: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match[1]) {
        names.push(match[1]);
      }
    }

    return names;
  }

  private classifyNames(
    names: string[]
  ): { convention: NamingPattern['convention']; confidence: number } | null {
    if (names.length === 0) return null;

    let camelCase = 0;
    let snakeCase = 0;
    let pascalCase = 0;
    let screamingSnake = 0;

    for (const name of names) {
      if (/^[A-Z][A-Z0-9_]+$/.test(name)) {
        screamingSnake++;
      } else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
        pascalCase++;
      } else if (/^[a-z][a-zA-Z0-9]*$/.test(name)) {
        camelCase++;
      } else if (/^[a-z][a-z0-9_]*$/.test(name)) {
        snakeCase++;
      }
    }

    const counts = [
      { convention: 'camelCase' as const, count: camelCase },
      { convention: 'snake_case' as const, count: snakeCase },
      { convention: 'PascalCase' as const, count: pascalCase },
      { convention: 'SCREAMING_SNAKE' as const, count: screamingSnake },
    ];

    counts.sort((a, b) => b.count - a.count);
    const top = counts[0];

    if (top.count === 0) return null;

    return {
      convention: top.convention,
      confidence: Math.round((top.count / names.length) * 100) / 100,
    };
  }

  private findFilesRecursively(dirPath: string, extensions: string[]): string[] {
    const results: string[] = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        // Skip common non-source directories
        if (entry.isDirectory()) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'dist' ||
            entry.name === 'build' ||
            entry.name === 'coverage' ||
            entry.name === '.next'
          ) {
            continue;
          }
          results.push(...this.findFilesRecursively(fullPath, extensions));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch (err) {
      logger.debug(`Failed to read directory: ${dirPath}`);
    }

    return results;
  }

  private formatIndentation(indentation: string): string {
    switch (indentation) {
      case '2-spaces': return '2 spaces';
      case '4-spaces': return '4 spaces';
      case 'tabs': return 'tabs';
      default: return indentation;
    }
  }

  private formatImportStyle(importStyle: ImportPattern): string {
    const parts: string[] = [];
    parts.push(`${importStyle.style} imports`);
    if (importStyle.extensionsInImports) {
      parts.push('with .js extensions');
    }
    if (importStyle.usesBarrelFiles) {
      parts.push('using barrel files');
    }
    return parts.join(' ');
  }

  private formatNamingConventions(patterns: NamingPattern[]): string {
    if (patterns.length === 0) return 'no strong conventions detected';

    const parts: string[] = [];
    for (const p of patterns) {
      parts.push(`${p.convention} for ${p.scope}s`);
    }
    return parts.join(', ');
  }

  private formatErrorHandling(
    pattern: 'try-catch' | 'promise-catch' | 'result-type' | 'mixed'
  ): string {
    switch (pattern) {
      case 'try-catch': return 'try-catch';
      case 'promise-catch': return 'promise .catch()';
      case 'result-type': return 'Result type pattern';
      case 'mixed': return 'mixed patterns';
    }
  }

  private formatTestingPattern(pattern: 'describe-it' | 'test-only' | 'mixed'): string {
    switch (pattern) {
      case 'describe-it': return 'describe/it blocks';
      case 'test-only': return 'standalone test() calls';
      case 'mixed': return 'mixed test styles';
    }
  }

  private mergeProfiles(partials: Partial<CodingStyleProfile>[]): CodingStyleProfile {
    return {
      quoteStyle: this.majorityVote(partials, 'quoteStyle', 'single'),
      semicolons: this.majorityVoteBool(partials, 'semicolons', true),
      indentation: this.majorityVote(partials, 'indentation', '2-spaces'),
      importStyle: this.mergeImportStyles(partials),
      errorHandlingPattern: this.majorityVote(partials, 'errorHandlingPattern', 'try-catch'),
      testingPattern: this.majorityVote(partials, 'testingPattern', 'describe-it'),
      namingConventions: this.mergeNamingConventions(partials),
      typeAnnotationDensity: this.majorityVote(partials, 'typeAnnotationDensity', 'moderate'),
    };
  }

  private majorityVote<K extends keyof CodingStyleProfile>(
    partials: Partial<CodingStyleProfile>[],
    key: K,
    defaultValue: CodingStyleProfile[K]
  ): CodingStyleProfile[K] {
    const counts = new Map<CodingStyleProfile[K], number>();

    for (const p of partials) {
      const val = p[key] as CodingStyleProfile[K] | undefined;
      if (val !== undefined) {
        counts.set(val, (counts.get(val) || 0) + 1);
      }
    }

    if (counts.size === 0) return defaultValue;

    let maxCount = 0;
    let maxVal = defaultValue;
    for (const [val, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        maxVal = val;
      }
    }

    return maxVal;
  }

  private majorityVoteBool(
    partials: Partial<CodingStyleProfile>[],
    key: 'semicolons',
    defaultValue: boolean
  ): boolean {
    let trueCount = 0;
    let falseCount = 0;

    for (const p of partials) {
      if (p[key] !== undefined) {
        if (p[key]) trueCount++;
        else falseCount++;
      }
    }

    if (trueCount + falseCount === 0) return defaultValue;
    return trueCount >= falseCount;
  }

  private mergeImportStyles(partials: Partial<CodingStyleProfile>[]): ImportPattern {
    const styles = partials
      .map((p) => p.importStyle)
      .filter((s): s is ImportPattern => s !== undefined);

    if (styles.length === 0) {
      return { style: 'mixed', usesBarrelFiles: false, extensionsInImports: false };
    }

    const styleCounts = new Map<string, number>();
    let barrelCount = 0;
    let extensionCount = 0;

    for (const s of styles) {
      styleCounts.set(s.style, (styleCounts.get(s.style) || 0) + 1);
      if (s.usesBarrelFiles) barrelCount++;
      if (s.extensionsInImports) extensionCount++;
    }

    let topStyle: ImportPattern['style'] = 'mixed';
    let topCount = 0;
    for (const [style, count] of styleCounts) {
      if (count > topCount) {
        topCount = count;
        topStyle = style as ImportPattern['style'];
      }
    }

    return {
      style: topStyle,
      usesBarrelFiles: barrelCount > styles.length / 2,
      extensionsInImports: extensionCount > styles.length / 2,
    };
  }

  private mergeNamingConventions(partials: Partial<CodingStyleProfile>[]): NamingPattern[] {
    const byScope = new Map<
      NamingPattern['scope'],
      Map<NamingPattern['convention'], number[]>
    >();

    for (const p of partials) {
      if (!p.namingConventions) continue;
      for (const np of p.namingConventions) {
        if (!byScope.has(np.scope)) {
          byScope.set(np.scope, new Map());
        }
        const conventions = byScope.get(np.scope)!;
        if (!conventions.has(np.convention)) {
          conventions.set(np.convention, []);
        }
        conventions.get(np.convention)!.push(np.confidence);
      }
    }

    const result: NamingPattern[] = [];
    for (const [scope, conventions] of byScope) {
      let topConvention: NamingPattern['convention'] = 'camelCase';
      let topCount = 0;
      let topConfidences: number[] = [];

      for (const [convention, confidences] of conventions) {
        if (confidences.length > topCount) {
          topCount = confidences.length;
          topConvention = convention;
          topConfidences = confidences;
        }
      }

      const avgConfidence =
        topConfidences.reduce((a, b) => a + b, 0) / topConfidences.length;

      result.push({
        scope,
        convention: topConvention,
        confidence: Math.round(avgConfidence * 100) / 100,
      });
    }

    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CodingStyleAnalyzer | null = null;

export function getCodingStyleAnalyzer(): CodingStyleAnalyzer {
  if (!instance) instance = new CodingStyleAnalyzer();
  return instance;
}

export function resetCodingStyleAnalyzer(): void {
  instance = null;
}
