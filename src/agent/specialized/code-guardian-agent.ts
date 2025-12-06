/**
 * Grokinette - Code Guardian Agent
 *
 * Agent spécialisé dans l'analyse de code source, la revue d'architecture,
 * la proposition de correctifs et l'amélioration progressive du projet.
 *
 * Modes de fonctionnement:
 * - ANALYZE_ONLY: Lecture et analyse uniquement
 * - SUGGEST_REFACTOR: Analyse + suggestions de refactoring
 * - PATCH_PLAN: Plan de modifications structurées
 * - PATCH_DIFF: Diffs prêts à appliquer
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { extname, basename, dirname, join, relative } from 'path';
import {
  SpecializedAgent,
  SpecializedAgentConfig,
  AgentTask,
  AgentResult,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

/** Modes de fonctionnement de l'agent */
export type CodeGuardianMode =
  | 'ANALYZE_ONLY'
  | 'SUGGEST_REFACTOR'
  | 'PATCH_PLAN'
  | 'PATCH_DIFF';

/** Niveau de sévérité des problèmes détectés */
export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Type de problème détecté */
export type IssueType =
  | 'security'
  | 'performance'
  | 'maintainability'
  | 'complexity'
  | 'style'
  | 'duplication'
  | 'dead-code'
  | 'dependency'
  | 'architecture'
  | 'documentation';

/** Problème détecté dans le code */
export interface CodeIssue {
  type: IssueType;
  severity: IssueSeverity;
  file: string;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
  code?: string;
}

/** Dépendance d'un fichier */
export interface FileDependency {
  path: string;
  type: 'import' | 'export' | 'require' | 'type-import';
  isExternal: boolean;
}

/** Analyse d'un fichier */
export interface FileAnalysis {
  path: string;
  relativePath: string;
  size: number;
  lines: number;
  language: string;
  complexity?: number;
  dependencies: FileDependency[];
  exports: string[];
  issues: CodeIssue[];
  summary: string;
}

/** Analyse complète du projet/module */
export interface CodeAnalysis {
  rootDir: string;
  timestamp: Date;
  mode: CodeGuardianMode;
  files: FileAnalysis[];
  totalFiles: number;
  totalLines: number;
  issuesByType: Record<IssueType, number>;
  issuesBySeverity: Record<IssueSeverity, number>;
  architectureSummary: string;
  recommendations: string[];
  dependencyGraph?: Map<string, string[]>;
}

/** Suggestion de refactoring */
export interface RefactorSuggestion {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  affectedFiles: string[];
  estimatedImpact: string;
  risks: string[];
  testSuggestions: string[];
  pseudoCode?: string;
}

/** Étape d'un plan de modification */
export interface PatchStep {
  order: number;
  file: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  type: 'bugfix' | 'refactor' | 'feature' | 'doc' | 'test' | 'config';
  description: string;
  dependencies: number[]; // References to other steps
  rollbackStrategy: string;
}

/** Plan de modifications */
export interface PatchPlan {
  id: string;
  title: string;
  description: string;
  steps: PatchStep[];
  totalFiles: number;
  estimatedRisk: 'low' | 'medium' | 'high';
  testPlan: string[];
  rollbackPlan: string;
}

/** Diff d'une modification */
export interface PatchDiff {
  file: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  oldPath?: string;
  hunks: Array<{
    startLine: number;
    endLine: number;
    oldContent: string;
    newContent: string;
    context: string;
  }>;
  explanation: string;
  warnings: string[];
}

// ============================================================================
// Configuration
// ============================================================================

const CODE_GUARDIAN_CONFIG: SpecializedAgentConfig = {
  id: 'code-guardian',
  name: 'Grokinette - Code Guardian',
  description: 'Agent spécialisé dans l\'analyse de code, revue d\'architecture et amélioration progressive',
  capabilities: ['code-analyze', 'code-review', 'code-refactor', 'code-security'],
  fileExtensions: [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'pyw',
    'java', 'kt', 'scala',
    'go',
    'rs',
    'c', 'cpp', 'cc', 'cxx', 'h', 'hpp',
    'cs',
    'rb',
    'php',
    'swift',
    'vue', 'svelte',
    'json', 'yaml', 'yml', 'toml',
    'md', 'mdx',
    'sql',
    'sh', 'bash', 'zsh',
  ],
  maxFileSize: 10 * 1024 * 1024, // 10MB per file
  requiredTools: [],
  options: {
    defaultMode: 'ANALYZE_ONLY' as CodeGuardianMode,
  },
};

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
    /\+\s*['"`].*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi,
    /\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/gi,
  ],
};

// ============================================================================
// Code Guardian Agent Implementation
// ============================================================================

export class CodeGuardianAgent extends SpecializedAgent {
  private currentMode: CodeGuardianMode = 'ANALYZE_ONLY';
  private analysisCache: Map<string, FileAnalysis> = new Map();

  constructor() {
    super(CODE_GUARDIAN_CONFIG);
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Définir le mode de fonctionnement
   */
  setMode(mode: CodeGuardianMode): void {
    this.currentMode = mode;
    this.emit('mode:changed', mode);
  }

  /**
   * Obtenir le mode actuel
   */
  getMode(): CodeGuardianMode {
    return this.currentMode;
  }

  getSupportedActions(): string[] {
    return [
      'analyze',
      'analyze-file',
      'analyze-directory',
      'suggest-refactor',
      'create-patch-plan',
      'create-patch-diff',
      'find-issues',
      'check-security',
      'map-dependencies',
      'explain-code',
      'review-architecture',
    ];
  }

  getActionHelp(action: string): string {
    const help: Record<string, string> = {
      'analyze': 'Analyse complète d\'un fichier ou répertoire selon le mode actuel',
      'analyze-file': 'Analyse détaillée d\'un fichier spécifique',
      'analyze-directory': 'Analyse récursive d\'un répertoire',
      'suggest-refactor': 'Propose des suggestions de refactoring',
      'create-patch-plan': 'Crée un plan structuré de modifications',
      'create-patch-diff': 'Génère des diffs prêts à appliquer',
      'find-issues': 'Recherche les problèmes potentiels dans le code',
      'check-security': 'Vérifie les problèmes de sécurité',
      'map-dependencies': 'Cartographie les dépendances entre fichiers',
      'explain-code': 'Explique le fonctionnement du code',
      'review-architecture': 'Revue de l\'architecture du projet',
    };
    return help[action] || `Action inconnue: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Définir le mode si spécifié
      if (task.params?.mode) {
        this.setMode(task.params.mode as CodeGuardianMode);
      }

      switch (task.action) {
        case 'analyze':
        case 'analyze-file':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun fichier spécifié' };
          }
          return await this.analyzeFile(task.inputFiles[0], startTime);

        case 'analyze-directory':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun répertoire spécifié' };
          }
          return await this.analyzeDirectory(task.inputFiles[0], task.params, startTime);

        case 'suggest-refactor':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun fichier spécifié' };
          }
          return await this.suggestRefactor(task.inputFiles, task.params, startTime);

        case 'create-patch-plan':
          if (!task.params?.issues) {
            return { success: false, error: 'Aucun problème spécifié pour le plan' };
          }
          return this.createPatchPlan(task.params.issues as CodeIssue[], task.params, startTime);

        case 'create-patch-diff':
          if (!task.params?.plan) {
            return { success: false, error: 'Aucun plan spécifié pour les diffs' };
          }
          return this.createPatchDiff(task.params.plan as PatchPlan, startTime);

        case 'find-issues':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun fichier spécifié' };
          }
          return await this.findIssues(task.inputFiles, task.params, startTime);

        case 'check-security':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun fichier spécifié' };
          }
          return await this.checkSecurity(task.inputFiles, startTime);

        case 'map-dependencies':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun fichier spécifié' };
          }
          return await this.mapDependencies(task.inputFiles[0], startTime);

        case 'explain-code':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun fichier spécifié' };
          }
          return await this.explainCode(task.inputFiles[0], task.params, startTime);

        case 'review-architecture':
          if (!task.inputFiles || task.inputFiles.length === 0) {
            return { success: false, error: 'Aucun répertoire spécifié' };
          }
          return await this.reviewArchitecture(task.inputFiles[0], startTime);

        default:
          return { success: false, error: `Action inconnue: ${task.action}` };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Erreur Code Guardian: ${errorMessage}`,
        duration: Date.now() - startTime,
      };
    }
  }

  // ============================================================================
  // Analyse de fichier
  // ============================================================================

  private async analyzeFile(filePath: string, startTime: number): Promise<AgentResult> {
    if (!existsSync(filePath)) {
      return { success: false, error: `Fichier non trouvé: ${filePath}` };
    }

    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      return this.analyzeDirectory(filePath, {}, startTime);
    }

    const content = readFileSync(filePath, 'utf-8');
    const analysis = this.analyzeFileContent(filePath, content);

    const output = this.formatFileAnalysis(analysis);

    return {
      success: true,
      data: analysis,
      output,
      duration: Date.now() - startTime,
      metadata: {
        mode: this.currentMode,
        file: filePath,
      },
    };
  }

  private analyzeFileContent(filePath: string, content: string): FileAnalysis {
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

    this.analysisCache.set(filePath, analysis);
    return analysis;
  }

  private detectLanguage(filePath: string): string {
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

  private extractDependencies(content: string, language: string): FileDependency[] {
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

  private extractExports(content: string, language: string): string[] {
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

  private detectIssues(content: string, filePath: string, language: string): CodeIssue[] {
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
      hardcodedSecrets: 'Utiliser des variables d\'environnement ou un gestionnaire de secrets',
      dangerousFunctions: 'Éviter eval() et les fonctions similaires. Utiliser des alternatives sécurisées',
      sqlInjection: 'Utiliser des requêtes paramétrées ou un ORM',
    };
    return suggestions[category] || 'Consulter les bonnes pratiques de sécurité';
  }

  private estimateComplexity(content: string): number {
    // Estimation simple basée sur les structures de contrôle
    const controlStructures = [
      /\bif\s*\(/g, /\belse\s*{/g, /\belse\s+if/g,
      /\bfor\s*\(/g, /\bwhile\s*\(/g, /\bdo\s*{/g,
      /\bswitch\s*\(/g, /\bcase\s+/g,
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

  private generateFileSummary(content: string, language: string): string {
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

  private formatFileAnalysis(analysis: FileAnalysis): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║  📊 ANALYSE DE CODE - Grokinette Code Guardian               ║',
      '╠══════════════════════════════════════════════════════════════╣',
      '',
      `📁 Fichier: ${analysis.path}`,
      `📝 Langage: ${analysis.language}`,
      `📏 Lignes: ${analysis.lines} | Taille: ${this.formatSize(analysis.size)}`,
      `🔄 Complexité estimée: ${analysis.complexity}`,
      '',
      '── Résumé ──────────────────────────────────────────────────────',
      analysis.summary,
      '',
    ];

    if (analysis.dependencies.length > 0) {
      lines.push('── Dépendances ─────────────────────────────────────────────────');
      const internal = analysis.dependencies.filter(d => !d.isExternal);
      const external = analysis.dependencies.filter(d => d.isExternal);
      if (internal.length > 0) {
        lines.push(`  Internes (${internal.length}):`);
        internal.slice(0, 10).forEach(d => lines.push(`    → ${d.path}`));
        if (internal.length > 10) lines.push(`    ... et ${internal.length - 10} autres`);
      }
      if (external.length > 0) {
        lines.push(`  Externes (${external.length}):`);
        external.slice(0, 10).forEach(d => lines.push(`    📦 ${d.path}`));
        if (external.length > 10) lines.push(`    ... et ${external.length - 10} autres`);
      }
      lines.push('');
    }

    if (analysis.exports.length > 0) {
      lines.push('── Exports ─────────────────────────────────────────────────────');
      lines.push(`  ${analysis.exports.join(', ')}`);
      lines.push('');
    }

    if (analysis.issues.length > 0) {
      lines.push('── Problèmes détectés ──────────────────────────────────────────');
      const grouped = this.groupIssuesBySeverity(analysis.issues);
      for (const [severity, issues] of Object.entries(grouped)) {
        const icon = this.getSeverityIcon(severity as IssueSeverity);
        lines.push(`${icon} ${severity.toUpperCase()} (${issues.length}):`);
        issues.slice(0, 5).forEach(issue => {
          lines.push(`    L${issue.line || '?'}: ${issue.message}`);
          if (issue.suggestion) {
            lines.push(`       💡 ${issue.suggestion}`);
          }
        });
        if (issues.length > 5) {
          lines.push(`    ... et ${issues.length - 5} autres`);
        }
      }
    } else {
      lines.push('✅ Aucun problème détecté');
    }

    lines.push('');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    return lines.join('\n');
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private getSeverityIcon(severity: IssueSeverity): string {
    const icons: Record<IssueSeverity, string> = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      critical: '🚨',
    };
    return icons[severity];
  }

  private groupIssuesBySeverity(issues: CodeIssue[]): Record<string, CodeIssue[]> {
    return issues.reduce((acc, issue) => {
      if (!acc[issue.severity]) acc[issue.severity] = [];
      acc[issue.severity].push(issue);
      return acc;
    }, {} as Record<string, CodeIssue[]>);
  }

  // ============================================================================
  // Analyse de répertoire
  // ============================================================================

  private async analyzeDirectory(
    dirPath: string,
    params: Record<string, unknown> | undefined,
    startTime: number
  ): Promise<AgentResult> {
    if (!existsSync(dirPath)) {
      return { success: false, error: `Répertoire non trouvé: ${dirPath}` };
    }

    const maxDepth = (params?.maxDepth as number) || 5;
    const ignorePatterns = (params?.ignore as string[]) || ['node_modules', '.git', 'dist', 'build'];

    const files = this.collectFiles(dirPath, maxDepth, ignorePatterns);
    const analyses: FileAnalysis[] = [];
    const issuesByType: Record<IssueType, number> = {} as Record<IssueType, number>;
    const issuesBySeverity: Record<IssueSeverity, number> = {} as Record<IssueSeverity, number>;

    let totalLines = 0;

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const analysis = this.analyzeFileContent(file, content);
        analysis.relativePath = relative(dirPath, file);
        analyses.push(analysis);
        totalLines += analysis.lines;

        // Comptabiliser les problèmes
        for (const issue of analysis.issues) {
          issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
          issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
        }
      } catch {
        // Ignorer les fichiers illisibles
      }
    }

    const codeAnalysis: CodeAnalysis = {
      rootDir: dirPath,
      timestamp: new Date(),
      mode: this.currentMode,
      files: analyses,
      totalFiles: analyses.length,
      totalLines,
      issuesByType,
      issuesBySeverity,
      architectureSummary: this.generateArchitectureSummary(analyses),
      recommendations: this.generateRecommendations(analyses),
    };

    const output = this.formatCodeAnalysis(codeAnalysis);

    return {
      success: true,
      data: codeAnalysis,
      output,
      duration: Date.now() - startTime,
      metadata: {
        mode: this.currentMode,
        directory: dirPath,
        fileCount: analyses.length,
      },
    };
  }

  private collectFiles(dir: string, maxDepth: number, ignorePatterns: string[], depth = 0): string[] {
    if (depth >= maxDepth) return [];

    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Ignorer les patterns
      if (ignorePatterns.some(p => entry.name === p || entry.name.startsWith(p))) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push(...this.collectFiles(fullPath, maxDepth, ignorePatterns, depth + 1));
      } else if (entry.isFile()) {
        const ext = extname(entry.name).slice(1).toLowerCase();
        if (this.config.fileExtensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  private generateArchitectureSummary(analyses: FileAnalysis[]): string {
    const byLanguage = new Map<string, number>();
    const byDirectory = new Map<string, number>();

    for (const analysis of analyses) {
      byLanguage.set(analysis.language, (byLanguage.get(analysis.language) || 0) + 1);
      const dir = dirname(analysis.relativePath);
      byDirectory.set(dir, (byDirectory.get(dir) || 0) + 1);
    }

    const topLanguages = [...byLanguage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => `${lang} (${count})`)
      .join(', ');

    const topDirs = [...byDirectory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dir, count]) => `${dir || '.'} (${count})`)
      .join(', ');

    return `Langages: ${topLanguages}\nRépertoires principaux: ${topDirs}`;
  }

  private generateRecommendations(analyses: FileAnalysis[]): string[] {
    const recommendations: string[] = [];
    const totalIssues = analyses.reduce((sum, a) => sum + a.issues.length, 0);
    const criticalIssues = analyses.reduce(
      (sum, a) => sum + a.issues.filter(i => i.severity === 'critical').length,
      0
    );
    const securityIssues = analyses.reduce(
      (sum, a) => sum + a.issues.filter(i => i.type === 'security').length,
      0
    );

    if (criticalIssues > 0) {
      recommendations.push(`🚨 ${criticalIssues} problème(s) critique(s) à résoudre en priorité`);
    }

    if (securityIssues > 0) {
      recommendations.push(`🔒 ${securityIssues} problème(s) de sécurité détecté(s)`);
    }

    if (totalIssues > 50) {
      recommendations.push(`📊 ${totalIssues} problèmes détectés - considérer une session de refactoring`);
    }

    const complexFiles = analyses.filter(a => (a.complexity || 0) > 20);
    if (complexFiles.length > 0) {
      recommendations.push(`🔄 ${complexFiles.length} fichier(s) avec complexité élevée à simplifier`);
    }

    const longFiles = analyses.filter(a => a.lines > 500);
    if (longFiles.length > 0) {
      recommendations.push(`📄 ${longFiles.length} fichier(s) de plus de 500 lignes à diviser`);
    }

    return recommendations;
  }

  private formatCodeAnalysis(analysis: CodeAnalysis): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════════╗',
      '║  🛡️ ANALYSE DE PROJET - Grokinette Code Guardian                 ║',
      '╠══════════════════════════════════════════════════════════════════╣',
      '',
      `📁 Répertoire: ${analysis.rootDir}`,
      `📅 Date: ${analysis.timestamp.toISOString()}`,
      `🔧 Mode: ${analysis.mode}`,
      '',
      `📊 Statistiques:`,
      `   Fichiers analysés: ${analysis.totalFiles}`,
      `   Lignes totales: ${analysis.totalLines.toLocaleString()}`,
      '',
    ];

    // Problèmes par sévérité
    const severityOrder: IssueSeverity[] = ['critical', 'error', 'warning', 'info'];
    const hasIssues = Object.values(analysis.issuesBySeverity).some(v => v > 0);

    if (hasIssues) {
      lines.push('── Problèmes par sévérité ──────────────────────────────────────');
      for (const severity of severityOrder) {
        const count = analysis.issuesBySeverity[severity] || 0;
        if (count > 0) {
          lines.push(`   ${this.getSeverityIcon(severity)} ${severity}: ${count}`);
        }
      }
      lines.push('');
    }

    // Architecture
    lines.push('── Architecture ────────────────────────────────────────────────');
    lines.push(analysis.architectureSummary);
    lines.push('');

    // Recommandations
    if (analysis.recommendations.length > 0) {
      lines.push('── Recommandations ─────────────────────────────────────────────');
      analysis.recommendations.forEach(r => lines.push(`   ${r}`));
      lines.push('');
    }

    // Top fichiers problématiques
    const problematicFiles = [...analysis.files]
      .sort((a, b) => b.issues.length - a.issues.length)
      .slice(0, 5)
      .filter(f => f.issues.length > 0);

    if (problematicFiles.length > 0) {
      lines.push('── Top fichiers à revoir ───────────────────────────────────────');
      problematicFiles.forEach(f => {
        lines.push(`   📄 ${f.relativePath} (${f.issues.length} problèmes)`);
      });
      lines.push('');
    }

    lines.push('╚══════════════════════════════════════════════════════════════════╝');
    return lines.join('\n');
  }

  // ============================================================================
  // Suggestions de refactoring
  // ============================================================================

  private async suggestRefactor(
    inputFiles: string[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): Promise<AgentResult> {
    if (this.currentMode === 'ANALYZE_ONLY') {
      return {
        success: false,
        error: 'Mode ANALYZE_ONLY actif. Changez le mode pour SUGGEST_REFACTOR ou supérieur.',
      };
    }

    const suggestions: RefactorSuggestion[] = [];

    for (const filePath of inputFiles) {
      const analysis = this.analysisCache.get(filePath) ||
        this.analyzeFileContent(filePath, readFileSync(filePath, 'utf-8'));

      // Générer des suggestions basées sur l'analyse
      if (analysis.issues.length > 0) {
        suggestions.push({
          id: `refactor-${basename(filePath)}-issues`,
          title: `Résoudre les problèmes dans ${basename(filePath)}`,
          description: `${analysis.issues.length} problème(s) détecté(s)`,
          priority: analysis.issues.some(i => i.severity === 'critical') ? 'critical' : 'medium',
          affectedFiles: [filePath],
          estimatedImpact: 'Amélioration de la qualité et maintenabilité',
          risks: ['Tests à exécuter après modification'],
          testSuggestions: ['Exécuter les tests unitaires', 'Vérifier le comportement manuellement'],
        });
      }

      if ((analysis.complexity || 0) > 15) {
        suggestions.push({
          id: `refactor-${basename(filePath)}-complexity`,
          title: `Simplifier ${basename(filePath)}`,
          description: `Complexité cyclomatique élevée (${analysis.complexity})`,
          priority: 'medium',
          affectedFiles: [filePath],
          estimatedImpact: 'Code plus lisible et testable',
          risks: ['Changement de comportement possible'],
          testSuggestions: ['Ajouter des tests avant refactoring', 'Comparer les sorties avant/après'],
          pseudoCode: 'Extraire les fonctions longues en sous-fonctions\nSimplifier les conditions imbriquées',
        });
      }

      if (analysis.lines > 300) {
        suggestions.push({
          id: `refactor-${basename(filePath)}-split`,
          title: `Diviser ${basename(filePath)}`,
          description: `Fichier trop long (${analysis.lines} lignes)`,
          priority: 'low',
          affectedFiles: [filePath],
          estimatedImpact: 'Meilleure organisation du code',
          risks: ['Mise à jour des imports nécessaire'],
          testSuggestions: ['Vérifier que tous les imports sont mis à jour'],
        });
      }
    }

    const output = this.formatRefactorSuggestions(suggestions);

    return {
      success: true,
      data: { suggestions },
      output,
      duration: Date.now() - startTime,
      metadata: {
        mode: this.currentMode,
        suggestionCount: suggestions.length,
      },
    };
  }

  private formatRefactorSuggestions(suggestions: RefactorSuggestion[]): string {
    if (suggestions.length === 0) {
      return '✅ Aucune suggestion de refactoring majeure';
    }

    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║  💡 SUGGESTIONS DE REFACTORING                               ║',
      '╠══════════════════════════════════════════════════════════════╣',
      '',
    ];

    const priorityOrder = ['critical', 'high', 'medium', 'low'];
    const sorted = [...suggestions].sort((a, b) =>
      priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority)
    );

    for (const suggestion of sorted) {
      const priorityIcon = {
        critical: '🚨',
        high: '🔴',
        medium: '🟡',
        low: '🟢',
      }[suggestion.priority];

      lines.push(`${priorityIcon} ${suggestion.title}`);
      lines.push(`   ${suggestion.description}`);
      lines.push(`   📁 Fichiers: ${suggestion.affectedFiles.join(', ')}`);
      lines.push(`   📈 Impact: ${suggestion.estimatedImpact}`);
      if (suggestion.risks.length > 0) {
        lines.push(`   ⚠️ Risques: ${suggestion.risks.join(', ')}`);
      }
      if (suggestion.pseudoCode) {
        lines.push('   📝 Approche suggérée:');
        suggestion.pseudoCode.split('\n').forEach(l => lines.push(`      ${l}`));
      }
      lines.push('');
    }

    lines.push('╚══════════════════════════════════════════════════════════════╝');
    return lines.join('\n');
  }

  // ============================================================================
  // Plan de patch
  // ============================================================================

  private createPatchPlan(
    issues: CodeIssue[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): AgentResult {
    if (this.currentMode !== 'PATCH_PLAN' && this.currentMode !== 'PATCH_DIFF') {
      return {
        success: false,
        error: 'Mode insuffisant. Utilisez PATCH_PLAN ou PATCH_DIFF.',
      };
    }

    // Grouper les issues par fichier
    const byFile = new Map<string, CodeIssue[]>();
    for (const issue of issues) {
      const existing = byFile.get(issue.file) || [];
      existing.push(issue);
      byFile.set(issue.file, existing);
    }

    const steps: PatchStep[] = [];
    let order = 1;

    // Traiter d'abord les problèmes critiques/sécurité
    const criticalIssues = issues.filter(i => i.severity === 'critical' || i.type === 'security');
    for (const issue of criticalIssues) {
      steps.push({
        order: order++,
        file: issue.file,
        action: 'modify',
        type: 'bugfix',
        description: `[CRITIQUE] ${issue.message}`,
        dependencies: [],
        rollbackStrategy: `git checkout ${issue.file}`,
      });
    }

    // Puis les autres problèmes
    const otherIssues = issues.filter(i => i.severity !== 'critical' && i.type !== 'security');
    for (const issue of otherIssues) {
      steps.push({
        order: order++,
        file: issue.file,
        action: 'modify',
        type: issue.type === 'maintainability' ? 'refactor' : 'bugfix',
        description: issue.message,
        dependencies: [],
        rollbackStrategy: `git checkout ${issue.file}`,
      });
    }

    const plan: PatchPlan = {
      id: `plan-${Date.now()}`,
      title: 'Plan de correction',
      description: `Plan pour résoudre ${issues.length} problème(s) dans ${byFile.size} fichier(s)`,
      steps,
      totalFiles: byFile.size,
      estimatedRisk: criticalIssues.length > 0 ? 'high' : 'medium',
      testPlan: [
        'Exécuter la suite de tests complète',
        'Vérifier la compilation TypeScript',
        'Tester manuellement les fonctionnalités impactées',
      ],
      rollbackPlan: 'git stash push -m "backup avant patch" && git checkout .',
    };

    const output = this.formatPatchPlan(plan);

    return {
      success: true,
      data: { plan },
      output,
      duration: Date.now() - startTime,
      metadata: {
        mode: this.currentMode,
        stepCount: steps.length,
      },
    };
  }

  private formatPatchPlan(plan: PatchPlan): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║  📋 PLAN DE MODIFICATIONS                                    ║',
      '╠══════════════════════════════════════════════════════════════╣',
      '',
      `📌 ${plan.title}`,
      `📝 ${plan.description}`,
      `⚠️ Risque estimé: ${plan.estimatedRisk.toUpperCase()}`,
      '',
      '── Étapes ──────────────────────────────────────────────────────',
    ];

    for (const step of plan.steps) {
      const actionIcon = {
        create: '➕',
        modify: '✏️',
        delete: '🗑️',
        rename: '📛',
      }[step.action];
      lines.push(`${step.order}. ${actionIcon} [${step.type}] ${step.file}`);
      lines.push(`   ${step.description}`);
    }

    lines.push('');
    lines.push('── Plan de test ────────────────────────────────────────────────');
    plan.testPlan.forEach((t, i) => lines.push(`${i + 1}. ${t}`));

    lines.push('');
    lines.push('── Rollback ────────────────────────────────────────────────────');
    lines.push(`   ${plan.rollbackPlan}`);

    lines.push('');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    return lines.join('\n');
  }

  // ============================================================================
  // Génération de diffs
  // ============================================================================

  private createPatchDiff(plan: PatchPlan, startTime: number): AgentResult {
    if (this.currentMode !== 'PATCH_DIFF') {
      return {
        success: false,
        error: 'Mode insuffisant. Utilisez PATCH_DIFF.',
      };
    }

    // Note: Dans une vraie implémentation, ceci générerait des diffs réels
    // Pour l'instant, on génère un placeholder structuré
    const diffs: PatchDiff[] = plan.steps.map(step => ({
      file: step.file,
      action: step.action,
      hunks: [],
      explanation: `Modification pour: ${step.description}`,
      warnings: step.type === 'bugfix' ?
        ['Vérifier que le comportement attendu est préservé'] :
        [],
    }));

    const output = this.formatPatchDiffs(diffs, plan);

    return {
      success: true,
      data: { diffs, plan },
      output,
      duration: Date.now() - startTime,
      metadata: {
        mode: this.currentMode,
        diffCount: diffs.length,
      },
    };
  }

  private formatPatchDiffs(diffs: PatchDiff[], plan: PatchPlan): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║  📝 DIFFS PROPOSÉS                                           ║',
      '╠══════════════════════════════════════════════════════════════╣',
      '',
      `⚠️ ATTENTION: Les modifications ci-dessous nécessitent validation humaine`,
      '',
    ];

    for (const diff of diffs) {
      const actionIcon = {
        create: '➕ CREATE',
        modify: '✏️ MODIFY',
        delete: '🗑️ DELETE',
        rename: '📛 RENAME',
      }[diff.action];

      lines.push(`─── ${actionIcon}: ${diff.file} ───────────────────────────────`);
      lines.push(`📖 ${diff.explanation}`);

      if (diff.warnings.length > 0) {
        diff.warnings.forEach(w => lines.push(`⚠️ ${w}`));
      }

      lines.push('');
    }

    lines.push('── Instructions d\'application ──────────────────────────────────');
    lines.push('1. Vérifier chaque diff avant application');
    lines.push('2. Créer un commit de backup ou utiliser git stash');
    lines.push('3. Appliquer les modifications une par une');
    lines.push('4. Exécuter les tests après chaque modification');
    lines.push(`5. En cas de problème: ${plan.rollbackPlan}`);

    lines.push('');
    lines.push('╚══════════════════════════════════════════════════════════════╝');
    return lines.join('\n');
  }

  // ============================================================================
  // Autres actions
  // ============================================================================

  private async findIssues(
    inputFiles: string[],
    params: Record<string, unknown> | undefined,
    startTime: number
  ): Promise<AgentResult> {
    const allIssues: CodeIssue[] = [];
    const filterType = params?.type as IssueType | undefined;
    const filterSeverity = params?.severity as IssueSeverity | undefined;

    for (const filePath of inputFiles) {
      if (!existsSync(filePath)) continue;

      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        const files = this.collectFiles(filePath, 5, ['node_modules', '.git', 'dist']);
        for (const file of files) {
          const content = readFileSync(file, 'utf-8');
          const analysis = this.analyzeFileContent(file, content);
          allIssues.push(...analysis.issues);
        }
      } else {
        const content = readFileSync(filePath, 'utf-8');
        const analysis = this.analyzeFileContent(filePath, content);
        allIssues.push(...analysis.issues);
      }
    }

    let filteredIssues = allIssues;
    if (filterType) {
      filteredIssues = filteredIssues.filter(i => i.type === filterType);
    }
    if (filterSeverity) {
      filteredIssues = filteredIssues.filter(i => i.severity === filterSeverity);
    }

    const output = this.formatIssuesList(filteredIssues);

    return {
      success: true,
      data: { issues: filteredIssues, total: filteredIssues.length },
      output,
      duration: Date.now() - startTime,
    };
  }

  private formatIssuesList(issues: CodeIssue[]): string {
    if (issues.length === 0) {
      return '✅ Aucun problème trouvé';
    }

    const lines: string[] = [
      `🔍 ${issues.length} problème(s) trouvé(s)`,
      '',
    ];

    // Grouper par fichier
    const byFile = new Map<string, CodeIssue[]>();
    for (const issue of issues) {
      const existing = byFile.get(issue.file) || [];
      existing.push(issue);
      byFile.set(issue.file, existing);
    }

    for (const [file, fileIssues] of byFile) {
      lines.push(`📄 ${file} (${fileIssues.length})`);
      for (const issue of fileIssues) {
        const icon = this.getSeverityIcon(issue.severity);
        lines.push(`   ${icon} L${issue.line || '?'}: [${issue.type}] ${issue.message}`);
      }
    }

    return lines.join('\n');
  }

  private async checkSecurity(inputFiles: string[], startTime: number): Promise<AgentResult> {
    const result = await this.findIssues(inputFiles, { type: 'security' }, startTime);

    if (result.success) {
      const issues = (result.data as { issues: CodeIssue[] }).issues;
      if (issues.length === 0) {
        result.output = '🔒 Aucun problème de sécurité détecté';
      } else {
        result.output = `🔒 ALERTE SÉCURITÉ: ${issues.length} problème(s) détecté(s)\n\n${result.output}`;
      }
    }

    return result;
  }

  private async mapDependencies(dirPath: string, startTime: number): Promise<AgentResult> {
    const dependencyGraph = new Map<string, string[]>();
    const files = this.collectFiles(dirPath, 5, ['node_modules', '.git', 'dist']);

    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const analysis = this.analyzeFileContent(file, content);
      const relativePath = relative(dirPath, file);

      const deps = analysis.dependencies
        .filter(d => !d.isExternal)
        .map(d => d.path);

      dependencyGraph.set(relativePath, deps);
    }

    const output = this.formatDependencyGraph(dependencyGraph);

    return {
      success: true,
      data: { graph: Object.fromEntries(dependencyGraph) },
      output,
      duration: Date.now() - startTime,
    };
  }

  private formatDependencyGraph(graph: Map<string, string[]>): string {
    const lines: string[] = [
      '🗺️ CARTE DES DÉPENDANCES',
      '',
    ];

    for (const [file, deps] of graph) {
      if (deps.length > 0) {
        lines.push(`📄 ${file}`);
        deps.forEach(d => lines.push(`   → ${d}`));
      }
    }

    if (lines.length === 2) {
      lines.push('Aucune dépendance interne détectée');
    }

    return lines.join('\n');
  }

  private async explainCode(
    filePath: string,
    params: Record<string, unknown> | undefined,
    startTime: number
  ): Promise<AgentResult> {
    if (!existsSync(filePath)) {
      return { success: false, error: `Fichier non trouvé: ${filePath}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    const analysis = this.analyzeFileContent(filePath, content);

    const lines: string[] = [
      '📖 EXPLICATION DU CODE',
      '',
      `📄 Fichier: ${filePath}`,
      `📝 Langage: ${analysis.language}`,
      '',
      '── Ce que fait ce fichier ──────────────────────────────────────',
      analysis.summary,
      '',
    ];

    if (analysis.exports.length > 0) {
      lines.push('── Éléments exportés ───────────────────────────────────────────');
      lines.push(`Ce fichier exporte: ${analysis.exports.join(', ')}`);
      lines.push('');
    }

    if (analysis.dependencies.length > 0) {
      const internal = analysis.dependencies.filter(d => !d.isExternal);
      const external = analysis.dependencies.filter(d => d.isExternal);

      lines.push('── Dépendances ─────────────────────────────────────────────────');
      if (external.length > 0) {
        lines.push(`Modules externes: ${external.map(d => d.path).join(', ')}`);
      }
      if (internal.length > 0) {
        lines.push(`Modules internes: ${internal.map(d => d.path).join(', ')}`);
      }
      lines.push('');
    }

    if (analysis.issues.length > 0) {
      lines.push('── Points d\'attention ──────────────────────────────────────────');
      analysis.issues.slice(0, 5).forEach(i => {
        lines.push(`${this.getSeverityIcon(i.severity)} ${i.message}`);
      });
    }

    return {
      success: true,
      data: { analysis },
      output: lines.join('\n'),
      duration: Date.now() - startTime,
    };
  }

  private async reviewArchitecture(dirPath: string, startTime: number): Promise<AgentResult> {
    const analysisResult = await this.analyzeDirectory(dirPath, {}, Date.now());

    if (!analysisResult.success) {
      return analysisResult;
    }

    const analysis = analysisResult.data as CodeAnalysis;

    const lines: string[] = [
      '🏗️ REVUE D\'ARCHITECTURE',
      '',
      `📁 Projet: ${dirPath}`,
      '',
      '── Vue d\'ensemble ──────────────────────────────────────────────',
      `Fichiers: ${analysis.totalFiles}`,
      `Lignes de code: ${analysis.totalLines.toLocaleString()}`,
      '',
      analysis.architectureSummary,
      '',
    ];

    // Analyse des couches
    const layers = this.detectArchitecturalLayers(analysis.files);
    if (layers.length > 0) {
      lines.push('── Couches détectées ───────────────────────────────────────────');
      layers.forEach(l => lines.push(`   ${l.icon} ${l.name}: ${l.files} fichier(s)`));
      lines.push('');
    }

    // Recommandations architecturales
    lines.push('── Recommandations ─────────────────────────────────────────────');
    analysis.recommendations.forEach(r => lines.push(`   ${r}`));

    return {
      success: true,
      data: { analysis, layers },
      output: lines.join('\n'),
      duration: Date.now() - startTime,
    };
  }

  private detectArchitecturalLayers(files: FileAnalysis[]): Array<{ name: string; icon: string; files: number }> {
    const layers: Array<{ name: string; icon: string; pattern: RegExp; files: number }> = [
      { name: 'UI/Components', icon: '🎨', pattern: /(?:ui|component|view|page)/i, files: 0 },
      { name: 'API/Routes', icon: '🔌', pattern: /(?:api|route|controller|endpoint)/i, files: 0 },
      { name: 'Services', icon: '⚙️', pattern: /(?:service|provider)/i, files: 0 },
      { name: 'Models/Types', icon: '📦', pattern: /(?:model|type|entity|schema)/i, files: 0 },
      { name: 'Utils', icon: '🔧', pattern: /(?:util|helper|lib)/i, files: 0 },
      { name: 'Tests', icon: '🧪', pattern: /(?:test|spec|__test__)/i, files: 0 },
      { name: 'Config', icon: '⚙️', pattern: /(?:config|setting)/i, files: 0 },
    ];

    for (const file of files) {
      for (const layer of layers) {
        if (layer.pattern.test(file.path)) {
          layer.files++;
          break;
        }
      }
    }

    return layers.filter(l => l.files > 0).map(l => ({
      name: l.name,
      icon: l.icon,
      files: l.files,
    }));
  }
}

// ============================================================================
// Singleton & Exports
// ============================================================================

let codeGuardianInstance: CodeGuardianAgent | null = null;

/**
 * Obtenir l'instance de l'agent Code Guardian
 */
export function getCodeGuardianAgent(): CodeGuardianAgent {
  if (!codeGuardianInstance) {
    codeGuardianInstance = new CodeGuardianAgent();
  }
  return codeGuardianInstance;
}

/**
 * Réinitialiser l'agent (pour les tests)
 */
export function resetCodeGuardianAgent(): void {
  if (codeGuardianInstance) {
    codeGuardianInstance.cleanup();
  }
  codeGuardianInstance = null;
}
