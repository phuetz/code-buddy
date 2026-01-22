/**
 * Code Guardian Agent
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
  AgentTask,
  AgentResult,
} from '../types.js';
import type {
  CodeGuardianMode,
  IssueType,
  IssueSeverity,
  CodeIssue,
  FileAnalysis,
  CodeAnalysis,
  RefactorSuggestion,
  PatchStep,
  PatchPlan,
  PatchDiff,
} from '../../../services/analysis/types.js';
import { CodeAnalyzer } from '../../../services/analysis/code-analyzer.js';
import { CODE_GUARDIAN_CONFIG, ACTION_HELP, SUPPORTED_ACTIONS } from './config.js';
import {
  formatFileAnalysis,
  formatCodeAnalysis,
  formatRefactorSuggestions,
  formatPatchPlan,
  formatPatchDiffs,
  formatIssuesList,
  formatDependencyGraph,
  getSeverityIcon,
} from './formatters.js';

export class CodeGuardianAgent extends SpecializedAgent {
  private currentMode: CodeGuardianMode = 'ANALYZE_ONLY';
  private analysisCache: Map<string, FileAnalysis> = new Map();
  private codeAnalyzer = new CodeAnalyzer();

  constructor() {
    super(CODE_GUARDIAN_CONFIG);
  }

  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.emit('initialized');
  }

  setMode(mode: CodeGuardianMode): void {
    this.currentMode = mode;
    this.emit('mode:changed', mode);
  }

  getMode(): CodeGuardianMode {
    return this.currentMode;
  }

  getSupportedActions(): string[] {
    return SUPPORTED_ACTIONS;
  }

  getActionHelp(action: string): string {
    return ACTION_HELP[action] || `Action inconnue: ${action}`;
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const startTime = Date.now();

    try {
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
  // File Analysis
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

    return {
      success: true,
      data: analysis,
      output: formatFileAnalysis(analysis),
      duration: Date.now() - startTime,
      metadata: { mode: this.currentMode, file: filePath },
    };
  }

  private analyzeFileContent(filePath: string, content: string): FileAnalysis {
    const analysis = this.codeAnalyzer.analyzeFileContent(filePath, content);
    this.analysisCache.set(filePath, analysis);
    return analysis;
  }

  // ============================================================================
  // Directory Analysis
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

    return {
      success: true,
      data: codeAnalysis,
      output: formatCodeAnalysis(codeAnalysis),
      duration: Date.now() - startTime,
      metadata: { mode: this.currentMode, directory: dirPath, fileCount: analyses.length },
    };
  }

  private collectFiles(dir: string, maxDepth: number, ignorePatterns: string[], depth = 0): string[] {
    if (depth >= maxDepth) return [];

    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

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
      const dir = dirname(analysis.relativePath || '');
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

  // ============================================================================
  // Refactoring Suggestions
  // ============================================================================

  private async suggestRefactor(
    inputFiles: string[],
    _params: Record<string, unknown> | undefined,
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

    return {
      success: true,
      data: { suggestions },
      output: formatRefactorSuggestions(suggestions),
      duration: Date.now() - startTime,
      metadata: { mode: this.currentMode, suggestionCount: suggestions.length },
    };
  }

  // ============================================================================
  // Patch Planning
  // ============================================================================

  private createPatchPlan(
    issues: CodeIssue[],
    _params: Record<string, unknown> | undefined,
    startTime: number
  ): AgentResult {
    if (this.currentMode !== 'PATCH_PLAN' && this.currentMode !== 'PATCH_DIFF') {
      return {
        success: false,
        error: 'Mode insuffisant. Utilisez PATCH_PLAN ou PATCH_DIFF.',
      };
    }

    const byFile = new Map<string, CodeIssue[]>();
    for (const issue of issues) {
      const existing = byFile.get(issue.file) || [];
      existing.push(issue);
      byFile.set(issue.file, existing);
    }

    const steps: PatchStep[] = [];
    let order = 1;

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

    return {
      success: true,
      data: { plan },
      output: formatPatchPlan(plan),
      duration: Date.now() - startTime,
      metadata: { mode: this.currentMode, stepCount: steps.length },
    };
  }

  private createPatchDiff(plan: PatchPlan, startTime: number): AgentResult {
    if (this.currentMode !== 'PATCH_DIFF') {
      return {
        success: false,
        error: 'Mode insuffisant. Utilisez PATCH_DIFF.',
      };
    }

    const diffs: PatchDiff[] = plan.steps.map(step => ({
      file: step.file,
      action: step.action,
      hunks: [],
      explanation: `Modification pour: ${step.description}`,
      warnings: step.type === 'bugfix' ?
        ['Vérifier que le comportement attendu est préservé'] :
        [],
    }));

    return {
      success: true,
      data: { diffs, plan },
      output: formatPatchDiffs(diffs, plan),
      duration: Date.now() - startTime,
      metadata: { mode: this.currentMode, diffCount: diffs.length },
    };
  }

  // ============================================================================
  // Other Actions
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

    return {
      success: true,
      data: { issues: filteredIssues, total: filteredIssues.length },
      output: formatIssuesList(filteredIssues),
      duration: Date.now() - startTime,
    };
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

    return {
      success: true,
      data: { graph: Object.fromEntries(dependencyGraph) },
      output: formatDependencyGraph(dependencyGraph),
      duration: Date.now() - startTime,
    };
  }

  private async explainCode(
    filePath: string,
    _params: Record<string, unknown> | undefined,
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
        lines.push(`${getSeverityIcon(i.severity)} ${i.message}`);
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

    const layers = this.detectArchitecturalLayers(analysis.files);
    if (layers.length > 0) {
      lines.push('── Couches détectées ───────────────────────────────────────────');
      layers.forEach(l => lines.push(`   ${l.icon} ${l.name}: ${l.files} fichier(s)`));
      lines.push('');
    }

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
// Singleton
// ============================================================================

let codeGuardianInstance: CodeGuardianAgent | null = null;

export function getCodeGuardianAgent(): CodeGuardianAgent {
  if (!codeGuardianInstance) {
    codeGuardianInstance = new CodeGuardianAgent();
  }
  return codeGuardianInstance;
}

export function resetCodeGuardianAgent(): void {
  if (codeGuardianInstance) {
    codeGuardianInstance.cleanup();
  }
  codeGuardianInstance = null;
}
