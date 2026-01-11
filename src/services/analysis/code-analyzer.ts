/**
 * Code Analyzer Service
 * extracted from src/agent/specialized/code-guardian-agent.ts
 */

import { extname, basename } from 'path';
import {
  FileAnalysis,
  CodeIssue,
  FileDependency,
  IssueSeverity,
} from './types.js';

// ============================================================================ 
// Patterns de sécurité à détecter
// ============================================================================ 

const SECURITY_PATTERNS = {
  hardcodedSecrets: [
    /(?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*['"`][^'"`]{8,}/gi,
    /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g, // AWS Access Key
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub Personal Token
    /sk-[a-zA-Z0-9]{48}/g, // OpenAI API Key
  ],
  dangerousFunctions: [
    /\beval\s*\(/g,
    /\bnew\s+Function\s*\(/g,
    /\.innerHTML\s*=/g,
    /child_process\.exec(?:Sync)?\s*\(/g,
    /\bexec\s*\(/g,
    /document\.write\s*\(/g,
  ],
  sqlInjection: [
    /\.query\s*\(\s*['"`].*\$\{.*\}['"`]\s*\)/g, // Template literal in query
    /\.execute\s*\(\s*['"`].*\$\{.*\}['"`]\s*\)/g,
  ],
};

export class CodeAnalyzer {
  public analyzeFileContent(filePath: string, content: string): FileAnalysis {
    const lines = content.split('\n');
    const language = this.detectLanguage(filePath);
    const dependencies = this.extractDependencies(content, language);
    const exports = this.extractExports(content, language);
    const issues = this.detectIssues(content, filePath, language);

    const analysis: FileAnalysis = {
      path: filePath,
      relativePath: basename(filePath),
      size: content.length,
      lines: lines.length,
      language,
      complexity: this.estimateComplexity(content),
      dependencies,
      exports,
      issues,
      summary: this.generateFileSummary(content, language),
    };

    return analysis;
  }

  public detectLanguage(filePath: string): string {
    const ext = extname(filePath).slice(1).toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript',
      js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
      py: 'python', pyw: 'python',
      java: 'java', kt: 'kotlin', scala: 'scala',
      go: 'go',
      rs: 'rust',
      c: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', h: 'c', hpp: 'cpp',
      cs: 'csharp',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      vue: 'vue', svelte: 'svelte',
      json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
      md: 'markdown', mdx: 'markdown',
      sql: 'sql',
      sh: 'shell', bash: 'shell', zsh: 'shell',
    };
    return languageMap[ext] || 'unknown';
  }

  public extractDependencies(content: string, language: string): FileDependency[] {
    const dependencies: FileDependency[] = [];

    if (['typescript', 'javascript'].includes(language)) {
      // ES imports
      const importRegex = /import\s+(?:type\s+)?(?:{[^}]*}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:{[^}]*}|\w+))?\s*from\s+['"]([^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const path = match[1];
        const isType = match[0].includes('import type');
        dependencies.push({
          path,
          type: isType ? 'type-import' : 'import',
          isExternal: !path.startsWith('.') && !path.startsWith('/'),
        });
      }

      // require()
      const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((match = requireRegex.exec(content)) !== null) {
        dependencies.push({
          path: match[1],
          type: 'require',
          isExternal: !match[1].startsWith('.') && !match[1].startsWith('/'),
        });
      }
    }

    if (language === 'python') {
      const importRegex = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const path = match[1] || match[2];
        dependencies.push({
          path,
          type: 'import',
          isExternal: !path.startsWith('.'),
        });
      }
    }

    return dependencies;
  }

  public extractExports(content: string, language: string): string[] {
    const exports: string[] = [];

    if (['typescript', 'javascript'].includes(language)) {
      // Named exports
      const namedExportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
      let match;
      while ((match = namedExportRegex.exec(content)) !== null) {
        exports.push(match[1]);
      }

      // Export default
      if (/export\s+default/.test(content)) {
        exports.push('default');
      }
    }

    return exports;
  }

  public detectIssues(content: string, filePath: string, language: string): CodeIssue[] {
    const issues: CodeIssue[] = [];
    const lines = content.split('\n');

    // Vérification des patterns de sécurité
    for (const [category, patterns] of Object.entries(SECURITY_PATTERNS)) {
      for (const pattern of patterns) {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(content)) !== null) {
          const lineNumber = content.substring(0, match.index).split('\n').length;
          issues.push({
            type: 'security',
            severity: category === 'hardcodedSecrets' ? 'critical' : 'error',
            file: filePath,
            line: lineNumber,
            message: `Problème de sécurité détecté: ${category}`,
            suggestion: this.getSecuritySuggestion(category),
            code: match[0].substring(0, 50),
          });
        }
      }
    }

    // Détection de code mort (TODO, FIXME non résolus)
    lines.forEach((line, index) => {
      if (/\/\/\s*(TODO|FIXME|HACK|XXX)/i.test(line)) {
        issues.push({
          type: 'maintainability',
          severity: 'warning',
          file: filePath,
          line: index + 1,
          message: 'TODO/FIXME non résolu',
          code: line.trim(),
        });
      }
    });

    // Détection de lignes trop longues
    lines.forEach((line, index) => {
      if (line.length > 120) {
        issues.push({
          type: 'style',
          severity: 'info',
          file: filePath,
          line: index + 1,
          message: `Ligne trop longue (${line.length} caractères)`,
          suggestion: 'Diviser la ligne en plusieurs lignes',
        });
      }
    });

    // Détection de console.log en production
    if (['typescript', 'javascript'].includes(language)) {
      lines.forEach((line, index) => {
        if (/console\.(log|debug|info)\s*\(/.test(line) && !/\/\//.test(line.split('console')[0])) {
          issues.push({
            type: 'maintainability',
            severity: 'warning',
            file: filePath,
            line: index + 1,
            message: 'console.log détecté (à supprimer en production)',
            suggestion: 'Utiliser un système de logging approprié',
            code: line.trim(),
          });
        }
      });
    }

    // Détection de any en TypeScript
    if (language === 'typescript') {
      lines.forEach((line, index) => {
        if (/:\s*any\b/.test(line)) {
          issues.push({
            type: 'maintainability',
            severity: 'warning',
            file: filePath,
            line: index + 1,
            message: 'Type "any" utilisé',
            suggestion: 'Utiliser un type plus spécifique ou "unknown"',
            code: line.trim(),
          });
        }
      });
    }

    return issues;
  }

  private getSecuritySuggestion(category: string): string {
    const suggestions: Record<string, string> = {
      hardcodedSecrets: "Utiliser des variables d'environnement ou un gestionnaire de secrets",
      dangerousFunctions: 'Éviter eval() et les fonctions similaires. Utiliser des alternatives sécurisées',
      sqlInjection: 'Utiliser des requêtes paramétrées ou un ORM',
    };
    return suggestions[category] || 'Consulter les bonnes pratiques de sécurité';
  }

  public estimateComplexity(content: string): number {
    // Estimation simple basée sur les structures de contrôle
    const controlStructures = [
      /\bif\s*\(/g, /\belse\s*{/g, /\belse\s+if/g,
      /\bfor\s*\(/g, /\bwhile\s*\(/g, /\bdo\s*{/g,
      /\bswitch\s*\(/g, /\bcase\s+ /g,
      /\btry\s*{/g, /\bcatch\s*\(/g,
      /\?\s*.*\s*:/g, // Ternary
      /&&|\|\|/g, // Logical operators
    ];

    let complexity = 1;
    for (const pattern of controlStructures) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }
    return complexity;
  }

  private generateFileSummary(content: string, _language: string): string {
    const lines = content.split('\n').length;
    const functions = (content.match(/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(/g) || []).length;
    const classes = (content.match(/class\s+\w+/g) || []).length;
    const interfaces = (content.match(/interface\s+\w+/g) || []).length;

    const parts = [`${lines} lignes`];
    if (functions > 0) parts.push(`${functions} fonction(s)`);
    if (classes > 0) parts.push(`${classes} classe(s)`);
    if (interfaces > 0) parts.push(`${interfaces} interface(s)`);

    return parts.join(', ');
  }
}
